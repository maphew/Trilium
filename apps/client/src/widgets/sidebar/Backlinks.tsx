import { t } from "../../services/i18n";
// The list itself is shared with the status bar's backlinks badge; only the framing differs here.
import { BacklinksList } from "../FloatingButtonsDefinitions";
import { useActiveNoteContext } from "../react/hooks";
import RightPanelWidget from "./RightPanelWidget";

export default function Backlinks() {
    const { note } = useActiveNoteContext();

    return (
        <RightPanelWidget id="backlinks" title={t("right_pane.backlinks")} grow>
            {note && (
                // The classes the shared list's card styling hangs off (see ../Backlinks.css).
                <div class="tn-backlinks-widget">
                    <ul class="backlinks-items">
                        <BacklinksList note={note} />
                    </ul>
                </div>
            )}
        </RightPanelWidget>
    );
}
