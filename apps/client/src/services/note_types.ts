import type { TemplatesResponse } from "@triliumnext/commons";

import type FNote from "../entities/fnote.js";
import type { NoteType } from "../entities/fnote.js";
import type { MenuCommandItem, MenuItem, MenuItemBadge, MenuSeparatorItem } from "../menus/context_menu.js";
import type { TreeCommandNames } from "../menus/tree_context_menu.js";
import { isExperimentalFeatureEnabled } from "./experimental_features.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import server from "./server.js";

export interface NoteTypeMapping {
    type: NoteType;
    mime?: string;
    title: string;
    icon?: string;
    /** Indicates whether this type should be marked as a newly introduced feature. */
    isNew?: boolean;
    /** Indicates that this note type is part of a beta feature. */
    isBeta?: boolean;
    /** Indicates that this note type cannot be created by the user. */
    reserved?: boolean;
    /** Indicates that once a note of this type is created, its type can no longer be changed. */
    static?: boolean;
}

export const NOTE_TYPES: NoteTypeMapping[] = [
    // The suggested note type ordering method: insert the item into the corresponding group,
    // then ensure the items within the group are ordered alphabetically.

    // The default note type (always the first item)
    { type: "text", mime: "text/html", title: t("note_types.text"), icon: "bx-note" },
    { type: "spreadsheet", mime: "application/json", title: t("note_types.spreadsheet"), icon: "bx-table", isBeta: true, isNew: true },

    // Text notes group
    { type: "book", mime: "", title: t("note_types.book"), icon: "bx-book" },

    // Graphic notes
    { type: "canvas", mime: "application/json", title: t("note_types.canvas"), icon: "bx-pen" },
    { type: "mermaid", mime: "text/mermaid", title: t("note_types.mermaid-diagram"), icon: "bx-selection" },

    // Map notes
    { type: "mindMap", mime: "application/json", title: t("note_types.mind-map"), icon: "bx-sitemap" },
    { type: "noteMap", mime: "", title: t("note_types.note-map"), icon: "bxs-network-chart", static: true },
    { type: "relationMap", mime: "application/json", title: t("note_types.relation-map"), icon: "bxs-network-chart" },

    // Misc note types
    { type: "llmChat", mime: "application/json", title: t("note_types.llm-chat"), icon: "bx-message-square-dots", isBeta: true },
    { type: "render", mime: "", title: t("note_types.render-note"), icon: "bx-extension" },
    { type: "search", title: t("note_types.saved-search"), icon: "bx-file-find", static: true },
    { type: "webView", mime: "", title: t("note_types.web-view"), icon: "bx-globe-alt" },

    // Code notes
    { type: "code", mime: "text/plain", title: t("note_types.code"), icon: "bx-code" },
    { type: "code", mime: "text/x-markdown", title: t("note_types.markdown"), icon: "bxl-markdown", isNew: true },

    // Reserved types (cannot be created by the user)
    { type: "contentWidget", mime: "", title: t("note_types.widget"), reserved: true },
    { type: "doc", mime: "", title: t("note_types.doc"), reserved: true },
    { type: "file", title: t("note_types.file"), reserved: true },
    { type: "image", title: t("note_types.image"), reserved: true },
    { type: "launcher", mime: "", title: t("note_types.launcher"), reserved: true },
];

/** The menu item badge used to mark new note types and templates */
const NEW_BADGE: MenuItemBadge = {
    title: t("note_types.new-feature"),
    className: "new-note-type-badge"
};

/** The menu item badge used to mark note types that are part of a beta feature */
const BETA_BADGE = {
    title: t("note_types.beta-feature")
};

const SEPARATOR: MenuSeparatorItem = { kind: "separator" };

/**
 * The templates the note type menus are built from. Kept separate from the menu items so that a
 * caller building several menus at once (e.g. the tree context menu, which has both an "insert
 * note after" and an "insert child note" submenu) pays for the requests only once.
 */
export interface NoteTypeData {
    builtInTemplateNotes: FNote[];
    userTemplateNotes: FNote[];
    /** The IDs of the templates to mark with the "New" badge. */
    newTemplates: Set<string>;
}

