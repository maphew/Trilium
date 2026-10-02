import { attachmentIcon } from "@triliumnext/commons";
import { h } from "preact";

import appContext from "../../../components/app_context";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link, { ViewScope } from "../../../services/link";
import utils from "../../../services/utils";
import IncludeNote, { getNoteActions, TinyIncludeNote } from "./IncludeNote";

/**
 * Fills an include box with a note. Without a box size of its own, the box takes the one of its
 * section.
 */
export async function loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string) {
    const note = await froca.getNote(noteId);
    if (!note) return;

    const el = $el[0];
    const size = boxSize ?? getSectionBoxSize(el);
    if (size === "tiny") {
        const $link = await link.createLink(note.noteId, {
            showTooltip: false,
            showNotePath: true
        });
        const box = h(TinyIncludeNote, {
            icon: note.getIcon(),
            title: $link[0],
            notePath: note.noteId,
            actions: getNoteActions(note.noteId)
        });
        await content_renderer.mountInteractiveWidget(box, getWrapper(el));
        return;
    }

    const $link = await link.createLink(note.noteId, {
        showTooltip: false,
        showNoteIcon: true
    });

    // The include widget itself is the first level of inclusion, so the included note's own
    // includes are rendered as reference links rather than expanded (see includesAsReferenceLinks).
    const { $renderedContent, type } = await content_renderer.getRenderedContent(note, {
        interactive: true,
        includesAsReferenceLinks: true,
        mediaEnvironment: "embedded"
    });

    const box = h(IncludeNote, {
        boxSize: size,
        title: $link[0],
        content: $renderedContent[0],
        contentType: type,
        notePath: note.noteId
    });
    await content_renderer.mountInteractiveWidget(box, getWrapper(el));
}

/**
 * Fills an include box with an embedded attachment, under a title linking to it. Without a box
 * size of its own, the box takes the one of its section.
 */
export async function loadIncludedAttachment(
    attachmentId: string,
    $el: JQuery<HTMLElement>,
    boxSize?: string
) {
    const attachment = await froca.getAttachment(attachmentId, true);
    if (!attachment) return;

    const el = $el[0];
    const size = boxSize ?? getSectionBoxSize(el);
    const viewScope: ViewScope = { viewMode: "attachments", attachmentId };
    if (size === "tiny") {
        // `attachment_actions` is imported on demand: it imports the image compression dialog.
        const [ $link, { getDownloadAction, getOpenExternallyAction } ] = await Promise.all([
            link.createLink(attachment.ownerId, { showTooltip: false, viewScope }),
            import("../../../services/attachment_actions")
        ]);
        const box = h(TinyIncludeNote, {
            icon: attachmentIcon(attachment.role, attachment.mime),
            title: $link[0],
            description: utils.formatSize(attachment.contentLength),
            notePath: attachment.ownerId,
            viewScope,
            actions: [ getOpenExternallyAction(attachment), getDownloadAction(attachment) ]
        });
        await content_renderer.mountInteractiveWidget(box, getWrapper(el));
        return;
    }

    const $link = await link.createLink(attachment.ownerId, {
        showTooltip: false,
        showNoteIcon: true,
        viewScope
    });
    const { $renderedContent, type } = await content_renderer.getRenderedContent(
        attachment,
        { interactive: true, mediaEnvironment: "embedded" }
    );

    const box = h(IncludeNote, {
        boxSize: size,
        title: $link[0],
        content: $renderedContent[0],
        contentType: type,
        notePath: attachment.ownerId,
        viewScope
    });
    await content_renderer.mountInteractiveWidget(box, getWrapper(el));
}

function getSectionBoxSize(el: HTMLElement) {
    return el.closest<HTMLElement>("section.include-note")?.dataset.boxSize;
}

/**
 * The element an include box is mounted in: `el` when it is the `.include-note-wrapper` the
 * editor renders, otherwise the wrapper of the `section.include-note`, reused or created.
 */
