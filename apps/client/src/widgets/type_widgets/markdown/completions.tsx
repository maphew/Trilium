import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import { hostedCompletion, type HostedCompletionApply, type HostedCompletionState } from "@triliumnext/codemirror/src/extensions/hosted_completion";
import { isAnchorState, NOTE_TYPE_ICONS, type TaskStateDef } from "@triliumnext/commons";
import { useEffect, useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import mime_types from "../../../services/mime_types";
import { getTaskStateDefinitions } from "../../../services/task_states";
import { type CommandEntry, CommandMentionList, createHostedList, filterCommandEntries } from "../../react/NoteAutocomplete";
import { type CodeSnippet, SLASH_COMMAND_REGEX, useCodeSnippets } from "../code/snippets";
import SAMPLE_DIAGRAMS from "../mermaid/sample_diagrams";
import type { TypeWidgetProps } from "../type_widget";
import { uploadImageAndInsert } from "./editor_utils";

/** A `/` command of the Markdown editor, listed as the text editor lists its own. */
export interface SlashCommand extends CommandEntry {
    /** Runs the command on the typed `/command`, which starts at `from` and ends at the caret, `to`. */
    apply: HostedCompletionApply;
}

/** The `/command` typed before the caret, which the list filters its commands by. */
export interface SlashCommandMatch {
    from: number;
    query: string;
}

/** What the commands are built from, read again each time the list looks them up. */
export interface SlashCommandContext {
    parentComponent: TypeWidgetProps["parentComponent"];
    note: FNote;
    editorView: VanillaCodeMirror;
    /** The user's task states, one `/todo:<state>` each where it has a Markdown marker. */
    taskStates: TaskStateDef[];
    snippets: CodeSnippet[];
}

/**
 * Lists the `/` commands typed at the start of a line or after whitespace in the shared command
 * list, as the text editor does, through `hostedCompletion()`. The code-fence languages stay with
 * CodeMirror's own completion.
 */
export function useSlashCommands(parentComponent: TypeWidgetProps["parentComponent"], editorView: VanillaCodeMirror | null, note: FNote) {
    // Held in refs so the commands read the current note and parent component without registering
    // the extension again.
    const noteRef = useRef(note);
    const parentRef = useRef(parentComponent);
    // The user-configured todo task states (from the `_taskStates` subtree), loaded once.
    const taskStatesRef = useRef<TaskStateDef[]>([]);
    // Markdown snippets (#snippet code notes with a markdown MIME) plus generic plain-text snippets,
    // inserted via `/snippet:<name>`. useCodeSnippets keeps the ref fresh so the list reads the latest.
    const snippetsRef = useCodeSnippets(
        (candidate) => candidate.isMarkdown() || (candidate.type === "code" && candidate.mime === "text/plain"),
        "markdown"
    );
    useEffect(() => { noteRef.current = note; }, [note]);
    useEffect(() => { parentRef.current = parentComponent; }, [parentComponent]);
    useEffect(() => { void getTaskStateDefinitions().then((states) => { taskStatesRef.current = states; }); }, []);

    useEffect(() => {
        if (!editorView) return;

        const commands = () => buildSlashCommands({
            parentComponent: parentRef.current,
            note: noteRef.current,
            editorView,
            taskStates: taskStatesRef.current,
            snippets: snippetsRef.current.filter((snippet) => snippet.noteId !== noteRef.current.noteId)
        });
        // Bridges the codemirror package's own @codemirror/state identity, as for the sources below.
        type CmSlashCommandMatcher = Parameters<typeof hostedCompletion<SlashCommandMatch>>[0]["match"];
        editorView.setNamedExtension("slashCommands", hostedCompletion({
            match: slashCommandAt as unknown as CmSlashCommandMatcher,
            list: () => createSlashCommandList(commands)
        }));
        // CodeMirror allows one `override` config per editor, so sources go through
        // `setCompletionSource` instead of each adding its own `autocompletion()`.
        // Bridges the codemirror package's own @codemirror/autocomplete identity, as code/snippets.ts does.
        type CmCompletionSource = Parameters<VanillaCodeMirror["setCompletionSource"]>[1];
        editorView.setCompletionSource("markdownCodeFence", codeFenceCompletionSource as unknown as CmCompletionSource);

        return () => {
            editorView.setNamedExtension("slashCommands", []);
            editorView.setCompletionSource("markdownCodeFence", null);
        };
    }, [editorView]);
}

/**
 * The `/command` typed before the caret, at the start of a line or after whitespace, or `null` in a
 * code block or a code span, where a `/` is part of the code.
 */
export function slashCommandAt(before: string, _explicit: boolean, state: EditorState): SlashCommandMatch | null {
    const typed = new RegExp(`${SLASH_COMMAND_REGEX.source}$`).exec(before);
    if (!typed) return null;

    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(state.selection.main.head, -1); node; node = node.parent) {
        if (node.name.includes("Code")) return null;
    }

    return { from: typed.index, query: typed[0] };
}

