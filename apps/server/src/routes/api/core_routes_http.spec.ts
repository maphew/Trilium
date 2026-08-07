import { beforeAll, describe, expect, it } from "vitest";

import {
    type ApiTestContext,
    bootLoggedInApp,
    createTextNote } from "../../../spec/support/internal_api.js";

/**
 * Thin Express-transport layer for the shared **core** API routes.
 *
 * Per-route behaviour (handlers, serialization, status/error mapping) is covered
 * cross-runtime by the `CoreApiTester` specs in `packages/trilium-core/src/routes/api/`.
 * This spec only asserts the things that exist *because of Express* and the
 * server middleware — and therefore can't be exercised by the in-process core
 * driver: CSRF enforcement, and that core routes are actually wired into the
 * Express app end to end. (Auth-required can't be asserted here because the test
 * fixture's config.ini sets `noAuthentication=true`.)
 */
let ctx: ApiTestContext;

describe("Core routes over Express", () => {
    beforeAll(async () => {
        ctx = await bootLoggedInApp();
    });

    it("rejects a mutating request without a CSRF token (403)", async () => {
        await ctx.agent.post("/api/tree/load").send({ noteIds: [ "root" ] }).expect(403);
    });

    it("serves a core GET route end to end once authenticated", async () => {
        const res = await ctx.agent.get("/api/tree").expect(200);
        expect(res.body.notes.some((n: { noteId: string }) => n.noteId === "root")).toBe(true);
    });

    it("runs a core mutating route end to end with a CSRF token", async () => {
        const { noteId } = await createTextNote(ctx, { title: "Via Express" });
        const res = await ctx.agent.get(`/api/notes/${noteId}`).expect(200);
        expect(res.body.title).toBe("Via Express");
    });

    // Media players stream from open-partial, and only a real Express response can show that the
    // slice leaves as bytes: `res.send()` treats anything that is not a Buffer as JSON.
    it("answers a byte range on open-partial with 206 and the raw slice", async () => {
        const { noteId } = await createTextNote(ctx, { content: "<p>hello</p>" });

        const full = await ctx.agent.get(`/api/notes/${noteId}/open-partial`).expect(200);
        expect(full.headers["accept-ranges"]).toBe("bytes");
        expect(full.text).toBe("<p>hello</p>");

        const ranged = await ctx.agent.get(`/api/notes/${noteId}/open-partial`).set("Range", "bytes=3-7").expect(206);
        expect(ranged.headers["content-range"]).toBe("bytes 3-7/12");
        expect(ranged.text).toBe("hello");
    });
});
