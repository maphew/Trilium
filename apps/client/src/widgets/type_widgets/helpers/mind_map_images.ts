import type { NodeObj } from "mind-elixir";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";

/** The picture a node carries, as Mind Elixir holds it. */
export type NodeImage = NonNullable<NodeObj["image"]>;

/**
 * The widths a node picture is offered at, in the order the panel lays them out. A picture is drawn
 * at the size it is given rather than at the size it came in, so these are the whole of the choice:
 * a map is read at a glance, and a picture large enough to be read at that glance while still
 * leaving room for the branches around it lands well inside this range.
 */
export const NODE_IMAGE_WIDTHS = [ 120, 240, 400 ];

/** What a picture is taken in at, unless it is smaller than that to begin with (see below). */
export const DEFAULT_NODE_IMAGE_WIDTH = NODE_IMAGE_WIDTHS[1];

/**
 * Uploads a picture to the note the map belongs to and describes it as a node carries it.
 *
 * The picture is stored as an attachment of the note, the way every other note type stores the
 * pictures written into it, and the node holds the address it is served back from — so the map's
 * own content stays the small piece of JSON it is however many pictures it grows.
 *
 * @returns what to hand to a node, or `null` if the picture could not be taken in — a message
 *          having been shown for it, as it is the whole of what the caller asked for.
 */
export async function uploadNodeImage(noteId: string, file: File): Promise<NodeImage | null> {
    const [ url, size ] = await Promise.all([ uploadImage(noteId, file), measureImage(file) ]);
    if (!url || !size) {
        // A file the browser will not read as a picture may have been stored all the same; nothing
        // points at it, so the next save takes it as an orphan and schedules its erasure.
        return null;
    }

    // Never larger than it came: a picture drawn past its own size is a blurred one, and the sizes
    // below are there for whoever does want it larger than it is.
    return fitNodeImage({ url, ...size }, Math.min(DEFAULT_NODE_IMAGE_WIDTH, size.width));
}

/** The address a picture is served back from once the note holds it, or `null` with a message shown. */
async function uploadImage(noteId: string, file: File): Promise<string | null> {
    let detail: string | undefined;

    try {
        const result = await server.upload(
            `notes/${noteId}/attachments/upload`,
            file, undefined, "POST"
        ) as { uploaded?: boolean; url?: string; message?: string };

        if (result?.uploaded && result.url) {
            return result.url;
        }
        detail = result?.message;
    } catch (e) {
        detail = e instanceof Error ? e.message : undefined;
    }

    const message = t("mind-map.image-upload-failed", { name: file.name });
    toast.showError(detail ? `${message} ${detail}` : message);
    return null;
}

/**
 * The size a picture comes in, or `null` if it cannot be read as a picture at all.
 */
export async function measureImage(file: Blob): Promise<{ width: number, height: number } | null> {
    const image = await decodeImage(file);
    if (!image?.naturalWidth || !image.naturalHeight) {
        return null;
    }
    return { width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * A picture of the map, fetched from where a node points at it and redrawn at about the size it is
 * shown at, as data that can be carried inside the exported SVG (see `mind_map_export`).
 *
 * What has been fetched once is kept: the SVG is written again at every pause in the editing, and
 * an address names one picture for good — a picture put in the place of another is stored anew and
 * gets an address of its own.
 *
 * @returns the picture as a `data:` URL, or `null` where it could not be fetched at all — a map
 *          made elsewhere may point at a site that will not hand it over.
 */
export function loadImageData(url: string, displayWidth: number): Promise<string | null> {
    const width = Math.max(1, Math.round(displayWidth * IMAGE_EXPORT_SCALE));
    const key = `${width}|${url}`;

    let data = pictureData.get(key);
    if (!data) {
        data = fetchImageData(url, width);
        pictureData.set(key, data);
    }
    return data;
}

/**
 * How much larger than it is shown a picture is redrawn, so that it stays sharp on a dense display
 * and in a PNG export, which rasterizes the SVG at a scale of its own.
 */
const IMAGE_EXPORT_SCALE = 2;

/**
 * What a redrawn picture is written as. WebP holds transparency, as PNG does, at a fraction of the
 * weight; a browser that cannot write it falls back to PNG on its own.
 */
const IMAGE_EXPORT_TYPE = "image/webp";
const IMAGE_EXPORT_QUALITY = 0.8;

/** What has already been fetched, by address and by the width it was redrawn at. */
const pictureData = new Map<string, Promise<string | null>>();

async function fetchImageData(url: string, width: number): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }

        const blob = await response.blob();
        // Where the browser will not redraw it, it is carried as it came: heavier, but there.
        return await redrawImage(blob, width) ?? await readAsDataUrl(blob);
    } catch (e) {
        console.warn(`Could not read the picture at '${url}'`, e);
        return null;
    }
}

/** The picture redrawn at no more than the given width, or `null` if the browser would not draw it. */
async function redrawImage(blob: Blob, width: number): Promise<string | null> {
    const image = await decodeImage(blob);
    if (!image?.naturalWidth || !image.naturalHeight) {
        return null;
    }

    // Never larger than it came: that would cost more and show no more.
    const drawnWidth = Math.min(width, image.naturalWidth);
    const drawnHeight = Math.max(1, Math.round(drawnWidth * image.naturalHeight / image.naturalWidth));

    try {
        const canvas = document.createElement("canvas");
        canvas.width = drawnWidth;
        canvas.height = drawnHeight;

        const context = canvas.getContext("2d");
        if (!context) {
            return null;
        }
        context.drawImage(image, 0, 0, drawnWidth, drawnHeight);

        // A picture fetched from another site taints the canvas, and reading it back is refused.
        return canvas.toDataURL(IMAGE_EXPORT_TYPE, IMAGE_EXPORT_QUALITY);
    } catch (e) {
        console.warn("Could not redraw a picture of the map", e);
        return null;
    }
}

/**
 * Hands the picture to the browser to decode, `null` where it will not have it. Decoded through an
 * `<img>` rather than through `createImageBitmap`, which several browsers refuse for SVG — a format
 * a node takes as readily as any other.
 */
function decodeImage(blob: Blob): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();

        const settle = (decoded: HTMLImageElement | null) => {
            URL.revokeObjectURL(url);
            resolve(decoded);
        };

        image.onload = () => settle(image);
        image.onerror = () => settle(null);
        image.src = url;
    });
}

function readAsDataUrl(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });
}

/**
 * The same picture drawn at the given width, as tall as its proportions ask for. A node holds the
 * size it is drawn at rather than a scale, so every change of size goes through here.
 */
export function fitNodeImage(image: NodeImage, width: number): NodeImage {
    const ratio = (image.width > 0 ? image.height / image.width : 1);
    return {
        ...image,
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(width * ratio))
    };
}

/**
 * The offered width a picture is closest to, which is the one the panel shows as its size. A picture
 * is taken in at its own width where that is smaller than any of them (see {@link uploadNodeImage}),
 * and a map made elsewhere carries whatever width it was made with, so what a node holds is not
 * always one of them.
 */
export function nearestNodeImageWidth(width: number): number {
    return NODE_IMAGE_WIDTHS.reduce((nearest, offered) =>
        (Math.abs(offered - width) < Math.abs(nearest - width) ? offered : nearest));
}
