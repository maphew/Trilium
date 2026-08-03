export const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?[^\s#]*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

export function extractYouTubeVideoId(url: string): string | null {
    const match = url.match(YOUTUBE_REGEX);
    return match ? match[1] : null;
}

/**
 * True when the URL is one a link preview may ever point at.
 *
 * A preview's URL reaches the renderers as a `data-url` attribute of the stored note HTML, and the
 * HTML sanitizers (both `sanitize-html` on save and DOMPurify on render) pass `data-*` values
 * through untouched — they check attribute *names*, not the contents of custom ones. So a note
 * carrying `data-url="javascript:…"`, whether it arrived by import, ETAPI, sync from a compromised
 * instance, or hand-edited HTML, would otherwise be rendered as a live `<a href="javascript:…">`
 * — in the app *and* on the public share page. The metadata endpoint only ever produces http(s)
 * URLs, so anything else is illegitimate by construction.
 */
export function isHttpUrl(url: string | undefined | null): boolean {
    if (!url) {
        return false;
    }

    try {
        const { protocol } = new URL(url);
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * The URL to put in a link preview's `href`, or `about:blank` when it is not one we may link to.
 * Mirrors what the share view's `sanitizeUrl` does with a hostile scheme: render the element, make
 * the link inert. See {@link isHttpUrl}.
 */
export function safeLinkPreviewHref(url: string | undefined | null): string {
    return isHttpUrl(url) ? String(url) : "about:blank";
}

/**
 * A preview image reference the renderers may load: an inline `data:` image, or an attachment of
 * this very instance.
 *
 * The metadata pipeline never produces anything else. The server downloads the favicon and the card
 * image itself and hands back base64 `data:` URIs, precisely so that the note carries the picture
 * instead of hotlinking the origin site; the client then offloads the larger card image into an
 * attachment and stores its `api/attachments/…` URL. So a *remote* URL in `data-favicon` /
 * `data-image` is illegitimate by construction — the mirror image of the {@link isHttpUrl} rule for
 * `data-url`, where http(s) is the only legitimate case.
 *
 * That matters because those attributes reach an `<img src>` that fires on page load with no click,
 * and `data-*` survives both sanitizers untouched (see {@link isHttpUrl}), so a note arriving by
 * import, ETAPI or sync could otherwise make every reader of the note — and every visitor to it as a
 * shared page — announce themselves to a third party. Keeping the check here, at the render sinks,
 * means no stored value can produce an outbound request whatever route it came in by.
 */
export function isLocalPreviewImageSrc(src: string | undefined | null): boolean {
    if (!src) {
        return false;
    }

    const trimmed = src.trim();

    // An SVG data URI is included on purpose: the server itself emits one for a vector favicon, and
    // scripts inside an SVG loaded through <img> do not run.
    if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(trimmed)) {
        return true;
    }

    // Exactly the shape the attachment upload endpoint returns. Anchored, so a protocol-relative
    // `//evil.test/api/attachments/…` or a traversal cannot masquerade as one.
    return /^api\/attachments\/[a-zA-Z0-9_]+\/image\/[^\s"'<>]*$/.test(trimmed);
}

/**
 * The value to put in a preview's `<img src>`, or `undefined` when it is not one we may load.
 * Every caller already renders a placeholder for a preview with no image (a neutral dot for the
 * favicon, a link glyph for the card), so a rejected value degrades to that rather than to a broken
 * image. See {@link isLocalPreviewImageSrc}.
 */
export function safeLinkPreviewImageSrc(src: string | undefined | null): string | undefined {
    return isLocalPreviewImageSrc(src) ? String(src).trim() : undefined;
}

export interface LinkEmbedMetadata {
    url: string;
    title?: string;
    description?: string;
    image?: string;
    favicon?: string;
    siteName?: string;
    embedType: "youtube" | "opengraph";
    /**
     * True when the page could not be read at all — a network error, a bot challenge (many sites
     * answer a server-side fetch with a Cloudflare interstitial), a non-HTML response, or a page
     * carrying no title of its own. The remaining fields then hold nothing but a hostname-derived
     * placeholder, so an auto-detected URL is left as a plain link rather than becoming a preview
     * that shows less than the URL itself did. Never persisted into the note's HTML.
     */
    unresolved?: boolean;
}

/**
 * A runtime-neutral view of a block's child node, decoupled from any editor's
 * model types so the logic below can be unit-tested with plain objects.
 */
export interface BlockChildLike {
    /** True for a text node; false for any element (image, soft break, widget, …). */
    isText: boolean;
    /** Text contents when `isText`; ignored otherwise. */
    data?: string;
}

/**
 * True when `url` is the sole content of a block — its only non-whitespace text
 * is the URL and it holds no other elements. Surrounding whitespace (such as the
 * trailing space that triggers auto-linking) is ignored.
 */
export function isUrlAloneInBlock(children: Iterable<BlockChildLike>, url: string): boolean {
    let text = "";
    for (const child of children) {
        // Any non-text node (inline image, soft break, mention, …) means the
        // URL isn't alone.
        if (!child.isText) {
            return false;
        }
        text += child.data ?? "";
    }
    return text.trim() === url;
}

export type LinkPreviewKind = "embed" | "card" | "mention";

/** Where an auto-detected URL sits, and what the user did right after typing it. */
export interface LinkPreviewPlacement {
    /** The URL is the block's only content (see {@link isUrlAloneInBlock}). */
    urlAloneInBlock: boolean;
    /**
     * The block is a plain top-level paragraph — not a list item, table cell, quote or heading.
     * A block-level preview inside those reads as a layout accident, so they stay inline.
     */
    blockIsStandalone: boolean;
    /**
     * The caret has left the block, which is what pressing Enter does. While the caret is still
     * there the user is plausibly mid-sentence, so the URL has not (yet) been *left* alone.
     */
    caretLeftBlock: boolean;
}

/**
 * Chooses how an auto-detected URL should be previewed.
 *
 * A URL only becomes a block-level preview when the user deliberately left it alone on its own
 * line — sole content of a plain paragraph, then Enter. That gesture is the signal; anything else
 * (text either side, a list/table/quote, or a caret still sitting in the block because the user is
 * still typing) yields an unobtrusive inline mention.
 *
 * Given that gesture, the URL decides which block form: an embeddable one (e.g. YouTube) becomes a
 * player, everything else a card.
 */
export function chooseLinkPreviewKind(embedType: string, placement: LinkPreviewPlacement): LinkPreviewKind {
    if (!placement.urlAloneInBlock || !placement.blockIsStandalone || !placement.caretLeftBlock) {
        return "mention";
    }

    return embedType !== "opengraph" ? "embed" : "card";
}
