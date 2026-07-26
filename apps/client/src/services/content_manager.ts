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

/** Matched against the note's own attributes, reading through the `disabled:` prefix. */
export interface ContentPropertyCondition {
    /** Label to match. Set either this or {@link relation}, not both. */
    label?: string;
    /** Relation to match, e.g. an event handler. */
    relation?: string;
    /** Matches when the attribute carries any of these values. */
    is?: string | string[];
    /** Matches when the attribute exists and carries none of these values. */
    isNot?: string | string[];
}

export interface ContentPropertyValue {
    /** Translation key for the text shown when {@link condition} matches. */
    titleKey?: string;
    /** Shows this label's own value instead of a fixed title. */
    valueOfLabel?: string;
    condition?: ContentPropertyCondition;
}

/** Extra detail shown next to an item, e.g. `Trigger: backend startup, hourly`. */
export interface ContentProperty {
    /** Translation key for the property name. */
    titleKey: string;
    values: ContentPropertyValue[];
}

export interface ContentCategory {
    id: string;
    /** Translation key for the category heading. */
    titleKey: string;
    /** Extra detail to show per item. Only properties that resolve to a value are displayed. */
    properties?: ContentProperty[];
    /**
     * Search query selecting the notes of this category.
     *
     * Each query has to ask for the `disabled:` spelling of its attributes as well: disabling active
     * content renames its attribute, which is precisely what makes every collector stop seeing it —
     * so the Content Manager is the one place that has to look for both.
     */
    filter: string;
}

/**
 * The event relations that actually fire, paired with how they read in the UI.
 *
 * `runOnNoteDeletion` is deliberately absent: it is declared in `BUILTIN_ATTRIBUTES` but nothing in
 * `handlers.ts` subscribes to it, so listing it would advertise a trigger that never runs.
 */
const EVENT_HANDLERS = [
    { relation: "runOnNoteCreation", titleKey: "content_manager.event_note_creation" },
    { relation: "runOnNoteTitleChange", titleKey: "content_manager.event_note_title_change" },
    { relation: "runOnNoteChange", titleKey: "content_manager.event_note_change" },
    { relation: "runOnNoteContentChange", titleKey: "content_manager.event_note_content_change" },
    { relation: "runOnChildNoteCreation", titleKey: "content_manager.event_child_note_creation" },
    { relation: "runOnAttributeCreation", titleKey: "content_manager.event_attribute_creation" },
    { relation: "runOnAttributeChange", titleKey: "content_manager.event_attribute_change" },
    { relation: "runOnBranchCreation", titleKey: "content_manager.event_branch_creation" },
    { relation: "runOnBranchChange", titleKey: "content_manager.event_branch_change" },
    { relation: "runOnBranchDeletion", titleKey: "content_manager.event_branch_deletion" }
];

export const CONTENT_CATEGORIES: ContentCategory[] = [
    {
        id: "templates",
        titleKey: "content_manager.category_templates",
        filter: "#template OR #disabled:template",
        properties: [ {
            titleKey: "content_manager.property_scope",
            // A bare condition tests only that the label is present.
            values: [ { titleKey: "content_manager.scope_workspace", condition: { label: "workspaceTemplate" } } ]
        } ]
    },
    {
        id: "snippets",
        titleKey: "content_manager.category_snippets",
        filter: "#snippet OR #textSnippet OR #disabled:snippet OR #disabled:textSnippet"
    },
    {
        id: "iconPacks",
        titleKey: "content_manager.category_icon_packs",
        filter: "#iconPack OR #disabled:iconPack",
        properties: [ {
            titleKey: "content_manager.property_prefix",
            values: [ { valueOfLabel: "iconPack" } ]
        } ]
    },
    {
        id: "themes",
        titleKey: "content_manager.category_themes",
        filter: "#appTheme OR #disabled:appTheme",
        properties: [ {
            titleKey: "content_manager.property_base_theme",
            values: [ { valueOfLabel: "appThemeBase" } ]
        } ]
    },
    {
        id: "customCss",
        titleKey: "content_manager.category_custom_css",
        filter: "#appCss OR #disabled:appCss"
    },
    {
        id: "sharing",
        titleKey: "content_manager.category_sharing",
        filter: "#shareRaw OR ~shareJs OR ~shareHtml OR ~shareTemplate"
            + " OR #disabled:shareRaw OR ~disabled:shareJs OR ~disabled:shareHtml OR ~disabled:shareTemplate",
        properties: [ {
            titleKey: "content_manager.property_kind",
            values: [
                { titleKey: "content_manager.share_raw", condition: { label: "shareRaw" } },
                { titleKey: "content_manager.share_js", condition: { relation: "shareJs" } },
                { titleKey: "content_manager.share_html", condition: { relation: "shareHtml" } },
                { titleKey: "content_manager.share_template", condition: { relation: "shareTemplate" } }
            ]
        } ]
    },
    {
        id: "frontendScripts",
        titleKey: "content_manager.category_frontend_scripts",
        filter: "#run = frontendStartup OR #run = mobileStartup"
            + " OR #disabled:run = frontendStartup OR #disabled:run = mobileStartup",
        properties: [ {
            titleKey: "content_manager.property_trigger",
            values: [
                { titleKey: "content_manager.trigger_frontend_startup", condition: { label: "run", is: "frontendStartup" } },
                { titleKey: "content_manager.trigger_mobile_startup", condition: { label: "run", is: "mobileStartup" } }
            ]
        } ]
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
        id: "eventHandlers",
        titleKey: "content_manager.category_event_handlers",
        // The relation lives on the note the handler is attached to, not on the script it runs, so
        // these rows are the notes whose changes trigger something.
        filter: EVENT_HANDLERS.flatMap(({ relation }) => [ `~${relation}`, `~disabled:${relation}` ]).join(" OR "),
        properties: [ {
            titleKey: "content_manager.property_event",
            values: EVENT_HANDLERS.map(({ relation, titleKey }) => ({ titleKey, condition: { relation } }))
        } ]
    },
    {
        id: "endpoints",
        titleKey: "content_manager.category_endpoints",
        filter: "#customRequestHandler OR #customResourceProvider"
            + " OR #disabled:customRequestHandler OR #disabled:customResourceProvider",
        properties: [
            {
                titleKey: "content_manager.property_kind",
                values: [
                    { titleKey: "content_manager.endpoint_request_handler", condition: { label: "customRequestHandler" } },
                    { titleKey: "content_manager.endpoint_resource_provider", condition: { label: "customResourceProvider" } }
                ]
            },
            {
                // The label's value is the regular expression matched against the request path.
                titleKey: "content_manager.property_path",
                values: [
                    { valueOfLabel: "customRequestHandler" },
                    { valueOfLabel: "customResourceProvider" }
                ]
            }
        ]
    },
    {
        id: "backendScripts",
        titleKey: "content_manager.category_backend_scripts",
        filter: "#run = backendStartup OR #run = hourly OR #run = daily"
            + " OR #disabled:run = backendStartup OR #disabled:run = hourly OR #disabled:run = daily",
        properties: [
            {
                titleKey: "content_manager.property_trigger",
                values: [
                    { titleKey: "content_manager.trigger_backend_startup", condition: { label: "run", is: "backendStartup" } },
                    { titleKey: "content_manager.trigger_hourly", condition: { label: "run", is: "hourly" } },
                    { titleKey: "content_manager.trigger_daily", condition: { label: "run", is: "daily" } }
                ]
            },
            {
                // The scheduler skips the script on any instance not named here, so a script can look
                // enabled yet never run.
                titleKey: "content_manager.property_instance",
                values: [ { valueOfLabel: "runOnInstance" } ]
            }
        ]
    }
];

