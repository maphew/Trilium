import "./MindMapNodePanel.css";

import type { MindElixirInstance, NodeObj } from "mind-elixir";
import { ComponentChildren } from "preact";

import { t } from "../../services/i18n";
import ColorPicker from "../react/ColorPicker";

interface MindMapNodePanelProps {
    mind: MindElixirInstance;
    /** The currently selected nodes; the panel edits all of them at once. */
    nodes: NodeObj[];
}

/**
 * Floating panel displayed over a mind map while at least one node is selected, holding the
 * formatting controls for the selection.
 */
export default function MindMapNodePanel({ mind, nodes }: MindMapNodePanelProps) {
    const textColor = getCommonValue(nodes, (node) => node.style?.color);
    const backgroundColor = getCommonValue(nodes, (node) => node.style?.background);
    const branchColor = getCommonValue(nodes, (node) => node.branchColor);

    /**
     * Applies a patch to every selected node. The selection is read back from the instance rather
     * than taken from the props, so that the elements the patch is applied to are the live ones.
     */
    function patchSelectedNodes(patch: Partial<NodeObj>) {
        for (const topic of mind.currentNodes) {
            mind.reshapeNode(topic, patch);
        }
    }

    return (
        <div
            className="mind-map-node-panel"
            /* Keep interactions inside the panel from reaching the map underneath. */
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <PanelSection label={t("mind-map.text-color")}>
                <ColorPicker
                    {...toPickerValue(textColor)}
                    // Mind Elixir only ever assigns the style properties it is given and never
                    // resets the ones it isn't, so clearing has to blank the property explicitly.
                    onChange={(color) => patchSelectedNodes({ style: { color: color ?? "" } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.background-color")}>
                <ColorPicker
                    {...toPickerValue(backgroundColor)}
                    onChange={(color) => patchSelectedNodes({ style: { background: color ?? "" } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.branch-color")}>
                <ColorPicker
                    // The branches of a map are drawn from the theme's own palette, so those are
                    // the colors offered here.
                    presets={mind.theme.palette}
                    {...toPickerValue(branchColor)}
                    onChange={(color) => patchSelectedNodes({ branchColor: color ?? "" })}
                />
            </PanelSection>
        </div>
    );
}

/** Turns the outcome of {@link getCommonValue} into the matching {@link ColorPicker} state. */
function toPickerValue(value: string | null | typeof MIXED) {
    return {
        currentValue: (value !== MIXED ? value : null),
        indeterminate: (value === MIXED)
    };
}

function PanelSection({ label, children }: { label: string, children: ComponentChildren }) {
    return (
        <div className="mind-map-node-panel-section">
            <div className="mind-map-node-panel-section-label">{label}</div>
            {children}
        </div>
    );
}

/** Returned instead of a value when the selected nodes don't agree on one. */
export const MIXED = Symbol("mixed");

/**
 * Reads one property off every given node, returning the value they share, `null` if none of them
 * has one, or {@link MIXED} if they disagree. Values that are unset and values that were blanked
 * out (see {@link MindMapNodePanel}) count as the same thing.
 */
export function getCommonValue(nodes: NodeObj[], read: (node: NodeObj) => string | undefined): string | null | typeof MIXED {
    let common: string | null | undefined;

    for (const node of nodes) {
        const value = read(node) || null;
        if (common === undefined) {
            common = value;
        } else if (common !== value) {
            return MIXED;
        }
    }

    return common ?? null;
}
