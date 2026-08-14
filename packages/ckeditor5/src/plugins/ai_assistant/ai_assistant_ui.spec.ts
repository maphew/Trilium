import { _setModelData as setModelData, ButtonView, ClassicEditor, Dialog, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumAiAssistant from "./ai_assistant.js";
import type { AiCompletionRequest, AiQuickActionGroup, AiStreamCallback, AiStreamFunction } from "./ai_assistant_config.js";
import AiAssistantUI from "./ai_assistant_ui.js";

// ---- Typed views of the dropdown internals ----

/** A leaf entry: an action the user can pick. */
interface MenuButtonView {
    id: string;
    label?: string;
    isEnabled: boolean;
    fire(event: string): void;
}

/** A submenu entry: a group that opens rather than listing its actions inline. */
interface NestedMenuView {
    id: string;
    buttonView: { label?: string };
    listView: { items: Array<{ childView: MenuButtonView }> };
}

interface QuickActionsDropdown {
    isOpen: boolean;
    isEnabled: boolean;
    class?: string;
    buttonView: SplitButtonView;
    menuView: {
        items: Array<{ childView: MenuButtonView | NestedMenuView }>;
        buttons: MenuButtonView[];
    };
}

const QUICK_ACTIONS: AiQuickActionGroup[] = [
    {
        id: "edit",
        label: "Edit or review",
        actions: [
            { id: "fixTypos", label: "Fix typos", prompt: "Fix all mistakes." },
            { id: "makeShorter", label: "Make shorter", prompt: "Shorten it." }
        ]
    },
    {
        id: "generate",
        label: "Generate",
        actions: [
            { id: "write", label: "Write something", prompt: "Write a paragraph.", requiresContent: false }
        ]
    },
    {
        id: "tone",
        label: "Change tone",
        submenu: true,
        actions: [
            { id: "direct", label: "Direct", prompt: "Make it direct." },
            { id: "friendly", label: "Friendly", prompt: "Make it friendly." }
        ]
    }
];

/**
 * The plugin requires a host sanitizer and refuses to render without one; the tests assert on the
 * HTML they feed in, so the double passes it through untouched.
 */
const sanitizeHtml = (html: string) => html;

/** The requests handed to the stream, in order, plus the stub itself. */
function createStreamStub(response = "<p>done</p>") {
    const requests: AiCompletionRequest[] = [];
    const stream: AiStreamFunction = async (request: AiCompletionRequest, onData: AiStreamCallback) => {
        requests.push(request);
        onData(response);
    };
    return { requests, stream };
}

async function createEditor(quickActions?: AiQuickActionGroup[], stream?: AiStreamFunction) {
    return createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
        aiAssistant: { stream, quickActions, sanitizeHtml }
    });
}

function createComponent(editor: ClassicEditor) {
    return editor.ui.componentFactory.create("aiAssistant") as unknown as QuickActionsDropdown;
}

/** Opens the dropdown — `addMenuToDropdown` only builds the menu on the first open. */
function openMenu(dropdown: QuickActionsDropdown): QuickActionsDropdown["menuView"] {
    dropdown.isOpen = true;
    return dropdown.menuView;
}

/**
 * What the menu offers at its top level: an inlined action reads as its label, a submenu as its
 * label plus the labels it holds.
 */
function menuEntries(dropdown: QuickActionsDropdown): Array<string | { menu: string; actions: string[] }> {
    return openMenu(dropdown).items.map(({ childView }) => ("listView" in childView
        ? {
            menu: childView.buttonView.label ?? "",
            actions: childView.listView.items.map((item) => item.childView.label ?? "")
        }
        : childView.label ?? ""));
}

/** Every action button, submenus included, in definition order. */
function quickActionButtons(dropdown: QuickActionsDropdown): MenuButtonView[] {
    return openMenu(dropdown).buttons;
}

/** The form the assistant put into the dialog, once it is open. */
function openForm(editor: ClassicEditor) {
    return editor.plugins.get(Dialog).view?.contentView?.children.get(0) as unknown as {
        query: string;
        fire(event: string): void;
    };
}

