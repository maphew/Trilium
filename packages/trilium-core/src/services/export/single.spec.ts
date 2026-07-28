import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import type { ExportFormat } from "../../meta.js";
import TaskContext from "../task_context.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import singleExportService, { mapByNoteType } from "./single.js";

describe("Note type mappings", () => {
    it("supports mermaid note", () => {
        const note = buildNote({
            type: "mermaid",
            title: "New note"
        });

        expect(mapByNoteType(note, "", "html")).toMatchObject({
            extension: "mermaid",
            mime: "text/vnd.mermaid"
        });
    });

    it("strips CKEditor's data-list-item-id from single-note HTML and Markdown exports", () => {
        // The bullet converts to Markdown syntax; the list inside the table survives as raw HTML —
        // neither should carry the editor-only id in either format.
        const note = buildNote({ type: "text", title: "Listy" });
        const content = `<ul><li data-list-item-id="e0123">Bullet</li></ul>`
            + `<table><tbody><tr><td><ul><li data-list-item-id="e4567">Cell</li></ul></td></tr></tbody></table>`;

        for (const format of ["html", "markdown"] as const) {
            const { payload } = mapByNoteType(note, content, format);
            expect(payload).not.toContain("data-list-item-id");
            expect(payload).toContain("Bullet");
            expect(payload).toContain("Cell");
        }
    });

    it("inlines a link preview's data-image attachment as base64 in single-note HTML export", () => {
        // A link preview references its card image attachment from `data-image`, not an <img src>;
        // the single-file export must inline it the same way to stay self-contained.
        const note = buildNote({ type: "text", title: "Preview" });
        const fakeAttachment = {
            mime: "image/jpeg",
            getContent: () => new Uint8Array([1, 2, 3])
        } as unknown as BAttachment;
        const getAttachment = vi.spyOn(becca, "getAttachment").mockReturnValue(fakeAttachment);

        try {
            const content = `<section class="link-embed" data-url="https://example.com"`
                + ` data-image="api/attachments/att1/image/preview.jpg"></section>`;
            const { payload } = mapByNoteType(note, content, "html");

            expect(getAttachment).toHaveBeenCalledWith("att1");
            expect(payload).toContain(`data-image="data:image/jpeg;base64,AQID"`);
            expect(payload).not.toContain("api/attachments");
        } finally {
            getAttachment.mockRestore();
        }
    });

    it("exports a spreadsheet note verbatim with a .triliumsheet extension", () => {
        // Like canvas/mermaid, single-note spreadsheet export is a lossless raw dump of the stored
        // Univer workbook JSON — no conversion (the editor's own CSV/XLSX buttons cover interchange).
        const content = JSON.stringify({ workbook: { id: "wb", sheetOrder: ["s1"], sheets: { s1: {} } } });
        const note = buildNote({ type: "spreadsheet", mime: "text/x-spreadsheet", title: "Budget" });

        const result = mapByNoteType(note, content, "html");

        expect(result).toMatchObject({
            extension: "triliumsheet",
            mime: "application/json"
        });
        // Byte-for-byte: the payload is the stored workbook, untouched.
        expect(result.payload).toBe(content);
    });

    it("falls back to a raw .dat dump for note types without a dedicated mapping", () => {
        // book/webView/mindMap/… aren't handled explicitly; rather than a zero-byte `.undefined`, they
        // export their raw content with a generic extension (mirrors the zip export's `dat` fallback).
        const note = buildNote({ type: "book", mime: "", title: "My book" });
        expect(mapByNoteType(note, "raw contents", "html")).toMatchObject({
            payload: "raw contents",
            extension: "dat",
            mime: "application/octet-stream"
        });

        // A note carrying its own MIME keeps it in the Content-Type.
        const webView = buildNote({ type: "webView", mime: "text/html", title: "Site" });
        expect(mapByNoteType(webView, "x", "html")).toMatchObject({ extension: "dat", mime: "text/html" });
    });

    it("exports markdown code notes with a .md extension", () => {
        // `mime-types` doesn't recognize Trilium's custom `text/x-markdown`;
        // without the explicit fallback this was exporting as `.code`.
        for (const mime of [ "text/x-markdown", "text/markdown", "text/x-gfm" ]) {
            const note = buildNote({ type: "code", mime, title: "Doc" });
            expect(mapByNoteType(note, "# hi", "markdown")).toMatchObject({
                extension: "md",
                mime
            });
        }
    });

    it("dumps canvas, relation map and search notes verbatim as JSON", () => {
        const cases = [
            { type: "canvas" as const, extension: "excalidraw" },
            { type: "relationMap" as const, extension: "json" },
            { type: "search" as const, extension: "json" }
        ];

        for (const { type, extension } of cases) {
            const note = buildNote({ type, title: "Raw" });
            expect(mapByNoteType(note, "{}", "html")).toMatchObject({ payload: "{}", extension, mime: "application/json" });
        }
    });

    it("refuses binary content, which has no single-file text representation", () => {
        const note = buildNote({ type: "text", title: "Binary" });

        expect(() => mapByNoteType(note, new Uint8Array([1, 2, 3]), "html")).toThrow("Unsupported content type for export.");
    });
});

