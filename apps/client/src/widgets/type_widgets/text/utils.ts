import { h } from "preact";

import appContext from "../../../components/app_context";
import linkContextMenu from "../../../menus/link_context_menu";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import link, { ViewScope } from "../../../services/link";
import utils from "../../../services/utils";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

export async function loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string) {
    const note = await froca.getNote(noteId);
    if (!note) return;

    const $link = await link.createLink(note.noteId, {
        showTooltip: false,
        showNoteIcon: true
    });

    // The include widget itself is the first level of inclusion, so the included note's own
    // includes are rendered as reference links rather than expanded (see includesAsReferenceLinks).
    await fillIncludeBox($el, boxSize, $link, () => content_renderer.getRenderedContent(note, {
        interactive: true,
        includesAsReferenceLinks: true,
        mediaEnvironment: "embedded"
    }), { notePath: note.noteId });
}

/** Fills an include box with an embedded attachment, under a title linking to it. */
export async function loadIncludedAttachment(
    attachmentId: string,
    $el: JQuery<HTMLElement>,
    boxSize?: string
) {
    const attachment = await froca.getAttachment(attachmentId, true);
    if (!attachment) return;

    const viewScope: ViewScope = { viewMode: "attachments", attachmentId };
    const $link = await link.createLink(attachment.ownerId, {
        showTooltip: false,
        showNoteIcon: true,
        viewScope
    });

    await fillIncludeBox($el, boxSize, $link, () => content_renderer.getRenderedContent(
        attachment,
        { interactive: true, mediaEnvironment: "embedded" }
    ), { notePath: attachment.ownerId, viewScope, offersFullscreen: true });
}

/** The href of a reference link to the attachment, or `null` once it is deleted. */
export async function getAttachmentHref(attachmentId: string) {
    const attachment = await froca.getAttachment(attachmentId, true);
    if (!attachment) return null;

    return `#root/${attachment.ownerId}?viewMode=attachments&attachmentId=${attachmentId}`;
}

type RenderedContent = Awaited<ReturnType<typeof content_renderer.getRenderedContent>>;

interface IncludeBoxOptions {
    /** The note that the box's button opens in a new tab. */
    notePath: string;
    /** The view of that note to open, such as one of its attachments. */
    viewScope?: ViewScope;
    /** Whether a medium or full box ends its title row with a fullscreen button. */
    offersFullscreen?: boolean;
}