/** The commands the `/` list offers, in groups: the inserts, the diagrams, the blocks, the callouts, the tasks and the snippets. */
export function buildSlashCommands({ parentComponent, note, editorView, taskStates, snippets }: SlashCommandContext): SlashCommand[] {
    /** Removes the typed command, then runs one of the text editor's commands in its place. */
    const runCommand = (name: Parameters<NonNullable<typeof parentComponent>["triggerCommand"]>[0]): HostedCompletionApply =>
        (view, from, to) => {
            view.dispatch({ changes: { from, to } });
            parentComponent?.triggerCommand(name);
        };

    return [
        command("/date", t("markdown_slash_commands.date"), "bx bx-calendar", runCommand("insertDateTimeToText")),
        command("/include", t("markdown_slash_commands.include"), "bx bx-file", runCommand("addIncludeNoteToText")),
        command("/image", t("markdown_slash_commands.image"), "bx bx-image", (view, from, to) => {
            view.dispatch({ changes: { from, to } });
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.addEventListener("change", () => {
                const file = input.files?.[0];
                if (file) uploadImageAndInsert(editorView, note, file);
            });
            input.click();
        }),
        command("/link", t("markdown_slash_commands.link"), "bx bx-link", runCommand("addLinkToText")),
        command("/math", t("markdown_slash_commands.math"), "bx bx-math", (view, from, to) => {
            const placeholder = `\\text{${t("markdown_slash_commands.placeholders.math")}}`;
            const template = `$$\n${placeholder}\n$$`;
            view.dispatch({
                changes: { from, to, insert: template },
                selection: { anchor: from + 3, head: from + 3 + placeholder.length }
            });
        }),
        command("/footnote", t("markdown_slash_commands.footnote"), "bx bx-comment-detail", (view, from, to) => {
            let maxFootnote = 0;
            for (const m of view.state.doc.toString().matchAll(/\[\^(\d+)\]/g)) {
                maxFootnote = Math.max(maxFootnote, parseInt(m[1], 10));
            }
            const n = maxFootnote + 1;
            const ref = `[^${n}]`;
            const def = `\n\n[^${n}]: `;
            const docEnd = view.state.doc.length;
            const newDocEnd = docEnd - (to - from) + ref.length + def.length;
            view.dispatch({
                changes: [
                    { from, to, insert: ref },
                    { from: docEnd, insert: def }
                ],
                selection: { anchor: newDocEnd }
            });
        }),
        command("/mermaid", t("markdown_slash_commands.mermaid"), NOTE_TYPE_ICONS.mermaid, (view, from, to) => {
            const placeholder = "graph TD\n    A --> B";
            const template = `\`\`\`mermaid\n${placeholder}\n\`\`\``;
            view.dispatch({
                changes: { from, to, insert: template },
                selection: { anchor: from + 11, head: from + 11 + placeholder.length }
            });
        }),
        // One `/mermaid:<type>` per sample diagram (e.g. `/mermaid:flowchart`), pre-filling the
        // fenced block with that template's source.
        ...grouped(SAMPLE_DIAGRAMS.map((sample) => command(
            `/mermaid:${sample.name.toLowerCase().replace(/\s+/g, "-")}`,
            t("markdown_slash_commands.mermaid_template", { name: sample.name }),
            NOTE_TYPE_ICONS.mermaid,
            (view, from, to) => {
                const template = `\`\`\`mermaid\n${sample.content.trimEnd()}\n\`\`\``;
                view.dispatch({
                    changes: { from, to, insert: template },
                    selection: { anchor: from + 11 }
                });
            }
        ))),
        ...grouped([
            command("/collapsible", t("markdown_slash_commands.collapsible"), "bx bx-collapse-vertical", (view, from, to) => {
                // No native markdown syntax — round-trips through the importer as raw
                // <details>/<summary> HTML (see markdown.ts).
                const placeholder = t("markdown_slash_commands.placeholders.collapsible_summary");
                const open = `<details class="trilium-collapsible">\n<summary>`;
                const close = `</summary>\n\n${t("markdown_slash_commands.placeholders.collapsible_details")}\n\n</details>`;
                const anchor = from + open.length;
                view.dispatch({
                    changes: { from, to, insert: open + placeholder + close },
                    selection: { anchor, head: anchor + placeholder.length }
                });
            }),
            command("/page-break", t("markdown_slash_commands.page_break"), "bx bx-cut", (view, from, to) => {
                // No native markdown syntax — round-trips through the importer as raw HTML and
                // drives the print/PDF page break (see print.css). The trailing blank line ends the
                // raw-HTML block; without it the text on the next line is swallowed into the <div>.
                const insert = `<div class="page-break"></div>\n\n`;
                view.dispatch({
                    changes: { from, to, insert },
                    selection: { anchor: from + insert.length }
                });
            }),
            command("/table", t("markdown_slash_commands.table"), "bx bx-table", (view, from, to) => {
                // GFM table skeleton. The trailing blank line ends the table block so following text
                // isn't absorbed into it.
                const header = t("markdown_slash_commands.placeholders.table_column", { number: 1 });
                const table = [
                    `| ${header} | ${t("markdown_slash_commands.placeholders.table_column", { number: 2 })} |`,
                    `| -------- | -------- |`,
                    `|          |          |`
                ].join("\n");
                // Selects the first header cell, past the leading "| ", for the first column's name.
                const anchor = from + 2;
                view.dispatch({
                    changes: { from, to, insert: `${table}\n\n` },
                    selection: { anchor, head: anchor + header.length }
                });
            })
        ]),
        ...grouped(Object.entries(ADMONITION_ICONS).map(([ admonitionType, icon ]) => command(
            `/${admonitionType}`,
            t("markdown_slash_commands.admonition", { type: admonitionType }),
            icon,
            (view, from, to) => {
                const template = `> [!${admonitionType.toUpperCase()}]\n> `;
                view.dispatch({
                    changes: { from, to, insert: template },
                    selection: { anchor: from + template.length }
                });
            }
        ))),
        // One `/todo:<state>` per configured task state that has a markdown marker — the ` `
        // (unchecked) and `x` (checked) anchors are markers too, so both are covered.
        ...grouped(taskStates
            .filter((state) => state.markdownSymbol)
            .map((state) => {
                // Anchors (`none`/`done`) are the standard `[ ]`/`[x]`; custom states use
                // non-standard markers (e.g. `[/]`), so the description flags those.
                const detailKey = isAnchorState(state.name)
                    ? "markdown_slash_commands.todo"
                    : "markdown_slash_commands.todo_nonstandard";
                return command(`/todo:${state.name}`, t(detailKey, { title: state.title }), state.icon, (view, from, to) => {
                    const precededByBullet = from >= 2 && view.state.doc.sliceString(from - 2, from) === "- ";
                    const insert = buildTaskItemInsert(state.markdownSymbol, precededByBullet);
                    view.dispatch({ changes: { from, to, insert } });
                });
            })),
        ...grouped(snippets.map((snippet) => command(
            `/snippet:${snippet.title}`,
            snippet.description,
            "bx bx-code-curly",
            (view, from, to) => {
                view.dispatch({
                    changes: { from, to, insert: snippet.content },
                    selection: { anchor: from + snippet.content.length }
                });
            }
        )))
    ];
}

