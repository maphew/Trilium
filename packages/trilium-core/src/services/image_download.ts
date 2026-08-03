/**
 * Fetching the pictures a note's content names at a third party, and keeping them as its own.
 *
 * Note content arrives from places that reference pictures by URL rather than carrying them: a page
 * pasted from a browser, a clipping, an export from another app. Left alone those references keep
 * the note dependent on someone else's server — every reader fetches from it, and the picture
 * disappears the day the URL rots. So the bytes are fetched once, stored as attachments of the note,
 * and the references rewritten to point at them.
 *
 * Governed throughout by `downloadImagesAutomatically`: fetching is the note reaching out to a third
 * party on the reader's behalf, which is the user's decision rather than ours.
 *
 * Two shapes of reference are handled, and {@link downloadPictureToAttachment} is the step they
 * share — give it an address and it answers with the attachment URL that replaces it.
 */

import { type ImageAttachmentRole, imageExtensionForMime, isHttpUrl, linkPreviewImageName, safeHostname } from "@triliumnext/commons";
import url from "url";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import * as cls from "./context.js";
import imageService from "./image.js";
import { inspectImage, UNKNOWN_FORMAT } from "./image_inspect.js";
import { getLog } from "./log.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import request from "./request.js";
import { getSql } from "./sql/index.js";
import { decodeBase64 } from "./utils/binary.js";
import { quoteRegex, unescapeHtml } from "./utils/index.js";
import { basename } from "./utils/path.js";

/** What a stored picture is referenced by, once it belongs to the note rather than to a website. */
function attachmentReference(attachmentId: string, title: string): string {
    return `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}`;
}

/**
 * Fetches one picture and keeps it as an attachment of `noteId`, answering with the URL that
 * references it — or nothing when it could not be had, or is not a picture at all.
 *
 * The step both passes below share, and the one worth reaching for from anywhere else that finds a
 * picture named by an address: an importer, a clipper, a repair that fills in what a preview is
 * missing. The bytes are asked what they are rather than the address or its server being taken for
 * it, so a 404 page served where a picture should be is refused rather than stored.
 *
 * `title` is what the attachment is called, and for a role that deduplicates it is also the key a
 * second use of the same picture reuses it by — so it should say which thing this is rather than
 * describe it.
 */
export async function downloadPictureToAttachment(
    noteId: string,
    pictureUrl: string,
    { role, title, shrink = false }: { role: ImageAttachmentRole; title: string; shrink?: boolean }
): Promise<string | undefined> {
    if (!isHttpUrl(pictureUrl)) {
        return undefined;
    }

    try {
        const bytes = new Uint8Array(await request.getImage(pictureUrl));
        const { format, mime } = inspectImage(bytes);

        if (format === UNKNOWN_FORMAT) {
            return undefined;
        }

        const attachment = imageService.saveImageToAttachment(
            noteId,
            bytes,
            `${title}.${imageExtensionForMime(mime)}`,
            shrink,
            // The title is the key a deduplicated role is reused by, so it is never shortened.
            false,
            role
        );

        return attachment.attachmentId ? attachmentReference(attachment.attachmentId, attachment.title) : undefined;
    } catch (e: unknown) {
        // The address is deliberately left out of the line: it is a page the user was reading, and
        // the note it came from is enough to find this again.
        getLog().info(`Could not download a picture for note '${noteId}': ${e}`);
        return undefined;
    }
}

const imageUrlToAttachmentIdMapping: Record<string, string> = {};

