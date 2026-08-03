import "../widgets/type_widgets/text/LinkEmbed.css";

import { extractYouTubeVideoId, type ImageAttachmentRole, type LinkEmbedMetadata, linkPreviewImageName, safeLinkPreviewHref, safeLinkPreviewImageSrc, YOUTUBE_REGEX } from "@triliumnext/commons";
import { render } from "preact";
import { useState } from "preact/hooks";

import { t } from "./i18n.js";
import { uploadImageAttachment } from "./image_upload.js";
import server from "./server.js";

export interface EmbedMetadata {
    url: string;
    embedType: string;
    title?: string;
    description?: string;
    favicon?: string;
    siteName?: string;
    image?: string;
    /** See {@link LinkEmbedMetadata.unresolved}. Not persisted into the note's HTML. */
    unresolved?: boolean;
}


export function detectEmbedType(url: string): "youtube" | "opengraph" {
    return YOUTUBE_REGEX.test(url) ? "youtube" : "opengraph";
}

export function safeHostname(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
}

/**
 * Fetches link metadata from the server. Called once at link creation time.
 * The returned metadata is then stored in the note's HTML as data attributes.
 *
 * When `ownerNoteId` is given, both pictures a preview carries — the card image and the favicon —
 * are stored as attachments of that note, and only their `api/attachments/...` URLs end up in the
 * metadata. Inlined as base64 data URIs they are 10–140KB of note content for a card image and
 * 1–10KB for a favicon, and that lands in the note's HTML, where it is synced and revisioned like
 * any other content. A single card is enough to push a note past the `autoReadonlySizeText`
 * threshold (32KB by default) and flip it read-only; favicons get there by repetition instead,
 * since a note that links a site once usually links it many times and each copy carries the icon
 * again.
 */
export async function fetchMetadata(url: string, ownerNoteId?: string): Promise<EmbedMetadata> {
    try {
        // POSTed rather than passed in the query string: a URL can carry a one-time token or a
        // signed signature, and a query string ends up in every access log along the way.
        const metadata = await server.post<LinkEmbedMetadata>("link-embed/metadata", { url });
        // Uploaded together: they are two independent requests and a preview needs both before it
        // can be stored.
        // Each picture is named after the thing it is of — the favicon by its site, the cover by
        // its page — which is what lets a note that links the same site many times keep one icon,
        // and the same URL pasted twice keep one cover.
        const [ favicon, image ] = await Promise.all([
            offloadPictureToAttachment(metadata.favicon, ownerNoteId, "favicon", safeHostname(metadata.url)),
            offloadPictureToAttachment(metadata.image, ownerNoteId, "coverImage", linkPreviewImageName(metadata.url))
        ]);

        return {
            url: metadata.url,
            embedType: metadata.embedType,
            title: metadata.title,
            description: metadata.description,
            favicon,
            siteName: metadata.siteName,
            image,
            unresolved: metadata.unresolved
        };
    } catch {
        return {
            url,
            embedType: detectEmbedType(url),
            title: safeHostname(url),
            unresolved: true
        };
    }
}

/**
 * Converts one of a preview's base64 pictures into an attachment of the owning note, returning its
 * `api/attachments/...` URL — or the data URI unchanged when the upload fails, so the preview still
 * persists and renders, just at the old inline cost.
 *
 * Both pictures go through this, so both are subject to the same rule at the render sinks: only an
 * inline image or an attachment of this instance is ever loaded (see `isLocalPreviewImageSrc`).
 *
 * They are stored under different roles all the same. A card image is a picture of the page and
 * belongs with the note's own images; a favicon is the site's mark, fetched rather than chosen, and
 * telling the two apart is what lets icons be deduplicated and kept out of the tools that reason
 * about what the user put in the note.
 */
async function offloadPictureToAttachment(
    picture: string | undefined,
    ownerNoteId: string | undefined,
    role: ImageAttachmentRole = "image",
    baseName?: string
): Promise<string | undefined> {
    if (!picture || !ownerNoteId || !picture.startsWith("data:")) {
        return picture;
    }

    return await uploadImageAttachment(ownerNoteId, picture, role, baseName) ?? picture;
}

// ---------------------------------------------------------------------------
// Preact components — render previews from stored metadata, no network requests.
// Used by the CKEditor editing downcast (via component interface), the
// read-only text renderer, and postProcessRichContent (tooltips, included
// notes, markdown preview).
// ---------------------------------------------------------------------------

function Favicon({ src }: { src?: string }) {
    const [failed, setFailed] = useState(false);
    // See safeLinkPreviewImageSrc: only an inline image or an attachment of this instance, so that
    // opening a note never announces the reader to a third party.
    const safeSrc = safeLinkPreviewImageSrc(src);

    if (!safeSrc || failed) {
        return <span className="link-embed-mention-dot" />;
    }

    return (
        <img
            className="link-embed-mention-favicon"
            src={safeSrc}
            width={16}
            height={16}
            onError={() => setFailed(true)}
        />
    );
}

function ImagePlaceholder() {
    return <div className="link-embed-card-image-placeholder">&#128279;</div>;
}

function CardImage({ src }: { src?: string }) {
    const [failed, setFailed] = useState(false);
    const safeSrc = safeLinkPreviewImageSrc(src);

    if (!safeSrc || failed) {
        return <ImagePlaceholder />;
    }

    return (
        <img
            className="link-embed-card-image"
            src={safeSrc}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
        />
    );
}

