import type { ImageAttachmentRole } from "@triliumnext/commons";

import server from "./server.js";

/**
 * Uploads a base64 `data:` image to a note as an attachment via the standard attachment-upload
 * endpoint (the server assigns the id, compresses the image, and returns the reference URL).
 * Resolves to the `api/attachments/...` URL, or `null` on failure (caller decides how to fall back,
 * e.g. keep the image inline as base64 so it still persists/renders).
 *
 * Format-agnostic: used by any rich note type that needs to offload inline base64 images to
 * attachments (e.g. the spreadsheet drawing layer).
 *
 * `role` says which kind of picture it is. The default is a plain image — the user's own — and a
 * caller passes something else only for a picture the app fetched on its behalf, such as a link
 * preview's site icon; see {@link IMAGE_ATTACHMENT_ROLES}. The server checks the value against the
 * same list rather than storing whatever it is sent.
 */
export async function uploadImageAttachment(noteId: string, dataUrl: string, role: ImageAttachmentRole = "image"): Promise<string | null> {
    const file = dataUrlToImageFile(dataUrl);
    if (!file) return null;

    try {
        const url = `notes/${noteId}/attachments/upload?role=${encodeURIComponent(role)}`;
        const response = await server.upload(url, file, undefined, "POST") as { uploaded?: boolean; url?: string };
        return response?.uploaded && response.url ? response.url : null;
    } catch (e) {
        console.error("Failed to upload image attachment", e);
        return null;
    }
}

/** Decodes a `data:<mime>;base64,<data>` URL into a {@link File} suitable for upload. */
export function dataUrlToImageFile(dataUrl: string): File | null {
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) return null;

    let binary: string;
    try {
        binary = atob(parsed.base64);
    } catch {
        return null; // malformed base64 — atob throws a DOMException
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([ bytes ], `image.${parsed.ext}`, { type: parsed.mime });
}

export interface ParsedImageDataUrl {
    mime: string;
    base64: string;
    ext: string;
}

/** Splits a `data:<mime>;base64,<data>` URL into its mime, raw base64 and a file extension. */
export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | null {
    const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
    if (!match) return null;

    const mime = match[1];
    const base64 = match[2];
    const subtype = mime.split("/")[1] ?? "png";
    const ext = subtype === "svg+xml" ? "svg" : (subtype.replace(/[^a-z0-9]/gi, "") || "png");
    return { mime, base64, ext };
}
