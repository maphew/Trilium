import "./content_manager.css";

import clsx from "clsx";
import type { TargetedMouseEvent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import contextMenu, { type MenuItem } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import {
    CONTENT_CATEGORIES,
    type ContentCategory,
    type ContentSortOrder,
    findCategoryNotes,
    isCategoryEnabled,
    resolveProperties,
    setCategoryEnabled
} from "../../../services/content_manager";
import { t } from "../../../services/i18n";
import { ListView, type ListViewOptions } from "../../collections/legacy/ListOrGridView";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import FormToggle from "../../react/FormToggle";
import { useTriliumEvent, useTriliumOption } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import type { TypeWidgetProps } from "../type_widget";
import OptionsPageHeader from "./components/OptionsPageHeader";

const NOOP = () => {};

/**
 * The item's "..." menu. The collection menu is replaced here because most of its entries act on a
 * note in the context of its parent, which this list is not: these notes live all over the tree.
 */
function ContentItemMenu({ note }: { note: FNote }) {
    const openMenu = useCallback((e: TargetedMouseEvent<HTMLElement>) => {
        const items: MenuItem<ContentItemCommand>[] = [
            { title: t("link_context_menu.open_note_in_new_tab"), command: "openNoteInNewTab", uiIcon: "bx bx-link-external" },
            { title: t("tree-context-menu.delete"), command: "deleteNote", uiIcon: "bx bx-trash destructive-action-icon" }
        ];

        void contextMenu.show<ContentItemCommand>({
            x: e.pageX,
            y: e.pageY,
            items,
            selectMenuItemHandler: ({ command }) => {
                if (command === "openNoteInNewTab") {
                    void appContext.tabManager.openContextWithNote(note.noteId, {
                        hoistedNoteId: appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null
                    });
                } else if (command === "deleteNote") {
                    // Search results carry virtual branches, which cannot be deleted.
                    const [ branchId ] = note.getParentBranchIds().filter((id) => !id.startsWith("virt-"));

                    if (branchId) {
                        // Deliberately one branch, not all of them: the dialog counts a note's
                        // *other* placements to warn about clones and offer "delete all clones", so
                        // passing every branch would zero that count and delete them all silently.
                        // `moveToParent` is off — the user is on this page, not on the note.
                        void branches.deleteNotes([ branchId ], false, false);
                    }
                }
            }
        });

        e.stopPropagation();
    }, [ note ]);

    return (
        <ActionButton
            className="note-book-item-menu"
            icon="bx bx-dots-vertical-rounded" text=""
            onClick={openMenu}
        />
    );
}

type ContentItemCommand = "openNoteInNewTab" | "deleteNote";

/** Renders a note's extra detail, e.g. `Trigger: backend startup, hourly; Mode: authentic`. */
function ContentProperties({ note, category }: { note: FNote, category: ContentCategory }) {
    const properties = resolveProperties(note, category);

    if (!properties.length) return null;

    return (
        <span className="content-manager-properties">
            {properties.map(({ titleKey, values }) => (
                <span key={titleKey} className="content-manager-property">
                    <strong>{t(titleKey)}:</strong>
                    {" "}
                    {values.map((value) => value.titleKey ? t(value.titleKey) : value.text).join(", ")}
                </span>
            ))}
        </span>
    );
}

function ContentToggle({ note, category }: { note: FNote, category: ContentCategory }) {
    const [ enabled, setEnabled ] = useState(() => isCategoryEnabled(note, category));

    // Re-sync when the row is reused for another note, or the state changed elsewhere.
    useEffect(() => setEnabled(isCategoryEnabled(note, category)), [ note, category ]);

    return (
        <FormToggle
            switchOnName="" switchOffName=""
            currentValue={enabled}
            switchOnTooltip={t("content_manager.toggle_enable")}
            switchOffTooltip={t("content_manager.toggle_disable")}
            onChange={(willEnable) => {
                // Applied straight away so the switch responds before the lists are rebuilt.
                setEnabled(willEnable);
                void setCategoryEnabled(note, category, willEnable);
            }}
        />
    );
}

const LIST_OPTIONS: ListViewOptions = {
    // These notes are scattered across the tree rather than being children of this page, so they are
    // listed flat with their real location shown underneath, the way search results are.
    searchResultsLayout: true,
    hideSubNotes: true,
    // Collapsed by default: the list is meant to be scanned, and expanding reveals the note's own
    // preview rather than a subtree.
    expandDepth: 0,
    pageSize: 50
};

export default function ContentManagerSettings({ note }: TypeWidgetProps) {
    const [ sortOrder, setSortOrder ] = useTriliumOption("contentManagerSortOrder");
    const categories = useCategoryNotes(sortOrder as ContentSortOrder);

    return (
        <>
            <OptionsPageHeader />

            <div className="content-manager-toolbar">
                <span className="content-manager-toolbar-label">{t("content_manager.sort_order")}</span>
                <SortOrderSelect currentValue={sortOrder} onChange={(newValue) => void setSortOrder(newValue)} />
            </div>

            <div className="content-manager-list">
                <CategoryList pageNote={note} categories={categories} />
            </div>
        </>
    );
}

function CategoryList({ pageNote, categories }: { pageNote: FNote, categories: CategoryNotes[] | null }) {
    if (!categories) {
        return <p className="content-manager-loading">{t("content_manager.loading")}</p>;
    }

    const populated = categories.filter(({ notes }) => notes.length > 0);

    if (!populated.length) {
        return (
            <NoItems icon="bx bx-package" text={t("content_manager.no_items")}>
                <small>{t("content_manager.no_items_hint")}</small>
            </NoItems>
        );
    }

    return (
        <>
            {populated.map(({ category, notes }) => (
                <ListView
                    key={category.id}
                    note={pageNote}
                    notePath={pageNote.noteId}
                    noteIds={notes.map(({ noteId }) => noteId)}
                    highlightedTokens={null}
                    viewConfig={undefined}
                    saveConfig={NOOP}
                    media="screen"
                    onReady={NOOP}
                    listOptions={{
                        ...LIST_OPTIONS,
                        title: t(category.titleKey),
                        renderItemActions: (note) => (
                            <>
                                <ContentProperties note={note} category={category} />
                                <ContentToggle note={note} category={category} />
                            </>
                        ),
                        renderItemMenu: (note) => <ContentItemMenu note={note} />
                    }}
                />
            ))}
        </>
    );
}

function SortOrderSelect({ currentValue, onChange }: { currentValue: string, onChange: (newValue: string) => void }) {
    return (
        <ButtonGroup size="sm">
            {SORT_ORDERS.map(({ value, label }) => (
                <Button
                    key={value}
                    text={label}
                    size="small"
                    className={clsx(currentValue === value && "active")}
                    onClick={() => onChange(value)}
                />
            ))}
        </ButtonGroup>
    );
}

const SORT_ORDERS: { value: ContentSortOrder, label: string }[] = [
    { value: "title", label: t("content_manager.sort_by_title") },
    { value: "dateCreated", label: t("content_manager.sort_by_date_created") }
];

interface CategoryNotes {
    category: ContentCategory;
    notes: FNote[];
}

/**
 * Runs every category's query and keeps the results in sync with the note tree.
 *
 * One query per category is more requests than a single combined search would need, but it keeps
 * each category's definition self-contained and the counts stay far too small for the difference to
 * be noticeable.
 */
function useCategoryNotes(sortOrder: ContentSortOrder) {
    // `null` until the first search resolves, so the page can tell "still loading" apart from
    // "genuinely nothing to show" instead of flashing the empty state on every open.
    const [ categories, setCategories ] = useState<CategoryNotes[] | null>(null);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;
        const refreshed = await Promise.all(CONTENT_CATEGORIES.map(async (category) => ({
            category,
            notes: await findCategoryNotes(category, sortOrder)
        })));

        // Both the sort order and `entitiesReloaded` trigger a refresh, so two can be in flight at
        // once. Drop a superseded response instead of letting it repaint over newer results.
        if (requestId === latestRequest.current) {
            setCategories(refreshed);
        }
    }, [ sortOrder ]);

    useEffect(() => { void refresh(); }, [ refresh ]);

    // Creating, deleting or relabelling a note can add or remove entries from any category.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().length || loadResults.getNoteIds().length) {
            void refresh();
        }
    });

    return categories;
}