/** The callouts GitHub's Markdown knows, each with the icon of what it marks. */
const ADMONITION_ICONS: Record<string, string> = {
    note: "bx bx-info-circle",
    tip: "bx bx-bulb",
    important: "bx bx-message-square-error",
    caution: "bx bx-error-alt",
    warning: "bx bx-error"
};

function command(title: string, description: string | undefined, icon: string, apply: HostedCompletionApply): SlashCommand {
    return { id: title, title, description, icon, apply };
}

/** Sets `commands` apart from those before them with a divider. */
function grouped(commands: SlashCommand[]) {
    return commands.map((entry, index) => (index === 0 ? { ...entry, startsGroup: true } : entry));
}

/** The `/` list, which runs the command picked on the typed `/command`. */
function createSlashCommandList(commands: () => SlashCommand[]) {
    return createHostedList<HostedCompletionState<SlashCommandMatch>>((state, list) => (
        <CommandMentionList<SlashCommand>
            key={state.match.from}
            {...list}
            query={state.match.query}
            source={async (query) => filterCommandEntries(commands(), query)}
            onPick={(entry) => state.commit(entry.apply)}
        />
    ));
}

/**
 * Builds the markdown a `/todo:<state>` command inserts. Omits the leading `- `
 * bullet when the slash was typed right after an existing one (e.g. `- /todo:doing`),
 * so the existing bullet is reused instead of producing a doubled `- - [ ] ` marker.
 */
