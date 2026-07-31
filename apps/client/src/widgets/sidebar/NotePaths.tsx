import { t } from "../../services/i18n";
import { useActiveNoteContext } from "../react/hooks";
// The paths list is shared with the ribbon's note paths tab; only the framing differs here. The status
// bar's badge has no list of its own — it opens this one.
import { NotePathsWidget, useSortedNotePaths } from "../ribbon/NotePathsTab";
import RightPanelWidget from "./RightPanelWidget";

export default function NotePaths() {
    const { note, notePath, hoistedNoteId } = useActiveNoteContext();
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);

    return (
        <RightPanelWidget id="notePaths" title={t("note_paths.title")}>
            <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} />
        </RightPanelWidget>
    );
}
