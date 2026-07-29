import appContext from "../../../../../components/app_context";
import type FNote from "../../../../../entities/fnote";
import contextMenu, {
    type ContextMenuEvent,
    type MenuItem
} from "../../../../../menus/context_menu";
import branches from "../../../../../services/branches";
import froca from "../../../../../services/froca";
import { t } from "../../../../../services/i18n";
import { downloadFileNote } from "../../../../../services/open";
import server from "../../../../../services/server";
import toast from "../../../../../services/toast";

const ROOT_NOTE_ID = "root";

/** Switches the section to Browse, focused on the given path. */
export type ShowDetailsHandler = (notePath: string[]) => void;

/**
 * Asks the section for a fresh reading, after this menu changed what there is to measure.
 *
 * The views take a reading when asked rather than following the database, so an action taken from
 * within them has to say so — otherwise a note the user just deleted keeps its cell, and the totals
 * keep counting it.
 */
export type ContentChangedHandler = () => void;

/**
 * The actions every Space Usage view offers on a note it draws — the treemap cells of Overview, the
 * children ring and center note of Browse. One builder so a note answers the same way whichever
 * chart the pointer is over.
 *
 * `notePath` runs from the root (inclusive) down to the note: the charts already carry it for their
 * links, and it is what identifies the placement to act on — a clone occupies space once, at the
 * canonical placement the usage figures were attributed to, so that is the branch Delete removes
 * and the path Export resolves.
 */
export async function openSpaceUsageContextMenu(
    event: ContextMenuEvent,
    notePath: string[],
    onShowDetails: ShowDetailsHandler,
    onContentChanged: ContentChangedHandler
) {
    event.preventDefault();
    event.stopPropagation();

    const noteId = notePath[notePath.length - 1];
    const parentNoteId = notePath[notePath.length - 2];
    // Silent: the usage snapshot predates the menu, so the note may already be gone — no menu,
    // no error.
    const note = noteId ? await froca.getNote(noteId, true) : null;

    if (!note) {
        return;
    }

    // The root has no parent, so no path the export dialog can resolve into a branch. Note that
    // `getBranchId` answers the placeholder "none_root" for the root rather than nothing, so the
    // root is recognised by its ID and never by the absence of a branch.
    const isRoot = noteId === ROOT_NOTE_ID;
    const branchId = parentNoteId ? await froca.getBranchId(parentNoteId, noteId) : null;
    const notePathString = notePath.join("/");

    // Wording and icons are borrowed from the surfaces that already offer these actions — the tree
    // context menu and the note menu — so a note reads the same here as it does there. Only "Show
    // details" is particular to Space Usage.
    const items: MenuItem<never>[] = [
        {
            title: t("tree-context-menu.open-in-popup"),
            uiIcon: "bx bx-edit",
            handler: () => quickEditNote(notePath)
        },
        {
            title: t("tree-context-menu.open-in-a-new-tab"),
            uiIcon: "bx bx-link-external",
            handler: () => openNoteInNewTab(noteId)
        },
        {
            title: t("space_usage.menu_show_details"),
            uiIcon: "bx bx-detail",
            handler: () => onShowDetails(notePath)
        },

        { kind: "separator" },

        ...(isDownloadable(note) ? [ {
            title: t("file_properties.download"),
            uiIcon: "bx bx-download",
            enabled: note.isContentAvailable(),
            handler: () => downloadFileNote(note, null, null)
        } ] : []),
        {
            title: t("tree-context-menu.export"),
            uiIcon: "bx bx-export",
            enabled: !!parentNoteId,
            handler: () => {
                void appContext.triggerCommand("showExportDialog", {
                    notePath: notePathString,
                    defaultType: "subtree"
                });
            }
        },

        // The root cannot be deleted at all, so it is left out rather than shown struck through —
        // and its separator goes with it, or the menu would end on a dangling divider.
        ...(isRoot ? [] : [
            { kind: "separator" as const },
            {
                title: t("tree-context-menu.delete"),
                uiIcon: "bx bx-trash destructive-action-icon",
                enabled: !!branchId,
                handler: () => {
                    if (!branchId) {
                        return;
                    }

                    // Only once the deletion actually happened: `deleteNotes` answers false when
                    // the user backs out of its confirmation, and re-measuring the whole database
                    // for a cancelled action is exactly what the views avoid doing.
                    void branches.deleteNotes([ branchId ], false, false)
                        .then((deleted) => deleted && onContentChanged());
                }
            }
        ])
    ];

    await contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items,
        // Every item carries its own handler; nothing here dispatches a command by name.
        selectMenuItemHandler: () => {}
    });
}

/**
 * The menu on the deleted-notes cell, which stands for space the tree has already let go of but the
 * database still holds until the retention window runs out. Its one action is releasing that space
 * now — the same erasure the Recent Changes dialog and the options page run, so the wording and the
 * confirmation-free behaviour are theirs.
 */
export async function openDeletedNotesContextMenu(
    event: ContextMenuEvent,
    onContentChanged: ContentChangedHandler
) {
    event.preventDefault();
    event.stopPropagation();

    await contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [ {
            title: t("recent_changes.erase_notes_button"),
            uiIcon: "bx bx-trash destructive-action-icon",
            handler: () => {
                void server.post("notes/erase-deleted-notes-now").then(() => {
                    toast.showMessage(t("recent_changes.deleted_notes_message"));
                    // The cell just lost everything it stood for, so the section has to measure
                    // again — the views take a reading when asked, never on their own.
                    onContentChanged();
                });
            }
        } ],
        selectMenuItemHandler: () => {}
    });
}

/**
 * The default action on a Space Usage note: the quick-edit popup, which stacks above the settings
 * dialog instead of replacing what the user was looking at.
 */
export function quickEditNote(notePath: string[]) {
    void appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath.join("/") });
}

/** Opens the note in a new tab, leaving the settings page in place. */
export function openNoteInNewTab(noteId: string) {
    void appContext.tabManager.openContextWithNote(noteId, {
        activate: true,
        hoistedNoteId: appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null
    });
}

/** Note types whose content is a saveable file — the same ones the ribbon offers Download for. */
function isDownloadable(note: FNote) {
    return note.type === "file" || note.type === "image";
}
