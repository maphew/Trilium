import type { ResolvedImage } from "@triliumnext/commons/src/lib/spreadsheet/render_to_xlsx.js";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import { ValidationError } from "../../errors.js";
import { encodeBase64 } from "../../services/utils/binary.js";

// A drawing whose image lives in an attachment, as `persistence.tsx` rewrites it on save.
const ATTACHMENT_IMAGE_SOURCE = /attachments\/([A-Za-z0-9_]+)\/image\//;

/**
 * Renders a spreadsheet workbook to an `.xlsx` file, returned base64-encoded so the client can
 * hand it straight to a data-URL download. The client posts the live editor state instead of a
 * `noteId`, so an export includes edits the debounced save has not flushed yet.
 *
 * `exceljs` is dynamically imported, which both keeps it off the startup path and keeps it out of
 * the client bundle: rendering here is the only reason the browser used to need the library.
 */
async function renderXlsx(req: Request) {
    const { content } = req.body;

    if (typeof content !== "string") {
        throw new ValidationError("'content' must be the workbook JSON.");
    }

    const { renderSpreadsheetToXlsx } = await import(
        "@triliumnext/commons/src/lib/spreadsheet/render_to_xlsx.js"
    );
    const buffer = await renderSpreadsheetToXlsx(content, { resolveImage });

    return { base64: encodeBase64(new Uint8Array(buffer)) };
}

/**
 * Resolves a drawing's `source` to embeddable bytes. Attachment URLs are read straight from becca;
 * inline `data:` URLs already carry their payload. Returns null (image skipped) when the attachment
 * is gone, its content is unavailable (a protected note outside a protected session), or its format
 * is one exceljs cannot embed.
 */
async function resolveImage(source: string): Promise<ResolvedImage | null> {
    if (source.startsWith("data:")) {
        return resolveDataUrl(source);
    }

    const match = ATTACHMENT_IMAGE_SOURCE.exec(source);
    const attachment = match ? becca.getAttachment(match[1]) : null;
    if (!attachment) {
        return null;
    }

    const extension = imageExtensionForMime(attachment.mime);
    if (!extension) {
        return null;
    }

    try {
        return { base64: encodeBase64(attachment.getContent()), extension };
    } catch {
        return null;
    }
}

/**
 * Splits a `data:<mime>;base64,<payload>` URL with plain string ops — a regex over the `;`
 * parameters can backtrack exponentially.
 */
function resolveDataUrl(dataUrl: string): ResolvedImage | null {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) {
        return null;
    }

    const header = dataUrl.slice(0, comma);
    if (!/;base64$/i.test(header)) {
        return null;
    }

    const extension = imageExtensionForMime(header.slice("data:".length).split(";")[0]);
    return extension ? { base64: dataUrl.slice(comma + 1), extension } : null;
}

function imageExtensionForMime(mime: string): ResolvedImage["extension"] | null {
    switch (mime.toLowerCase()) {
        case "image/png": return "png";
        case "image/jpeg":
        case "image/jpg": return "jpeg";
        case "image/gif": return "gif";
        default: return null; // svg/webp/bmp etc. — exceljs can't embed these
    }
}

export default {
    renderXlsx
};
