import type { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import VanillaCodeMirror from "@triliumnext/codemirror";
import type { MimeType, TaskStateDef } from "@triliumnext/commons";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import mime_types from "../../../services/mime_types.js";
import type { TypeWidgetProps } from "../type_widget";
import { buildCodeFenceOptions, buildSlashCommands, buildTaskItemInsert, codeFenceCompletionSource, isClosingFence, parseCodeFencePrefix, slashCommandAt, useSlashCommands } from "./completions";

// The hook's two asynchronous sources of menu entries, stubbed so mounting it needs no server.
vi.mock("../code/snippets", async (importOriginal) => ({
    ...await importOriginal<typeof import("../code/snippets")>(),
    useCodeSnippets: () => ({ current: [] })
}));
vi.mock("../../../services/task_states", () => ({ getTaskStateDefinitions: () => Promise.resolve([]) }));
// The catalogue is not loaded in specs, and the sample diagrams translate their names as they load.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/i18n")>(),
    t: (key: string) => key
}));

describe("buildTaskItemInsert", () => {
    it("prepends a bullet when not already in a list item", () => {
        expect(buildTaskItemInsert(" ", false)).toBe("- [ ] ");
        expect(buildTaskItemInsert("x", false)).toBe("- [x] ");
        expect(buildTaskItemInsert("/", false)).toBe("- [/] ");
    });

    it("reuses an existing '- ' bullet to avoid a doubled marker", () => {
        expect(buildTaskItemInsert(" ", true)).toBe("[ ] ");
        expect(buildTaskItemInsert("x", true)).toBe("[x] ");
        expect(buildTaskItemInsert("/", true)).toBe("[/] ");
    });
});

describe("parseCodeFencePrefix", () => {
    it("matches a bare fence opener", () => {
        expect(parseCodeFencePrefix("```")).toEqual({ langStart: 3, typed: "" });
    });

    it("captures the partial language token after the backticks", () => {
        expect(parseCodeFencePrefix("```js")).toEqual({ langStart: 3, typed: "js" });
        expect(parseCodeFencePrefix("```c++")).toEqual({ langStart: 3, typed: "c++" });
    });

    it("accounts for leading indentation in langStart", () => {
        expect(parseCodeFencePrefix("    ```py")).toEqual({ langStart: 7, typed: "py" });
    });

    it("handles fences longer than three backticks", () => {
        expect(parseCodeFencePrefix("`````")).toEqual({ langStart: 5, typed: "" });
    });

    it("rejects non-fence text", () => {
        expect(parseCodeFencePrefix("``")).toBeNull();           // too few backticks
        expect(parseCodeFencePrefix("text ```js")).toBeNull();   // not at line start
        expect(parseCodeFencePrefix("```js ")).toBeNull();       // language already finished (trailing space)
    });
});

describe("isClosingFence", () => {
    function lineStart(doc: string, lineNumber: number): number {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return state.doc.line(lineNumber).from;
    }

    function check(doc: string, lineNumber: number): boolean {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return isClosingFence(state, state.doc.line(lineNumber).from);
    }

    it("treats the first fence line of a block as an opener", () => {
        expect(check("```js\ncode\n```", 1)).toBe(false);
    });

    it("treats the terminating fence line as a closer", () => {
        expect(check("```js\ncode\n```", 3)).toBe(true);
    });

    it("treats a new fence after a closed block as an opener", () => {
        // The second block's opener must still offer completions.
        expect(check("```js\ncode\n```\n\n```py\nmore\n```", 5)).toBe(false);
    });

    it("does not flag a plain line as a closing fence", () => {
        expect(check("just a paragraph", 1)).toBe(false);
        // Referencing lineStart keeps the helper used and documents the offset math.
        expect(lineStart("```js\ncode\n```", 3)).toBe(11);
    });
});

describe("buildCodeFenceOptions", () => {
    afterEach(() => vi.restoreAllMocks());

    const mime = (over: Partial<MimeType>): MimeType => ({
        title: "T", mime: "text/x", enabled: true, mdLanguageCode: "x", ...over
    } as MimeType);

    it("emits one option per enabled language, skipping disabled, code-less and duplicate entries", () => {
        vi.spyOn(mime_types, "getMimeTypes").mockReturnValue([
            mime({ mdLanguageCode: "js", title: "JavaScript" }),
            mime({ mdLanguageCode: "py", title: "Python", enabled: false }),  // disabled → skipped
            mime({ mdLanguageCode: undefined, title: "No code" }),            // no language code → skipped
            mime({ mdLanguageCode: "js", title: "JS again" })                 // duplicate code → skipped
        ]);

        expect(buildCodeFenceOptions()).toEqual([{ label: "js", detail: "JavaScript" }]);
    });
});

