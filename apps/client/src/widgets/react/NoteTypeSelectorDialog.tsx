import "./NoteTypeSelectorDialog.css";

import { useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import {
    type NoteTypeOption, type NoteTypeOptionGroup, noteTypeOptionGroupTitle
} from "../../services/note_types";
import Button from "./Button";
import FormCheckbox from "./FormCheckbox";
import Icon from "./Icon";
import Modal from "./Modal";

/**
 * Which of the things a note can be made from a feature offers, ticked off a list of all of them.
 *
 * Written for anything that lets the reader narrow the choice down to what they actually use: a
 * board's card templates are the first, and the dialog knows nothing of boards. Saving an empty
 * selection is refused, since a feature that offers nothing can make nothing.
 */
export default function NoteTypeSelectorDialog({
    available, selected, shown, title, hint, onSave, onClose
}: {
    /** Everything that could be offered, usually `getNoteTypeOptions()`. */
    available: NoteTypeOption[],
    /** What is offered now, which is what the dialog opens on. */
    selected: string[],
    shown: boolean,
    title: string,
    /** A line above the list saying what the choice is for. */
    hint?: string,
    onSave: (ids: string[]) => void,
    onClose: () => void
}) {
    const [ picked, setPicked ] = useState<string[]>(selected);

    // Opened on what is offered now rather than on what was offered when it was first drawn: the
    // dialog is kept mounted and shown by a flag.
    useEffect(() => {
        if (shown) {
            setPicked(selected);
        }
    }, [ shown, selected ]);

    const groups = useMemo(() => {
        const byGroup = new Map<NoteTypeOptionGroup, NoteTypeOption[]>();
        for (const option of available) {
            byGroup.set(option.group, [ ...(byGroup.get(option.group) ?? []), option ]);
        }

        return [ ...byGroup.entries() ];
    }, [ available ]);

    return (
        <Modal
            className="note-type-selector-dialog"
            title={title}
            size="lg"
            scrollable
            // Raised the way every dialog opened from a menu is: the menu's own backdrop stands
            // above the stock modal layer, and would otherwise cover this.
            zIndex={2000}
            show={shown}
            onSubmit={() => {
                onSave(picked);
                onClose();
            }}
            onHidden={onClose}
            footer={<>
                <Button text={t("modal.cancel")} onClick={onClose} />
                <Button
                    text={t("note_types.selector-save")}
                    keyboardShortcut="Enter"
                    kind="primary"
                    disabled={!picked.length}
                />
            </>}
        >
            {hint && <p className="note-type-selector-hint">{hint}</p>}

            {groups.map(([ group, options ]) => (
                <section key={group}>
                    <h5>{noteTypeOptionGroupTitle(group)}</h5>
                    {options.map((option) => (
                        <FormCheckbox
                            key={option.id}
                            name={option.id}
                            label={<><Icon icon={option.icon} /> {option.title}</>}
                            currentValue={picked.includes(option.id)}
                            onChange={(checked) => setPicked((was) => checked
                                ? [ ...was, option.id ]
                                : was.filter((id) => id !== option.id))}
                        />
                    ))}
                </section>
            ))}
        </Modal>
    );
}