/** Runs one category's query and returns the user-made notes it matches, already sorted. */
export async function findCategoryNotes(category: ContentCategory, sortOrder: ContentSortOrder) {
    const notes = await search.searchForNotes(buildCategoryQuery(category.filter, sortOrder));

    return notes.filter((note) => isUserContent(note));
}

/**
 * Appends the ordering clause, which the search engine applies server-side.
 *
 * Note IDs break ties. Notes routinely share a title, and the sort would otherwise be unstable —
 * equally named rows could swap places on every refresh, which reads as the list jumping about.
 */
export function buildCategoryQuery(filter: string, sortOrder: ContentSortOrder) {
    // Newest first reads better for dates, while titles are most useful alphabetically.
    const orderBy = sortOrder === "dateCreated"
        ? "note.dateCreated desc, note.noteId"
        : "note.title, note.noteId";

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

/** One resolved value: either a fixed title to translate, or text taken from the note itself. */
export interface ResolvedPropertyValue {
    titleKey?: string;
    text?: string;
}

export interface ResolvedProperty {
    titleKey: string;
    values: ResolvedPropertyValue[];
}

/**
 * Works out the extra detail to show for a note, dropping properties that resolve to nothing.
 *
 * Translation is left to the caller: a value is either a key to translate or text read off the note,
 * and mixing the two here would drag i18n into what is otherwise pure data.
 */
export function resolveProperties(note: FNote, category: ContentCategory): ResolvedProperty[] {
    const resolved: ResolvedProperty[] = [];

    for (const property of category.properties ?? []) {
        const values: ResolvedPropertyValue[] = [];

        for (const value of property.values) {
            if (value.condition && !matchesCondition(note, value.condition)) {
                continue;
            }

            if (value.titleKey) {
                values.push({ titleKey: value.titleKey });
            } else if (value.valueOfLabel) {
                // Several labels of the same name are possible, e.g. two `#run` triggers.
                values.push(...getOwnedAttributeValues(note, value.valueOfLabel, "label")
                    .filter((text) => text.trim())
                    .map((text) => ({ text })));
            }
        }

        if (values.length) {
            resolved.push({ titleKey: property.titleKey, values });
        }
    }

    return resolved;
}

function matchesCondition(note: FNote, { label, relation, is, isNot }: ContentPropertyCondition) {
    const values = relation
        ? getOwnedAttributeValues(note, relation, "relation")
        : label ? getOwnedAttributeValues(note, label, "label") : [];

    if (!values.length) {
        return false;
    }

    if (is !== undefined && !values.some((value) => toArray(is).includes(value))) {
        return false;
    }

    return isNot === undefined || !values.some((value) => toArray(isNot).includes(value));
}

/**
 * All values the note holds for an attribute, matched through the `disabled:` prefix so that
 * switching an item off doesn't blank out the detail explaining what it does.
 */
function getOwnedAttributeValues(note: FNote, name: string, type: "label" | "relation") {
    return note.getOwnedAttributes()
        .filter((attribute) => attribute.type === type
            && attributes.getNameWithoutDangerousPrefix(attribute.name).toLowerCase() === name.toLowerCase())
        .map((attribute) => attribute.value);
}

function toArray(value: string | string[]) {
    return Array.isArray(value) ? value : [ value ];
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
