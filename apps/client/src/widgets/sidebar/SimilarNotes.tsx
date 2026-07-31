import { t } from "../../services/i18n";
import { useActiveNoteContext } from "../react/hooks";
// The list itself is shared with the ribbon's similar notes tab and the status bar's
// bottom panel; only the framing differs here.
import SimilarNotesTab from "../ribbon/SimilarNotesTab";
import RightPanelWidget from "./RightPanelWidget";

export default function SimilarNotes() {
    const { note } = useActiveNoteContext();

    return (
        <RightPanelWidget id="similarNotes" title={t("similar_notes.title")}>
            {note && <SimilarNotesTab note={note} />}
        </RightPanelWidget>
    );
}
