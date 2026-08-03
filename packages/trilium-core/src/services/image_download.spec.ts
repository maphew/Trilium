import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import { downloadImages, downloadPictureToAttachment, storeLinkPreviewPictures } from "./image_download.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import { initRequest } from "./request.js";

/**
 * Runs against the real in-memory fixture DB booted by the server suite setup, through which
 * co-located trilium-core specs run. The network is the only thing stood in for.
 */

let counter = 0;

/** Creates a fresh text note under root, uniquely titled since the fixture DB is shared. */
function createNote(content: string): BNote {
    counter++;

    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `image-download-spec-${counter}`,
            content,
            type: "text"
        })
    ).note;
}

/** A 1x1 PNG. The bytes are asked what they are, so a placeholder buffer would rightly be refused. */
const PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
);

/** A vector icon, as GitHub and a good many other sites serve. Markup, so its bytes are text. */
const TINY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>`;

const card = (url: string, favicon: string, image?: string) =>
    `<section class="link-embed" data-url="${url}" data-embed-type="opengraph" data-favicon="${favicon}"`
    + `${image ? ` data-image="${image}"` : ""}></section>`;

/**
 * Stands in for the network. The suite boots no request provider, so one is installed here and
 * taken away again — leaving a stub in place would answer for whatever else shares this worker.
 */
let asked: string[] = [];
let answerWith: (url: string) => Buffer | undefined = () => PIXEL_PNG;

beforeAll(() => {
    initRequest({
        exec: async () => { throw new Error("Not used by these tests."); },
        getImage: async (url: string) => {
            asked.push(url);
            const bytes = answerWith(url);

            if (!bytes) {
                throw new Error(`404 ${url}`);
            }

            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        }
    });
});

afterAll(() => {
    initRequest({
        exec: async () => { throw new Error("Request provider not initialized. Call initRequest() first."); },
        getImage: async () => { throw new Error("Request provider not initialized. Call initRequest() first."); }
    });
});

beforeEach(() => {
    asked = [];
    answerWith = () => PIXEL_PNG;
});

describe("downloadPictureToAttachment (real DB)", () => {
    it("keeps the picture as an attachment under the role and title it is given", async () => {
        const note = createNote("<p>x</p>");

        const reference = await getContext().init(() => downloadPictureToAttachment(note.noteId, "https://example.com/icon.png", {
            role: "favicon",
            title: "example.com"
        }));

        const [ attachment ] = note.getAttachments();
        // The extension comes from what the bytes are, not from the address they came from.
        expect(attachment).toMatchObject({ role: "favicon", title: "example.com.png" });
        expect(reference).toBe(`api/attachments/${attachment.attachmentId}/image/example.com.png`);
    });

    it("asks for nothing at an address that is not a website", async () => {
        // The address reaches this from note content, so it is whatever was written there.
        const note = createNote("<p>x</p>");

        for (const address of [ "file:///etc/passwd", "data:image/png;base64,AAAA", "api/attachments/a/image/b.png", "" ]) {
            expect(await getContext().init(() => downloadPictureToAttachment(note.noteId, address, { role: "image", title: "x" }))).toBeUndefined();
        }

        expect(asked).toEqual([]);
    });

    it("refuses what comes back if it is not a picture", async () => {
        // A 404 page served where a picture should be is the ordinary case.
        const note = createNote("<p>x</p>");
        answerWith = () => Buffer.from("<html>Not found</html>");

        expect(await getContext().init(() => downloadPictureToAttachment(note.noteId, "https://example.com/gone.png", {
            role: "image",
            title: "x"
        }))).toBeUndefined();
        expect(note.getAttachments()).toHaveLength(0);
    });

    it("answers with nothing when the address cannot be reached", async () => {
        const note = createNote("<p>x</p>");
        answerWith = () => undefined;

        expect(await getContext().init(() => downloadPictureToAttachment(note.noteId, "https://example.com/x.png", {
            role: "image",
            title: "x"
        }))).toBeUndefined();
    });
});

describe("downloadImages (real DB)", () => {
    it("reads a src past the attributes written before it, and knows an attachment's own", () => {
        // The tag is bounded in how far it is read for a `src`, so what an editor actually writes
        // before one — a class, a style, an alt — has to still be found past it.
        const note = createNote("<p>x</p>");
        const pasted = `<img class="image_resized" style="width:53.68%;" alt="a pasted picture"`
            + ` src="data:image/png;base64,${PIXEL_PNG.toString("base64")}">`;
        const stored = `<img src="api/attachments/abc123456789/image/kept.png">`;

        const rewritten = getContext().init(() => downloadImages(note.noteId, `<p>${pasted}${stored}</p>`));

        const [ attachment ] = note.getAttachments();
        expect(rewritten).toContain(`<img src="api/attachments/${attachment.attachmentId}/image/`);
        // A picture this note already holds is not a picture to go and fetch.
        expect(rewritten).toContain(stored);
        expect(asked).toEqual([]);
    });
});

