import "./EditToolbar.css";

import { useContext } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayToolbar, { OverlayToolbarButton } from "../../react/OverlayToolbar";
import { ParentMap } from "./map";

interface EditToolbarProps {
    /** The map may not be edited, which is every one of these buttons refused at once. */
    isReadOnly: boolean;
    /** The map is armed for the next click to place a new note, which the button wears as held
     *  down (see OverlayToolbar's active styling). */
    placing: boolean;
    /** Arms the map for a note to be placed, or stands it down again — the visible counterpart of
     *  the Escape the instruction toast offers (see index.tsx). */
    onTogglePlacement: () => void;
}

/**
 * The bar of editing actions, standing in the map's top leading corner: adding a note today, with
 * room down the column for whatever editing the map comes to offer next.
 *
 * A bar of its own rather than more buttons on {@link MapToolbar}: that one is the camera — how
 * close in the map is drawn, how much screen it gets — and what changes the map is another kind of
 * thing. The corner is the last one free, and the one with room to grow: the trailing edge belongs
 * to the detail pane, and the foot to the camera bar on one side and the scale on the other.
 *
 * It stands on the map rather than in the collection bar above it because the map alone is what
 * goes fullscreen (see MapToolbar): the collection bar stays behind, and while the button lived
 * there, a fullscreen map could only be added to through its right-click menu.
 */
export default function EditToolbar({ isReadOnly, placing, onTogglePlacement }: EditToolbarProps) {
    const map = useContext(ParentMap);

    // No bar over a map that could not be drawn (see the WebGL fallback in map.tsx).
    if (!map) return null;

    return (
        // Standing at the leading edge, the tooltips open inward, over the map.
        <OverlayToolbar className="geo-edit-toolbar" titlePosition={glob.isRtl ? "left" : "right"}>
            <OverlayToolbarButton
                icon="bx bx-plus"
                text={placing ? t("geo-map.create-child-note-cancel") : t("geo-map.create-child-note-title")}
                active={placing}
                disabled={isReadOnly}
                onClick={onTogglePlacement}
            />
        </OverlayToolbar>
    );
}
