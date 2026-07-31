import { t } from "../../services/i18n";
import LazyComponent from "../react/LazyComponent";
import RightPanelWidget from "./RightPanelWidget";

/**
 * The card is rendered here and the map itself loaded on demand from within it, rather than the whole
 * widget being loaded on demand from the pane: the lazy wrapper is a `display: contents` element, which
 * leaves no box but is still an element as far as selectors are concerned, so a card behind it is no
 * longer a child of the tab body and misses everything the pane styles by that relation — its dividing
 * border, the first card's header padding, the sharing out of the tab's height.
 */
export default function NoteMap() {
    return (
        <RightPanelWidget
            id="noteMap"
            title={t("note_map.title")}
            noPadding
        >
            <LazyComponent loader={() => import("./NoteMapGraph.jsx")} />
        </RightPanelWidget>
    );
}
