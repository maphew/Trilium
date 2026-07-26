import type FNote from "../entities/fnote";
import search from "./search";

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