async function downloadImage(noteId: string, imageUrl: string) {
    const unescapedUrl = unescapeHtml(imageUrl);

    // SSRF protection: only allow http(s) URLs and block file:// and other schemes.
    try {
        const parsed = new URL(unescapedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            getLog().error(`Download of '${imageUrl}' for note '${noteId}' rejected: only http/https URLs are allowed.`);
            return;
        }
    } catch {
        getLog().error(`Download of '${imageUrl}' for note '${noteId}' rejected: invalid URL.`);
        return;
    }

    try {
        const imageBuffer = new Uint8Array(await request.getImage(unescapedUrl));

        const parsedUrl = url.parse(unescapedUrl);
        const title = basename(parsedUrl.pathname || "");

        const attachment = imageService.saveImageToAttachment(noteId, imageBuffer, title, true, true);

        if (attachment.attachmentId) {
            imageUrlToAttachmentIdMapping[imageUrl] = attachment.attachmentId;
        } else {
            getLog().error(`Download of '${imageUrl}' for note '${noteId}' failed due to no attachment ID.`);
        }

        getLog().info(`Download of '${imageUrl}' succeeded and was saved as image attachment '${attachment.attachmentId}' of note '${noteId}'`);
    } catch (e: any) {
        getLog().error(`Download of '${imageUrl}' for note '${noteId}' failed with error: ${e.message} ${e.stack}`);
    }
}

/** url => download promise */
const downloadImagePromises: Record<string, Promise<void>> = {};

function replaceUrl(content: string, url: string, attachment: { attachmentId?: string; title: string }) {
    const quotedUrl = quoteRegex(url);

    return content.replace(new RegExp(`\\s+src=[\"']${quotedUrl}[\"']`, "ig"), ` src="api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}"`);
}

export function downloadImages(noteId: string, content: string) {
    const imageRe = /<img[^>]*?\ssrc=['"]([^'">]+)['"]/gi;
    let imageMatch;

    while ((imageMatch = imageRe.exec(content))) {
        const url = imageMatch[1];
        const inlineImageMatch = /^data:image\/[a-z]+;base64,/.exec(url);

        if (inlineImageMatch) {
            const imageBase64 = url.substring(inlineImageMatch[0].length);
            const imageBuffer = decodeBase64(imageBase64);

            const attachment = imageService.saveImageToAttachment(noteId, imageBuffer, "inline image", true, true);

            const encodedTitle = encodeURIComponent(attachment.title);

            content = `${content.substring(0, imageMatch.index)}<img src="api/attachments/${attachment.attachmentId}/image/${encodedTitle}"${content.substring(imageMatch.index + imageMatch[0].length)}`;
        } else if (
            !url.includes("api/images/") &&
            !/api\/attachments\/.+\/image\/?.*/.test(url) &&
            // this is an exception for the web clipper's "imageId"
            (url.length !== 20 || url.toLowerCase().startsWith("http"))
        ) {
            if (!optionService.getOptionBool("downloadImagesAutomatically")) {
                continue;
            }

            if (url in imageUrlToAttachmentIdMapping) {
                const attachment = becca.getAttachment(imageUrlToAttachmentIdMapping[url]);

                if (!attachment) {
                    delete imageUrlToAttachmentIdMapping[url];
                } else {
                    content = replaceUrl(content, url, attachment);
                    continue;
                }
            }

            if (url in downloadImagePromises) {
                // download is already in progress
                continue;
            }

            // this is done asynchronously, it would be too slow to wait for the download
            // given that save can be triggered very often
            downloadImagePromises[url] = downloadImage(noteId, url);
        }
    }

    Promise.all(Object.values(downloadImagePromises)).then(() => {
        setTimeout(() => {
            // the normal expected flow of the offline image saving is that users will paste the image(s)
            // which will get asynchronously downloaded, during that time they keep editing the note
            // once the download is finished, the image note representing the downloaded image will be used
            // to replace the IMG link.
            // However, there's another flow where the user pastes the image and leaves the note before the images
            // are downloaded and the IMG references are not updated. For this occasion we have this code
            // which upon the download of all the images will update the note if the links have not been fixed before

            cls.getContext().init(() => {
                getSql().transactional(() => {
                const imageNotes = becca.getNotes(Object.values(imageUrlToAttachmentIdMapping), true);
                    const log = getLog();

                const origNote = becca.getNote(noteId);

                if (!origNote) {
                    log.error(`Cannot find note '${noteId}' to replace image link.`);
                    return;
                }

                const origContent = origNote.getContent();
                let updatedContent = origContent;

                if (typeof updatedContent !== "string") {
                    log.error(`Note '${noteId}' has a non-string content, cannot replace image link.`);
                    return;
                }

                for (const url in imageUrlToAttachmentIdMapping) {
                    const imageNote = imageNotes.find((note) => note.noteId === imageUrlToAttachmentIdMapping[url]);

                    if (imageNote) {
                        updatedContent = replaceUrl(updatedContent, url, imageNote);
                    }
                }

                // update only if the links have not been already fixed.
                if (updatedContent !== origContent) {
                    origNote.setContent(updatedContent);

                    void noteService.asyncPostProcessContent(origNote, updatedContent);

                    console.log(`Fixed the image links for note '${noteId}' to the offline saved.`);
                }
                });
            });
        }, 5000);
    });

    return content;
}

