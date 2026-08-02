import "./note_icon.css";

import { Dropdown as BootstrapDropdown } from "bootstrap";
import { t } from "i18next";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { isMobile } from "../services/utils";
import ActionButton from "./react/ActionButton";
import Dropdown from "./react/Dropdown";
import { useNoteContext, useNoteLabel, useWindowSize } from "./react/hooks";
import IconPicker, { ICON_SIZE } from "./react/IconPicker";
import Modal from "./react/Modal";

export default function NoteIcon() {
    const { note, viewScope } = useNoteContext();
    const [ icon, setIcon ] = useState<string | null | undefined>();
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");
    const dropdownRef = useRef<BootstrapDropdown>(null);

    useEffect(() => {
        setIcon(note?.getIcon());
    }, [ note, iconClass, workspaceIconClass ]);

    const isDisabled = viewScope?.viewMode !== "default"
        || note?.isMetadataReadOnly;

    if (isMobile()) {
        return <MobileNoteIconSwitcher note={note} icon={icon} disabled={isDisabled} />;
    }

    return (
        <Dropdown
            className="note-icon-widget"
            title={t("note_icon.change_note_icon")}
            dropdownRef={dropdownRef}
            dropdownContainerStyle={{ width: "620px" }}
            dropdownOptions={{ autoClose: "outside" }}
            // The inline title sets `container-type: inline-size`, which makes it a backdrop root and
            // flattens the menu's blur into a flat tint. Portal the menu out of that subtree; it stays
            // wrapped in a `.note-icon-widget` div so the picker's scoped CSS keeps applying.
            portalToBody
            buttonClassName={`note-icon tn-focusable-button ${icon ?? "bx bx-empty"}`}
            hideToggleArrow
            disabled={isDisabled}
        >
            { note && <NoteIconPicker note={note} onHide={() => dropdownRef?.current?.hide()} columnCount={12} /> }
        </Dropdown>
    );
}

/** The shared picker, made to set and clear the icon of a note. */
function NoteIconPicker({ note, onHide, columnCount }: {
    note: FNote;
    onHide: () => void;
    columnCount: number;
}) {
    const iconLabels = getIconLabels(note);

    return (
        <IconPicker
            columnCount={columnCount}
            onSelect={(iconClass) => {
                const attributeToSet = note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass";
                attributes.setLabel(note.noteId, attributeToSet, iconClass);
                onHide();
            }}
            // Nothing to reset while the note wears the icon its type gives it.
            onReset={iconLabels.length ? () => {
                for (const label of iconLabels) {
                    attributes.removeAttributeById(note.noteId, label.attributeId);
                }
                onHide();
            } : undefined}
        />
    );
}

function MobileNoteIconSwitcher({ note, icon, disabled }: {
    note: FNote | null | undefined;
    icon: string | null | undefined;
    disabled?: boolean;
}) {
    const [ modalShown, setModalShown ] = useState(false);
    const { windowWidth } = useWindowSize();

    return (
        <div className="note-icon-widget">
            <ActionButton
                className="note-icon"
                icon={icon ?? "bx bx-empty"}
                text={t("note_icon.change_note_icon")}
                onClick={() => setModalShown(true)}
                disabled={disabled}
            />

            {createPortal((
                <Modal
                    title={t("note_icon.change_note_icon")}
                    size="xl"
                    show={modalShown} onHidden={() => setModalShown(false)}
                    className="icon-switcher note-icon-widget"
                    scrollable
                >
                    {note && <NoteIconPicker note={note} onHide={() => setModalShown(false)} columnCount={Math.max(1, Math.floor(windowWidth / ICON_SIZE))} />}
                </Modal>
            ), document.body)}
        </div>
    );
}

function getIconLabels(note: FNote) {
    if (!note) {
        return [];
    }
    return note.getOwnedLabels()
        .filter((label) => ["workspaceIconClass", "iconClass"]
            .includes(label.name));
}
