import type { AttachmentRole } from "@triliumnext/commons";

import { t } from "./i18n.js";

/**
 * What each role is called where a reader sees it.
 *
 * A `Record` over the roles rather than a lookup with a default, so a role added to
 * `ATTACHMENT_ROLES` does not compile until it has been given a name — the same arrangement the
 * user/system split uses. Naming is not derivable from the traits that live with the roles
 * themselves, and it is a question only the client has to answer, which is why the names live here
 * and not beside the roles.
 *
 * Each entry calls `t` on a literal rather than holding the key for a caller to resolve: the tooling
 * that finds translatable strings reads call sites, and a key handed through a variable is invisible
 * to it. Thunks rather than strings so the name is read at render, and a language changed under the
 * app is not left showing the one loaded at startup.
 */
const ATTACHMENT_ROLE_NAMES: Record<AttachmentRole, () => string> = {
    image: () => t("attachment_roles.image"),
    file: () => t("attachment_roles.file"),
    favicon: () => t("attachment_roles.favicon"),
    coverImage: () => t("attachment_roles.coverImage"),
    viewConfig: () => t("attachment_roles.viewConfig"),
    canvasLibraryItem: () => t("attachment_roles.canvasLibraryItem"),
    importSource: () => t("attachment_roles.importSource")
};

/**
 * What to call an attachment of this role.
 *
 * A role nobody here has heard of — a script's own, or one from a newer version reached over sync —
 * is shown as it was stored. It is not a name anyone chose, but it is the only thing known about the
 * attachment, and saying nothing would leave a row with a gap where every other row says something.
 */
export function attachmentRoleName(role: string | undefined | null): string {
    if (!role) {
        return "";
    }

    // `hasOwn` rather than a plain lookup: the role is whatever was stored, so `"constructor"`
    // reaches this, and reading it off the object would answer with something from its prototype.
    return Object.hasOwn(ATTACHMENT_ROLE_NAMES, role)
        ? ATTACHMENT_ROLE_NAMES[role as AttachmentRole]()
        : role;
}