/**
 * A YouTube player that only contacts YouTube once the user asks it to.
 *
 * Until then it shows the thumbnail already stored in the note, so merely opening a note with an
 * embedded video does not tell Google that the reader opened it — the note stays free of
 * third-party requests, which is the whole point of embedding the metadata server-side.
 */
function VideoEmbed({ meta, videoId }: { meta: EmbedMetadata; videoId: string }) {
    const [playing, setPlaying] = useState(false);
    const thumbnail = safeLinkPreviewImageSrc(meta.image);

    if (!playing) {
        return (
            <div className="link-embed-video">
                <button
                    type="button"
                    className="link-embed-video-facade"
                    aria-label={t("link_embed.play_video")}
                    title={t("link_embed.play_video")}
                    onClick={() => setPlaying(true)}
                >
                    {thumbnail && <img className="link-embed-video-thumbnail" src={thumbnail} alt="" draggable={false} />}
                    <span className="link-embed-video-play" aria-hidden="true" />
                </button>
            </div>
        );
    }

    // The `origin` param is only valid for a real web origin. On desktop the
    // renderer is served from `trilium-app://app`, which YouTube's player
    // rejects ("video player configuration error"), so omit it there.
    const webOrigin = window.location.protocol.startsWith("http") ? window.location.origin : null;
    // autoplay: the click on the facade *was* the play command; without it the user would have to
    // press play a second time, inside YouTube's own player.
    const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1${webOrigin ? `&origin=${encodeURIComponent(webOrigin)}` : ""}`;

    return (
        <div className="link-embed-video">
            <iframe
                src={embedSrc}
                frameBorder="0"
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
            />
        </div>
    );
}

function EmbedPreview({ meta, editable }: { meta: EmbedMetadata; editable?: boolean }) {
    // Only show the YouTube player when embedType is not explicitly
    // set to 'opengraph' (Card mode). This lets the user choose between
    // an embedded player and a static card preview for YouTube links.
    const videoId = meta.embedType !== "opengraph"
        ? extractYouTubeVideoId(meta.url)
        : null;

    if (videoId) {
        return <VideoEmbed meta={meta} videoId={videoId} />;
    }

    // In editing mode, omit target="_blank" so Trilium's global link handler
    // (link.ts goToLinkExt) treats the <a> as inside [contenteditable] and
    // only opens it on double-click or Ctrl+click.
    const target = editable ? undefined : "_blank";

    return (
        <a className="link-embed-card" href={safeLinkPreviewHref(meta.url)} target={target} rel="noopener noreferrer">
            <div className="link-embed-card-image-wrapper">
                <CardImage src={meta.image} />
            </div>
            <div className="link-embed-card-content">
                {meta.title && <div className="link-embed-card-title">{meta.title}</div>}
                {meta.description && <div className="link-embed-card-description">{meta.description}</div>}
                <div className="link-embed-card-url">
                    {/* The same favicon the inline mention shows, read from the metadata already
                        stored on the element. */}
                    <Favicon src={meta.favicon} />
                    <span>{meta.siteName || safeHostname(meta.url)}</span>
                </div>
            </div>
        </a>
    );
}

function MentionPreview({ meta, editable }: { meta: { url: string; title?: string; favicon?: string }; editable?: boolean }) {
    const target = editable ? undefined : "_blank";

    return (
        <a className="link-embed-mention" href={safeLinkPreviewHref(meta.url)} target={target} rel="noopener noreferrer">
            <Favicon src={meta.favicon} />
            <span className="link-embed-mention-title">{meta.title || safeHostname(meta.url)}</span>
        </a>
    );
}

// ---------------------------------------------------------------------------
// Imperative API — renders Preact components into DOM containers.
// ---------------------------------------------------------------------------

export function renderEmbedPreview(container: HTMLElement, meta: EmbedMetadata, editable?: boolean) {
    render(<EmbedPreview meta={meta} editable={editable} />, container);
}

export function renderMentionPreview(container: HTMLElement, meta: { url: string; title?: string; favicon?: string }, editable?: boolean) {
    render(<MentionPreview meta={meta} editable={editable} />, container);
}

/**
 * Processes all link embed and mention elements in a container, rendering
 * previews from their stored data attributes. Analogous to how
 * `link.loadReferenceLinkTitle` works for reference links.
 */
export function applyLinkEmbeds(container: HTMLElement) {
    for (const embed of container.querySelectorAll<HTMLElement>("section.link-embed")) {
        const url = embed.dataset.url;
        if (!url) continue;
        embed.innerHTML = "";
        renderEmbedPreview(embed, {
            url,
            embedType: embed.dataset.embedType || "opengraph",
            title: embed.dataset.title,
            description: embed.dataset.description,
            favicon: embed.dataset.favicon,
            siteName: embed.dataset.siteName,
            image: embed.dataset.image
        });
    }

    for (const mention of container.querySelectorAll<HTMLElement>("span.link-mention")) {
        const url = mention.dataset.url;
        if (!url) continue;
        mention.innerHTML = "";
        renderMentionPreview(mention, {
            url,
            title: mention.dataset.title,
            favicon: mention.dataset.favicon
        });
    }
}

export default {
    fetchMetadata,
    detectEmbedType,
    safeHostname,
    renderEmbedPreview,
    renderMentionPreview,
    applyLinkEmbeds
};
