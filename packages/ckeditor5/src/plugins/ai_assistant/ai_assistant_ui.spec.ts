import { _getModelData as getModelData, _setModelData as setModelData, ButtonView, ClassicEditor, Dialog, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
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
    /** A separator is a plain view: no `childView`, the same as at the top level. */
    listView: { items: Array<{ childView?: MenuButtonView }> };
}

interface QuickActionsDropdown {
    isOpen: boolean;
    isEnabled: boolean;
    class?: string;
    buttonView: SplitButtonView;
    /** Holds the menu once it is open; a redraw has to leave exactly one behind. */
    panelView: { children: { length: number } };
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
                actions: childView.listView.items.map((item) => item.childView?.label ?? "---")
            }
            : childView.label ?? "";
    });
}

/**
 * Every action button, submenus included, in definition order — without the row that heads the
 * menu, which opens the assistant rather than running anything.
 */
function quickActionButtons(dropdown: QuickActionsDropdown): MenuButtonView[] {
    return openMenu(dropdown).buttons.filter((button) => button.id !== "__ask");
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
        previewView: { element?: HTMLElement | null };
        fire(event: string): void;
    };
}

/** What the preview currently holds, for the specs that assert on rendered content. */
function previewHtml(editor: ClassicEditor): string {
    return openForm(editor).previewView.element?.innerHTML ?? "";
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
                // The way in the button half offers, for the menu — a prompt rather than an
                // instruction, so it heads the menu behind a rule of its own.
                "Ask AI…",
                "---",
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
        it("heads the menu with the way in the button half offers", () => {
            const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");
            const [ask] = openMenu(dropdown).buttons;

            expect(ask.id).toBe("__ask");
            expect(ask.label).toBe("Ask AI…");

            // A prompt is typed against whatever is there, so unlike an instruction about content
            // this row does not go inert when there is none.
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(ask.isEnabled).toBe(true);

            ask.fire("execute");
            expect(showSpy).toHaveBeenCalled();
        });

        it("rules off each block but not between adjacent submenus", () => {
            const entries = menuEntries(dropdown);
            // One under the prompt row, then one per group boundary that is not between submenus.
            expect(entries.filter((entry) => entry === "---")).toHaveLength(3);
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

        // A group whose contents the host lets the user choose ends with the row that chooses them,
        // which is not an action: no prompt, nothing to work on, and nothing for the model to do.
        it("closes a group's submenu with its footer, below a rule and reachable without content", async () => {
            const run = vi.fn();
            const stub = createStreamStub();
            const editorWithFooter = await createEditor([{
                id: "translate",
                label: "Translate",
                submenu: true,
                actions: [{ id: "german", label: "German", prompt: "Translate to German." }],
                footer: { label: "Configure languages…", iconClass: "bx bx-cog", run }
            }], stub.stream);
            const dropdownWithFooter = createComponent(editorWithFooter);
            const [translate] = openMenu(dropdownWithFooter).menus;

            expect(translate.listView.items.map((item) => item.childView?.label ?? "---"))
                .toEqual(["German", "---", "Configure languages…"]);

            // Its one action needs content; the footer does not, so neither the row nor the submenu
            // holding it closes off with nothing selected.
            setModelData(editorWithFooter.model, "<paragraph>[]</paragraph>");
            expect(translate.isEnabled).toBe(true);

            const configure = quickActionButtons(dropdownWithFooter)
                .find((button) => button.id === "translate:footer");
            expect(configure?.isEnabled).toBe(true);
            expect(configure?.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-cog");

            configure?.fire("execute");
            expect(run).toHaveBeenCalled();
            // It runs host code instead of the assistant: no request, and no dialog.
            expect(stub.requests).toHaveLength(0);
            expect(editorWithFooter.plugins.get(Dialog).id).toBeNull();
        });

        // The Translate group lists the enabled content languages, which the footer above lets the
        // user change from inside the editor — so the menu has to be able to say something new
        // without the editor being torn down and rebuilt, which would cost the caret and the undo
        // history of the note being written.
        it("redraws the menu when the quick actions are replaced on a live editor", async () => {
            expect(menuEntries(dropdown)).toContainEqual({ menu: "Translate", actions: ["Romanian"] });

            editor.plugins.get(AiAssistantUI).updateQuickActions([{
                id: "translate",
                label: "Translate",
                submenu: true,
                actions: [
                    { id: "german", label: "German", prompt: "Translate to German." },
                    { id: "japanese", label: "Japanese", prompt: "Translate to Japanese." }
                ]
            }]);

            // Redrawn on the way open, so it is still the old menu until the dropdown is reopened.
            dropdown.isOpen = false;
            dropdown.isOpen = true;
            expect(menuEntries(dropdown)).toEqual([
                "Ask AI…",
                "---",
                { menu: "Translate", actions: ["German", "Japanese"] }
            ]);

            // The menu the redraw replaced is gone rather than left beside its successor.
            expect(dropdown.panelView.children.length).toBe(1);

            // A button from the new draw still reaches the assistant, so the execute lookup was
            // refilled along with the views.
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(dropdown).find((button) => button.id === "japanese")?.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));
            expect(requests[0]).toEqual({ query: "Translate to Japanese.", context: "foo" });
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

        it("hands the pinned range back as the selection when dismissed", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            editor.execute("aiAssistant");

            // The marker, not the selection, is what shows the target while the dialog stands.
            expect(editor.model.markers.has("triliumAiTarget")).toBe(true);

            // Whatever becomes of the selection meanwhile — the editable is blurred for the
            // dialog's whole life, so nothing is holding it in place.
            const start = editor.model.document.selection.getFirstPosition();
            if (start) {
                editor.model.change((writer) => writer.setSelection(start));
            }
            expect(getModelData(editor.model)).toBe("<paragraph>[]foo</paragraph>");

            editor.plugins.get(Dialog).hide();

            expect(editor.model.markers.has("triliumAiTarget")).toBe(false);
            expect(getModelData(editor.model)).toBe("<paragraph>[foo]</paragraph>");
        });

        it("leaves the selection to the insertion when the response is committed", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const [fixTypos] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            openForm(editor).fire("replace");

            // A commit places the selection itself; the pinned range it wrote over must not be
            // restored over the top of that, which would leave the insertion selected.
            expect(editor.model.markers.has("triliumAiTarget")).toBe(false);
            expect(getModelData(editor.model)).toBe("<paragraph>[]done</paragraph>");
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

    // A diagram is a `language-mermaid` code block until the content is upcast into the model,
    // which the assistant only does on commit — so the preview has to render it itself, or the
    // Diagram quick action reviews its own source and the diagram only appears once accepted.
    describe("Mermaid diagrams in the preview", () => {
        const DIAGRAM = "graph TD; A-->B;";
        const DIAGRAM_HTML = `<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>`;

        const DIAGRAM_ACTION: AiQuickActionGroup[] = [{
            id: "reformat",
            label: "Reformat",
            actions: [{ id: "diagram", label: "Diagram", prompt: "Draw it.", reviewView: "result" }]
        }];

        /** Stands in for the mermaid library the host lazy-loads, one SVG per source. */
        function createMermaidStub() {
            return {
                initialize: vi.fn(),
                render: vi.fn(async (id: string, source: string) => ({ svg: `<svg data-source="${source}"></svg>` }))
            };
        }

        async function createDiagramEditor(mermaid: ReturnType<typeof createMermaidStub>, stream: AiStreamFunction) {
            return createTestEditor([Essentials, Paragraph, CodeBlockEditing, MermaidEditing, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: DIAGRAM_ACTION, stream },
                mermaid: { lazyLoad: () => mermaid, config: {} }
            });
        }

        it("renders the diagram a finished response holds, in place of its code block", async () => {
            const mermaid = createMermaidStub();
            const stub = createStreamStub(DIAGRAM_HTML);
            const editor = await createDiagramEditor(mermaid, stub.stream);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            await vi.waitFor(() => expect(previewHtml(editor)).toContain("<svg"));
            expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
            // The `<pre>` goes with the `<code>`: what is left is the diagram, not a framed one.
            expect(previewHtml(editor)).toContain(`<div class="ck-ai-assistant-form__diagram"><svg data-source="${DIAGRAM}">`);
            expect(previewHtml(editor)).not.toContain("<pre>");

            // Nothing was done to the response itself — the note gets the code block, which the
            // editor upcasts into a diagram widget of its own.
            openForm(editor).fire("replace");
            expect(editor.getData()).toContain(`<code class="language-mermaid">`);
        });

        it("leaves a half-streamed diagram as its source", async () => {
            const mermaid = createMermaidStub();
            const editor = await createDiagramEditor(mermaid, async (request, onData) => {
                onData(`<pre><code class="language-mermaid">graph TD; A--</code></pre>`);
                await new Promise(() => {});
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            // Parsing a fragment would put a parse error where the diagram is about to be, once
            // per streamed chunk. The source stands until the response is complete.
            await vi.waitFor(() => expect(previewHtml(editor)).toContain("language-mermaid"));
            expect(mermaid.render).not.toHaveBeenCalled();
        });

        it("leaves the code block alone in the diff, whose text is two responses at once", async () => {
            const mermaid = createMermaidStub();
            const stub = createStreamStub(DIAGRAM_HTML);
            const editor = await createTestEditor([Essentials, Paragraph, CodeBlockEditing, MermaidEditing, TriliumAiAssistant], {
                aiAssistant: {
                    sanitizeHtml,
                    quickActions: DIAGRAM_ACTION,
                    stream: stub.stream,
                    // Opens on the diff, since the action asking for the result is not the one run.
                    diff: () => `<pre><code class="language-mermaid">graph <del>LR</del><ins>TD</ins></code></pre>`
                }
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            editor.execute("aiAssistant");
            const form = openForm(editor);
            form.query = "Draw it.";
            form.fire("submit");

            await vi.waitFor(() => expect(form.viewMode).toBe("changes"));
            expect(mermaid.render).not.toHaveBeenCalled();
            expect(previewHtml(editor)).toContain("<del>LR</del>");

            // The toggle back to the result is a render of its own, so the diagram lands there.
            form.viewMode = "result";
            await vi.waitFor(() => expect(previewHtml(editor)).toContain("<svg"));
        });
    });

    it("is disabled when no LLM provider is configured", async () => {
        const editor = await createEditor(QUICK_ACTIONS);
        expect(createComponent(editor).isEnabled).toBe(false);
    });
});