describe("AiAssistantUI toolbar entry", () => {
    it("is a plain button when the host configured no quick actions", async () => {
        const editor = await createEditor(undefined, createStreamStub().stream);
        const button = editor.ui.componentFactory.create("aiAssistant") as ButtonView;
        const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");

        expect(button).toBeInstanceOf(ButtonView);
        expect(button.label).toBe("AI assistant");
        expect(button.icon).toContain("<svg");
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(showSpy).toHaveBeenCalled();
    });

    describe("with quick actions configured", () => {
        let editor: ClassicEditor;
        let dropdown: QuickActionsDropdown;
        let requests: AiCompletionRequest[];

        beforeEach(async () => {
            const stub = createStreamStub();
            requests = stub.requests;
            editor = await createEditor(QUICK_ACTIONS, stub.stream);
            dropdown = createComponent(editor);
        });

        it("is a split button whose action opens the assistant", () => {
            const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");

            expect(dropdown.buttonView).toBeInstanceOf(SplitButtonView);
            expect(dropdown.buttonView.label).toBe("AI assistant");
            expect(dropdown.buttonView.icon).toContain("<svg");

            dropdown.buttonView.fire("execute");
            expect(showSpy).toHaveBeenCalled();
        });

        it("inlines an ordinary group and gives a `submenu` one its own menu", () => {
            // An inlined group loses its heading — its actions already read as commands, and the
            // menu definition has no room for a heading. A submenu keeps its label as the entry.
            expect(menuEntries(dropdown)).toEqual([
                "Fix typos",
                "Make shorter",
                "Write something",
                { menu: "Change tone", actions: ["Direct", "Friendly"] }
            ]);
        });

        it("gates the content-requiring actions on there being something to work on", () => {
            const [fixTypos, , write, direct] = quickActionButtons(dropdown);

            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(fixTypos.isEnabled).toBe(false);
            expect(write.isEnabled).toBe(true);
            // Gating reaches into the submenus too, not just the inlined actions.
            expect(direct.isEnabled).toBe(false);

            // A collapsed caret is enough as long as its block has content: that is what the run
            // falls back to.
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            expect(fixTypos.isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            expect(fixTypos.isEnabled).toBe(true);
        });

        it("runs an action picked from inside a submenu", async () => {
            // A submenu button delegates its `execute` up through its menu to the root rather than
            // firing on the dropdown itself, so this is a different path from an inlined action.
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const direct = quickActionButtons(dropdown).find((button) => button.id === "direct");

            direct?.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Make it direct.", context: "foo" });
        });

        it("falls back to the caret's block when nothing is selected", async () => {
            setModelData(editor.model, "<paragraph>first</paragraph><paragraph>seco[]nd</paragraph>");
            const [fixTypos] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Fix all mistakes.", context: "second" });
        });

        it("keeps a free-form prompt at a collapsed caret generating from scratch", async () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.execute("aiAssistant");

            const form = openForm(editor);
            form.query = "Write a haiku.";
            form.fire("submit");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Write a haiku.", context: "" });
        });

        it("runs the picked action against the selection and opens the dialog on it", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const [fixTypos] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Fix all mistakes.", context: "foo" });

            const dialog = editor.plugins.get(Dialog);
            expect(dialog.isOpen).toBe(true);
            expect(dialog.id).toBe("aiAssistant");
        });

        it("closes itself off while a run is in flight", async () => {
            let release = () => {};
            const editorWithSlowStream = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: {
                    sanitizeHtml,
                    quickActions: QUICK_ACTIONS,
                    stream: () => new Promise<void>((resolve) => {
                        release = resolve;
                    })
                }
            });
            const slowDropdown = createComponent(editorWithSlowStream);

            setModelData(editorWithSlowStream.model, "<paragraph>[foo]</paragraph>");
            expect(slowDropdown.isEnabled).toBe(true);

            const [fixTypos] = quickActionButtons(slowDropdown);
            fixTypos.fire("execute");

            await vi.waitFor(() => expect(slowDropdown.isEnabled).toBe(false));
            release();
            await vi.waitFor(() => expect(slowDropdown.isEnabled).toBe(true));
        });
    });

    it("is disabled when no LLM provider is configured", async () => {
        const editor = await createEditor(QUICK_ACTIONS);
        expect(createComponent(editor).isEnabled).toBe(false);
    });
});
