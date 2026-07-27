import "./attribute_detail.css";

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import type { Attribute } from "../../services/attribute_parser.js";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features.js";
import { focusSavedElement, saveFocusedElement } from "../../services/focus.js";
import { t } from "../../services/i18n.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import { disposeReactWidget, renderReactWidgetAtElement } from "../react/react_utils.jsx";

export interface AttributeDetailOpts {
    allAttributes?: Attribute[];
    attribute: Attribute;
    isOwned: boolean;
    x: number;
    y: number;
    focus?: "name";
    parent?: HTMLElement;
    hideMultiplicity?: boolean;
}

/**
 * Transitional adapter keeping the legacy widget contract (`showAttributeDetail()`/`hide()`)
 * while the actual UI is progressively ported to the {@link AttributeDetail} Preact component.
 * Will be removed once the consumers can render the component directly.
 */
export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private opts: AttributeDetailOpts | null = null;

    doRender() {
        // No initial renderComponent() here: doRender() runs synchronously inside the
        // parent's render phase (via useLegacyWidget's useMemo), and a nested Preact
        // render() there corrupts the outer component's hook state.
        this.$widget = $("<div>");
    }

    async refresh() {
        // switching note/tab should close the widget
        this.hide();
    }

    async noteSwitched() {
        this.hide();
    }

    showAttributeDetail(opts: AttributeDetailOpts) {
        if (!opts.attribute) {
            // the attribute can be null at runtime, e.g. when the editor content fails to parse
            this.hide();
            return;
        }

        saveFocusedElement();

        this.opts = opts;
        // The widget has no note context, so isEnabled() is falsy and render()
        // stamps the container with hidden-int; visibility is driven manually,
        // exactly like the legacy widget did. The container must be visible
        // before rendering: the positioning layout effect runs synchronously
        // inside renderComponent() and needs to measure the popup.
        this.toggleInt(true);
        this.renderComponent();
    }

    hide() {
        this.opts = null;
        this.renderComponent();
        this.toggleInt(false);
    }

    cleanup() {
        disposeReactWidget(this.$widget[0]);
    }

    private async cancelAndClose() {
        await this.triggerCommand("reloadAttributes");

        this.hide();

        focusSavedElement();
    }

    private renderComponent() {
        renderReactWidgetAtElement(
            this,
            <AttributeDetail
                opts={this.opts}
                parentOffset={this.parent?.$widget?.offset() ?? { top: 0, left: 0 }}
                onDismiss={() => this.hide()}
                onCancel={() => this.cancelAndClose()}
            />,
            this.$widget[0]);
    }
}

interface AttributeDetailProps {
    opts: AttributeDetailOpts | null;
    /** Offset of the spawning widget, the reference point for classic-layout coordinates. */
    parentOffset: { top: number; left: number };
    /** Plain close, e.g. on click outside the popup. */
    onDismiss: () => void;
    /** Close discarding unsaved changes (close button, escape). */
    onCancel: () => void;
}

function AttributeDetail({ opts, parentOffset, onDismiss, onCancel }: AttributeDetailProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const shown = !!opts;

    // Positioning needs the popup's rendered size, so it runs after the DOM is
    // built but before paint.
    useLayoutEffect(() => {
        if (popupRef.current && opts) {
            positionPopup(popupRef.current, opts, parentOffset);
        }
    }, [ opts, parentOffset ]);

    // Dismiss on click outside the popup, except in floating UI logically belonging
    // to it (autocomplete dropdowns and context menus are appended to the body).
    // Unlike the legacy widget, the listener only exists while the popup is shown.
    useEffect(() => {
        if (!shown) {
            return;
        }

        const onMouseDown = (e: MouseEvent) => {
            if (!(e.target instanceof Element)
                || popupRef.current?.contains(e.target)
                || e.target.closest(".algolia-autocomplete, #context-menu-container")) {
                return;
            }
            onDismiss();
        };

        window.addEventListener("mousedown", onMouseDown);
        return () => window.removeEventListener("mousedown", onMouseDown);
    }, [ shown, onDismiss ]);

    if (!opts) {
        return null;
    }

    const attrType = getAttrType(opts.attribute);

    return (
        <div ref={popupRef} class="attr-detail tn-tool-dialog">
            <div class="attr-detail-header">
                <h5 class="attr-detail-title">{attrType ? ATTR_TITLES[attrType] : ""}</h5>

                <button
                    class="close-attr-detail-button icon-action bx bx-x"
                    title={t("attribute_detail.close_button_title")}
                    onClick={onCancel}
                />
            </div>

            Hello world
        </div>
    );
}

