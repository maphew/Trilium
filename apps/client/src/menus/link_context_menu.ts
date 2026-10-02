import type { CKTextEditor } from "@triliumnext/ckeditor5";

import type { GeoMouseEvent } from "../widgets/collections/geomap/map.js";

import appContext, { type CommandNames } from "../components/app_context.js";
import type FAttachment from "../entities/fattachment.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import type { ViewScope } from "../services/link.js";
import utils, { isMobile } from "../services/utils.js";
import { getClosestNtxId } from "../widgets/widget_utils.js";
import contextMenu, { type ContextMenuOptions, type MenuItem } from "./context_menu.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

/**
 * Where a link menu opens, and the element it is opened from. A mouse event is one; a control
 * acting on something shown elsewhere passes that thing as `target`.
 */
export type LinkMenuOrigin = Pick<MouseEvent, "pageX" | "pageY" | "target">;

let lastMenuRequest = 0;

async function openContextMenu(
    notePath: string,
    e: LinkMenuOrigin,
    viewScope: ViewScope = {},
    hoistedNoteId: string | null = null
) {
    const request = ++lastMenuRequest;
    const noteId = notePath.split("/").at(-1) ?? notePath;
    const editor = await getEditingTextEditor(getTarget(e));
    const attachmentItems = await getAttachmentItems(noteId, viewScope, e, editor);
    // A later right-click opened its own menu while this one waited for the editor or the
    // attachment.
    if (request !== lastMenuRequest) {
        return;
    }

    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [ ...getItems(e), ...attachmentItems ],
        selectMenuItemHandler: ({ command }) => handleLinkContextMenuItem(command, e, notePath, viewScope, hoistedNoteId),
        ...(editor ? keepEditorFocused(editor) : {})
    });
}

/**
 * Menu options adding the menu to the focus tracker of `editor`, so that the editor stays focused
 * while the menu is up.
 */
function keepEditorFocused(
    editor: CKTextEditor
): Pick<ContextMenuOptions<CommandNames>, "onShow" | "onHide"> {
    let menuContainer: HTMLElement | null = null;

    return {
        onShow: (container) => {
            menuContainer = container;
            editor.ui.focusTracker.add(container);
        },
        onHide: () => {
            if (menuContainer) {
                editor.ui.focusTracker.remove(menuContainer);
            }
        }
    };
}