/** Which of a link preview's picture attributes holds what, and under which role it is stored. */
const PREVIEW_PICTURE_ROLES = [
    [ "data-favicon", "favicon" ],
    [ "data-image", "coverImage" ]
] as const;

/** The opening tag of a link preview, block or inline. Its attributes are read and rewritten in place. */
const PREVIEW_TAG_REGEX = /<(?:section|span)\b[^>]*\bclass="[^"]*link-(?:embed|mention)[^"]*"[^>]*>/gi;

/**
 * Fetches the pictures a link preview names at a third party, storing each as an attachment.
 *
 * Only imported and pasted content ever holds such a URL: a preview made here has its pictures
 * downloaded and stored server-side already, and the render sinks refuse a remote one outright, so
 * until they are fetched these cards show placeholders. A Notion export is the case in point — it
 * ships no bytes at all, only the origin's addresses.
 *
 * Governed by `downloadImagesAutomatically`, the same setting that decides whether a remote `<img>`
 * in note content is fetched. These pictures belong to that question and were only ever outside it
 * by accident: they arrive in an export as ordinary `<img>` elements and become attributes when the
 * importer rewrites the card, which took them out of the pass that would have handled them.
 */
export async function downloadLinkPreviewPictures(note: BNote) {
    if (note.type !== "text" || !optionService.getOptionBool("downloadImagesAutomatically")) {
        return;
    }

    const content = note.getContent();

    // Cheap guard: parse nothing for the overwhelming majority of notes, which hold no preview.
    if (typeof content !== "string" || !content.includes("link-embed") && !content.includes("link-mention")) {
        return;
    }

    const tags = [ ...content.matchAll(PREVIEW_TAG_REGEX) ];
    let rewritten = "";
    let cursor = 0;

    for (const tag of tags) {
        rewritten += content.slice(cursor, tag.index) + await downloadPicturesOf(note.noteId, tag[0]);
        cursor = tag.index + tag[0].length;
    }

    rewritten += content.slice(cursor);

    if (rewritten !== content) {
        getSql().transactional(() => note.setContent(rewritten));
    }
}

/** One preview's opening tag, with any picture it names at a third party fetched and pointed at. */
async function downloadPicturesOf(noteId: string, tag: string): Promise<string> {
    const cardUrl = unescapeHtml(attributeOf(tag, "data-url") ?? "");
    let rewritten = tag;

    for (const [ attribute, role ] of PREVIEW_PICTURE_ROLES) {
        const stored = attributeOf(tag, attribute);
        // Anything already local — an attachment of this note, or an inline image — is left alone.
        if (!stored || !isHttpUrl(unescapeHtml(stored))) {
            continue;
        }

        // Named and roled exactly as a preview fetched here would be, so an imported card ends up
        // indistinguishable from a made one — and a site named by several cards keeps one icon
        // between them, the title being what a deduplicated role reuses an attachment by.
        const reference = await downloadPictureToAttachment(noteId, unescapeHtml(stored), {
            role,
            title: role === "favicon" ? safeHostname(cardUrl) : linkPreviewImageName(cardUrl),
            // An icon is a few KB of flat colour with nothing for the compression pipeline to find;
            // a cover may be a full-size social image.
            shrink: role === "coverImage"
        });

        if (reference) {
            rewritten = rewritten.replace(`${attribute}="${stored}"`, `${attribute}="${reference}"`);
        }
    }

    return rewritten;
}

function attributeOf(tag: string, name: string): string | undefined {
    return new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag)?.[1];
}
