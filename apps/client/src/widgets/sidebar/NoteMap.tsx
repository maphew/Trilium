import "./NoteMap.css";

import { useRef } from "preact/hooks";

import { t } from "../../services/i18n";
// The map itself is shared with the ribbon's note map tab and the note map note type;
// only the framing differs here.
import NoteMapEl from "../note_map/NoteMap";
import { useActiveNoteContext } from "../react/hooks";
import RightPanelWidget from "./RightPanelWidget";

export default function NoteMap() {
    const { note } = useActiveNoteContext();
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <RightPanelWidget id="noteMap" title={t("note_map.title")}>
            {note && (
                <div class="sidebar-note-map" ref={containerRef}>
                    {/* "sidebar" mode roots the map at the note being read, which is what a
                        connections panel is about (the other modes root it at a configured
                        or hoisted note), and drops the notes nothing links to — see
                        loadNotesAndRelations. */}
                    <NoteMapEl note={note} widgetMode="sidebar" parentRef={containerRef} />
                </div>
            )}
        </RightPanelWidget>
    );
}
