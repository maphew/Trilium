import "./content_manager.css";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import {
    CONTENT_CATEGORIES,
    type ContentCategory,
    type ContentSortOrder,
    findCategoryNotes,
    isCategoryEnabled,
    setCategoryEnabled
} from "../../../services/content_manager";
import { t } from "../../../services/i18n";
import { ListView, type ListViewOptions } from "../../collections/legacy/ListOrGridView";
import Button, { ButtonGroup } from "../../react/Button";
import FormToggle from "../../react/FormToggle";
import { useTriliumEvent, useTriliumOption } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import type { TypeWidgetProps } from "../type_widget";
import OptionsPageHeader from "./components/OptionsPageHeader";

const NOOP = () => {};

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
                        renderItemActions: (note) => <ContentToggle note={note} category={category} />
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
    { value: "title", label: t("content_manager.sort_by_name") },
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

    const refresh = useCallback(async () => {
        setCategories(await Promise.all(CONTENT_CATEGORIES.map(async (category) => ({
            category,
            notes: await findCategoryNotes(category, sortOrder)
        }))));
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