export function buildTaskItemInsert(symbol: string, precededByBullet: boolean): string {
    return `${precededByBullet ? "" : "- "}[${symbol}] `;
}

/**
 * Parses the text of a line up to the cursor to detect a fenced code block opener being typed
 * (e.g. "```", "```py", or an indented "    ```js"). Returns the offset within the line where the
 * language token starts (right after the run of backticks) and the partial language already typed,
 * or `null` when the text isn't a fence opener. Pure helper, unit-tested.
 */
export function parseCodeFencePrefix(lineBeforeCursor: string): { langStart: number; typed: string } | null {
    const match = /^(\s*)(`{3,})([A-Za-z0-9+#._-]*)$/.exec(lineBeforeCursor);
    if (!match) return null;
    return { langStart: match[1].length + match[2].length, typed: match[3] };
}

/**
 * Whether the fence on the line starting at `lineFrom` closes an already-open code block rather than
 * opening a new one. A bare ``` is both opener and closer in Markdown, so language completions are
 * only offered on openers: inside a `FencedCode` node that began on an earlier line, the ``` closes it.
 */
export function isClosingFence(state: EditorState, lineFrom: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
        if (node.name === "FencedCode") return node.from < lineFrom;
    }
    return false;
}

/** Builds the fence-language completions from the user's enabled code-note languages. */
export function buildCodeFenceOptions(): Completion[] {
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const mimeType of mime_types.getMimeTypes()) {
        const code = mimeType.mdLanguageCode;
        if (!mimeType.enabled || !code || seen.has(code)) continue;
        seen.add(code);
        options.push({ label: code, detail: mimeType.title });
    }
    return options;
}

/**
 * Completion source for code-fence languages: triggers only right after a ``` fence opener and lists
 * the user's enabled languages. Returns `null` everywhere else, so it never pollutes the slash menu.
 */
export function codeFenceCompletionSource(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const parsed = parseCodeFencePrefix(line.text.slice(0, context.pos - line.from));
    if (!parsed || isClosingFence(context.state, line.from)) return null;

    const options = buildCodeFenceOptions();
    return options.length ? { from: line.from + parsed.langStart, options } : null;
}
