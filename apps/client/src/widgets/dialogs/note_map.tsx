import "./note_map.css";

import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import NoteMap from "../note_map/NoteMap";
import { useActiveNoteContext, useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";

/**
 * The note map as a modal, for the layouts with no right pane to put it in — the mobile one, where it
 * is summoned from the note's own menu. The map follows the note being read, so the modal is summoned
 * without being told which note it is about.
 *
 * Drawn as the connections card's map expanded is drawn, which is what this is a phone's answer to:
 * the same two maps to choose between, remembered the same way.
 */
export default function NoteMapDialog() {
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showNoteMap", () => setShown(true));

    return (
        <Modal
            className="note-map-modal"
            // Named as the menu entry that summons it names it.
            title={t("note_map.title")}
            size="lg"
            show={shown}
            onHidden={() => setShown(false)}
            isFullPageOnMobile
        >
            <NoteMapBody />
        </Modal>
    );
}

function NoteMapBody() {
    const { note } = useActiveNoteContext();
    const containerRef = useRef<HTMLDivElement>(null);

    if (!note) {
        return null;
    }

    return (
        <div class="note-map-modal-body" ref={containerRef}>
            <NoteMap note={note} widgetMode="expanded" parentRef={containerRef} />
        </div>
    );
}
