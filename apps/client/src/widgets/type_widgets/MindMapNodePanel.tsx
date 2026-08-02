import "./MindMapNodePanel.css";

import type { MindElixirInstance, NodeObj } from "mind-elixir";
import { ComponentChildren } from "preact";

import { t } from "../../services/i18n";
import ColorPicker, { DEFAULT_COLOR_PALETTE } from "../react/ColorPicker";
import SegmentedChoice from "../react/SegmentedChoice";

/**
 * The hues offered by the panel: as many of the shared palette as fit on a single row next to the
 * clear and custom cells.
 */
export const NODE_COLORS = [0, 1, 2, 4, 7, 9].map((index) => DEFAULT_COLOR_PALETTE[index]);

/**
 * Backgrounds are the same hues at a quarter opacity. That keeps a node readable when its text and
 * its background are set to "the same" color, and lets a single set of swatches sit well on both
 * the light and the dark map theme, since the tint takes on whatever the canvas is.
 */
export const NODE_BACKGROUND_COLORS = NODE_COLORS.map((color) => `${color}40`);

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
    const fontSize = getCommonValue(nodes, (node) => node.style?.fontSize);
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
            <PanelSection label={t("mind-map.font-size")}>
                <SegmentedChoice
                    options={buildFontSizeOptions()}
                    currentValue={fontSize !== MIXED ? fontSize ?? DEFAULT_FONT_SIZE : MIXED_FONT_SIZE}
                    onChange={(fontSize) => patchSelectedNodes({ style: { fontSize } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.text-color")}>
                <ColorPicker
                    presets={NODE_COLORS}
                    {...toPickerValue(textColor)}
                    // Mind Elixir only ever assigns the style properties it is given and never
                    // resets the ones it isn't, so clearing has to blank the property explicitly.
                    onChange={(color) => patchSelectedNodes({ style: { color: color ?? "" } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.background-color")}>
                <ColorPicker
                    presets={NODE_BACKGROUND_COLORS}
                    {...toPickerValue(backgroundColor)}
                    onChange={(color) => patchSelectedNodes({ style: { background: color ?? "" } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.branch-color")}>
                <ColorPicker
                    presets={NODE_COLORS}
                    {...toPickerValue(branchColor)}
                    onChange={(color) => patchSelectedNodes({ branchColor: color ?? "" })}
                />
            </PanelSection>
        </div>
    );
}

/**
 * A node of medium size is one with no size of its own: that is what a node comes with, and it
 * leaves the root, which is larger by default, at the size its level implies rather than pinning
 * it to the size of an ordinary node.
 */
export const DEFAULT_FONT_SIZE = "";

/** Matches none of the sizes, for a selection whose nodes are not all of the same size. */
const MIXED_FONT_SIZE = "mixed";

/** The sizes a node can be given, after the ones the canvas note type offers. */
function buildFontSizeOptions() {
    return [
        { value: "12px", label: t("mind-map.font-size-small") },
        { value: DEFAULT_FONT_SIZE, label: t("mind-map.font-size-medium") },
        { value: "24px", label: t("mind-map.font-size-large") },
        { value: "32px", label: t("mind-map.font-size-extra-large") }
    ];
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
