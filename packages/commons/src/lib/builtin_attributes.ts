import { type LabelType } from "./promoted_attribute_definition_parser.js";

/**
 * Every attribute name Trilium itself gives a meaning to, as opposed to the ones a user invents.
 *
 * This is the single source of truth for that vocabulary: the {@link LabelNames} / {@link RelationNames}
 * types are derived from the array below, so a name cannot be known to the type system while being
 * missing from the runtime list (the drift that previously let system attributes go unrecognised).
 * Adding a name here is all that is needed to make it type-checkable and recognised at runtime alike.
 */

/**
 * A label, i.e. an attribute carrying a value.
 */
export interface BuiltinLabel {
    type: "label";
    name: string;
    /**
     * What kind of value the label holds. Not enforced at runtime — attribute values are always stored
     * as strings — but it types the `useNoteLabel*` hooks via {@link FilterLabelsByType}, and tells the
     * attribute editor which field to offer.
     *
     * Deliberately the same vocabulary a promoted attribute definition declares, rather than one of its
     * own: a system label and a user's promoted field describe the same thing when they say `color`.
     */
    valueType: LabelType;
    /**
     * Whether the attribute executes or embeds content, and so must be neutralised on import.
     * Dangerous attributes can be deactivated by prefixing them with `disabled:`, which is where the
     * `disabled:*` members of {@link LabelNames} / {@link RelationNames} come from.
     */
    isDangerous?: boolean;
    /**
     * Whether the *value* may contain user data, even though the *name* is system-defined. The name of
     * such an attribute is safe to keep in an anonymized database dump, its value is not — see
     * `anonymization.ts`, which preserves builtin attributes wholesale except for these.
     */
    hasUserValue?: boolean;
}

/**
 * A relation, i.e. an attribute pointing at a note. Its value is always a note ID, so it needs neither
 * a value type nor a {@link BuiltinLabel.hasUserValue} marker.
 */
export interface BuiltinRelation {
    type: "relation";
    name: string;
    isDangerous?: boolean;
}