const ATTR_TITLES: Record<string, string> = {
    label: t("attribute_detail.label"),
    "label-definition": t("attribute_detail.label_definition"),
    relation: t("attribute_detail.relation"),
    "relation-definition": t("attribute_detail.relation_definition")
};

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

function positionPopup(popup: HTMLElement, { x, y }: AttributeDetailOpts, parentOffset: { top: number; left: number }) {
    const outerWidth = popup.offsetWidth;
    const outerHeight = popup.offsetHeight;
    const windowHeight = document.documentElement.clientHeight;

    if (!outerWidth || !outerHeight || !windowHeight) {
        console.warn("Can't position popup, is it attached?");
        return;
    }

    const detPosition = getDetailPosition(x, parentOffset.left, outerWidth);

    if (isNewLayout) {
        // The popup always sits above the note attributes pane so it never covers it;
        // when the pane is closed (e.g. opened from the collection column editor),
        // it docks to the status bar instead.
        const attrPane = document.querySelector(".bottom-panel.attribute-list");
        const paneShown = attrPane instanceof HTMLElement && !attrPane.classList.contains("hidden-ext");
        const anchorTop = paneShown
            ? attrPane.getBoundingClientRect().top
            : document.body.clientHeight - (document.querySelector<HTMLElement>(".component.status-bar")?.offsetHeight ?? 0);

        popup.style.left = `${parentOffset.left + (typeof detPosition.left === "number" ? detPosition.left : 0)}px`;
        popup.style.right = "";
        popup.style.top = "unset";
        popup.style.bottom = `${document.body.clientHeight - anchorTop}px`;
        popup.style.maxHeight = `${anchorTop}px`;
    } else {
        popup.style.left = toCssPos(detPosition.left);
        popup.style.right = toCssPos(detPosition.right);
        popup.style.top = `${y - parentOffset.top + 70}px`;
        popup.style.bottom = "";
        popup.style.maxHeight = outerHeight + y > windowHeight - 50 ? `${windowHeight - y - 50}px` : "10000px";
    }
}

function getDetailPosition(x: number, offsetLeft: number, outerWidth: number) {
    let left: number | string = x - offsetLeft - outerWidth / 2;
    let right: number | string = "";

    if (left < 0) {
        left = 10;
    } else {
        const rightEdge = left + outerWidth;

        // Kept bug-for-bug from the legacy widget: this compares against the popup's own
        // width instead of the viewport's, so it holds whenever left >= 0 and the popup
        // effectively pins to the right edge except for far-left clicks.
        if (rightEdge > outerWidth - 10) {
            left = "";
            right = 10;
        }
    }

    return { left, right };
}

/** An empty string clears the property, matching the jQuery `.css()` behavior. */
function toCssPos(value: number | string) {
    return typeof value === "number" ? `${value}px` : value;
}

function getAttrType(attribute: Attribute) {
    if (attribute.type === "label") {
        if (attribute.name.startsWith("label:")) {
            return "label-definition";
        } else if (attribute.name.startsWith("relation:")) {
            return "relation-definition";
        }
        return "label";
    } else if (attribute.type === "relation") {
        return "relation";
    }
}
