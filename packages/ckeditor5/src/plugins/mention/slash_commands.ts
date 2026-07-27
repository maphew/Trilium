import "../../theme/slash_commands.css";

import {
    IconCodeBlock,
    IconHeading1,
    IconHeading2,
    IconHeading3,
    IconHeading4,
    IconHeading5,
    IconHeading6,
    IconHorizontalLine,
    IconIndent,
    IconOutdent,
    IconParagraph,
    IconQuote,
    IconTable
} from "@ckeditor/ckeditor5-icons";
import { type Editor, type MentionFeedObjectItem, Plugin } from "ckeditor5";

import { registerMentionFeed } from "./register_feed.js";

export const SLASH_MARKER = "/";

const DROPDOWN_LIMIT = 10;

/**
 * One entry of the `/` palette. Structurally the same shape premium `SlashCommand` accepted, so the
 * definitions in `extra_slash_commands.ts` carry over unchanged.
 */
export interface SlashCommandDefinition {
    /** Stable identifier, also what `slashCommand.removeCommands` matches against. */
    id: string;
    title: string;
    description?: string;
    /** Extra words the entry can be found by, beyond its title. */
    aliases?: string[];
    /** Raw SVG markup. */
    icon: string;
    /** The editor command to run. Entries naming a command that is not loaded are hidden. */
    commandName?: string;
    /** Runs instead of `commandName`, for entries that need arguments or open a UI. */
    execute?: (editor: Editor) => void;
}

export interface SlashCommandConfig {
    extraCommands?: SlashCommandDefinition[];
    removeCommands?: string[];
}

/**
 * The `/` command palette, hosted on {@link TriliumMentionUI}.
 *
 * This replaces premium `SlashCommand`, which was the only remaining plugin forcing the `Mention`
 * façade — and therefore upstream's `MentionUI` — into the text editor alongside ours. Two mention
 * UIs sharing `mention.feeds` fight over the same `ContextualBalloon`: whichever adds its view
 * second buries the other, and the buried one then throws `contextualballoon-add-view-exist` on its
 * next keystroke.
 *
 * CKEditor built the premium plugin on `Mention` themselves, so hosting `/` on a mention feed is
 * not a workaround but the same architecture. What is reimplemented here is the palette: the
 * catalog, the matcher and the row rendering. The definitions Trilium already hand-authored in
 * `extra_slash_commands.ts` are consumed unchanged via `slashCommand.extraCommands`.
 */
export default class TriliumSlashCommands extends Plugin {

    static get pluginName() {
        return "TriliumSlashCommands" as const;
    }

    constructor(editor: Editor) {
        super(editor);

        registerMentionFeed(editor, {
            marker: SLASH_MARKER,
            // A bare `/` opens the full palette, as the premium plugin did.
            minimumCharacters: 0,
            dropdownLimit: DROPDOWN_LIMIT,
            feed: (query: string) => matchSlashCommands(this._catalog(), query).map(toFeedItem),
            itemRenderer: (item) => renderRow(item as SlashCommandItem),
            commit: (editorInstance, item) => runSlashCommand(editorInstance, (item as SlashCommandItem).definition)
        });
    }

    /**
     * The definitions available in *this* editor: the built-in palette plus the configured extras,
     * minus anything `removeCommands` names and anything whose command is not loaded.
     */
    private _catalog(): SlashCommandDefinition[] {
        const editor = this.editor;
        const config = (editor.config.get("slashCommand") ?? {}) as SlashCommandConfig;
        const removed = new Set(config.removeCommands ?? []);

        return [ ...buildDefaultSlashCommands(editor), ...(config.extraCommands ?? []) ]
            .filter((definition) => !removed.has(definition.id))
            // An entry naming a command no plugin registered would throw on execute. Entries with
            // their own `execute` are the caller's responsibility, exactly as upstream treated
            // `extraCommands`.
            .filter((definition) => !definition.commandName || !!editor.commands.get(definition.commandName));
    }
}

type SlashCommandItem = MentionFeedObjectItem & { definition: SlashCommandDefinition };

function toFeedItem(definition: SlashCommandDefinition): SlashCommandItem {
    // Upstream requires a feed item's `id` to start with the marker.
    return { id: `${SLASH_MARKER}${definition.id}`, text: definition.title, definition };
}

function runSlashCommand(editor: Editor, definition: SlashCommandDefinition) {
    if (definition.execute) {
        definition.execute(editor);
        return;
    }

    /* v8 ignore next 3 -- `_catalog()` drops every definition that has neither `execute` nor a registered `commandName`, so one or the other is always present here */
    if (definition.commandName) {
        editor.execute(definition.commandName);
    }
}

/**
 * Ranks `definitions` against what the user typed after the `/`.
 *
 * Prefix matches sort above substring matches so that `/co` offers "Code block" before "Table of
 * contents", and title matches above alias matches so an entry is found by its own name first.
 * Ordering within a tier is the catalog order, which is deliberate: the defaults come first and the
 * hand-authored Trilium entries follow.
 */
