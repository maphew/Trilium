import type { Editor } from 'ckeditor5';
import insertFootnoteIcon from './icons/insert-footnote.svg?raw';
import { IconPageBreak, IconAlignLeft, IconAlignCenter, IconAlignRight, IconAlignJustify, IconBulletedList, IconNumberedList, IconTodoList } from "@ckeditor/ckeditor5-icons";
import bxInfoCircle from "boxicons/svg/regular/bx-info-circle.svg?raw";
import bxBulb from "boxicons/svg/regular/bx-bulb.svg?raw";
import bxCommentError from "boxicons/svg/regular/bx-comment-error.svg?raw";
import bxErrorCircle from "boxicons/svg/regular/bx-error-circle.svg?raw";
import bxError from "boxicons/svg/regular/bx-error.svg?raw";
import { COMMAND_NAME as INSERT_DATE_TIME_COMMAND } from './plugins/insert_date_time.js';
import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from './plugins/internallink.js';
import { COMMAND_NAME as INCLUDE_NOTE_COMMAND } from './plugins/includenote.js';
import { COMMAND_NAME as MARKDOWN_IMPORT_COMMAND } from './plugins/markdownimport.js';
import { getAdmonitionTitle } from "./plugins/admonition/admonition_ui.js";
import { ADMONITION_TYPE_NAMES, type AdmonitionType } from "./plugins/admonition/admonition_command.js";
import { translateMessage } from "./messages.js";
import collapsibleIcon from './icons/collapsible.svg?raw';
import dateTimeIcon from './icons/date-time.svg?raw';
import internalLinkIcon from './icons/trilium.svg?raw';
import noteIcon from './icons/note.svg?raw';
import importMarkdownIcon from './icons/markdown-mark.svg?raw';
import mathIcon from './icons/math.svg?raw';
import MathUI from './plugins/math/math_ui.js';
import { INSERT_MERMAID_COMMAND } from './plugins/mermaid/insert_mermaid_command.js';
import type { MermaidSample } from './plugins/mermaid/mermaid_ui.js';
import { BookmarkUI } from "ckeditor5";
import bxBookmark from "boxicons/svg/regular/bx-bookmark.svg?raw";
import bxNetworkChart from "boxicons/svg/regular/bx-network-chart.svg?raw";
import type { SlashCommandDefinition } from './plugins/mention/slash_commands.js';

/**
 * Resolves a full i18next key to the localized string. Supplied by the client, which owns i18n.
 *
 * The definitions below do not name keys themselves: they pass English message ids to a
 * {@link MessageTranslateFn}, which derives the key. This is the host translator that lookup ends
 * at.
 */
export type SlashTranslateFn = (key: string) => string;

/**
 * Translates one English message id, substituting `%0`, `%1`, … with `values`.
 *
 * The same contract as the `editor.t()` a plugin would call, which these definitions cannot: they
 * are built before any editor exists.
 */
type MessageTranslateFn = (message: string, ...values: string[]) => string;

export default function buildExtraCommands(
    translate: SlashTranslateFn,
    mermaidSamples: MermaidSample[] = []
): SlashCommandDefinition[] {
    const t: MessageTranslateFn = (message, ...values) => translateMessage(translate, message, values);

    return [
        ...buildListExtraCommands(t),
        ...buildAlignmentExtraCommands(t),
        ...buildAdmonitionExtraCommands(t),
        ...buildMermaidCommands(t, mermaidSamples),
        {
            id: "collapsible",
            title: t("Collapsible block"),
            description: t("Insert a toggleable section that hides/shows content on click."),
            aliases: [ "details", "fold", "toggle" ],
            icon: collapsibleIcon,
            commandName: "collapsible"
        },
        {
            id: 'footnote',
            title: t("Footnote"),
            description: t("Create a new footnote and reference it here"),
            icon: insertFootnoteIcon,
            commandName: "InsertFootnote"
        },
        {
            id: "datetime",
            title: t("Insert date/time"),
            description: t("Insert the current date and time"),
            icon: dateTimeIcon,
            commandName: INSERT_DATE_TIME_COMMAND
        },
        {
            id: "internal-link",
            title: t("Internal Trilium link"),
            description: t("Insert a link to another Trilium note"),
            aliases: [ "internal link", "trilium link", "reference link" ],
            icon: internalLinkIcon,
            commandName: INTERNAL_LINK_COMMAND
        },
        {
            id: "math",
            title: t("Math equation"),
            description: t("Insert a math equation"),
            aliases: [ "latex", "equation" ],
            icon: mathIcon,
            execute: (editor: Editor) => editor.plugins.get(MathUI)._showUI()
        },
        {
            id: "include-note",
            title: t("Include note"),
            description: t("Display the content of another note in this note"),
            icon: noteIcon,
            commandName: INCLUDE_NOTE_COMMAND
        },
        {
            id: "page-break",
            title: t("Page break"),
            description: t("Insert a page break (for printing)"),
            icon: IconPageBreak,
            commandName: "pageBreak"
        },
        {
            id: "markdown-import",
            title: t("Markdown import"),
            description: t("Import a markdown file into this note"),
            icon: importMarkdownIcon,
            commandName: MARKDOWN_IMPORT_COMMAND
        },
        {
            id: "anchor",
            title: t("Anchor"),
            description: t("Insert an anchor for internal linking"),
            aliases: [ "bookmark" ],
            icon: bxBookmark,
            execute: (editor: Editor) => {
                // Defer to the next event loop tick so the slash command fully finishes
                // its DOM/selection cleanup; _showFormView needs the view and mapper to
                // be in a settled state for balloon positioning.
                setTimeout(() => (editor.plugins.get(BookmarkUI) as any)._showFormView(), 0);
            }
        }
    ];
}

