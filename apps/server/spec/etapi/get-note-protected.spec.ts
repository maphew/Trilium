import { becca, cls, events, password_encryption, protected_session } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../src/services/config.js";
import { createNote, login } from "./utils.js";

let app: Application;
let token: string;

const USER = "etapi";
const PLAINTEXT_TITLE = "Bank account recovery codes";

describe("etapi/get-note protected", () => {
    let noteId: string;

    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
        token = await login(app);
        noteId = await createNote(app, token);

        // Protect the note the way the UI does: unlock, flip the flag so the title is
        // written back encrypted, then leave the protected session. The LEAVE event
        // reloads becca, which is what drops the decrypted title from memory.
        const dataKey = await password_encryption.getDataKey("demo1234");
        if (!(dataKey instanceof Uint8Array)) {
            throw new Error("Expected a data key from the fixture password.");
        }

        cls.init(() => {
            protected_session.default.setDataKey(dataKey);

            const note = becca.getNoteOrThrow(noteId);
            note.title = PLAINTEXT_TITLE;
            note.isProtected = true;
            note.save();

            protected_session.resetDataKey();
            events.emit(events.LEAVE_PROTECTED_SESSION);
        });
    });

    afterAll(() => {
        protected_session.resetDataKey();
    });

    it("does not disclose the protected title while the protected session is locked", async () => {
        expect(protected_session.default.isProtectedSessionAvailable()).toBe(false);

        const response = await supertest(app)
            .get(`/etapi/notes/${noteId}`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        expect(response.body.isProtected).toBe(true);
        expect(response.body.title).toStrictEqual("[protected]");
        expect(response.body.title).not.toContain(PLAINTEXT_TITLE);
    });
});
