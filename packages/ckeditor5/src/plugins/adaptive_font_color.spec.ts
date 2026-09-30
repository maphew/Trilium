import { adaptColor } from "@triliumnext/commons";
import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    FontBackgroundColor,
    FontColor,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AdaptiveFontColor from "./adaptive_font_color.js";

describe("AdaptiveFontColor", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, FontColor, FontBackgroundColor, AdaptiveFontColor
        ]);
        setModelData(editor.model, "<paragraph>[text]</paragraph>");
    });

    it("stores a picked color as a light and dark theme pair", () => {
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

    it("keeps a pair through saving and loading the note", () => {
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
});