const BUILTIN_ATTRIBUTES = [
    // Note tree & organisation
    { type: "label", name: "inbox", valueType: "boolean" },
    { type: "label", name: "disableVersioning", valueType: "boolean" },
    { type: "label", name: "versioningLimit", valueType: "number" },
    { type: "label", name: "calendarRoot", valueType: "boolean" },
    { type: "label", name: "archived", valueType: "boolean" },
    { type: "label", name: "excludeFromExport", valueType: "boolean" },
    { type: "label", name: "disableInclusion", valueType: "boolean" },
    { type: "label", name: "appCss", valueType: "boolean" },
    { type: "label", name: "appTheme", valueType: "text" },
    { type: "label", name: "appThemeBase", valueType: "text" },
    { type: "label", name: "hidePromotedAttributes", valueType: "boolean" },
    { type: "label", name: "readOnly", valueType: "boolean" },
    { type: "label", name: "autoReadOnlyDisabled", valueType: "boolean" },
    { type: "label", name: "cssClass", valueType: "text" },
    { type: "label", name: "iconClass", valueType: "text" },
    { type: "label", name: "keyboardShortcut", valueType: "text" },
    { type: "label", name: "run", valueType: "text", isDangerous: true },
    { type: "label", name: "runOnInstance", valueType: "text", isDangerous: false },
    { type: "label", name: "runAtHour", valueType: "number", isDangerous: false },
    { type: "label", name: "customRequestHandler", valueType: "text", isDangerous: true },
    { type: "label", name: "customResourceProvider", valueType: "text", isDangerous: true },
    { type: "label", name: "widget", valueType: "boolean", isDangerous: true },
    { type: "label", name: "similarNotesWidgetDisabled", valueType: "boolean" },
    { type: "label", name: "workspace", valueType: "boolean" },
    { type: "label", name: "workspaceIconClass", valueType: "text" },
    { type: "label", name: "workspaceTabBackgroundColor", valueType: "color" },
    { type: "label", name: "workspaceCalendarRoot", valueType: "boolean" },
    { type: "label", name: "workspaceTemplate", valueType: "boolean" },
    { type: "label", name: "searchHome", valueType: "boolean" },
    { type: "label", name: "workspaceInbox", valueType: "boolean" },
    { type: "label", name: "workspaceSearchHome", valueType: "boolean" },
    { type: "label", name: "sqlConsoleHome", valueType: "boolean" },
    { type: "label", name: "llmChatHome", valueType: "boolean" },
    { type: "label", name: "workspaceLlmChatHome", valueType: "boolean" },
    { type: "label", name: "datePattern", valueType: "text" },
    { type: "label", name: "weekPattern", valueType: "text" },
    { type: "label", name: "enableWeekNote", valueType: "boolean" },
    { type: "label", name: "monthPattern", valueType: "text" },
    { type: "label", name: "quarterPattern", valueType: "text" },
    { type: "label", name: "yearPattern", valueType: "text" },
    { type: "label", name: "enableQuarterNote", valueType: "boolean" },
    // Stamped onto each generated journal note, holding the period it stands for.
    { type: "label", name: "dateNote", valueType: "date", hasUserValue: true },
    { type: "label", name: "weekNote", valueType: "text", hasUserValue: true },
    { type: "label", name: "monthNote", valueType: "text", hasUserValue: true },
    { type: "label", name: "quarterNote", valueType: "text", hasUserValue: true },
    { type: "label", name: "yearNote", valueType: "text", hasUserValue: true },
    { type: "label", name: "pageSize", valueType: "number" },
    { type: "label", name: "viewType", valueType: "text" },
    { type: "label", name: "mapRootNoteId", valueType: "text" },
    { type: "label", name: "mapExcludeRelation", valueType: "text" },
    { type: "label", name: "mapIncludeRelation", valueType: "text" },
    // Keeps a note out of the note map -- unless the map is rooted at it, which journals rely on.
    { type: "label", name: "excludeFromNoteMap", valueType: "boolean" },
    { type: "label", name: "bookmarkFolder", valueType: "boolean" },
    { type: "label", name: "sorted", valueType: "boolean" },
    { type: "label", name: "sortDirection", valueType: "text" },
    { type: "label", name: "sortFoldersFirst", valueType: "boolean" },
    { type: "label", name: "sortNatural", valueType: "boolean" },
    { type: "label", name: "sortLocale", valueType: "text" },
    { type: "label", name: "top", valueType: "boolean" },
    { type: "label", name: "bottom", valueType: "boolean" },
    { type: "label", name: "fullContentWidth", valueType: "boolean" },
    { type: "label", name: "subtreeHidden", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "expanded", valueType: "text", hasUserValue: true },

    // Sharing
    { type: "label", name: "shareHiddenFromTree", valueType: "boolean" },
    // Both hold the URL to link out to; `shareExternal` is the older spelling the theme still reads.
    { type: "label", name: "shareExternalLink", valueType: "url", hasUserValue: true },
    { type: "label", name: "shareExternal", valueType: "url", hasUserValue: true },
    { type: "label", name: "shareRootLink", valueType: "url", hasUserValue: true },
    { type: "label", name: "shareLogoWidth", valueType: "number" },
    { type: "label", name: "shareLogoHeight", valueType: "number" },
    { type: "label", name: "shareOpenGraphColor", valueType: "color" },
    { type: "label", name: "shareOpenGraphURL", valueType: "url", hasUserValue: true },
    { type: "label", name: "shareOpenGraphDomain", valueType: "text", hasUserValue: true },
    // Also exists as a relation, pointing at an image note instead of naming a URL.
    { type: "label", name: "shareOpenGraphImage", valueType: "url", hasUserValue: true },
    { type: "label", name: "shareAlias", valueType: "text", hasUserValue: true },
    { type: "label", name: "shareOmitDefaultCss", valueType: "boolean" },
    { type: "label", name: "shareRoot", valueType: "boolean" },
    { type: "label", name: "shareDescription", valueType: "textarea" },
    { type: "label", name: "shareRaw", valueType: "boolean", isDangerous: true },
    { type: "label", name: "shareDisallowRobotIndexing", valueType: "boolean" },
    { type: "label", name: "shareCredentials", valueType: "text", hasUserValue: true },
    { type: "label", name: "shareIndex", valueType: "boolean" },
    { type: "label", name: "shareHtmlLocation", valueType: "text" },

    // Attributes & scripting
    { type: "label", name: "displayRelations", valueType: "text" },
    { type: "label", name: "hideRelations", valueType: "text" },
    { type: "label", name: "titleTemplate", valueType: "text", isDangerous: true },
    { type: "label", name: "template", valueType: "boolean" },
    { type: "label", name: "snippet", valueType: "boolean" },
    { type: "label", name: "snippetDescription", valueType: "text", hasUserValue: true },
    { type: "label", name: "textSnippet", valueType: "boolean" },
    { type: "label", name: "textSnippetDescription", valueType: "text", hasUserValue: true },
    { type: "label", name: "toc", valueType: "text" },
    { type: "label", name: "color", valueType: "color" },
    { type: "label", name: "keepCurrentHoisting", valueType: "boolean" },
    { type: "label", name: "executeButton", valueType: "boolean" },
    { type: "label", name: "executeDescription", valueType: "text" },
    { type: "label", name: "executeTitle", valueType: "text", hasUserValue: true },
    { type: "label", name: "newNotesOnTop", valueType: "boolean" },
    { type: "label", name: "clipperInbox", valueType: "boolean" },
    { type: "label", name: "clipType", valueType: "text" },
    { type: "label", name: "sentFromSender", valueType: "boolean" },
    { type: "label", name: "hideChildrenOverview", valueType: "boolean" },
    { type: "label", name: "mediaNotesPlayMode", valueType: "text" },
    { type: "label", name: "collection", valueType: "boolean" },
    { type: "label", name: "webViewSrc", valueType: "url", isDangerous: true },
    { type: "label", name: "hideHighlightWidget", valueType: "boolean" },
    { type: "label", name: "iconPack", valueType: "text", isDangerous: true },
    { type: "label", name: "docName", valueType: "text", isDangerous: true },
    { type: "label", name: "docUrl", valueType: "url", isDangerous: true },
    { type: "label", name: "language", valueType: "text", hasUserValue: true },
    { type: "label", name: "originalFileName", valueType: "text", hasUserValue: true },
    { type: "label", name: "pageUrl", valueType: "url", hasUserValue: true },
    { type: "label", name: "command", valueType: "text", hasUserValue: true },
    { type: "label", name: "displayMode", valueType: "text", hasUserValue: true },

    // Search
    { type: "label", name: "searchString", valueType: "text", hasUserValue: true },
    { type: "label", name: "ancestorDepth", valueType: "text", hasUserValue: true },
    { type: "label", name: "orderBy", valueType: "text", hasUserValue: true },
    { type: "label", name: "orderDirection", valueType: "text", hasUserValue: true },
    { type: "label", name: "limit", valueType: "text", hasUserValue: true },
    { type: "label", name: "fastSearch", valueType: "boolean" },
    { type: "label", name: "includeArchivedNotes", valueType: "boolean" },
    { type: "label", name: "debug", valueType: "boolean" },

    // Launch bar, and the hidden subtree items that back it
    { type: "label", name: "launcherType", valueType: "text" },
    { type: "label", name: "builtinWidget", valueType: "text" },
    // Dangerous together with `~script` below: it makes the launcher run its own content instead, so
    // neutralising only the relation would leave this as a way around it.
    { type: "label", name: "scriptInLauncherContent", valueType: "boolean", isDangerous: true },
    { type: "label", name: "baseSize", valueType: "number" },
    { type: "label", name: "growthFactor", valueType: "number" },
    { type: "label", name: "desktopOnly", valueType: "boolean" },
    { type: "label", name: "electronOnly", valueType: "boolean" },
    { type: "label", name: "serverOnly", valueType: "boolean" },
    { type: "label", name: "beta", valueType: "boolean" },

    // Recorded on import, to trace a note back to where it came from
    { type: "label", name: "oneNotePageId", valueType: "text", hasUserValue: true },
    { type: "label", name: "oneNoteSectionId", valueType: "text", hasUserValue: true },
    { type: "label", name: "oneNoteImportFailed", valueType: "boolean" },

    // Collections
    { type: "label", name: "status", valueType: "text", hasUserValue: true },
    { type: "label", name: "board:groupBy", valueType: "text", hasUserValue: true },
    // Carried by the task-state definition notes under `_taskStates`, which back the board columns.
    { type: "label", name: "stateId", valueType: "text", hasUserValue: true },
    { type: "label", name: "markdownSymbol", valueType: "text" },
    { type: "label", name: "isCompleted", valueType: "boolean" },
    { type: "label", name: "isHidden", valueType: "boolean" },
    { type: "label", name: "maxNestingDepth", valueType: "number", hasUserValue: true },
    { type: "label", name: "includeArchived", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "calendar:view", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:initialDate", valueType: "date", hasUserValue: true },
    { type: "label", name: "calendar:hideWeekends", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "calendar:weekNumbers", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "calendar:slotDuration", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:slotLabelInterval", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:title", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:displayedAttributes", valueType: "text", hasUserValue: true },
    // Each names the label an event reads a given field from, overriding the default listed after it.
    { type: "label", name: "calendar:startDate", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:endDate", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:startTime", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:endTime", valueType: "text", hasUserValue: true },
    { type: "label", name: "calendar:recurrence", valueType: "text", hasUserValue: true },
    { type: "label", name: "startDate", valueType: "date", hasUserValue: true },
    { type: "label", name: "endDate", valueType: "date", hasUserValue: true },
    { type: "label", name: "startTime", valueType: "time", hasUserValue: true },
    { type: "label", name: "endTime", valueType: "time", hasUserValue: true },
    { type: "label", name: "recurrence", valueType: "text", hasUserValue: true },
    { type: "label", name: "geolocation", valueType: "text", hasUserValue: true },
    { type: "label", name: "mapType", valueType: "text", hasUserValue: true },
    { type: "label", name: "map:style", valueType: "text", hasUserValue: true },
    { type: "label", name: "map:scale", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "map:hideLabels", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "presentation:theme", valueType: "text", hasUserValue: true },
    { type: "label", name: "slide:background", valueType: "text", hasUserValue: true },

    // Code notes
    { type: "label", name: "tabWidth", valueType: "number" },
    { type: "label", name: "indentWithTabs", valueType: "boolean" },
    { type: "label", name: "wrapLines", valueType: "boolean" },

    // Printing
    { type: "label", name: "printLandscape", valueType: "boolean" },
    { type: "label", name: "printPageSize", valueType: "text" },
    { type: "label", name: "printScale", valueType: "text" },
    { type: "label", name: "printMargins", valueType: "text" },
    { type: "label", name: "internalBookmark", valueType: "boolean" },

    // relation names
    { type: "relation", name: "internalLink" },
    { type: "relation", name: "imageLink" },
    { type: "relation", name: "relationMapLink" },
    { type: "relation", name: "includeNoteLink" },
    { type: "relation", name: "runOnNoteCreation", isDangerous: true },
    { type: "relation", name: "runOnNoteTitleChange", isDangerous: true },
    { type: "relation", name: "runOnNoteChange", isDangerous: true },
    { type: "relation", name: "runOnNoteContentChange", isDangerous: true },
    { type: "relation", name: "runOnNoteDeletion", isDangerous: true },
    { type: "relation", name: "runOnBranchCreation", isDangerous: true },
    { type: "relation", name: "runOnBranchChange", isDangerous: true },
    { type: "relation", name: "runOnBranchDeletion", isDangerous: true },
    { type: "relation", name: "runOnChildNoteCreation", isDangerous: true },
    { type: "relation", name: "runOnAttributeCreation", isDangerous: true },
    { type: "relation", name: "runOnAttributeChange", isDangerous: true },
    { type: "relation", name: "template" },
    { type: "relation", name: "inherit" },
    // Set on a journal root, to be applied as `~template` on each note the period generates.
    { type: "relation", name: "dateTemplate" },
    { type: "relation", name: "weekTemplate" },
    { type: "relation", name: "monthTemplate" },
    { type: "relation", name: "quarterTemplate" },
    { type: "relation", name: "yearTemplate" },
    { type: "relation", name: "widget", isDangerous: true },
    { type: "relation", name: "renderNote", isDangerous: true },
    { type: "relation", name: "searchScript", isDangerous: true },
    { type: "relation", name: "ancestor" },
    { type: "relation", name: "target" },
    // Both execute a script, unlike the handlers above only once the user opens or clicks something.
    // Flagged all the same, so a safe import cannot leave one primed behind a single keystroke.
    { type: "relation", name: "script", isDangerous: true },
    { type: "relation", name: "hoistedNote" },
    { type: "relation", name: "shareCss" },
    { type: "relation", name: "shareLogo" },
    { type: "relation", name: "shareOpenGraphImage" },
    { type: "relation", name: "shareJs", isDangerous: true },
    { type: "relation", name: "shareHtml", isDangerous: true },
    { type: "relation", name: "shareTemplate", isDangerous: true },
    { type: "relation", name: "shareFavicon" }
] as const satisfies readonly (BuiltinLabel | BuiltinRelation)[];

/**
 * Exported under the interface rather than the literal-preserving `as const` type: an entry that omits
 * an optional field would otherwise not have it at all, making `attr.isDangerous` a type error across
 * the union. The literal types remain available internally, for the name unions below.
 */
export default BUILTIN_ATTRIBUTES as readonly (BuiltinLabel | BuiltinRelation)[];

type BuiltinAttributeEntry = (typeof BUILTIN_ATTRIBUTES)[number];
type LabelEntry = Extract<BuiltinAttributeEntry, { type: "label" }>;
type RelationEntry = Extract<BuiltinAttributeEntry, { type: "relation" }>;

/**
 * The `disabled:`-prefixed forms of the dangerous entries in `T`, which is how a dangerous attribute is
 * neutralised without losing its value. Derived rather than enumerated, so marking an attribute
 * dangerous is enough to make its disabled form known to the type system.
 */
type DisabledForms<T extends { name: string }> = `disabled:${Extract<T, { isDangerous: true }>["name"]}`;

/**
 * What each label type is read as in TypeScript. Written as a mapped type over {@link LabelType} so a
 * type added to that vocabulary cannot be left without a reading here.
 */
type ValueTypeToTs = {
    [K in LabelType]: K extends "boolean" ? boolean : K extends "number" ? number : string;
};

/** The label types read as `U`, e.g. every string-ish one — `text`, `url`, `color`, … — for `string`. */
type ValueTypeNamesFor<U> = {
    [K in LabelType]: ValueTypeToTs[K] extends U ? K : never;
}[LabelType];

type LabelsWithValueType<U> = Extract<LabelEntry, { valueType: ValueTypeNamesFor<U> }>;

export type LabelNames = LabelEntry["name"] | DisabledForms<LabelEntry>;
export type RelationNames = RelationEntry["name"] | DisabledForms<RelationEntry>;

/** The names of the labels whose value is read as `U`, e.g. `FilterLabelsByType<boolean>` for flags. */
export type FilterLabelsByType<U> = LabelsWithValueType<U>["name"] | DisabledForms<LabelsWithValueType<U>>;