// Replaces CKEditor's built-in `bulletedList`/`numberedList`/`todoList` slash
// commands (removed via `removeCommands`), whose titles are Title Case, with
// sentence-case equivalents that run the same commands.
function buildListExtraCommands(t: MessageTranslateFn): SlashCommandDefinition[] {
    return [
        {
            id: "bulletedList",
            title: t("Bulleted list"),
            description: t("Create a bulleted list"),
            icon: IconBulletedList,
            commandName: "bulletedList"
        },
        {
            id: "numberedList",
            title: t("Numbered list"),
            description: t("Create a numbered list"),
            icon: IconNumberedList,
            commandName: "numberedList"
        },
        {
            id: "todoList",
            title: t("To-do list"),
            description: t("Create a to-do list"),
            icon: IconTodoList,
            commandName: "todoList"
        }
    ];
}

function buildMermaidCommands(t: MessageTranslateFn, samples: MermaidSample[]): SlashCommandDefinition[] {
    // The blank diagram. Replaces CKEditor's built-in `insertMermaidCommand`
    // slash command (removed via `removeCommands`), which uses a generic icon.
    const blank: SlashCommandDefinition = {
        id: "mermaid",
        title: t("Mermaid diagram"),
        description: t("Insert an empty Mermaid diagram"),
        aliases: [ "mermaid", "diagram", "flowchart" ],
        icon: bxNetworkChart,
        commandName: INSERT_MERMAID_COMMAND
    };

    const templates = samples.map((sample, index) => ({
        id: `mermaid-sample-${index}`,
        // The sample name is a placeholder rather than an appended string, so a locale can put the
        // name where its grammar wants it. It arrives already localized, from `mermaid.samples`.
        title: t("Mermaid diagram: %0", sample.name),
        description: t("Insert a \"%0\" Mermaid diagram template", sample.name),
        aliases: [ "mermaid", "diagram", sample.name ],
        icon: bxNetworkChart,
        // Inserts a mermaid block pre-filled with the sample source (see insertMermaidCommand).
        execute: (editor: Editor) => editor.execute(INSERT_MERMAID_COMMAND, { source: sample.content })
    }));

    return [ blank, ...templates ];
}

function buildAlignmentExtraCommands(t: MessageTranslateFn): SlashCommandDefinition[] {
    return [
        {
            id: "align-left",
            title: t("Align left"),
            description: t("Align text to the left"),
            icon: IconAlignLeft,
            execute: (editor: Editor) => editor.execute("alignment", { value: "left" }),
        },
        {
            id: "align-center",
            title: t("Align center"),
            description: t("Align text to the center"),
            icon: IconAlignCenter,
            execute: (editor: Editor) => editor.execute("alignment", { value: "center" }),
        },
        {
            id: "align-right",
            title: t("Align right"),
            description: t("Align text to the right"),
            icon: IconAlignRight,
            execute: (editor: Editor) => editor.execute("alignment", { value: "right" }),
        },
        {
            id: "align-justify",
            title: t("Justify"),
            description: t("Justify text alignment"),
            icon: IconAlignJustify,
            execute: (editor: Editor) => editor.execute("alignment", { value: "justify" }),
        }
    ];
}

function buildAdmonitionExtraCommands(t: MessageTranslateFn): SlashCommandDefinition[] {
    const commands: SlashCommandDefinition[] = [];
    const admonitionIcons: Record<AdmonitionType, string> = {
        note: bxInfoCircle,
        tip: bxBulb,
        important: bxCommentError,
        caution: bxErrorCircle,
        warning: bxError,
    };

    for (const type of ADMONITION_TYPE_NAMES) {
        commands.push({
            id: type,
            title: getAdmonitionTitle(t, type),
            description: t("Inserts a new admonition"),
            icon: admonitionIcons[type],
            execute: (editor: Editor) => editor.execute("admonition", { forceValue: type }),
            aliases: [ "box" ]
        });
    }
    return commands;
}