async function fillIncludeBox(
    $el: JQuery<HTMLElement>,
    boxSize: string | undefined,
    $link: JQuery<HTMLElement>,
    renderContent: () => Promise<RenderedContent>,
    { notePath, viewScope, offersFullscreen = false }: IncludeBoxOptions
) {
    // The box size is supplied explicitly by the editing-view downcast; for the other
    // callers (read-only rendering, script API refresh) fall back to reading it from the DOM.
    const effectiveBoxSize = boxSize ?? $el.closest('section.include-note').attr('data-box-size');
    const isExpandable = effectiveBoxSize === 'expandable';

    // The editing-view downcast passes the `.include-note-wrapper` element itself as $el, whereas the
    // read-only and refresh paths pass the outer `section.include-note`. Build the content in a
    // detached wrapper either way (so the old content stays visible during the async render — no
    // flicker), then swap it in; when $el is already the wrapper we move the built children straight
    // into it instead of nesting a redundant second `.include-note-wrapper`.
    const isWrapper = $el.hasClass('include-note-wrapper');
    const $wrapper = $('<div class="include-note-wrapper">');

    if (isExpandable) {
        // Create expandable structure with toggle
        const $titleRow = $('<div class="include-note-title-row">');
        const $toggle = $('<button class="include-note-toggle bx bx-chevron-right" aria-expanded="false">');
        const $title = $('<h4 class="include-note-title">').append($link);

        $titleRow.append(
            $toggle,
            $title,
            createOpenInNewTabButton(notePath, viewScope),
            createMenuButton(notePath, viewScope)
        );
        $wrapper.append($titleRow);

        const { $renderedContent, type } = await renderContent();
        const $content = $(`<div class="include-note-content type-${type}" style="display: none;">`).append($renderedContent);
        $wrapper.append($content);

        // Add toggle functionality
        $toggle.on('click', (e) => {
            e.stopPropagation();
            const isExpanded = $toggle.attr('aria-expanded') === 'true';
            $toggle.attr('aria-expanded', String(!isExpanded));
            $toggle.toggleClass('expanded');
            $content.slideToggle(200);
        });
    } else {
        const $title = $('<h4 class="include-note-title">').append($link);
        const { $renderedContent, type } = await renderContent();
        const $content = $(`<div class="include-note-content type-${type}">`)
            .append($renderedContent);
        const $titleRow = $('<div class="include-note-title-row">')
            .append($title, createOpenInNewTabButton(notePath, viewScope));

        if (offersFullscreen && (effectiveBoxSize === "medium" || effectiveBoxSize === "full")) {
            $titleRow.append(createFullscreenButton($content[0]));
            await mountExitFullscreenControls($content);
        }

        $titleRow.append(createMenuButton(notePath, viewScope));
        $wrapper.append($titleRow, $content);
    }

    // Unmount any interactive widgets from a previous render of this include (e.g. on a box-size
    // change or refreshIncludedNote) before $el.empty() discards their DOM — otherwise their
    // standalone Preact roots (collections, web views) would leak.
    content_renderer.disposeInteractiveContent($el);
    $el.empty().append(isWrapper ? $wrapper.children() : $wrapper);
}

/** A button opening a note in a new tab after the current one and switching to it. */
function createOpenInNewTabButton(notePath: string, viewScope: ViewScope | undefined) {
    return $('<button type="button" class="include-note-open bx bx-link-external">')
        .attr({ title: t("common.open_in_new_tab") })
        .on("click", (e) => {
            e.stopPropagation();
            void appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                viewScope,
                activate: true,
                placement: "afterCurrent"
            });
        });
}

/** A button opening the context menu that right-clicking the title of an include box opens. */
function createMenuButton(notePath: string, viewScope: ViewScope | undefined) {
    return $('<button type="button" class="include-note-menu bx bx-dots-vertical-rounded">')
        .attr({ title: t("common.more_actions") })
        .on("click", (e) => {
            e.stopPropagation();
            if (e.originalEvent) {
                void linkContextMenu.openContextMenu(notePath, e.originalEvent, viewScope);
            }
        });
}

/** A button giving `content` the whole screen. */
function createFullscreenButton(content: HTMLElement) {
    return $('<button type="button" class="include-note-fullscreen bx bx-fullscreen">')
        .attr({ title: t("common.fullscreen") })
        .on("click", (e) => {
            e.stopPropagation();
            content.requestFullscreen().catch((error: unknown) => {
                console.warn("Could not show the included content in fullscreen:", error);
            });
        });
}

/**
 * Mounts the button leaving fullscreen at the start of `$content`. The stylesheet shows it only
 * while `$content` has the screen.
 */
async function mountExitFullscreenControls($content: JQuery<HTMLElement>) {
    const container = document.createElement("div");
    container.className = "include-note-fullscreen-controls";
    $content.prepend(container);

    const exitButton = h(OverlayControlButton, {
        icon: "bx-exit",
        text: t("common.exit_fullscreen"),
        onClick: (e) => {
            e.stopPropagation();
            document.exitFullscreen().catch((error: unknown) => {
                console.warn("Could not leave fullscreen:", error);
            });
        }
    });
    await content_renderer.mountInteractiveWidget(h(OverlayControlGroup, {
        placement: "top-end",
        className: "include-note-exit-fullscreen",
        children: exitButton
    }), container);
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
