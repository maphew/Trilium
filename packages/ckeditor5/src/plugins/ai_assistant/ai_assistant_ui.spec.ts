import { _setModelData as setModelData, ButtonView, ClassicEditor, Dialog, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumAiAssistant from "./ai_assistant.js";
import type { AiCompletionRequest, AiQuickActionGroup, AiStreamCallback, AiStreamFunction } from "./ai_assistant_config.js";
import AiAssistantUI from "./ai_assistant_ui.js";

// ---- Typed views of the dropdown internals ----

interface ListButtonView {
    label?: string;
    isEnabled: boolean;
    fire(event: string): void;
}

interface ListItemView {
    children: { get(idx: number): ListButtonView };
}

interface ListGroupView {
    label: string;
    items: { get(idx: number): ListItemView };
}

interface QuickActionsDropdown {
    isOpen: boolean;
    isEnabled: boolean;
    class?: string;
    buttonView: SplitButtonView;
    panelView: { children: { get(idx: number): { items: { get(idx: number): ListGroupView } } } };
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

/** Opens the dropdown — `addListToDropdown` only populates the panel on the first open. */
function quickActionGroups(dropdown: QuickActionsDropdown): Array<{ label: string; buttons: ListButtonView[] }> {
    dropdown.isOpen = true;

    const list = dropdown.panelView.children.get(0);
    return QUICK_ACTIONS.map((configured, groupIdx) => {
        const group = list.items.get(groupIdx);
        const buttons = configured.actions.map((_action, itemIdx) => group.items.get(itemIdx).children.get(0));
        return { label: group.label, buttons };
    });
}

/** The action buttons of every group, flattened into definition order. */
function quickActionButtons(dropdown: QuickActionsDropdown): ListButtonView[] {
    return quickActionGroups(dropdown).flatMap((group) => group.buttons);
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

        it("lists every configured action under its group", () => {
            const groups = quickActionGroups(dropdown);

            expect(groups.map((group) => ({
                label: group.label,
                actions: group.buttons.map((button) => button.label)
            }))).toEqual([
                { label: "Edit or review", actions: ["Fix typos", "Make shorter"] },
                { label: "Generate", actions: ["Write something"] }
            ]);
        });

        it("gates the content-requiring actions on there being something to work on", () => {
            const [fixTypos, , write] = quickActionButtons(dropdown);

            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(fixTypos.isEnabled).toBe(false);
            expect(write.isEnabled).toBe(true);

            // A collapsed caret is enough as long as its block has content: that is what the run
            // falls back to.
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            expect(fixTypos.isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            expect(fixTypos.isEnabled).toBe(true);
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
