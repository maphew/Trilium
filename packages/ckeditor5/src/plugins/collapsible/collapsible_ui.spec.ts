import { _setModelData as setModelData, ButtonView, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Collapsible from "./collapsible.js";
import CollapsibleEditing from "./collapsible_editing.js";
import CollapsibleUI from "./collapsible_ui.js";

function createButton(editor: ClassicEditor): ButtonView {
    return editor.ui.componentFactory.create("collapsible") as unknown as ButtonView;
}

describe("CollapsibleUI", () => {
    it("registers a labelled toolbar button", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Collapsible]);
        const button = createButton(editor);

        expect(button).toBeInstanceOf(ButtonView);
        expect(button.icon).toContain("<svg");
        expect(button.tooltip).toBe(true);
        expect(CollapsibleUI.pluginName).toBe("CollapsibleUI");
    });

    it("falls back to the raw key when the host supplies no translate callback", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Collapsible]);

        expect(createButton(editor).label).toBe("text-editor.collapsible-button-label");
    });

    it("labels the button through the host's translate callback when one is configured", async () => {
        const translate = vi.fn(() => "Collapsible block");
        const editor = await createTestEditor([Essentials, Paragraph, Collapsible], { translate });

        expect(createButton(editor).label).toBe("Collapsible block");
        expect(translate).toHaveBeenCalledWith("text-editor.collapsible-button-label");
    });

    it("executes the command and returns focus to the editing view", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Collapsible]);
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const focusSpy = vi.spyOn(editor.editing.view, "focus");
        const executeSpy = vi.spyOn(editor, "execute");

        createButton(editor).fire("execute");

        expect(executeSpy).toHaveBeenCalledWith("collapsible");
        expect(focusSpy).toHaveBeenCalled();
    });

    it("tracks the command's enabled state", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Collapsible]);
        const button = createButton(editor);
        const command = editor.commands.get("collapsible");

        expect(button.isEnabled).toBe(true);

        command?.forceDisabled("test");

        expect(button.isEnabled).toBe(false);
    });

    it("still builds a button when the editing plugin is absent, with nothing to bind to", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, CollapsibleUI]);

        expect(editor.commands.get("collapsible")).toBeUndefined();
        expect(createButton(editor)).toBeInstanceOf(ButtonView);
    });

    it("declares the editing plugin as a requirement of the glue plugin", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Collapsible]);

        expect(Collapsible.requires).toContain(CollapsibleEditing);
        expect(Collapsible.requires).toContain(CollapsibleUI);
        expect(Collapsible.pluginName).toBe("Collapsible");
        expect(editor.plugins.get(Collapsible)).toBeInstanceOf(Collapsible);
        expect(editor.plugins.get(CollapsibleEditing)).toBeInstanceOf(CollapsibleEditing);
        expect(editor.plugins.get(CollapsibleUI)).toBeInstanceOf(CollapsibleUI);
    });
});
