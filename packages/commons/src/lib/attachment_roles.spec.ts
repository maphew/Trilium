import { describe, expect, it } from "vitest";

import { IMAGE_ATTACHMENT_ROLES, isDeduplicatedAttachmentRole, isImageAttachmentRole } from "./attachment_roles.js";

describe("isImageAttachmentRole", () => {
    it("recognises every picture role and nothing else", () => {
        for (const role of IMAGE_ATTACHMENT_ROLES) {
            expect(isImageAttachmentRole(role), role).toBe(true);
        }

        // The roles that are not pictures. "viewConfig" and "importSource" matter most: they are
        // managed by whatever created them, so treating one as a picture would put it in front of
        // the cleanup that erases unreferenced attachments.
        for (const role of [ "file", "viewConfig", "importSource", "Image", "", "favicons" ]) {
            expect(isImageAttachmentRole(role), role).toBe(false);
        }

        expect(isImageAttachmentRole(undefined)).toBe(false);
        expect(isImageAttachmentRole(null)).toBe(false);
    });

    it("covers both the user's own pictures and the ones the app fetched for them", () => {
        expect(isImageAttachmentRole("image")).toBe(true);
        expect(isImageAttachmentRole("favicon")).toBe(true);
    });
});

describe("isDeduplicatedAttachmentRole", () => {
    it("deduplicates only what the app named itself", () => {
        // A site's icon: one per site rather than one per link to it.
        expect(isDeduplicatedAttachmentRole("favicon")).toBe(true);

        // Never a picture the user placed. Two images they gave the same name are two images, and
        // collapsing them by title would lose one.
        for (const role of [ "image", "file", "viewConfig", "importSource", "" ]) {
            expect(isDeduplicatedAttachmentRole(role), role).toBe(false);
        }

        expect(isDeduplicatedAttachmentRole(undefined)).toBe(false);
        expect(isDeduplicatedAttachmentRole(null)).toBe(false);
    });
});
