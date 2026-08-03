import { ATTACHMENT_ROLES } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

// Nothing initializes i18next for the tests, so the wording is stood in for by the key — which is
// what the mapping here is actually about.
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));

const { attachmentRoleName } = await import("./attachment_role_names.js");

describe("attachmentRoleName", () => {
    it("names every role the app creates", () => {
        // The types already refuse a role that arrives without a name; this says the same for a role
        // added to neither table, which would otherwise reach a reader as its own identifier.
        for (const role of Object.keys(ATTACHMENT_ROLES)) {
            expect(attachmentRoleName(role), role).toBe(`attachment_roles.${role}`);
        }
    });

    it("shows a role it has never heard of as it was stored", () => {
        // Not a name anyone chose, but it is all that is known about the attachment, and a blank
        // would leave a gap where every other row says something.
        expect(attachmentRoleName("somethingAScriptInvented")).toBe("somethingAScriptInvented");
        // The role is whatever was stored, so these reach the lookup too; read off the table rather
        // than checked against it, they would answer with something from its prototype.
        expect(attachmentRoleName("constructor")).toBe("constructor");
        expect(attachmentRoleName("toString")).toBe("toString");
    });

    it("has nothing to say for an attachment without a role", () => {
        expect(attachmentRoleName(undefined)).toBe("");
        expect(attachmentRoleName(null)).toBe("");
        expect(attachmentRoleName("")).toBe("");
    });
});