describe("inlineAttachments", () => {
    /** Runs a text note's HTML through the export, which is what applies the inlining. */
    function exportHtml(content: string) {
        return String(mapByNoteType(buildNote({ type: "text", title: "Inliner" }), content, "html").payload);
    }

    it("inlines an embedded image note as a base64 data URI", () => {
        const imageNote = buildNote({ type: "image", mime: "image/png", title: "pic.png" });
        vi.spyOn(imageNote, "getContent").mockReturnValue(new Uint8Array([1, 2, 3]));
        const getNote = vi.spyOn(becca, "getNote").mockReturnValue(imageNote);

        try {
            const payload = exportHtml(`<p><img src="api/images/img1/pic.png"></p>`);

            expect(getNote).toHaveBeenCalledWith("img1");
            expect(payload).toContain(`src="data:image/png;base64,AQID"`);
            expect(payload).not.toContain("api/images");
        } finally {
            getNote.mockRestore();
        }
    });

    it("leaves an embedded image alone when the note is missing, not an image, or holds text", () => {
        const textNote = buildNote({ type: "text", mime: "text/html", title: "Not an image" });
        const stringImage = buildNote({ type: "image", mime: "image/png", title: "odd.png" });
        vi.spyOn(stringImage, "getContent").mockReturnValue("not binary");
        const getNote = vi.spyOn(becca, "getNote");

        try {
            for (const stub of [null, textNote, stringImage]) {
                getNote.mockReturnValue(stub as never);
                expect(exportHtml(`<p><img src="api/images/img1/pic.png"></p>`)).toContain(`src="api/images/img1/pic.png"`);
            }
        } finally {
            getNote.mockRestore();
        }
    });

    it("inlines an attachment link as a downloadable data URI", () => {
        const fakeAttachment = {
            mime: "application/pdf",
            title: "report <v2>.pdf",
            getContent: () => new Uint8Array([1, 2, 3])
        } as unknown as BAttachment;
        const getAttachment = vi.spyOn(becca, "getAttachment").mockReturnValue(fakeAttachment);

        try {
            const payload = exportHtml(`<p><a href="#root/abc?viewMode=attachments&attachmentId=att1">Report</a></p>`);

            expect(payload).toContain(`href="data:application/pdf;base64,AQID"`);
            // The download filename is escaped, so a title with markup can't break out of the attribute.
            expect(payload).toContain(`download="report &lt;v2&gt;.pdf"`);
        } finally {
            getAttachment.mockRestore();
        }
    });

    it("leaves an attachment reference alone when it is missing, not an image, or holds text", () => {
        const getAttachment = vi.spyOn(becca, "getAttachment");
        const textAttachment = { mime: "text/plain", title: "notes.txt", getContent: () => "plain text" } as unknown as BAttachment;

        try {
            // `data-image` only inlines images, so a non-image attachment is left as-is ...
            getAttachment.mockReturnValue(textAttachment);
            expect(exportHtml(`<section data-image="api/attachments/att1/image/x.png"></section>`))
                .toContain(`data-image="api/attachments/att1/image/x.png"`);

            // ... as is an image attachment whose content came back as text ...
            getAttachment.mockReturnValue({ mime: "image/png", title: "x.png", getContent: () => "text" } as unknown as BAttachment);
            expect(exportHtml(`<section data-image="api/attachments/att1/image/x.png"></section>`))
                .toContain(`data-image="api/attachments/att1/image/x.png"`);

            // ... and an href to an attachment that no longer exists, or whose content is text.
            getAttachment.mockReturnValue(null as never);
            expect(exportHtml(`<p><a href="#root/abc?viewMode=attachments&attachmentId=att1">x</a></p>`))
                .toContain("attachmentId=att1");

            getAttachment.mockReturnValue(textAttachment);
            expect(exportHtml(`<p><a href="#root/abc?viewMode=attachments&attachmentId=att1">x</a></p>`))
                .toContain("attachmentId=att1");
        } finally {
            getAttachment.mockRestore();
        }
    });
});

describe("exportSingleNote", () => {
    /**
     * `format` is deliberately widened past {@link ExportFormat} so the "unrecognized format" guard —
     * which only a caller bypassing the route's own validation can reach — stays testable.
     */
    function exportNote(note: BNote, format: ExportFormat | "pdf") {
        const branch = { getNote: () => note } as unknown as BBranch;
        const res = { setHeader: vi.fn(), send: vi.fn() } as unknown as Response;
        const taskContext = TaskContext.getInstance(`export-single-${note.type}-${format}`, "export", null);

        return { result: singleExportService.exportSingleNote(taskContext, branch, format as ExportFormat, res), res };
    }

    it("writes the mapped payload and download headers for a supported note", () => {
        const note = buildNote({ type: "code", mime: "text/x-markdown", title: "script" });
        vi.spyOn(note, "getContent").mockReturnValue("# hi");

        const { res } = exportNote(note, "html");

        expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", expect.stringContaining("script.md"));
        expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/x-markdown; charset=UTF-8");
        expect(res.send).toHaveBeenCalledWith("# hi");
    });

    it("throws a ValidationError for note types and formats it cannot export", () => {
        // A returned [status, body] tuple used to be dropped on the floor by the route, leaving the
        // request unanswered; throwing an HttpError is what actually reaches the client.
        for (const type of ["image", "file"] as const) {
            const note = buildNote({ type, title: "Binary" });

            expect(() => exportNote(note, "html")).toThrow(
                expect.objectContaining({
                    name: "ValidationError",
                    statusCode: 400,
                    message: `Note type '${type}' cannot be exported as single file.`
                })
            );
        }

        expect(() => exportNote(buildNote({ type: "text", title: "Texty" }), "pdf")).toThrow(
            expect.objectContaining({ name: "ValidationError", statusCode: 400, message: "Unrecognized format 'pdf'" })
        );
    });
});
