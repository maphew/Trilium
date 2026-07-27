import "./attribute_detail.css";

import { useEffect, useRef } from "preact/hooks";

import type { Attribute } from "../../services/attribute_parser.js";
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
        this.renderComponent();
        // The widget has no note context, so isEnabled() is falsy and render()
        // stamps the container with hidden-int; visibility is driven manually,
        // exactly like the legacy widget did.
        this.toggleInt(true);
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
                onDismiss={() => this.hide()}
                onCancel={() => this.cancelAndClose()}
            />,
            this.$widget[0]);
    }
}

interface AttributeDetailProps {
    opts: AttributeDetailOpts | null;
    /** Plain close, e.g. on click outside the popup. */
    onDismiss: () => void;
    /** Close discarding unsaved changes (close button, escape). */
    onCancel: () => void;
}

function AttributeDetail({ opts, onDismiss, onCancel }: AttributeDetailProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const shown = !!opts;

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
        <div ref={popupRef} class="attr-detail tn-tool-dialog" style={{ left: opts.x, top: opts.y }}>
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
