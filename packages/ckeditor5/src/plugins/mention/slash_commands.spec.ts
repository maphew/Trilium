import {
    BlockQuote,
    type ClassicEditor,
    ContextualBalloon,
    Essentials,
    _getModelData as getModelData,
    Heading,
    keyCodes,
    MentionEditing,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumSlashCommands, {
    buildDefaultSlashCommands,
    matchSlashCommands,
    type SlashCommandConfig,
    type SlashCommandDefinition
} from "./slash_commands.js";
import TriliumMentionUI from "./trilium_mention_ui.js";
import type { TriliumMentionFeed } from "./types.js";

/** Longer than the mention UI's 100 ms feed debounce. */
const AFTER_DEBOUNCE = 160;

const HEADING_OPTIONS = [
    { model: "paragraph", title: "Paragraph" },
    { model: "heading2", view: "h2", title: "Heading 2" },
    { model: "heading3", view: "h3", title: "Heading 3" }
];

describe("matchSlashCommands", () => {
    const definitions: SlashCommandDefinition[] = [
        { id: "table", title: "Table", icon: "", aliases: [ "grid" ] },
        { id: "codeBlock", title: "Code block", icon: "", aliases: [ "snippet" ] },
        { id: "toc", title: "Table of contents", icon: "", aliases: [ "outline" ] },
        { id: "quote", title: "Block quote", icon: "" }
    ];

    it("returns the whole catalog, in order, for an empty query", () => {
        expect(matchSlashCommands(definitions, "").map((d) => d.id)).toEqual([ "table", "codeBlock", "toc", "quote" ]);
        expect(matchSlashCommands(definitions, "   ").map((d) => d.id)).toEqual([ "table", "codeBlock", "toc", "quote" ]);
    });

    it("ranks title prefixes above alias prefixes, and both above substring matches", () => {
        // "Table"/"Table of contents" start with it; "Block quote" only contains it.
        expect(matchSlashCommands(definitions, "table").map((d) => d.id)).toEqual([ "table", "toc" ]);

        // `grid` is an alias of Table; `Code block` merely contains "d".
        expect(matchSlashCommands(definitions, "gri").map((d) => d.id)).toEqual([ "table" ]);

        // Title prefix (Code block) beats alias substring (outline).
        expect(matchSlashCommands(definitions, "co").map((d) => d.id)).toEqual([ "codeBlock", "toc" ]);

        // Last resort: only an alias contains it, and not at its start ("outline").
        expect(matchSlashCommands(definitions, "line").map((d) => d.id)).toEqual([ "toc" ]);
    });

    it("matches case-insensitively and ignores surrounding whitespace", () => {
        expect(matchSlashCommands(definitions, "  BLOCK ").map((d) => d.id)).toEqual([ "quote", "codeBlock" ]);
    });

    it("returns nothing when there is no match", () => {
        expect(matchSlashCommands(definitions, "zzz")).toEqual([]);
    });
});

describe("TriliumSlashCommands", () => {
    let editor: ClassicEditor;

    async function createEditor(slashCommand: SlashCommandConfig = {}) {
        editor = await createTestEditor(
            [ Essentials, Paragraph, Heading, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ],
            { heading: { options: HEADING_OPTIONS }, slashCommand }
        );
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    }

    /** The `/` feed the plugin registered, as the mention UI sees it. */
    function slashFeed(): TriliumMentionFeed {
        const feeds = (editor.config.get("mention.feeds") ?? []) as TriliumMentionFeed[];
        const feed = feeds.find((candidate) => candidate.marker === "/");

        if (!feed) {
            throw new Error("the plugin did not register a `/` feed");
        }

        return feed;
    }

    async function queryPalette(query: string) {
        const feed = slashFeed().feed;

        if (typeof feed !== "function") {
            throw new Error("the `/` feed should be a callback");
        }

        return await feed.call(editor, query);
    }

    function type(text: string) {
        editor.model.change((writer) => {
            editor.model.insertContent(writer.createText(text), editor.model.document.selection.getFirstPosition());
        });
    }

    function pressKey(keyCode: number) {
        editor.editing.view.document.fire("keydown", {
            keyCode,
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, AFTER_DEBOUNCE));
    }

    beforeEach(async () => {
        await createEditor();
    });

    it("registers itself and a `/` feed that opens on the bare marker", () => {
        expect(TriliumSlashCommands.pluginName).toBe("TriliumSlashCommands");
        expect(editor.plugins.get(TriliumSlashCommands)).toBeInstanceOf(TriliumSlashCommands);
        expect(slashFeed().minimumCharacters).toBe(0);
    });

    describe("catalog", () => {
        it("derives heading entries from heading.options, so the palette matches the configured levels", () => {
            const defaults = buildDefaultSlashCommands(editor).map((definition) => definition.id);

            // Trilium reserves heading1 for the note title, so it is absent from the options.
            expect(defaults.slice(0, 3)).toEqual([ "paragraph", "heading2", "heading3" ]);
            expect(defaults).not.toContain("heading1");
        });

        it("falls back to a heading-free palette in an editor that configures neither headings nor slash commands", async () => {
            editor = await createTestEditor(
                [ Essentials, Paragraph, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ]
            );
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            // No `heading.options` to derive from, so the palette carries no headings at all...
            expect(buildDefaultSlashCommands(editor).map((definition) => definition.id))
                .toEqual([ "blockQuote", "codeBlock", "insertTable", "horizontalLine", "indent", "outdent" ]);

            // ...and of those, only the one whose plugin is actually loaded survives the catalog.
            expect((await queryPalette("")).map((item) => (item as { id: string }).id)).toEqual([ "/blockQuote" ]);
        });

        it("uses a generic icon for a heading level outside h1-h6", async () => {
            await createEditor();
            editor.config.set("heading.options", [ { model: "headingCustom", title: "Custom heading" } ]);

            const [ custom ] = buildDefaultSlashCommands(editor);
            expect(custom.id).toBe("headingCustom");
            expect(custom.icon).toBeTruthy();
        });

        it("hides entries whose command no plugin registered", async () => {
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);

            // BlockQuote is loaded in this editor; CodeBlock and Table are not.
            expect(ids).toContain("/blockQuote");
            expect(ids).not.toContain("/codeBlock");
            expect(ids).not.toContain("/insertTable");
        });

        it("drops entries named by removeCommands", async () => {
            await createEditor({ removeCommands: [ "blockQuote", "heading3" ] });
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);

            expect(ids).not.toContain("/blockQuote");
            expect(ids).not.toContain("/heading3");
            expect(ids).toContain("/heading2");
        });

        it("appends extraCommands after the defaults, without gating them on a command", async () => {
            await createEditor({
                extraCommands: [ { id: "custom", title: "Custom thing", icon: "<svg/>", execute: () => {} } ]
            });
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);

            expect(ids[ids.length - 1]).toBe("/custom");
        });
    });

    describe("execution", () => {
        it("runs a commandName entry and removes the trigger text", async () => {
            type("/quo");
            await settle();

            pressKey(keyCodes.enter);

            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toContain("<blockQuote>");
            expect(data).not.toContain("/quo");
        });

        it("runs an entry's own execute callback, with the editor as its argument", async () => {
            const execute = vi.fn();
            await createEditor({ extraCommands: [ { id: "custom", title: "Custom thing", icon: "<svg/>", execute } ] });

            type("/custom");
            await settle();
            pressKey(keyCodes.enter);

            expect(execute).toHaveBeenCalledExactlyOnceWith(editor);
        });

        it("passes the level to the heading command rather than executing an id", async () => {
            type("/heading");
            await settle();

            // "Heading 2" is the first configured level, so it is the pre-selected suggestion.
            pressKey(keyCodes.enter);

            expect(getModelData(editor.model, { withoutSelection: true })).toContain("<heading2>");
        });
    });

    describe("row rendering", () => {
        function render(query: string, index = 0) {
            const items = matchSlashCommands(buildDefaultSlashCommands(editor), query);
            const renderer = slashFeed().itemRenderer;

            if (!renderer) {
                throw new Error("the `/` feed should provide an itemRenderer");
            }

            return renderer({ id: `/${items[index].id}`, text: items[index].title, definition: items[index] } as never) as HTMLElement;
        }

        it("renders the icon, title and description with premium's class names, so the theme still applies", () => {
            const row = render("block quote");

            expect(row.classList.contains("ck-slash-command-button")).toBe(true);
            // Without this the base button styles hide the label, leaving a title-less row.
            expect(row.classList.contains("ck-button_with-text")).toBe(true);
            expect(row.querySelector(".ck-icon")?.innerHTML).toContain("<svg");
            expect(row.querySelector(".ck-button__label")?.textContent).toBe("Block quote");
            expect(row.querySelector(".ck-slash-command-button__description")?.textContent).toBeTruthy();
        });

        it("omits the description element for an entry that has none", () => {
            const renderer = slashFeed().itemRenderer;

            if (!renderer) {
                throw new Error("the `/` feed should provide an itemRenderer");
            }

            const definition: SlashCommandDefinition = { id: "bare", title: "Bare", icon: "<svg/>" };
            const row = renderer({ id: "/bare", text: "Bare", definition } as never) as HTMLElement;

            expect(row.querySelector(".ck-slash-command-button__description")).toBeNull();
        });
    });

    it("does not open the palette on a mid-word slash", async () => {
        type("and/or");
        await settle();

        const balloon = editor.plugins.get(ContextualBalloon);
        expect(balloon.visibleView?.element?.classList.contains("ck-mentions") ?? false).toBe(false);
    });
});