async function loadNoteTypeData(): Promise<NoteTypeData> {
    // A single request reports both the user templates and which templates are new, so that the
    // menus can be assembled without a round trip per template.
    const { templateNoteIds, newTemplateNoteIds } =
        await server.get<TemplatesResponse>("search-templates");

    const [ builtInTemplateNotes, userTemplateNotes ] = await Promise.all([
        getBuiltInTemplateNotes(),
        froca.getNotes(templateNoteIds)
    ]);

    return { builtInTemplateNotes, userTemplateNotes, newTemplates: new Set(newTemplateNoteIds) };
}

function buildNoteTypeItems(data: NoteTypeData, command?: TreeCommandNames) {
    const { builtInTemplateNotes, userTemplateNotes, newTemplates } = data;

    const items: MenuItem<TreeCommandNames>[] = [
        ...getBlankNoteTypes(command),
        ...getBuiltInTemplates(null, command, builtInTemplateNotes, false, newTemplates),
        ...getBuiltInTemplates(
            t("note_types.collections"), command, builtInTemplateNotes, true, newTemplates
        ),
        ...getUserTemplates(command, userTemplateNotes, newTemplates)
    ];

    return items;
}

/** Builds a single note type menu. Use {@link loadNoteTypeData} directly to build several. */
async function getNoteTypeItems(command?: TreeCommandNames) {
    return buildNoteTypeItems(await loadNoteTypeData(), command);
}

function getBlankNoteTypes(command?: TreeCommandNames): MenuItem<TreeCommandNames>[] {
    return NOTE_TYPES
        .filter((nt) => !nt.reserved && nt.type !== "book")
        .filter((nt) => nt.type !== "llmChat" || isExperimentalFeatureEnabled("llm"))
        .map((nt) => {
            const menuItem: MenuCommandItem<TreeCommandNames> = {
                title: nt.title,
                command,
                type: nt.type,
                mime: nt.mime,
                uiIcon: `bx ${nt.icon}`,
                badges: []
            };

            if (nt.isNew) {
                menuItem.badges?.push(NEW_BADGE);
            }

            if (nt.isBeta) {
                menuItem.badges?.push(BETA_BADGE);
            }

            return menuItem;
        });
}

function getUserTemplates(command: TreeCommandNames | undefined, templateNotes: FNote[], newTemplates: Set<string>) {
    if (templateNotes.length === 0) {
        return [];
    }

    const items: MenuItem<TreeCommandNames>[] = [
        {
            title: t("note_type_chooser.templates"),
            kind: "header"
        }
    ];

    for (const templateNote of templateNotes) {
        const item: MenuItem<TreeCommandNames> = {
            title: templateNote.title,
            uiIcon: templateNote.getIcon(),
            command,
            type: templateNote.type,
            templateNoteId: templateNote.noteId
        };

        if (newTemplates.has(templateNote.noteId)) {
            item.badges = [NEW_BADGE];
        }

        items.push(item);
    }
    return items;
}

async function getBuiltInTemplateNotes() {
    const templatesRoot = await froca.getNote("_templates");
    if (!templatesRoot) {
        console.warn("Unable to find template root.");
        return [];
    }

    return await templatesRoot.getChildNotes();
}

function getBuiltInTemplates(title: string | null, command: TreeCommandNames | undefined, childNotes: FNote[], filterCollections: boolean, newTemplates: Set<string>) {
    if (childNotes.length === 0) {
        return [];
    }

    const items: MenuItem<TreeCommandNames>[] = [];
    if (title) {
        items.push({
            title,
            kind: "header"
        });
    } else {
        items.push(SEPARATOR);
    }

    for (const templateNote of childNotes) {
        if (templateNote.hasLabel("collection") !== filterCollections ||
            !templateNote.hasLabel("template")) {
            continue;
        }

        const item: MenuItem<TreeCommandNames> = {
            title: templateNote.title,
            uiIcon: templateNote.getIcon(),
            command,
            type: templateNote.type,
            templateNoteId: templateNote.noteId
        };

        const badges: MenuItemBadge[] = [];
        if (newTemplates.has(templateNote.noteId)) {
            badges.push(NEW_BADGE);
        }
        if (templateNote.hasLabel("beta")) {
            badges.push(BETA_BADGE);
        }
        if (badges.length > 0) {
            item.badges = badges;
        }

        items.push(item);
    }
    return items;
}

export default {
    loadNoteTypeData,
    buildNoteTypeItems,
    getNoteTypeItems
};