describe("codeFenceCompletionSource", () => {
    afterEach(() => vi.restoreAllMocks());

    function context(doc: string, pos: number): CompletionContext {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return { state, pos } as CompletionContext;
    }

    function withLanguages(...codes: string[]) {
        vi.spyOn(mime_types, "getMimeTypes").mockReturnValue(
            codes.map((code) => ({ title: code, mime: `text/${code}`, enabled: true, mdLanguageCode: code }) as MimeType)
        );
    }

    it("offers the enabled languages right after a fence opener, anchored at the language token", () => {
        withLanguages("js", "py");
        const result = codeFenceCompletionSource(context("```", 3));
        expect(result?.from).toBe(3); // line.from (0) + langStart (3)
        expect(result?.options.map((o) => o.label)).toEqual([ "js", "py" ]);
    });

    it("returns null when the line is not a fence opener", () => {
        withLanguages("js");
        expect(codeFenceCompletionSource(context("plain text", 5))).toBeNull();
    });

    it("returns null on a closing fence, so only openers get language completions", () => {
        withLanguages("js");
        // Cursor on the terminating ``` of `\`\`\`js\ncode\n\`\`\`` — line 3 starts at offset 11.
        expect(codeFenceCompletionSource(context("```js\ncode\n```", 14))).toBeNull();
    });

    it("returns null on a valid opener when no languages are enabled", () => {
        withLanguages(); // none enabled → no options
        expect(codeFenceCompletionSource(context("```", 3))).toBeNull();
    });
});

describe("slashCommandAt", () => {
    /** What is found with the caret at `pos`, or at the end. */
    function at(doc: string, pos = doc.length) {
        const state = EditorState.create({ doc, extensions: [ markdown() ], selection: { anchor: pos } });
        ensureSyntaxTree(state, doc.length);
        const line = state.doc.lineAt(pos);
        return slashCommandAt(line.text.slice(0, pos - line.from), false, state);
    }

    it("finds a command at the start of a line or after whitespace, from its slash, by what follows it", () => {
        expect(at("/")).toEqual({ from: 0, query: "" });
        expect(at("some text /todo:in-progress")).toEqual({ from: 10, query: "todo:in-progress" });
        expect(at("first\n  /ta")).toEqual({ from: 2, query: "ta" });
    });

    it("finds none inside a word, past a space, or in code", () => {
        expect(at("and/or")).toBeNull();
        expect(at("/table ")).toBeNull();
        expect(at("```js\nconst a = 1 /")).toBeNull();
        expect(at("text `a /` b", 9)).toBeNull();
    });
});

