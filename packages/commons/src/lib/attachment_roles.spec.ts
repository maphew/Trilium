import { describe, expect, it } from "vitest";

import { ATTACHMENT_ROLES, attachmentRoleTraits, IMAGE_ATTACHMENT_ROLES, isDeduplicatedAttachmentRole, isEmbeddedAttachmentRole, isImageAttachmentRole } from "./attachment_roles.js";

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

describe("isEmbeddedAttachmentRole", () => {
    it("covers what lives in the note's content, and nothing that manages itself", () => {
        // What the cleanup that erases unreferenced attachments is allowed to look at. A link
        // preview's pictures belong here: nothing manages them, so deleting the preview has to be
        // what eventually takes them with it.
        for (const role of [ "image", "file", "favicon", "coverImage" ]) {
            expect(isEmbeddedAttachmentRole(role), role).toBe(true);
        }

        // Nothing in the content ever refers to these, so letting the cleanup see them would erase
        // every one of them on the next save.
        for (const role of [ "viewConfig", "canvasLibraryItem", "importSource" ]) {
            expect(isEmbeddedAttachmentRole(role), role).toBe(false);
        }
    });
});

describe("attachmentRoleTraits", () => {
    it("answers nothing for a role it does not recognise", () => {
        // A script's own role, or one from a newer version reached over sync.
        expect(attachmentRoleTraits("somethingAScriptInvented")).toBeUndefined();
        expect(attachmentRoleTraits(undefined)).toBeUndefined();
        expect(attachmentRoleTraits("")).toBeUndefined();

        // The role is whatever was stored, so these reach the lookup too. Read off the table rather
        // than checked against it, they would answer with something from its prototype — and
        // `"constructor"` is truthy, which would make every question below answer yes.
        expect(attachmentRoleTraits("constructor")).toBeUndefined();
        expect(attachmentRoleTraits("toString")).toBeUndefined();
        expect(isImageAttachmentRole("constructor")).toBe(false);
    });

    it("gives every role an answer to every question", () => {
        // The types already refuse a role that arrives without one; this says the same at runtime,
        // for the shape the table is actually read with.
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect(Object.keys(traits).sort(), role).toStrictEqual([ "deduplicated", "embedded", "picture" ]);
        }
    });

    it("is what the questions are answered from", () => {
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect(isImageAttachmentRole(role), role).toBe(traits.picture);
            expect(isDeduplicatedAttachmentRole(role), role).toBe(traits.deduplicated);
            expect(isEmbeddedAttachmentRole(role), role).toBe(traits.embedded);
        }
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