describe("storeLinkPreviewPictures (real DB)", () => {
    it("stores each as an attachment and points the card at it", async () => {
        // What a Notion export leaves behind: the origin's addresses and no bytes, which the render
        // sinks refuse outright — so until they are fetched the card shows placeholders.
        const note = createNote(card("https://example.com/page", "https://example.com/favicon.png", "https://cdn.example.com/cover.png"));

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(asked).toEqual([ "https://example.com/favicon.png", "https://cdn.example.com/cover.png" ]);

        // Roled and named exactly as a preview fetched here would be.
        const attachments = note.getAttachments();
        expect(attachments.map((a) => [ a.role, a.title ]).sort()).toStrictEqual([
            [ "coverImage", expect.stringMatching(/^example\.com-page-[0-9a-f]{8}\.png$/) ],
            [ "favicon", "example.com.png" ]
        ]);

        const content = String(note.getContent());
        expect(content).not.toContain("https://example.com/favicon.png");
        expect(content).not.toContain("https://cdn.example.com/cover.png");
        for (const attachment of attachments) {
            expect(content).toContain(`api/attachments/${attachment.attachmentId}/image/`);
        }
    });

    it("keeps one icon for a site named by more than one card", async () => {
        const note = createNote(
            card("https://example.com/a", "https://example.com/favicon.png")
            + card("https://example.com/b", "https://example.com/favicon.png")
        );

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments().map((a) => a.title)).toStrictEqual([ "example.com.png" ]);
    });

    it("asks for nothing when the setting says not to", async () => {
        // The same setting that decides whether a remote <img> in note content is fetched.
        const note = createNote(card("https://example.com/page", "https://example.com/favicon.png"));
        const previously = optionService.getOptionBool("downloadImagesAutomatically");
        getContext().init(() => optionService.setOption("downloadImagesAutomatically", "false"));

        try {
            await getContext().init(() => storeLinkPreviewPictures(note));
        } finally {
            getContext().init(() => optionService.setOption("downloadImagesAutomatically", String(previously)));
        }

        expect(asked).toEqual([]);
        expect(note.getAttachments()).toHaveLength(0);
        // Left as it was: nothing was fetched, so nothing is rewritten.
        expect(String(note.getContent())).toContain("https://example.com/favicon.png");
    });

    it("leaves a picture that is already an attachment alone", async () => {
        // A preview made here, or one already stored: nothing left to do and nobody to ask.
        const note = createNote(card("https://example.com/page", "api/attachments/att1/image/example.com.ico"));

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(asked).toEqual([]);
        expect(note.getAttachments()).toHaveLength(0);
        expect(String(note.getContent())).toContain(`data-favicon="api/attachments/att1/image/example.com.ico"`);
    });

    it("lifts a picture carried inline out into an attachment", async () => {
        // Our own single-file export inlines both pictures as base64, having nowhere else to put them,
        // and every preview made before the pictures became attachments carried them the same way.
        // Left inline they cost a third more than the bytes they encode, in every revision of the note.
        const note = createNote(card(
            "https://example.com/page",
            `data:image/svg+xml;base64,${btoa(TINY_SVG)}`,
            `data:image/png;base64,${PIXEL_PNG.toString("base64")}`
        ));

        await getContext().init(() => storeLinkPreviewPictures(note));

        // Nothing was fetched — the bytes were already here — and both are roled and named exactly as
        // a preview made here would have stored them.
        expect(asked).toEqual([]);
        const attachments = note.getAttachments();
        expect(attachments.map((a) => [ a.role, a.title ]).sort()).toStrictEqual([
            [ "coverImage", expect.stringMatching(/^example\.com-page-[0-9a-f]{8}\.png$/) ],
            [ "favicon", "example.com.svg" ]
        ]);

        const content = String(note.getContent());
        expect(content).not.toContain("base64");
        for (const attachment of attachments) {
            expect(content).toContain(`api/attachments/${attachment.attachmentId}/image/`);
        }
    });

    it("lifts an inline picture whatever the setting says, having nobody to ask", async () => {
        // `downloadImagesAutomatically` governs reaching out to a third party on the reader's behalf.
        // Unpacking bytes the note already carries asks nothing of anyone, so the setting has no say —
        // and gating it there would leave the base64 in place for anyone who had turned it off.
        const note = createNote(card("https://example.com/page", `data:image/png;base64,${PIXEL_PNG.toString("base64")}`));
        const previously = optionService.getOptionBool("downloadImagesAutomatically");
        getContext().init(() => optionService.setOption("downloadImagesAutomatically", "false"));

        try {
            await getContext().init(() => storeLinkPreviewPictures(note));
        } finally {
            getContext().init(() => optionService.setOption("downloadImagesAutomatically", String(previously)));
        }

        expect(note.getAttachments().map((a) => a.title)).toStrictEqual([ "example.com.png" ]);
        expect(String(note.getContent())).not.toContain("base64");
    });

    it("keeps one icon when the same inline picture repeats across cards", async () => {
        // The saving that makes this worth doing: a site linked a dozen times inlines its icon a
        // dozen times, and a deduplicated role keys on the title, so those dozen become one.
        const icon = `data:image/png;base64,${PIXEL_PNG.toString("base64")}`;
        const note = createNote(
            card("https://example.com/a", icon) + card("https://example.com/b", icon)
        );

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments().map((a) => a.title)).toStrictEqual([ "example.com.png" ]);
    });

    it("leaves an inline value alone when it is not a picture at all", async () => {
        // The bytes are asked what they are rather than the `data:` prefix being taken for it.
        const note = createNote(card("https://example.com/page", "data:image/png;base64,AAAA"));

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments()).toHaveLength(0);
        expect(String(note.getContent())).toContain(`data-favicon="data:image/png;base64,AAAA"`);
    });

    it("drops nothing and keeps going when a picture cannot be had", async () => {
        // One address answers, the other does not: the card that can be completed is, and the one
        // that cannot keeps what it had rather than the note failing to save.
        const note = createNote(card("https://example.com/page", "https://example.com/favicon.png", "https://cdn.example.com/gone.png"));
        answerWith = (url) => (url.includes("gone") ? undefined : PIXEL_PNG);

        await getContext().init(() => storeLinkPreviewPictures(note));

        expect(note.getAttachments().map((a) => a.role)).toStrictEqual([ "favicon" ]);
        expect(String(note.getContent())).toContain(`data-image="https://cdn.example.com/gone.png"`);
    });
});
