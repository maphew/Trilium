import "./content_manager.css";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import {
    CONTENT_CATEGORIES,
    type ContentCategory,
    type ContentSortOrder,
    findCategoryNotes
} from "../../../services/content_manager";
import { t } from "../../../services/i18n";
import Button, { ButtonGroup } from "../../react/Button";
import { useTriliumEvent, useTriliumOption } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import NoteLink from "../../react/NoteLink";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsSection from "./components/OptionsSection";

export default function ContentManagerSettings() {
    const [ sortOrder, setSortOrder ] = useTriliumOption("contentManagerSortOrder");
    const categories = useCategoryNotes(sortOrder as ContentSortOrder);
    const isEmpty = categories.every(({ notes }) => !notes.length);

    return (
        <>
            <OptionsPageHeader />

            <div className="content-manager-toolbar">
                <span className="content-manager-toolbar-label">{t("content_manager.sort_order")}</span>
                <SortOrderSelect currentValue={sortOrder} onChange={(newValue) => void setSortOrder(newValue)} />
            </div>

            {isEmpty
                ? <NoItems icon="bx bx-package" text={t("content_manager.no_items")}>
                    <small>{t("content_manager.no_items_hint")}</small>
                </NoItems>
                : categories.map(({ category, notes }) => notes.length > 0 && (
                    <OptionsSection key={category.id} title={t(category.titleKey)}>
                        <div className="content-manager-items">
                            {notes.map((note) => (
                                <p key={note.noteId} className="content-manager-item">
                                    <NoteLink notePath={note.noteId} showNoteIcon showNotePath />
                                </p>
                            ))}
                        </div>
                    </OptionsSection>
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
    const [ categories, setCategories ] = useState<CategoryNotes[]>(() =>
        CONTENT_CATEGORIES.map((category) => ({ category, notes: [] })));

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
