import { convertOfficeToHtml } from "@triliumnext/core/src/services/office_preview.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Canary for the officeparser aliases in vite.config.mts: the standalone build bypasses
 * the package's prebuilt `browser` entry and bundles `officeparser/dist/index.mjs`
 * directly (with pdfjs-dist/tesseract.js stubbed out). That reaches into officeparser's
 * dist/ internals, so an upstream upgrade could silently break the alias target or the
 * stubbed-out code paths. This spec resolves officeparser through the same aliases, so
 * a breaking upgrade fails here instead of at runtime in the browser.
 */
describe("office preview with aliased officeparser", () => {
    it("converts a DOCX fixture to HTML through the slim entry", async () => {
        const docx = readFixture("demo.docx");
        const html = await convertOfficeToHtml(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

        expect(html).toContain("Welcome to Trilium Notes!");
        // An embeddable fragment, not a standalone document.
        expect(html).not.toContain("<html");
    });

    it("converts an XLSX spreadsheet fixture to HTML", async () => {
        const xlsx = readFixture("demo.xlsx");
        const html = await convertOfficeToHtml(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        expect(html).toContain("<table");
    });
});

function readFixture(name: string): Uint8Array {
    // Vitest serves transformed modules from Vite's virtual /@fs/ root — strip it
    // to get a real filesystem path (no-op when the prefix is absent).
    const path = fileURLToPath(new URL(`../../server/src/services/ocr/processors/samples/${name}`, import.meta.url))
        .replace(/^[/\\]@fs/, "");

    return new Uint8Array(readFileSync(path));
}
