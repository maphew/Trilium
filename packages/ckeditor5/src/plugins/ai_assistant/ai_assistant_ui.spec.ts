import { _setModelData as setModelData, ButtonView, ClassicEditor, Dialog, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumAiAssistant from "./ai_assistant.js";
import type { AiCompletionRequest, AiDiffFunction, AiQuickActionGroup, AiStreamCallback, AiStreamFunction } from "./ai_assistant_config.js";
import AiAssistantUI from "./ai_assistant_ui.js";

// ---- Typed views of the dropdown internals ----

/** A leaf entry: an action the user can pick. */
interface MenuButtonView {
    id: string;
    label?: string;
    isEnabled: boolean;
    element?: HTMLElement | null;
    fire(event: string): void;
}

/** A submenu entry: a group that opens rather than listing its actions inline. */
interface NestedMenuView {
    id: string;
    isEnabled: boolean;
    buttonView: { label?: string; element?: HTMLElement | null };
    listView: { items: Array<{ childView: MenuButtonView }> };
}

interface QuickActionsDropdown {
    isOpen: boolean;
    isEnabled: boolean;
    class?: string;
    buttonView: SplitButtonView;
    menuView: {
        /** A separator is a plain view: no `childView`, which is how the walker tells it apart. */
        items: Array<{ childView?: MenuButtonView | NestedMenuView }>;
        buttons: MenuButtonView[];
        menus: NestedMenuView[];
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
        iconClass: "bx bx-palette",
        actions: [
            { id: "direct", label: "Direct", commandLabel: "Make it direct", prompt: "Make it direct.", iconClass: "bx bx-target-lock" },
            { id: "friendly", label: "Friendly", prompt: "Make it friendly." }
        ]
    },
    {
        id: "translate",
        label: "Translate",
        submenu: true,
        iconClass: "bx bx-globe",
        actions: [
            { id: "romanian", label: "Romanian", commandLabel: "Translate to Romanian", prompt: "Translate it." }
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
    return openMenu(dropdown).items.map(({ childView }) => {
        if (!childView) {
            return "---";
        }
        return "listView" in childView
            ? {
                menu: childView.buttonView.label ?? "",
                actions: childView.listView.items.map((item) => item.childView.label ?? "")
            }
            : childView.label ?? "";
    });
}

/** Every action button, submenus included, in definition order. */
function quickActionButtons(dropdown: QuickActionsDropdown): MenuButtonView[] {
    return openMenu(dropdown).buttons;
}

/** What the dialog's header currently reads. */
function dialogTitle(editor: ClassicEditor) {
    return editor.plugins.get(Dialog).view?.headerView?.label;
}

/** The form the assistant put into the dialog, once it is open. */
function openForm(editor: ClassicEditor) {
    return editor.plugins.get(Dialog).view?.contentView?.children.get(0) as unknown as {
        query: string;
        phase: string;
        viewMode: string;
        hasDiff: boolean;
        isUnchanged: boolean;
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
                "---",
                "Write something",
                "---",
                { menu: "Change tone", actions: ["Direct", "Friendly"] },
                { menu: "Translate", actions: ["Romanian"] }
            ]);
        });

        // A rule between blocks, and none between two openers: without the headings the menu
        // definition cannot carry, the separator is what marks where a set of actions ends.
        it("rules off each block but not between adjacent submenus", () => {
            const entries = menuEntries(dropdown);
            expect(entries.filter((entry) => entry === "---")).toHaveLength(2);
            expect(entries.at(-1)).toEqual({ menu: "Translate", actions: ["Romanian"] });
        });

        // The menu definition has no icon field, so the glyphs are hung on the views CKEditor
        // built — on an item inside a submenu as much as on an inlined one.
        it("renders an icon-pack glyph for the actions and submenus that have one", () => {
            const direct = quickActionButtons(dropdown).find((button) => button.id === "direct");
            expect(direct?.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-target-lock");

            const [tone] = openMenu(dropdown).items
                .map(({ childView }) => childView)
                .filter((childView): childView is NestedMenuView => !!childView && "listView" in childView);
            expect(tone.buttonView.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-palette");
        });

        it("leaves an action without an icon alone", () => {
            const friendly = quickActionButtons(dropdown).find((button) => button.id === "friendly");
            expect(friendly?.element?.querySelector(".ck-ai-action-icon")).toBeNull();
        });

        it("gates a submenu on the content its actions need", () => {
            const [tone] = openMenu(dropdown).menus;

            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(tone.isEnabled).toBe(false);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            expect(tone.isEnabled).toBe(true);
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

        it("leaves a submenu alone when one of its actions runs without content", async () => {
            const editorWithFreeAction = await createEditor([{
                id: "generate",
                label: "Generate",
                submenu: true,
                actions: [
                    { id: "write", label: "Write something", prompt: "Write.", requiresContent: false },
                    { id: "rewrite", label: "Rewrite", prompt: "Rewrite." }
                ]
            }], createStreamStub().stream);
            const [generate] = openMenu(createComponent(editorWithFreeAction)).menus;

            setModelData(editorWithFreeAction.model, "<paragraph>[]</paragraph>");
            expect(generate.isEnabled).toBe(true);
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

        it("titles the dialog with the action it is running, as the palette names it", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const [fixTypos, , , direct] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));
            expect(dialogTitle(editor)).toBe("Fix typos");

            // A submenu's label can be a fragment ("Direct"), so an action may carry a standalone
            // phrasing for the places that show it away from its group.
            direct.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(2));
            expect(dialogTitle(editor)).toBe("Make it direct");

            // A typed follow-up is no longer that action.
            const form = openForm(editor);
            form.query = "now make it shorter";
            form.fire("submit");
            await vi.waitFor(() => expect(requests).toHaveLength(3));
            expect(dialogTitle(editor)).toBe("AI assistant");
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

    describe("the view a finished review opens on", () => {
        const REVIEW_ACTIONS: AiQuickActionGroup[] = [
            {
                id: "edit",
                label: "Edit or review",
                actions: [
                    { id: "fixTypos", label: "Fix typos", prompt: "Fix all mistakes." },
                    // A replacement by definition, whatever the diff makes of it.
                    { id: "translate", label: "Translate", prompt: "Translate it.", reviewView: "result" }
                ]
            }
        ];

        /** Runs one quick action against a selection and hands back the form in its review. */
        async function review(diff: AiDiffFunction, actionId: string) {
            const stub = createStreamStub();
            const editor = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: REVIEW_ACTIONS, stream: stub.stream, diff }
            });
            const dropdown = createComponent(editor);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(dropdown).find((button) => button.id === actionId)?.fire("execute");
            await vi.waitFor(() => expect(stub.requests).toHaveLength(1));

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            return form;
        }

        it("is the changes by default, and the result for an action that asks for it", async () => {
            const diff = () => "<ins>done</ins>";

            expect((await review(diff, "fixTypos")).viewMode).toBe("changes");
            expect((await review(diff, "translate")).viewMode).toBe("result");
        });

        it("withholds the diff of a response the differ reports as unchanged", async () => {
            const form = await review(() => ({ html: "<p>done</p>", isUnchanged: true }), "fixTypos");

            // The form says so in words; a diff with no marks in it reads as a diff that failed.
            expect(form.isUnchanged).toBe(true);
            expect(form.hasDiff).toBe(false);
            expect(form.viewMode).toBe("result");
        });

        it("is the result when the diff reports the response as mostly a rewrite", async () => {
            // The same call the differ makes for a response it could not align with its source.
            const form = await review(() => ({ html: "<ins>done</ins>", rewriteRatio: 1 }), "fixTypos");

            expect(form.viewMode).toBe("result");
            // Still offered, only not opened on.
            expect(form.hasDiff).toBe(true);
        });
    });

    it("is disabled when no LLM provider is configured", async () => {
        const editor = await createEditor(QUICK_ACTIONS);
        expect(createComponent(editor).isEnabled).toBe(false);
    });
});
