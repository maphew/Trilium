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
     * The shape the label's value is read as. Not enforced at runtime — attribute values are always
     * stored as strings — but it types the `useNoteLabel*` hooks via {@link FilterLabelsByType}.
     */
    valueType: "boolean" | "string" | "number";
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
    { type: "label", name: "calendarRoot", valueType: "boolean" },
    { type: "label", name: "archived", valueType: "boolean" },
    { type: "label", name: "excludeFromExport", valueType: "boolean" },
    { type: "label", name: "disableInclusion", valueType: "boolean" },
    { type: "label", name: "appCss", valueType: "boolean" },
    { type: "label", name: "appTheme", valueType: "string" },
    { type: "label", name: "appThemeBase", valueType: "string" },
    { type: "label", name: "hidePromotedAttributes", valueType: "boolean" },
    { type: "label", name: "readOnly", valueType: "boolean" },
    { type: "label", name: "autoReadOnlyDisabled", valueType: "boolean" },
    { type: "label", name: "cssClass", valueType: "string" },
    { type: "label", name: "iconClass", valueType: "string" },
    { type: "label", name: "keyboardShortcut", valueType: "string" },
    { type: "label", name: "run", valueType: "string", isDangerous: true },
    { type: "label", name: "runOnInstance", valueType: "string", isDangerous: false },
    { type: "label", name: "runAtHour", valueType: "number", isDangerous: false },
    { type: "label", name: "customRequestHandler", valueType: "string", isDangerous: true },
    { type: "label", name: "customResourceProvider", valueType: "string", isDangerous: true },
    { type: "label", name: "widget", valueType: "boolean", isDangerous: true },
    { type: "label", name: "similarNotesWidgetDisabled", valueType: "boolean" },
    { type: "label", name: "workspace", valueType: "boolean" },
    { type: "label", name: "workspaceIconClass", valueType: "string" },
    { type: "label", name: "workspaceTabBackgroundColor", valueType: "string" },
    { type: "label", name: "workspaceCalendarRoot", valueType: "boolean" },
    { type: "label", name: "workspaceTemplate", valueType: "boolean" },
    { type: "label", name: "searchHome", valueType: "boolean" },
    { type: "label", name: "workspaceInbox", valueType: "boolean" },
    { type: "label", name: "workspaceSearchHome", valueType: "boolean" },
    { type: "label", name: "sqlConsoleHome", valueType: "boolean" },
    { type: "label", name: "datePattern", valueType: "string" },
    { type: "label", name: "weekPattern", valueType: "string" },
    { type: "label", name: "enableWeekNote", valueType: "boolean" },
    { type: "label", name: "monthPattern", valueType: "string" },
    { type: "label", name: "quarterPattern", valueType: "string" },
    { type: "label", name: "yearPattern", valueType: "string" },
    { type: "label", name: "enableQuarterNote", valueType: "boolean" },
    // Stamped onto each generated journal note, holding the period it stands for.
    { type: "label", name: "dateNote", valueType: "string", hasUserValue: true },
    { type: "label", name: "weekNote", valueType: "string", hasUserValue: true },
    { type: "label", name: "monthNote", valueType: "string", hasUserValue: true },
    { type: "label", name: "quarterNote", valueType: "string", hasUserValue: true },
    { type: "label", name: "yearNote", valueType: "string", hasUserValue: true },
    { type: "label", name: "pageSize", valueType: "number" },
    { type: "label", name: "viewType", valueType: "string" },
    { type: "label", name: "mapRootNoteId", valueType: "string" },
    { type: "label", name: "mapExcludeRelation", valueType: "string" },
    { type: "label", name: "mapIncludeRelation", valueType: "string" },
    { type: "label", name: "bookmarkFolder", valueType: "boolean" },
    { type: "label", name: "sorted", valueType: "boolean" },
    { type: "label", name: "sortDirection", valueType: "string" },
    { type: "label", name: "sortFoldersFirst", valueType: "boolean" },
    { type: "label", name: "sortNatural", valueType: "boolean" },
    { type: "label", name: "sortLocale", valueType: "string" },
    { type: "label", name: "top", valueType: "boolean" },
    { type: "label", name: "bottom", valueType: "boolean" },
    { type: "label", name: "fullContentWidth", valueType: "boolean" },
    { type: "label", name: "subtreeHidden", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "expanded", valueType: "string", hasUserValue: true },

    // Sharing
    { type: "label", name: "shareHiddenFromTree", valueType: "boolean" },
    { type: "label", name: "shareExternalLink", valueType: "boolean" },
    { type: "label", name: "shareAlias", valueType: "string", hasUserValue: true },
    { type: "label", name: "shareOmitDefaultCss", valueType: "boolean" },
    { type: "label", name: "shareRoot", valueType: "boolean" },
    { type: "label", name: "shareDescription", valueType: "string" },
    { type: "label", name: "shareRaw", valueType: "boolean", isDangerous: true },
    { type: "label", name: "shareDisallowRobotIndexing", valueType: "boolean" },
    { type: "label", name: "shareCredentials", valueType: "string", hasUserValue: true },
    { type: "label", name: "shareIndex", valueType: "boolean" },
    { type: "label", name: "shareHtmlLocation", valueType: "string" },

    // Attributes & scripting
    { type: "label", name: "displayRelations", valueType: "string" },
    { type: "label", name: "hideRelations", valueType: "string" },
    { type: "label", name: "titleTemplate", valueType: "string", isDangerous: true },
    { type: "label", name: "template", valueType: "boolean" },
    { type: "label", name: "snippet", valueType: "boolean" },
    { type: "label", name: "textSnippet", valueType: "boolean" },
    { type: "label", name: "toc", valueType: "string" },
    { type: "label", name: "color", valueType: "string" },
    { type: "label", name: "keepCurrentHoisting", valueType: "boolean" },
    { type: "label", name: "executeButton", valueType: "boolean" },
    { type: "label", name: "executeDescription", valueType: "string" },
    { type: "label", name: "executeTitle", valueType: "string", hasUserValue: true },
    { type: "label", name: "newNotesOnTop", valueType: "boolean" },
    { type: "label", name: "clipperInbox", valueType: "boolean" },
    { type: "label", name: "webViewSrc", valueType: "string", isDangerous: true },
    { type: "label", name: "hideHighlightWidget", valueType: "boolean" },
    { type: "label", name: "iconPack", valueType: "string", isDangerous: true },
    { type: "label", name: "docName", valueType: "string", isDangerous: true },
    { type: "label", name: "docUrl", valueType: "string", isDangerous: true },
    { type: "label", name: "language", valueType: "string", hasUserValue: true },
    { type: "label", name: "originalFileName", valueType: "string", hasUserValue: true },
    { type: "label", name: "pageUrl", valueType: "string", hasUserValue: true },
    { type: "label", name: "command", valueType: "string", hasUserValue: true },
    { type: "label", name: "displayMode", valueType: "string", hasUserValue: true },

    // Search
    { type: "label", name: "searchString", valueType: "string", hasUserValue: true },
    { type: "label", name: "ancestorDepth", valueType: "string", hasUserValue: true },
    { type: "label", name: "orderBy", valueType: "string", hasUserValue: true },
    { type: "label", name: "orderDirection", valueType: "string", hasUserValue: true },
    { type: "label", name: "limit", valueType: "string", hasUserValue: true },

    // Collections
    { type: "label", name: "status", valueType: "string", hasUserValue: true },
    { type: "label", name: "board:groupBy", valueType: "string", hasUserValue: true },
    { type: "label", name: "maxNestingDepth", valueType: "number", hasUserValue: true },
    { type: "label", name: "includeArchived", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "calendar:view", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:initialDate", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:hideWeekends", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "calendar:weekNumbers", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "calendar:slotDuration", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:slotLabelInterval", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:title", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:displayedAttributes", valueType: "string", hasUserValue: true },
    // Each names the label an event reads a given field from, overriding the default listed after it.
    { type: "label", name: "calendar:startDate", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:endDate", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:startTime", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:endTime", valueType: "string", hasUserValue: true },
    { type: "label", name: "calendar:recurrence", valueType: "string", hasUserValue: true },
    { type: "label", name: "startDate", valueType: "string", hasUserValue: true },
    { type: "label", name: "endDate", valueType: "string", hasUserValue: true },
    { type: "label", name: "startTime", valueType: "string", hasUserValue: true },
    { type: "label", name: "endTime", valueType: "string", hasUserValue: true },
    { type: "label", name: "recurrence", valueType: "string", hasUserValue: true },
    { type: "label", name: "geolocation", valueType: "string", hasUserValue: true },
    { type: "label", name: "mapType", valueType: "string", hasUserValue: true },
    { type: "label", name: "map:style", valueType: "string", hasUserValue: true },
    { type: "label", name: "map:scale", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "map:hideLabels", valueType: "boolean", hasUserValue: true },
    { type: "label", name: "presentation:theme", valueType: "string", hasUserValue: true },
    { type: "label", name: "slide:background", valueType: "string", hasUserValue: true },

    // Code notes
    { type: "label", name: "tabWidth", valueType: "number" },
    { type: "label", name: "indentWithTabs", valueType: "boolean" },
    { type: "label", name: "wrapLines", valueType: "boolean" },

    // Printing
    { type: "label", name: "printLandscape", valueType: "boolean" },
    { type: "label", name: "printPageSize", valueType: "string" },
    { type: "label", name: "printScale", valueType: "string" },
    { type: "label", name: "printMargins", valueType: "string" },
    { type: "label", name: "internalBookmark", valueType: "boolean" },

    // relation names
    { type: "relation", name: "internalLink" },
    { type: "relation", name: "imageLink" },
    { type: "relation", name: "relationMapLink" },
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
    { type: "relation", name: "searchScript" },
    { type: "relation", name: "ancestor" },
    { type: "relation", name: "target" },
    { type: "relation", name: "shareCss" },
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

/** Maps a value type back onto the {@link BuiltinLabel.valueType} discriminant that stands for it. */
type ValueTypeName<U> = U extends boolean ? "boolean" : U extends number ? "number" : U extends string ? "string" : never;

type LabelsWithValueType<U> = Extract<LabelEntry, { valueType: ValueTypeName<U> }>;

export type LabelNames = LabelEntry["name"] | DisabledForms<LabelEntry>;
export type RelationNames = RelationEntry["name"] | DisabledForms<RelationEntry>;

/** The names of the labels whose value is read as `U`, e.g. `FilterLabelsByType<boolean>` for flags. */
export type FilterLabelsByType<U> = LabelsWithValueType<U>["name"] | DisabledForms<LabelsWithValueType<U>>;
