import { AttributeRow } from "@triliumnext/commons";

import FNote from "../../../entities/fnote";
import { setAttribute, setLabel } from "../../../services/attributes";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import { deleteNoteOrBranch } from "../../../services/note_deletion";

interface NewEventOpts {
    /** Left out, the note is named the way any new child of the calendar is — by the calendar's
     *  `#titleTemplate` where one is set (see getNewNoteTitle in trilium-core). */
    title?: string;
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    componentId?: string;
}

interface ChangeEventOpts {
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    componentId?: string;
}

export async function newEvent(parentNote: FNote, { title, startDate, endDate, startTime, endTime, componentId }: NewEventOpts) {
    const attributes: Omit<AttributeRow, "noteId" | "attributeId">[] = [];
    attributes.push({
        type: "label",
        name: "startDate",
        value: startDate
    });
    if (endDate) {
        attributes.push({
            type: "label",
            name: "endDate",
            value: endDate
        });
    }
    if (startTime) {
        attributes.push({
            type: "label",
            name: "startTime",
            value: startTime
        });
    }
    if (endTime) {
        attributes.push({
            type: "label",
            name: "endTime",
            value: endTime
        });
    }

    // Create the note, and hand it back for the detail dock to open on.
    const { note } = await note_create.createNote(parentNote.noteId, {
        title,
        isProtected: parentNote.isProtected,
        content: "",
        type: "text",
        attributes,
        activate: false
    }, componentId);

    return note;
}

/**
 * Takes an event off the calendar, having asked first, and offers to delete its note while it is at
 * it — the bargain the geo map strikes for a marker (see removeFromMap there): taking an event off
 * the calendar and getting rid of its note are different wishes, and granting only one of them left
 * a note behind that the calendar no longer showed. What deleting would actually cost is the
 * dialog's to work out and to say (see confirmDeleteNoteBoxWithNote); all this has to know is which
 * branch the calendar holds the note by.
 *
 * Answers whether anything was done, the caller's pane having nothing else to close itself by: an
 * event taken off the calendar is still a note of the collection, so no watcher of the collection's
 * notes will stand the pane down.
 */
export async function removeFromCalendar(note: FNote, calendarNote: FNote) {
    // The calendar's own branch for the note, which is how a note the calendar merely shows —
    // cloned in from elsewhere, and clone-able out again — is told from one that lives here and
    // nowhere else.
    const branchId = note.parentToBranch[calendarNote.noteId] ?? null;

    const result = await dialog.confirmDeleteNoteBoxWithNote(
        note.title,
        { noteId: note.noteId, branchId },
        { message: t("calendar_view.remove_from_calendar_confirmation", { title: note.title }) }
    );

    if (typeof result !== "object" || !result.confirmed) {
        return false;
    }

    if (result.isDeleteNoteChecked) {
        await deleteNoteOrBranch(note.noteId, branchId);
    } else {
        // Only the start date goes — the label the calendar draws the event by, which the note may
        // name for itself (see changeEvent). Whatever else the note holds about its dates keeps:
        // an end or a time without a start puts nothing on the calendar.
        const startAttribute = note.getLabelValue("calendar:startDate") || "startDate";
        await setAttribute(note, "label", startAttribute, undefined);
    }

    return true;
}

export async function changeEvent(note: FNote, { startDate, endDate, startTime, endTime, componentId }: ChangeEventOpts) {
    // Don't store the end date if it's empty.
    if (endDate === startDate) {
        endDate = undefined;
    }

    // Since they can be customized via calendar:startDate=$foo and calendar:endDate=$bar we need to determine the
    // attributes to be effectively updated
    let startAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:startDate").shift()?.value||"startDate";
    let endAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:endDate").shift()?.value||"endDate";

    const noteId = note.noteId;
    setLabel(noteId, startAttribute, startDate, false, componentId);
    setAttribute(note, "label", endAttribute, endDate, componentId);

    startAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:startTime").shift()?.value||"startTime";
    endAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:endTime").shift()?.value||"endTime";

    setAttribute(note, "label", startAttribute, startTime, componentId);
    setAttribute(note, "label", endAttribute, endTime, componentId);
}