function getItems(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames>[] {
    return [ ...getOpenItems(e), getQuickEditItem() ];
}

/** The places the note can be opened in, without the quick edit popup. */
function getOpenItems(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames>[] {
    const ntxId = getNtxId(e);
    const isMobileSplitOpen = isMobile() && appContext.tabManager.getNoteContextById(ntxId).getMainContext().getSubContexts().length > 1;

    return [
        { title: t("link_context_menu.open_note_in_new_tab"), command: "openNoteInNewTab", uiIcon: "bx bx-link-external" },
        { title: !isMobileSplitOpen ? t("link_context_menu.open_note_in_new_split") : t("link_context_menu.open_note_in_other_split"), command: "openNoteInNewSplit", uiIcon: "bx bx-dock-right" },
        { title: t("link_context_menu.open_note_in_new_window"), command: "openNoteInNewWindow", uiIcon: "bx bx-window-open" }
    ];
}

/** Opens the note in a popup over the current one. */
function getQuickEditItem(): MenuItem<CommandNames> {
    return { title: t("link_context_menu.open_note_in_popup"), command: "openNoteInPopup", uiIcon: "bx bx-edit" };
}

/**
 * The same places, folded into one submenu, for a menu that lists entries of its own beside them.
 *
 * The items keep their commands, so `handleLinkContextMenuItem` handles them from a submenu as it
 * does from the top level. The entry carries the first of those commands itself, so that picking it
 * opens a new tab without going into the submenu for the place it is opened in most often.
 */
function getOpenNoteItem(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames> {
    return {
        title: t("link_context_menu.open_note"),
        uiIcon: "bx bx-link-external",
        command: "openNoteInNewTab",
        items: getOpenItems(e)
    };
}

function handleLinkContextMenuItem(command: string | undefined, e: LinkMenuOrigin | GeoMouseEvent, notePath: string, viewScope = {}, hoistedNoteId: string | null = null) {
    if (!hoistedNoteId) {
        hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null;
    }

    if (command === "openNoteInNewTab") {
        appContext.tabManager.openContextWithNote(notePath, {
            hoistedNoteId, viewScope, placement: "afterCurrent"
        });
        return true;
    } else if (command === "openNoteInNewSplit") {
        const ntxId = getNtxId(e);
        if (!ntxId) return false;
        appContext.triggerCommand("openNewNoteSplit", { ntxId, notePath, hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInNewWindow") {
        appContext.triggerCommand("openInWindow", { notePath, hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInPopup") {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath, viewScope });
        return true;
    }

    return false;
}

/** The actions on the attachment a link points to, each group after a separator. */
async function getAttachmentItems(
    noteId: string,
    { viewMode, attachmentId }: ViewScope,
    e: LinkMenuOrigin,
    editor: CKTextEditor | null
): Promise<MenuItem<CommandNames>[]> {
    if (viewMode !== "attachments" || !attachmentId) {
        return [];
    }

    // Imported on demand: `attachment_actions` imports `link`, which imports this module.
    const [ attachment, { getAttachmentActionGroups } ] = await Promise.all([
        froca.getAttachmentOfNote(noteId, attachmentId),
        import("../services/attachment_actions.js")
    ]);
    if (!attachment) {
        return [];
    }

    const groups = getAttachmentActionGroups(attachment);
    const actionItems = groups.flatMap((group): MenuItem<CommandNames>[] => [
        { kind: "separator" },
        ...group.map((action) => ({
            title: action.title,
            uiIcon: action.icon,
            enabled: !action.disabledReason,
            handler: () => void action.run()
        }))
    ]);

    const embedItem = await getConvertToEmbedItem(e, editor, attachment);
    const conversionItems = [ embedItem, getConvertToLinkItem(e, editor) ]
        .filter((item) => item !== null);
    return [ ...actionItems, ...conversionItems ];
}

/** "Convert link to an embed", for an attachment link in a text note open for editing. */
async function getConvertToEmbedItem(
    e: LinkMenuOrigin,
    editor: CKTextEditor | null,
    attachment: FAttachment
): Promise<MenuItem<CommandNames> | null> {
    const link = getTarget(e)?.closest<HTMLElement>("a.reference-link");
    if (!link || !editor?.commands.get("embedAttachmentLink")?.isEnabled) {
        return null;
    }

    // Imported on demand: `content_renderer` imports `link`, which imports this module.
    const { getIncludeBoxSize } = await import("../services/content_renderer.js");
    return {
        title: t("link_context_menu.convert_link_to_embed"),
        uiIcon: "bx bx-window-alt",
        handler: () => editor.execute("embedAttachmentLink", {
            domElement: link,
            boxSize: getIncludeBoxSize(attachment)
        })
    };
}

/**
 * "Convert to link", for a menu opened from the title row of an attachment embed in a text note
 * open for editing.
 */
function getConvertToLinkItem(
    e: LinkMenuOrigin,
    editor: CKTextEditor | null
): MenuItem<CommandNames> | null {
    const titleRow = getTarget(e)?.closest<HTMLElement>(".include-note-title-row");
    if (!titleRow?.closest(".include-note[data-attachment-id]")
            || !editor?.plugins.has("IncludeNote") || !editor.commands.get("convertEmbedToLink")) {
        return null;
    }

    return {
        title: t("link_context_menu.convert_embed_to_link"),
        uiIcon: "bx bx-link",
        handler: () => {
            // `convertEmbedToLink` acts on the selected embed.
            if (editor.plugins.get("IncludeNote").selectIncludeAt(titleRow)) {
                editor.execute("convertEmbedToLink");
            }
        }
    };
}

function getTarget(e: LinkMenuOrigin) {
    return e.target instanceof Element ? e.target : null;
}

/** The text editor containing `element`, or `null` when there is none or it is read-only. */
async function getEditingTextEditor(element: Element | null) {
    // Checked first: a note shown read-only has no editor, and asking for one waits for a timeout.
    if (!element?.closest(".ck-editor__editable[contenteditable='true']")) {
        return null;
    }

    return getTextEditorContaining(element);
}

function getNtxId(e: LinkMenuOrigin | GeoMouseEvent) {
    if (utils.isDesktop()) {
        const subContexts = appContext.tabManager.getActiveContext()?.getSubContexts();
        if (!subContexts) return null;
        return subContexts[subContexts.length - 1].ntxId;
    } else {
        const target = "originalEvent" in e ? e.originalEvent?.target : e.target;
        if (target instanceof HTMLElement) {
            const closest = getClosestNtxId(target);
            if (closest) return closest;
        }
    }
    // Fallback: when the event originates outside any note-context DOM
    // (e.g. mobile sidebar), target the currently active context so downstream
    // lookups don't fail with a null ntxId.
    return appContext.tabManager.activeNtxId ?? null;
}

export default {
    getItems,
    getQuickEditItem,
    getOpenNoteItem,
    handleLinkContextMenuItem,
    openContextMenu
};
