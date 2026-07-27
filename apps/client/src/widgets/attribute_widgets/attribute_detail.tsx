import "./attribute_detail.css";

import type { Attribute } from "../../services/attribute_parser.js";
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

    private renderComponent() {
        renderReactWidgetAtElement(this, <AttributeDetail opts={this.opts} />, this.$widget[0]);
    }
}

function AttributeDetail({ opts }: { opts: AttributeDetailOpts | null }) {
    if (!opts) {
        return null;
    }

    return (
        <div class="attr-detail tn-tool-dialog" style={{ left: opts.x, top: opts.y }}>
            Hello world
        </div>
    );
}