describe("buildSlashCommands", () => {
    let editor: VanillaCodeMirror;
    const triggerCommand = vi.fn();

    beforeEach(() => {
        triggerCommand.mockReset();
        const parent = document.createElement("div");
        document.body.append(parent);
        editor = new VanillaCodeMirror({ parent });
    });

    afterEach(() => editor.destroy());

    const todo = (name: string, markdownSymbol: string): TaskStateDef => ({ name, title: name, markdownSymbol, isCompleted: false, icon: `bx bx-${name}` });

    function commands(taskStates: TaskStateDef[] = []) {
        return buildSlashCommands({
            parentComponent: { triggerCommand } as unknown as TypeWidgetProps["parentComponent"],
            note: {} as FNote,
            editorView: editor,
            taskStates,
            snippets: [ { noteId: "s1", title: "Greeting", description: "Says hello", content: "Hello!" } ]
        });
    }

    /** Puts `doc` in the editor and runs the command `id` on the command typed at its end. */
    function run(id: string, doc: string, taskStates: TaskStateDef[] = []) {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: doc }, selection: { anchor: doc.length } });
        const entry = commands(taskStates).find((candidate) => candidate.id === id);
        if (!entry) throw new Error(`no command ${id}`);
        entry.apply(editor, doc.lastIndexOf("/"), doc.length);
        return editor.state.doc.toString();
    }

    it("titles and draws each command as the text editor does, found by what is typed after the slash too", () => {
        const entries = commands([ todo("done", "x") ]);
        const byId = (id: string) => entries.find((entry) => entry.id === id);

        expect(byId("table")).toMatchObject({ title: "markdown_slash_commands.titles.table", aliases: [ "table", "grid" ] });
        expect(byId("table")?.iconSvg).toContain("<svg");
        expect(byId("tip")?.iconSvg).toContain("<svg");
        expect(byId("todo:done")).toMatchObject({ aliases: expect.arrayContaining([ "todo:done", "done" ]), icon: "bx bx-done" });
        expect(byId("snippet:Greeting")).toMatchObject({ title: "Greeting", description: "Says hello", icon: "bx bx-code-curly" });
        // One run of commands, with no dividers, as the text editor lists them.
        expect(entries.some((entry) => entry.startsGroup)).toBe(false);
    });

    it("replaces the typed command with what it inserts", () => {
        expect(run("snippet:Greeting", "Hi /snip")).toBe("Hi Hello!");
        expect(run("todo:done", "- /todo", [ todo("done", "x") ])).toBe("- [x] ");
        expect(run("todo:done", "/todo", [ todo("done", "x") ])).toBe("- [x] ");
        expect(run("tip", "/tip")).toBe("> [!TIP]\n> ");
    });

    it("numbers a footnote past the highest one, and selects what to type over", () => {
        expect(run("footnote", "a[^2] b /foot")).toBe("a[^2] b [^3]\n\n[^3]: ");
        expect(editor.state.selection.main.head).toBe(editor.state.doc.length);

        run("table", "/table");
        const { from, to } = editor.state.selection.main;
        expect(editor.state.sliceDoc(from, to)).toBe("markdown_slash_commands.placeholders.table_column");
    });

    it("removes the typed command before running one of the text editor's commands", () => {
        expect(run("date", "On /date")).toBe("On ");
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("insertDateTimeToText");
    });
});

describe("useSlashCommands", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** Mounts the hook against `editorView`. */
    function mount(editorView: VanillaCodeMirror) {
        function Probe() {
            useSlashCommands({} as TypeWidgetProps["parentComponent"], editorView, { noteId: "n1" } as FNote);
            return null;
        }

        act(() => render(h(Probe, {}), container));
    }

    it("registers the list and the fence languages with the editor, and withdraws both on unmount", () => {
        const setNamedExtension = vi.fn();
        const setCompletionSource = vi.fn();
        mount({ setNamedExtension, setCompletionSource } as unknown as VanillaCodeMirror);

        expect(setNamedExtension).toHaveBeenCalledExactlyOnceWith("slashCommands", expect.anything());
        expect(setCompletionSource).toHaveBeenCalledExactlyOnceWith("markdownCodeFence", expect.any(Function));

        act(() => render(null, container));
        expect(setNamedExtension).toHaveBeenLastCalledWith("slashCommands", []);
        expect(setCompletionSource).toHaveBeenLastCalledWith("markdownCodeFence", null);
    });

    it("lists the commands for what follows a slash, as the text editor does, and runs the one picked", async () => {
        const parent = document.createElement("div");
        document.body.append(parent);
        const editor = new VanillaCodeMirror({ parent });
        mount(editor);
        editor.focus();

        editor.dispatch({ changes: { from: 0, insert: "/tip" }, selection: { anchor: 4 } });
        const rows = () => [ ...document.querySelectorAll(".note-autocomplete-menu [role=option]") ];
        // Found by its title, without the slash.
        await vi.waitFor(() => expect(rows().map((row) => row.textContent)).toEqual([ expect.stringContaining("titles.tip") ]));
        expect(rows()[0]?.querySelector("b")?.textContent).toBe("tip");
        // Sized as the text editor's `/` list is.
        expect(document.querySelector(".note-autocomplete-menu.slash-command-menu")).not.toBeNull();

        // Opened on the best match, so Enter runs it.
        editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("> [!TIP]\n> "));
        await vi.waitFor(() => expect(rows()).toEqual([]));

        act(() => render(null, container));
        editor.destroy();
    });
});
