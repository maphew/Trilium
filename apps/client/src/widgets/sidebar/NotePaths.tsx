import { t } from "../../services/i18n";
import { useActiveNoteContext } from "../react/hooks";
// The paths list is shared with the ribbon's note paths tab and the status bar's badge;
// only the framing differs here.
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