function getWrapper(el: HTMLElement) {
    if (el.classList.contains("include-note-wrapper")) {
        return el;
    }

    const existing = el.querySelector<HTMLElement>(":scope > .include-note-wrapper");
    if (existing) {
        return existing;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "include-note-wrapper";
    el.replaceChildren(wrapper);
    return wrapper;
}

/** The href of a reference link to the attachment, or `null` once it is deleted. */
export async function getAttachmentHref(attachmentId: string) {
    const attachment = await froca.getAttachment(attachmentId, true);
    if (!attachment) return null;

    return `#root/${attachment.ownerId}?viewMode=attachments&attachmentId=${attachmentId}`;
}

/**
 * Unmounts the include boxes, and what they show, once they leave `container`. The returned
 * function stops watching and unmounts the boxes still in it.
 */
export function watchIncludedNotes(container: HTMLElement) {
    const observer = new MutationObserver(disposeRemoved);
    observer.observe(container, { childList: true, subtree: true });

    return () => {
        disposeRemoved(observer.takeRecords());
        observer.disconnect();
        content_renderer.disposeInteractiveContent($(container));
    };
}

function disposeRemoved(records: MutationRecord[]) {
    for (const record of records) {
        for (const node of record.removedNodes) {
            // A node moved elsewhere in the document is still in use.
            if (node instanceof HTMLElement && !node.isConnected) {
                content_renderer.disposeInteractiveContent($(node));
            }
        }
    }
}

export function refreshIncludedNote(container: HTMLDivElement, noteId: string) {
    const includedNotes = container.querySelectorAll(`section[data-note-id="${noteId}"]`);
    for (const includedNote of includedNotes) {
        loadIncludedNote(noteId, $(includedNote as HTMLElement));
    }
}

export function setupImageOpening(container: HTMLDivElement, singleClickOpens: boolean) {
    const $container = $(container);
    $container.on("dblclick", "img", (e) => openImageInCurrentTab($(e.target)));
    $container.on("click", "img", (e) => {
        e.stopPropagation();
        const isLeftClick = e.which === 1;
        const isMiddleClick = e.which === 2;
        const ctrlKey = utils.isCtrlKey(e);
        const activate = (isLeftClick && ctrlKey && e.shiftKey) || (isMiddleClick && e.shiftKey);

        if ((isLeftClick && ctrlKey) || isMiddleClick) {
            openImageInNewTab($(e.target), activate);
        } else if (isLeftClick && singleClickOpens) {
            openImageInCurrentTab($(e.target));
        }
    });
}

async function openImageInCurrentTab($img: JQuery<HTMLElement>) {
    const parsedImage  = await parseFromImage($img);

    if (parsedImage) {
        appContext.tabManager.getActiveContext()?.setNote(parsedImage.noteId, { viewScope: parsedImage.viewScope });
    } else {
        window.open($img.prop("src"), "_blank");
    }
}

async function openImageInNewTab($img: JQuery<HTMLElement>, activate: boolean = false) {
    const parsedImage = await parseFromImage($img);

    if (parsedImage) {
        appContext.tabManager.openTabWithNoteWithHoisting(parsedImage.noteId, { activate, viewScope: parsedImage.viewScope });
    } else {
        window.open($img.prop("src"), "_blank");
    }
}

async function parseFromImage($img: JQuery<HTMLElement>): Promise<{ noteId: string; viewScope: ViewScope } | null> {
    const imgSrc = $img.prop("src");

    const imageNoteMatch = imgSrc.match(/\/api\/images\/([A-Za-z0-9_]+)\//);
    if (imageNoteMatch) {
        return {
            noteId: imageNoteMatch[1],
            viewScope: {}
        };
    }

    const attachmentMatch = imgSrc.match(/\/api\/attachments\/([A-Za-z0-9_]+)\/image\//);
    if (attachmentMatch) {
        const attachmentId = attachmentMatch[1];
        const attachment = await froca.getAttachment(attachmentId);
        if (!attachment) return null;

        return {
            noteId: attachment.ownerId,
            viewScope: {
                viewMode: "attachments",
                attachmentId: attachmentId
            }
        };
    }

    return null;
}
