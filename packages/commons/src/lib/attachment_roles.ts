/**
 * The attachment roles whose content is a picture.
 *
 * A role is not a label — it is what the code branches on. `image` alone used to mean "this
 * attachment is a picture", so every such branch spelled it that way, and a second picture role
 * has to be admitted to all of them at once or it half-works: served but never cleaned up, cleaned
 * up but never served, listed but rendered as an unknown file.
 *
 * `favicon` is separate from `image` so a link preview's site icon can be told apart from a picture
 * the user put in the note — they are created, deduplicated and replaced on completely different
 * terms, and only one of them is something the user chose. Keeping them apart also keeps icons out
 * of the places that reason about the user's images: the compression inventory has nothing to gain
 * from a 16x16 icon, and offering to recompress one is noise.
 */
export const IMAGE_ATTACHMENT_ROLES = [ "image", "favicon" ] as const;

export type ImageAttachmentRole = typeof IMAGE_ATTACHMENT_ROLES[number];

/** Whether an attachment of this role holds a picture, whoever created it. */
export function isImageAttachmentRole(role: string | undefined | null): role is ImageAttachmentRole {
    return !!role && (IMAGE_ATTACHMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that keep one attachment per title in a note, rather than one per use.
 *
 * Only for pictures the app fetched and named itself, where the title says which thing it is and
 * the same thing is fetched again and again: a note that links a site once usually links it many
 * times, and each link would otherwise bring its own copy of that site's icon. One row per site
 * instead of one per link is the difference between an attachment list a reader can use and a
 * wall of identical icons.
 *
 * Never for a picture the user placed. Two images they happened to give the same name are two
 * images, and quietly collapsing them would lose one.
 */
const DEDUPLICATED_ATTACHMENT_ROLES: readonly string[] = [ "favicon" ];

/**
 * Whether a second attachment of this role and title should reuse the first rather than be stored
 * again. The title is the key, so for these roles it is the caller's job to make it identify the
 * thing — a site's hostname for a favicon — and the server's not to shorten it.
 */
export function isDeduplicatedAttachmentRole(role: string | undefined | null): boolean {
    return !!role && DEDUPLICATED_ATTACHMENT_ROLES.includes(role);
}
