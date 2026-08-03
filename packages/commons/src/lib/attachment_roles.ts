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
