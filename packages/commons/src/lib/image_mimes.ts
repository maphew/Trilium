/**
 * The media types Trilium handles as pictures, shared by the two places that decide it.
 *
 * The upload endpoints gate on this to choose between storing an image (an `image`-role attachment
 * or an image note, addressed by an `api/attachments/.../image/...` URL) and storing an opaque file
 * (addressed by a `#root/...?viewMode=attachments` reference). The rich text editor gates on the
 * same thing to choose between inserting a picture and handing the file to the file-upload plugin.
 *
 * Those two used to be separate lists, and every type they disagreed about was a defect:
 *
 * - Claimed by the editor but not by the endpoint, the editor inserts an image element, uploads,
 *   and assigns whatever comes back as its source without looking at it — so the file branch's
 *   `#root/...` reference ended up in an `<img src>`, drawing a permanently broken picture.
 * - Accepted by the endpoint but not claimed by the editor, the file-upload plugin builds a
 *   reference link out of it and points it at the image URL the endpoint answered with, which is
 *   not a note URL, so it renders as "[missing note]".
 *
 * Keeping one list means neither can happen. Consult it through {@link isAcceptedImageMime} where a
 * media type is in hand, and through {@link IMAGE_UPLOAD_SUBTYPES} where the editor's config wants
 * bare subtypes.
 */
export const IMAGE_MIMES = [
    "image/png",
    // Unregistered, but some clients send it for a JPEG.
    "image/jpg",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/avif",
    // `image/svg` is unregistered too — `image/svg+xml` is the real one — but it costs nothing to
    // recognise, and a document arriving under it is still a document.
    "image/svg",
    "image/svg+xml",
    // Both spellings of an icon: `image/vnd.microsoft.icon` is the registered name and
    // `image/x-icon` is what servers actually send.
    "image/x-icon",
    "image/vnd.microsoft.icon"
] as const;

/**
 * TIFF is deliberately absent. No browser but Safari draws one in an `<img>`, so treating it as a
 * picture produces an element that cannot render whichever side is asked; left off, it stores as a
 * file and gets a working reference link instead.
 */
const ACCEPTED_IMAGE_MIMES: ReadonlySet<string> = new Set(IMAGE_MIMES);

/** Whether an upload of this media type is to be handled as a picture. */
export function isAcceptedImageMime(mime: string | undefined | null): boolean {
    return !!mime && ACCEPTED_IMAGE_MIMES.has(mime);
}

/**
 * The same list as the editor's `image.upload.types` wants it: bare subtypes, which it matches
 * against a dropped file as `^image/(<one of these>)$`. Anchored, so every subtype has to appear in
 * full — `svg` does not stand in for `svg+xml`.
 */
export const IMAGE_UPLOAD_SUBTYPES: readonly string[] = IMAGE_MIMES.map((mime) => mime.slice("image/".length));
