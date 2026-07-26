import type FNote from "../entities/fnote";
import attributes from "./attributes";
import search from "./search";

/** An attribute that makes a note part of a category. */
export interface ContentTrigger {
    type: "label" | "relation";
    name: string;
}

/** How the notes within each category are ordered. */
export type ContentSortOrder = "title" | "dateCreated";

export interface ContentCategory {
    id: string;
    /** Translation key for the category heading. */
    titleKey: string;
    /**
     * Search query selecting the notes of this category.
     *
     * Each query has to ask for the `disabled:` spelling of its attributes as well: disabling active
     * content renames its attribute, which is precisely what makes every collector stop seeing it —
     * so the Content Manager is the one place that has to look for both.
     */
    filter: string;
}

export const CONTENT_CATEGORIES: ContentCategory[] = [
    {
        id: "backendScripts",
        titleKey: "content_manager.category_backend_scripts",
        filter: "#run = backendStartup OR #run = hourly OR #run = daily"
            + " OR #disabled:run = backendStartup OR #disabled:run = hourly OR #disabled:run = daily"
    },
    {
        id: "frontendScripts",
        titleKey: "content_manager.category_frontend_scripts",
        filter: "#run = frontendStartup OR #run = mobileStartup"
            + " OR #disabled:run = frontendStartup OR #disabled:run = mobileStartup"
    },
    {
        id: "widgets",
        titleKey: "content_manager.category_widgets",
        filter: "#widget OR #disabled:widget"
    },
    {
        id: "renderNotes",
        titleKey: "content_manager.category_render_notes",
        filter: "~renderNote OR ~disabled:renderNote"
    },
    {
        id: "themes",
        titleKey: "content_manager.category_themes",
        filter: "#appTheme OR #disabled:appTheme"
    },
    {
        id: "customCss",
        titleKey: "content_manager.category_custom_css",
        filter: "#appCss OR #disabled:appCss"
    },
    {
        id: "iconPacks",
        titleKey: "content_manager.category_icon_packs",
        filter: "#iconPack OR #disabled:iconPack"
    },
    {
        id: "templates",
        titleKey: "content_manager.category_templates",
        filter: "#template OR #disabled:template"
    },
    {
        id: "snippets",
        titleKey: "content_manager.category_snippets",
        filter: "#snippet OR #textSnippet OR #disabled:snippet OR #disabled:textSnippet"
    }
];

/** Runs one category's query and returns the user-made notes it matches, already sorted. */
export async function findCategoryNotes(category: ContentCategory, sortOrder: ContentSortOrder) {
    const notes = await search.searchForNotes(buildCategoryQuery(category.filter, sortOrder));

    return notes.filter((note) => isUserContent(note));
}

/** Appends the ordering clause, which the search engine applies server-side. */
export function buildCategoryQuery(filter: string, sortOrder: ContentSortOrder) {
    // Newest first reads better for dates, while titles are most useful alphabetically.
    const orderBy = sortOrder === "dateCreated" ? "note.dateCreated desc" : "note.title";

    return `${filter} orderBy ${orderBy}`;
}

/**
 * Whether a note is the user's own active content rather than something Trilium ships.
 *
 * Built-in notes live in the hidden subtree under reserved `_`-prefixed IDs. They are excluded
 * because the user did not create them and cannot meaningfully manage them: `checkHiddenSubtree()`
 * enforces their attributes on every startup, so any change made here would be reverted.
 */
export function isUserContent(note: FNote) {
    return !note.noteId.startsWith("_");
}

/** Whether the note is currently active in this category, i.e. at least one trigger is not disabled. */
export function isCategoryEnabled(note: FNote, category: ContentCategory) {
    return getCategoryTriggers(note, category).some(({ enabled }) => enabled);
}

/**
 * Enables or disables the note's participation in this category, and only this one.
 *
 * A note can be active content in several ways at once — a script that is also a template — so the
 * triggers of other categories are deliberately left alone.
 */
export async function setCategoryEnabled(note: FNote, category: ContentCategory, enabled: boolean) {
    for (const { type, name } of getCategoryTriggers(note, category)) {
        await attributes.toggleDangerousAttribute(note, type, name, enabled);
    }
}

/**
 * The triggers of this category that the note actually owns, deduplicated by type and name, with
 * `disabled:` stripped so the name is the one to write back.
 */
function getCategoryTriggers(note: FNote, category: ContentCategory) {
    const wanted = new Set(parseFilterTriggers(category.filter).map(toTriggerKey));
    const found = new Map<string, ContentTrigger & { enabled: boolean }>();

    for (const attribute of note.getOwnedAttributes()) {
        if (attribute.type !== "label" && attribute.type !== "relation") {
            continue;
        }

        const trigger: ContentTrigger = {
            type: attribute.type,
            name: attributes.getNameWithoutDangerousPrefix(attribute.name)
        };
        const key = toTriggerKey(trigger);

        if (!wanted.has(key)) {
            continue;
        }

        // An enabled spelling wins: the note counts as active if any of its triggers is live.
        const enabled = !attribute.name.startsWith(DISABLED_PREFIX);
        found.set(key, { ...trigger, enabled: enabled || (found.get(key)?.enabled ?? false) });
    }

    return [ ...found.values() ];
}

/** Reads the attribute names out of a category's search query, so it stays the single source of truth. */
export function parseFilterTriggers(filter: string): ContentTrigger[] {
    const triggers = new Map<string, ContentTrigger>();

    for (const match of filter.match(/[#~][\w:]+/g) ?? []) {
        const trigger: ContentTrigger = {
            type: match.startsWith("#") ? "label" : "relation",
            name: attributes.getNameWithoutDangerousPrefix(match.slice(1))
        };
        triggers.set(toTriggerKey(trigger), trigger);
    }

    return [ ...triggers.values() ];
}

function toTriggerKey({ type, name }: ContentTrigger) {
    return `${type}-${name.toLowerCase()}`;
}

const DISABLED_PREFIX = "disabled:";