export function matchSlashCommands(definitions: SlashCommandDefinition[], query: string): SlashCommandDefinition[] {
    const needle = query.trim().toLowerCase();

    if (!needle) {
        return definitions;
    }

    const ranked: Array<{ definition: SlashCommandDefinition; rank: number }> = [];

    for (const definition of definitions) {
        const title = definition.title.toLowerCase();
        const aliases = (definition.aliases ?? []).map((alias) => alias.toLowerCase());
        let rank: number | null = null;

        if (title.startsWith(needle)) {
            rank = 0;
        } else if (aliases.some((alias) => alias.startsWith(needle))) {
            rank = 1;
        } else if (title.includes(needle)) {
            rank = 2;
        } else if (aliases.some((alias) => alias.includes(needle))) {
            rank = 3;
        }

        if (rank !== null) {
            ranked.push({ definition, rank });
        }
    }

    // `sort` is stable in every engine we target, so equal ranks keep their catalog order.
    return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.definition);
}

/**
 * The subset of premium's built-in palette that applies to Trilium. Entries Trilium re-authors with
 * better icons or sentence-case titles (the lists, Mermaid) live in `extra_slash_commands.ts` and
 * are deliberately absent here; so are the ones for plugins Trilium never loads (CKBox, CKFinder,
 * HTML embed).
 *
 * Headings are derived from `heading.options` rather than hardcoded, so the palette automatically
 * matches the configured levels — Trilium omits `heading1`, which is reserved for the note title.
 */
export function buildDefaultSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const t = editor.locale.t;

    return [
        ...buildHeadingSlashCommands(editor),
        {
            id: "blockQuote",
            title: t("Block quote"),
            description: t("Quote a passage from another source."),
            aliases: [ "quote", "citation" ],
            icon: IconQuote,
            commandName: "blockQuote"
        },
        {
            id: "codeBlock",
            title: t("Code block"),
            description: t("Insert a block of preformatted code."),
            aliases: [ "snippet", "pre" ],
            icon: IconCodeBlock,
            commandName: "codeBlock"
        },
        {
            id: "insertTable",
            title: t("Table"),
            description: t("Insert a table."),
            aliases: [ "grid" ],
            icon: IconTable,
            commandName: "insertTable"
        },
        {
            id: "horizontalLine",
            title: t("Horizontal line"),
            description: t("Insert a horizontal rule."),
            aliases: [ "divider", "separator", "rule" ],
            icon: IconHorizontalLine,
            commandName: "horizontalLine"
        },
        {
            id: "indent",
            title: t("Indent"),
            description: t("Increase the indentation of the current block."),
            icon: IconIndent,
            commandName: "indent"
        },
        {
            id: "outdent",
            title: t("Outdent"),
            description: t("Decrease the indentation of the current block."),
            icon: IconOutdent,
            commandName: "outdent"
        }
    ];
}

function buildHeadingSlashCommands(editor: Editor): SlashCommandDefinition[] {
    const options = (editor.config.get("heading.options") ?? []) as Array<{ model: string; title: string }>;
    const icons: Record<string, string> = {
        heading1: IconHeading1,
        heading2: IconHeading2,
        heading3: IconHeading3,
        heading4: IconHeading4,
        heading5: IconHeading5,
        heading6: IconHeading6
    };

    return options.map((option) => {
        if (option.model === "paragraph") {
            return {
                id: "paragraph",
                title: option.title,
                description: editor.locale.t("Turn the current block into a paragraph."),
                aliases: [ "text", "body" ],
                icon: IconParagraph,
                commandName: "paragraph"
            };
        }

        return {
            id: option.model,
            title: option.title,
            description: editor.locale.t("Turn the current block into a heading."),
            aliases: [ "title", option.model.replace("heading", "h") ],
            icon: icons[option.model] ?? IconHeading2,
            // `heading` takes the level as an argument, so it cannot use `commandName`.
            execute: (target: Editor) => target.execute("heading", { value: option.model })
        };
    });
}

/**
 * Renders one palette row: icon, title and description. The class names match premium's, so the
 * overrides Trilium already carries in `style.css` and the Next theme keep applying unchanged.
 */
function renderRow(item: SlashCommandItem): HTMLElement {
    const { definition } = item;

    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    // `ck-button_with-text` is load-bearing, not cosmetic: the base button styles hide
    // `.ck-button__label` outright without it, which leaves the row showing its description and no
    // title at all.
    button.classList.add("ck", "ck-button", "ck-button_with-text", "ck-slash-command-button");

    const icon = document.createElement("span");
    icon.classList.add("ck", "ck-icon");
    icon.innerHTML = definition.icon;
    button.append(icon);

    const textPart = document.createElement("span");
    textPart.classList.add("ck", "ck-slash-command-button__text-part");

    const label = document.createElement("span");
    label.classList.add("ck", "ck-button__label");
    label.textContent = definition.title;
    textPart.append(label);

    if (definition.description) {
        const description = document.createElement("span");
        description.classList.add("ck", "ck-slash-command-button__description");
        description.textContent = definition.description;
        textPart.append(description);
    }

    button.append(textPart);
    return button;
}
