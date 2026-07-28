import {
    Bold,
    type ButtonView,
    type ClassicEditor,
    Essentials,
    _getModelData as getModelData,
    HorizontalLine,
    Italic,
    keyCodes,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COPY_FORMAT_COMMAND, CURSOR_ACTIVE_CSS_CLASS, FORMAT_PAINTER_COMPONENT } from "./constants.js";
import TriliumFormatPainter from "./format_painter.js";
import FormatPainterUI from "./format_painter_ui.js";

describe("FormatPainterUI", () => {
    let editor: ClassicEditor;

    async function createEditor() {
        editor = await createTestEditor([ Essentials, Paragraph, Bold, Italic, HorizontalLine, TriliumFormatPainter ]);
    }

    function ui() {
        return editor.plugins.get(FormatPainterUI);
    }

    function button() {
        return editor.ui.componentFactory.create(FORMAT_PAINTER_COMPONENT) as ButtonView;
    }

    function root() {
        const domRoot = editor.editing.view.getDomRoot();
        if (!domRoot) {
            throw new Error("editing root is not attached");
        }
        return domRoot;
    }

    function paintClick() {
        root().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }

    function pressKey(keyCode: number) {
        editor.editing.view.document.fire("keydown", {
            keyCode,
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    function model() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    beforeEach(async () => {
        await createEditor();
    });

    it("registers the plugin and a labelled, icon-bearing button", () => {
        expect(FormatPainterUI.pluginName).toBe("FormatPainterUI");

        const view = button();
        expect(view.label).toBe("Copy formatting");
        expect(view.icon).toBeTruthy();
        expect(view.tooltip).toBe(true);
    });

    it("binds the button's enabled state to whether formatting can be copied", () => {
        const view = button();

        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(view.isEnabled).toBe(true);

        // A selected block object is not a place formatting can be read from.
        setModelData(editor.model, "[<horizontalLine></horizontalLine>]");
        expect(view.isEnabled).toBe(false);
    });

    describe("one-shot painting", () => {
        it("arms on click: copies the formatting and marks the roots", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");

            const view = button();
            view.fire("execute");

            expect(ui().isActive).toBe(true);
            expect(view.isOn).toBe(true);
            expect(root().classList.contains(CURSOR_ACTIVE_CSS_CLASS)).toBe(true);
            expect(editor.commands.get(COPY_FORMAT_COMMAND)?.value).toEqual({ bold: true });
        });

        it("pastes onto the next click's selection, then disarms", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            button().fire("execute");

            // The user now selects a target elsewhere and releases the mouse over it.
            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            paintClick();

            expect(model()).toContain("<$text bold=\"true\">bar</$text>");
            expect(ui().isActive).toBe(false);
            expect(root().classList.contains(CURSOR_ACTIVE_CSS_CLASS)).toBe(false);
        });

        it("disarms without pasting when the button is clicked again", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            const view = button();

            view.fire("execute");
            expect(ui().isActive).toBe(true);

            view.fire("execute");
            expect(ui().isActive).toBe(false);

            // A later click must not paste, since the painter is no longer armed.
            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            paintClick();
            expect(model()).toContain("<paragraph>bar</paragraph>");
        });
    });

    describe("cancelling", () => {
        function arm() {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            button().fire("execute");
            expect(ui().isActive).toBe(true);
        }

        it("cancels on Escape", () => {
            arm();
            pressKey(keyCodes.esc);
            expect(ui().isActive).toBe(false);
        });

        it("ignores a non-Escape key while armed", () => {
            arm();
            pressKey(keyCodes.arrowdown);
            expect(ui().isActive).toBe(true);
        });

        it("does nothing on Escape when not armed", () => {
            pressKey(keyCodes.esc);
            expect(ui().isActive).toBe(false);
        });

        it("cancels when the editor turns read-only", () => {
            arm();
            editor.enableReadOnlyMode("test");
            expect(ui().isActive).toBe(false);
            editor.disableReadOnlyMode("test");
        });

        it("tolerates a read-only toggle while not armed", () => {
            editor.enableReadOnlyMode("test");
            expect(ui().isActive).toBe(false);
            editor.disableReadOnlyMode("test");
        });
    });
});
