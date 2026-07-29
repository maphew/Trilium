import "./note_attributes.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import AttributeList from "../sidebar/AttributeList";

/**
 * The attributes panel as a modal, for the layouts with no right pane to put it in — the mobile one,
 * where it is summoned from the note's own menu. The panel follows the note being read, so the modal is
 * summoned without being told which note it is about.
 */
export default function NoteAttributesDialog() {
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showNoteAttributes", () => setShown(true));

    return (
        <Modal
            className="note-attributes-modal"
            // Named as the menu entry that summons it names it.
            title={t("note_actions.note_attributes")}
            size="md"
            show={shown}
            onHidden={() => setShown(false)}
            scrollable
            isFullPageOnMobile
        >
            <AttributeList />
        </Modal>
    );
}
