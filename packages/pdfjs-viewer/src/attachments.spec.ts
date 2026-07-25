import { describe, expect, it, vi } from "vitest";

import { collectAttachments } from "./attachments";

/** Mirrors what pdf.js hands back since 6.1: a `Map`, with the content stripped from the entries. */
function attachmentMap(...entries: [string, { filename?: string }][]) {
    return new Map(entries);
}

describe("collectAttachments", () => {
    it("maps a pdf.js attachment map into metadata, sizing each entry from its content", async () => {
        const getContent = vi.fn(async (id: string) => new Uint8Array(id === "note" ? 1024 : 3));

        const result = await collectAttachments(attachmentMap(
            ["note", { filename: "Note.trilium" }],
            ["nested/data.bin", { filename: "data.bin" }]
        ), getContent);

        expect(result).toEqual([
            { id: "note", filename: "Note.trilium", size: 1024 },
            { id: "nested/data.bin", filename: "data.bin", size: 3 }
        ]);

        // Content is fetched by map key, which is what the client sends back to download it.
        expect(getContent.mock.calls).toEqual([["note"], ["nested/data.bin"]]);
    });

    it("falls back to the key when an entry has no display filename, and to 0 for missing content", async () => {
        const result = await collectAttachments(attachmentMap(
            ["unnamed", {}],
            ["gone", { filename: "gone.txt" }]
        ), async (id) => (id === "gone" ? null : new Uint8Array(2)));

        expect(result).toEqual([
            { id: "unnamed", filename: "unnamed", size: 2 },
            { id: "gone", filename: "gone.txt", size: 0 }
        ]);
    });

    it("returns an empty list for documents without attachments", async () => {
        const getContent = vi.fn();

        expect(await collectAttachments(null, getContent)).toEqual([]);
        expect(await collectAttachments(undefined, getContent)).toEqual([]);
        expect(await collectAttachments(attachmentMap(), getContent)).toEqual([]);
        expect(getContent).not.toHaveBeenCalled();
    });
});
