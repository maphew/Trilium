import {
    ClassicEditor, Essentials, Paragraph, Widget, _setModelData as setModelData
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import ContentEmbed from "./content_embed.js";
import ContentEmbedTools, {
    CONTENT_EMBED_TOOLS, ContentEmbedToolsView
} from "./content_embed_tools.js";

const ICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"></svg>";
const SELECTION: Tool = {
    id: "selection", label: "Selection", text: "1", isOn: true, group: "tools"
};
const RECTANGLE: Tool = {
    id: "rectangle", label: "Rectangle", text: "2", isOn: false, group: "tools"
};
const UNDO: Tool = { id: "undo", label: "Undo", icon: ICON, isEnabled: false, group: "history" };

interface Tool {
    id: string;
    label: string;
    text?: string;
    icon?: string;
    isOn?: boolean;
    isEnabled?: boolean;
    group?: string;
}

describe("ContentEmbedTools", () => {
    let editor: ClassicEditor;
    let provider: ReturnType<typeof createProvider>;
    let getContentEmbedTools: ReturnType<typeof vi.fn>;
    let view: ContentEmbedToolsView | undefined;

    beforeEach(async () => {
        provider = createProvider([ SELECTION, RECTANGLE ]);
        getContentEmbedTools = vi.fn(() => provider);
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote: vi.fn(), getContentEmbedTools })
        });

        editor = await createTestEditor([
            Essentials, Paragraph, Widget, ContentEmbed, ContentEmbedTools
        ]);
    });

    afterEach(() => {
        view?.element?.remove();
        view = undefined;
    });

    function createView() {
        const created = editor.ui.componentFactory.create(CONTENT_EMBED_TOOLS);
        if (!(created instanceof ContentEmbedToolsView)) {
            throw new Error("Expected the tools view.");
        }
        created.render();
        view = created;
        return created;
    }

    function selectEmbed() {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("The editor has no root.");
            }
            const embed = writer.createElement("contentEmbed", { noteId: "n1", boxSize: "medium" });
            writer.insert(embed, root, 0);
            writer.setSelection(embed, "on");
        });
        editor.ui.update();
    }

    function getButtonStates(tools: ContentEmbedToolsView) {
        return tools.buttons.map((button) => [
            button.label, button.withText, button.icon, button.tooltip, button.ariaLabel,
            button.isToggleable, button.isOn, button.isEnabled
        ]);
    }

    /** The labels of the buttons, and `|` for each separator, in order. */
    function getItems(tools: ContentEmbedToolsView) {
        return [ ...tools.element?.children ?? [] ].map((item) =>
            item.classList.contains("ck-toolbar__separator") ? "|" : item.textContent);
    }

    it("shows the tools of the selected embed's content, and hides them elsewhere", () => {
        const tools = createView();
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        editor.ui.update();
        expect(getContentEmbedTools).not.toHaveBeenCalled();
        expect(tools.element?.classList.contains("ck-hidden")).toBe(true);

        selectEmbed();
        editor.ui.update();
        const embed = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        expect(getContentEmbedTools).toHaveBeenLastCalledWith(embed);
        expect(provider.subscribe).toHaveBeenCalledTimes(1);
        expect(tools.element?.classList.contains("ck-hidden")).toBe(false);
        expect(getButtonStates(tools)).toEqual([
            [ "1", true, undefined, "Selection", "Selection", true, true, true ],
            [ "2", true, undefined, "Rectangle", "Rectangle", true, false, true ]
        ]);

        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        editor.ui.update();
        expect(provider.unsubscribe).toHaveBeenCalledTimes(1);
        expect(tools.isVisible).toBe(false);
    });

    it("shows a command with an icon, and separates the groups of tools", () => {
        const tools = createView();
        selectEmbed();

        provider.change([ SELECTION, RECTANGLE, UNDO ]);
        expect(getButtonStates(tools)[2])
            .toEqual([ "Undo", false, ICON, "Undo", "Undo", false, false, false ]);
        expect(getItems(tools)).toEqual([ "1", "2", "|", "Undo" ]);

        provider.change([ SELECTION, RECTANGLE, { ...UNDO, isEnabled: true } ]);
        expect(tools.buttons[2]?.isEnabled).toBe(true);
    });

    it("shows no tools for content without any, or for a host that offers none", () => {
        const tools = createView();
        getContentEmbedTools.mockReturnValue(null);
        selectEmbed();
        expect(tools.isVisible).toBe(false);

        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        selectEmbed();
        expect(tools.isVisible).toBe(false);

        installGlobMock({ getComponentByEl: () => undefined });
        editor.ui.update();
        expect(tools.isVisible).toBe(false);
    });

    it("runs a tool without taking the focus", () => {
        const tools = createView();
        selectEmbed();
        const rectangle = tools.buttons[1];
        const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        rectangle?.element?.dispatchEvent(mousedown);
        rectangle?.fire("execute");

        expect(mousedown.defaultPrevented).toBe(true);
        expect(provider.execute).toHaveBeenCalledWith("rectangle");
    });

    it("updates the buttons in place, and places the toolbar again for a new set", () => {
        const tools = createView();
        selectEmbed();
        const update = vi.spyOn(editor.ui, "update");
        const first = tools.buttons[0];

        provider.change([ { ...SELECTION, isOn: false }, { ...RECTANGLE, isOn: true } ]);
        expect(tools.buttons.map((button) => button.isOn)).toEqual([ false, true ]);
        expect(tools.buttons[0]).toBe(first);
        expect(update).not.toHaveBeenCalled();

        provider.change([ RECTANGLE ]);
        expect(getButtonStates(tools))
            .toEqual([ [ "2", true, undefined, "Rectangle", "Rectangle", true, false, true ] ]);
        expect(update).toHaveBeenCalledTimes(1);

        provider.change([]);
        expect(tools.isVisible).toBe(false);
    });

    it("focuses its first button, and stops following the provider once destroyed", () => {
        const tools = createView();
        selectEmbed();
        if (tools.element) {
            document.body.append(tools.element);
        }

        tools.focus();
        expect(document.activeElement).toBe(tools.buttons[0]?.element);

        tools.destroy();
        expect(provider.unsubscribe).toHaveBeenCalledTimes(1);
    });
});

/** A provider whose tools the spec changes. */
function createProvider(initialTools: Tool[]) {
    let tools = initialTools;
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();

    return {
        unsubscribe,
        getTools: () => tools,
        execute: vi.fn(),
        subscribe: vi.fn((callback: () => void) => {
            listener = callback;
            return unsubscribe;
        }),
        change(next: Tool[]) {
            tools = next;
            listener?.();
        }
    };
}
