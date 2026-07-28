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

/** Switches the section to Browse, focused on the given path. */
export type ShowDetailsHandler = (notePath: string[]) => void;

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
    onShowDetails: ShowDetailsHandler
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

    // The root has no parent, so it has neither a branch to delete nor a path the export dialog can
    // resolve into one.
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

        { kind: "separator" },

        {
            title: t("tree-context-menu.delete"),
            uiIcon: "bx bx-trash destructive-action-icon",
            enabled: !!branchId,
            handler: () => {
                if (branchId) {
                    void branches.deleteNotes([ branchId ], false, false);
                }
            }
        }
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
