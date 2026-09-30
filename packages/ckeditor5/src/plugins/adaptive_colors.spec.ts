import { adaptColor } from "@triliumnext/commons";
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

    it("stores a picked text color as a light and dark theme pair", () => {
        editor.execute("fontColor", { value: "hsl(0, 75%, 60%)" });
        editor.execute("fontBackgroundColor", { value: "hsl(60,75%,60%)" });

        const text = adaptColor("hsl(0, 75%, 60%)", "text");
        const background = adaptColor("hsl(60,75%,60%)", "background");
        expect(text).toMatch(/^light-dark\(/);
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<paragraph><$text fontBackgroundColor="${background}" fontColor="${text}">`
            + "text</$text></paragraph>"
        );
    });

    it("keeps a text color pair through saving and loading the note", () => {
        editor.execute("fontColor", { value: "#e64d4d" });
        const saved = editor.getData();
        expect(saved).toContain(`color:${adaptColor("#e64d4d", "text")}`);

        editor.setData(saved);
        expect(editor.getData()).toBe(saved);
    });

    it("keeps a pair as it is, and still removes a color", () => {
        const pair = "light-dark(#b81e2c,#ff9f96)";
        editor.execute("fontColor", { value: pair });
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph><$text fontColor="${pair}">text</$text></paragraph>`);

        editor.execute("fontColor");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<paragraph>text</paragraph>");
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
        // 1px is the default cell border width, so the cell gets no `border` shorthand.
        expect(saved).toContain(`border-color:${adaptColor("#000000", "tableBorder")}`);
        expect(saved).toContain(`background-color:${adaptColor("#e64d4d", "tableBackground")}`);

        editor.setData(saved);
        expect(editor.getData()).toBe(saved);
    });
});
