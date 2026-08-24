import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { decodeBase64 } from "../../services/utils/binary";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared spreadsheet render route through {@link CoreApiTester} (no Express), so this
 * spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

/** A 1x1 transparent PNG, small enough to be written out in full. */
const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA"
    + "C0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("Spreadsheet API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("renders a workbook to a readable xlsx, and rejects a non-string content", async () => {
        const cellData = { "0": { "0": { v: "Hello", t: 1 }, "1": { v: 42, t: 2 } } };
        const ws = (await renderWorkbook(workbookJson(cellData))).getWorksheet("Ledger");

        expect(ws?.getCell("A1").value).toBe("Hello");
        expect(ws?.getCell("B1").value).toBe(42);

        const rejected = await api.post("/api/spreadsheet/xlsx", {
            body: { content: { not: "a string" } }
        });
        expect(rejected.status).toBe(400);
    });

    it("embeds an image stored as an attachment", async () => {
        const source = await uploadPixelPng("Attachment image export");
        const wb = await renderWorkbook(workbookJson(cellWithDrawing(source)));

        expect(wb.worksheets[0].getImages().length).toBe(1);
        expect(wb.model.media[0]?.extension).toBe("png");
    });

    it("embeds an inline data URL", async () => {
        const source = `data:image/png;base64,${PIXEL_PNG_BASE64}`;
        const wb = await renderWorkbook(workbookJson(cellWithDrawing(source)));

        expect(wb.worksheets[0].getImages().length).toBe(1);
        expect(wb.model.media[0]?.extension).toBe("png");
    });

    it("skips a drawing it can't turn into embeddable bytes", async () => {
        // A vanished attachment, a format exceljs can't embed, and a source that is neither an
        // attachment URL nor a data URL.
        const sources = [
            "api/attachments/nosuchattachment/image/x.png",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "https://example.com/photo.png"
        ];

        for (const source of sources) {
            const wb = await renderWorkbook(workbookJson(cellWithDrawing(source)));
            expect(wb.worksheets[0].getImages().length).toBe(0);
        }
    });
});

/** Posts the workbook JSON to the route and reads the answer back as a real workbook. */
async function renderWorkbook(json: string): Promise<ExcelJS.Workbook> {
    const res = await api.post<{ base64: string }>("/api/spreadsheet/xlsx", {
        body: { content: json }
    });
    expect(res.status).toBe(200);

    // The decoder can hand back a view into a larger pooled buffer, so copy the bytes into an
    // ArrayBuffer of their own before exceljs unzips it.
    const bytes = decodeBase64(res.body.base64);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(bytes).buffer);
    return wb;
}

/** Wraps cell data into a complete single-sheet workbook payload. */
function workbookJson(cellData: Record<string, Record<string, unknown>>): string {
    return JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"],
            styles: {},
            sheets: {
                s1: {
                    id: "s1",
                    name: "Ledger",
                    hidden: 0,
                    mergeData: [],
                    cellData,
                    rowData: {},
                    columnData: {}
                }
            }
        }
    });
}

/** Cell data holding one cell image pointing at `source`. */
function cellWithDrawing(source: string) {
    const drawing = { drawingId: "d1", source, transform: { width: 10, height: 10 } };

    return {
        "0": {
            "0": {
                p: { drawings: { d1: drawing }, drawingsOrder: ["d1"] }
            }
        }
    };
}

/** Uploads the pixel PNG and returns the `api/attachments/...` URL it is served from. */
async function uploadPixelPng(title: string): Promise<string> {
    const { noteId } = await createTextNote(api, { title });

    const res = await api.post<{ uploaded: boolean; url: string }>(
        `/api/notes/${noteId}/attachments/upload`,
        {
            file: {
                originalname: "pixel.png",
                mimetype: "image/png",
                buffer: decodeBase64(PIXEL_PNG_BASE64)
            }
        }
    );
    expect(res.body.uploaded).toBe(true);

    return res.body.url;
}
