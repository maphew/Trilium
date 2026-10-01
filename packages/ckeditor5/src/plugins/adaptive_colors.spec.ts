import {
    adaptColor,
    DEFAULT_ADAPTIVE_COLOR_BANDS,
    toAdaptiveColorValue
} from "@triliumnext/commons";
import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    FontBackgroundColor,
    FontColor,
    Paragraph,
    Table,
    TableCellProperties,
    TableProperties
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AdaptiveColors from "./adaptive_colors.js";

describe("AdaptiveColors", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, FontColor, FontBackgroundColor, Table, TableProperties,
            TableCellProperties, AdaptiveColors
        ]);
        setModelData(editor.model, "<paragraph>[text]</paragraph>");
    });

    it("stores a picked text color as a pair, with the color as picked", () => {
        editor.execute("fontColor", { value: "hsl(0, 75%, 60%)" });
        editor.execute("fontBackgroundColor", { value: "#e5e64d" });

        const text = toAdaptiveColorValue("hsl(0, 75%, 60%)", "text");
        const background = toAdaptiveColorValue("#e5e64d", "background");
        expect(text).toMatch(/^light-dark\(.+\)\/\*#[0-9a-f]{6}\*\/$/);
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<paragraph><$text fontBackgroundColor="${background}" fontColor="${text}">`
            + "text</$text></paragraph>"
        );
    });

    it("saves the pair and the color as picked as two declarations, and loads them back", () => {
        editor.execute("fontColor", { value: "#e64d4d" });
        editor.execute("fontBackgroundColor", { value: "#e5e64d" });

        const saved = editor.getData();
        expect(saved).toContain(`color:${adaptColor("#e64d4d", "text")}`);
        expect(saved).toContain("--tn-color:#e64d4d");
        expect(saved).toContain(`background-color:${adaptColor("#e5e64d", "background")}`);
        expect(saved).toContain("--tn-background:#e5e64d");
        expect(saved).not.toContain("/*");

        editor.setData(saved);
        expect(editor.getData()).toBe(saved);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toContain(`fontColor="${toAdaptiveColorValue("#e64d4d", "text")}"`);
    });

    it("loads a color saved without the color as picked as it is", () => {
        const legacy = "<p><span style=\"color:#ff0000;\">a</span>"
            + "<span style=\"color:light-dark(#b81e2c,#ff9f96);\">b</span></p>";
        editor.setData(legacy);
        expect(editor.getData()).toBe(legacy);
    });

    it("keeps an adapted value as it is, and removes both declarations with the color", () => {
        const value = toAdaptiveColorValue("#e64d4d", "text");
        editor.execute("fontColor", { value });
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph><$text fontColor="${value}">text</$text></paragraph>`);

        editor.execute("fontColor");
        expect(editor.getData()).toBe("<p>text</p>");

        editor.execute("fontBackgroundColor", { value: "#e64d4d" });
        editor.execute("fontBackgroundColor", { value: "" });
        expect(editor.getData()).toBe("<p>text</p>");
    });

    it("uses the theme's limits from the editor config", async () => {
        const bands = {
            ...DEFAULT_ADAPTIVE_COLOR_BANDS,
            text: {
                ...DEFAULT_ADAPTIVE_COLOR_BANDS.text,
                light: { minLightness: 0, maxLightness: 0, maxChroma: Infinity }
            }
        };
        const themed = await createTestEditor(
            [ Essentials, Paragraph, FontColor, AdaptiveColors ],
            { adaptiveColorBands: bands }
        );
        setModelData(themed.model, "<paragraph>[text]</paragraph>");

        themed.execute("fontColor", { value: "#e64d4d" });
        const value = toAdaptiveColorValue("#e64d4d", "text", bands);
        expect(value).toMatch(/^light-dark\(#000000,/);
        expect(getModelData(themed.model, { withoutSelection: true }))
            .toBe(`<paragraph><$text fontColor="${value}">text</$text></paragraph>`);
    });

    it("converts text colors in an editor without the table properties plugins", async () => {
        const textOnly = await createTestEditor([
            Essentials, Paragraph, FontColor, FontBackgroundColor, AdaptiveColors
        ]);
        setModelData(textOnly.model, "<paragraph>[text]</paragraph>");

        textOnly.execute("fontColor", { value: "#e64d4d" });
        const value = toAdaptiveColorValue("#e64d4d", "text");
        expect(getModelData(textOnly.model, { withoutSelection: true }))
            .toBe(`<paragraph><$text fontColor="${value}">text</$text></paragraph>`);
    });

    it("stores table and cell colors as pairs, through saving and loading", () => {
        setModelData(editor.model, "<table><tableRow><tableCell><paragraph>[]a</paragraph>"
            + "</tableCell></tableRow></table>");
        editor.execute("tableBorderStyle", { value: "solid" });
        editor.execute("tableBorderWidth", { value: "2px" });
        editor.execute("tableBorderColor", { value: "#4d99e6" });
        editor.execute("tableBackgroundColor", { value: "#e5e64d" });
        editor.execute("tableCellBorderStyle", { value: "dashed" });
        editor.execute("tableCellBorderWidth", { value: "1px" });
        editor.execute("tableCellBorderColor", { value: "#000000" });
        editor.execute("tableCellBackgroundColor", { value: "#e64d4d" });

        const saved = editor.getData();
        expect(saved).toContain(`border:2px solid ${adaptColor("#4d99e6", "tableBorder")}`);
        expect(saved).toContain(`background-color:${adaptColor("#e5e64d", "tableBackground")}`);
        expect(saved).toContain("--tn-background:#e5e64d");
        // 1px is the default cell border width, so the cell gets no `border` shorthand.
        expect(saved).toContain(`border-color:${adaptColor("#000000", "tableBorder")}`);
        expect(saved).toContain(`background-color:${adaptColor("#e64d4d", "tableBackground")}`);
        expect(saved).toContain("--tn-background:#e64d4d");
        expect(saved).not.toContain("/*");

        editor.setData(saved);
        expect(editor.getData()).toBe(saved);

        // Loading selects the whole table; removing a cell color needs the caret in the cell.
        const cellParagraph = editor.model.document.getRoot()?.getNodeByPath([ 0, 0, 0, 0 ]);
        if (!cellParagraph) {
            throw new Error("The loaded table has no cell paragraph.");
        }
        editor.model.change((writer) => writer.setSelection(cellParagraph, 0));
        editor.execute("tableCellBackgroundColor", { value: "" });
        expect(editor.getData()).not.toContain("--tn-background:#e64d4d");
    });
});
