// Also imported by the map itself, which the styles of its container belong to: the header's are
// wanted before it has finished loading, so they cannot wait for that module to arrive.
import "./NoteMap.css";

import { t } from "../../services/i18n";
import MapTypeSwitcher from "../note_map/MapTypeSwitcher";
import { toMapType } from "../note_map/utils";
import { useActiveNoteContext, useNoteLabel } from "../react/hooks";
import LazyComponent from "../react/LazyComponent";
import RightPanelWidget from "./RightPanelWidget";

/**
 * The card is rendered here and the map itself loaded on demand from within it, rather than the whole
 * widget being loaded on demand from the pane: the lazy wrapper is a `display: contents` element, which
 * leaves no box but is still an element as far as selectors are concerned, so a card behind it is no
 * longer a child of the tab body and misses everything the pane styles by that relation — its dividing
 * border, the first card's header padding, the sharing out of the tab's height.
 *
 * Which map to draw is asked here too, rather than in the map's own floating overlay: a card of the
 * pane keeps its controls in its header, and a map this small has little room to stand buttons over.
 * The map reads the same label, so the two stay of one mind without being told.
 */
export default function NoteMap() {
    const { note } = useActiveNoteContext();
    const [ mapTypeLabel, setMapType ] = useNoteLabel(note, "mapType");

    return (
        <RightPanelWidget
            id="noteMap"
            title={t("note_map.title")}
            buttons={<MapTypeSwitcher mapType={toMapType(mapTypeLabel)} setMapType={setMapType} />}
            noPadding
        >
            <LazyComponent loader={() => import("./NoteMapGraph.jsx")} />
        </RightPanelWidget>
    );
}
