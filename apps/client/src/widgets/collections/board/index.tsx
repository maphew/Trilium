import "./index.css";

import { createContext, TargetedKeyboardEvent } from "preact";
import { Dispatch, StateUpdater, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { perfLog, perfSpan } from "../../../services/debug_perf";
import { t } from "../../../services/i18n";
import type LoadResults from "../../../services/load_results";
import { isIMEComposing } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import CollectionProperties from "../../note_bars/CollectionProperties";
import FormTextArea from "../../react/FormTextArea";
import FormTextBox from "../../react/FormTextBox";
import { useNoteLabelBoolean, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import { onWheelHorizontalScroll } from "../../widget_utils";
import { ViewModeProps } from "../interface";
import Api from "./api";
import BoardApi from "./api";
import { DEFAULT_GROUP_BY, getStatusDefinition } from "./columns";
import Column from "./column";
import { ColumnMap, getBoardData } from "./data";

export interface BoardViewData {
    columns?: BoardColumnData[];
}

export interface BoardColumnData {
    value: string;
}

interface BoardViewContextData {
    api?: BoardApi;
    parentNote?: FNote;
    branchIdToEdit?: string;
    columnNameToEdit?: string;
    setColumnNameToEdit?: Dispatch<StateUpdater<string | undefined>>;
    setBranchIdToEdit?: Dispatch<StateUpdater<string | undefined>>;
    draggedColumn: { column: string, index: number } | null;
    setDraggedColumn: (column: { column: string, index: number } | null) => void;
    dropPosition: { column: string, index: number } | null;
    setDropPosition: (position: { column: string, index: number } | null) => void;
    setDropTarget: (target: string | null) => void,
    dropTarget: string | null;
    draggedCard: { noteId: string, branchId: string, fromColumn: string, index: number } | null;
    setDraggedCard: Dispatch<StateUpdater<{ noteId: string; branchId: string; fromColumn: string; index: number; } | null>>;
}

export const BoardViewContext = createContext<BoardViewContextData | undefined>(undefined);

export default function BoardView({ note: parentNote, noteIds, viewConfig, saveConfig }: ViewModeProps<BoardViewData>) {
    const [ statusAttributeWithPrefix ] = useNoteLabelWithDefault(parentNote, "board:groupBy", DEFAULT_GROUP_BY);
    const [ includeArchived ] = useNoteLabelBoolean(parentNote, "includeArchived");
    const [ byColumn, setByColumn ] = useState<ColumnMap>();
    const [ columns, setColumns ] = useState<string[]>();
    const [ isInRelationMode, setIsRelationMode ] = useState(false);
    const [ draggedCard, setDraggedCard ] = useState<{ noteId: string, branchId: string, fromColumn: string, index: number } | null>(null);
    const [ dropTarget, setDropTarget ] = useState<string | null>(null);
    const [ dropPosition, setDropPosition ] = useState<{ column: string, index: number } | null>(null);
    const [ draggedColumn, setDraggedColumn ] = useState<{ column: string, index: number } | null>(null);
    const [ columnDropPosition, setColumnDropPosition ] = useState<number | null>(null);
    const [ columnHoverIndex, setColumnHoverIndex ] = useState<number | null>(null);
    const [ branchIdToEdit, setBranchIdToEdit ] = useState<string>();
    const [ columnNameToEdit, setColumnNameToEdit ] = useState<string>();
    /** Bumped when the definition changes, since it is read off the note rather than held in state. */
    const [ definitionRevision, setDefinitionRevision ] = useState(0);
    const statusDefinition = useMemo(
        () => getStatusDefinition(parentNote, statusAttributeWithPrefix),
        [ parentNote, statusAttributeWithPrefix, definitionRevision ]);
    const api = useMemo(() => {
        return new Api(byColumn, columns ?? [], parentNote, statusAttributeWithPrefix, viewConfig ?? {}, saveConfig, setBranchIdToEdit, statusDefinition );
    }, [ byColumn, columns, parentNote, statusAttributeWithPrefix, viewConfig, saveConfig, setBranchIdToEdit, statusDefinition ]);
    const boardViewContext = useMemo<BoardViewContextData>(() => ({
        api,
        parentNote,
        branchIdToEdit, setBranchIdToEdit,
        columnNameToEdit, setColumnNameToEdit,
        draggedColumn, setDraggedColumn,
        dropPosition, setDropPosition,
        draggedCard, setDraggedCard,
        dropTarget, setDropTarget
    }), [
        api,
        parentNote,
        branchIdToEdit, setBranchIdToEdit,
        columnNameToEdit, setColumnNameToEdit,
        draggedColumn, setDraggedColumn,
        dropPosition, setDropPosition,
        draggedCard, setDraggedCard,
        dropTarget, setDropTarget
    ]);

    /**
     * Closed by the layout effect below rather than at the end of `refresh()`, so the span covers
     * the commit the refresh causes and not just the state write, which Preact defers.
     */
    const renderSpanRef = useRef<(() => void) | null>(null);

    useLayoutEffect(() => {
        renderSpanRef.current?.();
        renderSpanRef.current = null;
    });

    function refresh() {
        const endData = perfSpan("board.getBoardData");
        getBoardData(parentNote, statusAttributeWithPrefix, viewConfig ?? {}, includeArchived, statusDefinition?.options ?? [])
            .then(({ byColumn, columns, newPersistedData, isInRelationMode }) => {
                endData();
                setByColumn(byColumn);
                setIsRelationMode(isInRelationMode);
                setColumns(columns);

                if (newPersistedData) {
                    viewConfig = { ...newPersistedData };
                    saveConfig(newPersistedData);
                }

                // The columns the board settled on are the options its definition should offer. This
                // is what gives a board created after migration 0240 ran a definition at all, and what
                // keeps one that gained a column from outside the board's own UI up to date. It writes
                // only when the two actually differ, so the re-render its own write causes stops here.
                // Reported rather than surfaced: nothing the user did is failing, and a board that
                // cannot write it re-tries on the next render, which would toast on each one.
                api.syncColumnsToDefinition(columns)
                    .catch((e) => console.error("Failed to sync the board columns to the attribute definition:", e));
            });
    }

    useEffect(refresh, [ parentNote, noteIds, viewConfig, statusAttributeWithPrefix, statusDefinition ]);

    const handleColumnDrop = useCallback((fromIndex: number, toIndex: number) => {
        const newColumns = api.reorderColumn(fromIndex, toIndex);
        if (newColumns) {
            setColumns(newColumns);
        }
        setDraggedColumn(null);
        setDraggedCard(null);
        setColumnDropPosition(null);
    }, [api]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // The column list is read off the definition, which may be edited from the attribute panel,
        // another split, or a synced instance. Re-reading it re-runs the refresh through the effect.
        if (loadResults.getAttributeRows().some(attr => attr.name === `label:${api.statusAttribute}`)) {
            setDefinitionRevision(revision => revision + 1);
        }

        const endMatch = perfSpan("board.matchRefreshReason");
        const reason = findRefreshReason(loadResults, api.statusAttribute, noteIds, parentNote.noteId);
        endMatch();

        if (reason) {
            // Logged when the redraw lands rather than when it starts, so each line carries its own
            // cost. A STALL line cannot answer that on a saturated main thread -- it spans every
            // redraw that fell inside one contiguous busy period.
            const endRefresh = perfSpan(`board.refreshToPaint[${reason}]`);
            renderSpanRef.current = () => perfLog("board.refreshToPaint", {
                reason,
                ms: Math.round(endRefresh()),
                cards: noteIds.length,
                changedNotes: loadResults.getNoteIds().length
            });

            refresh();
        }
    });

    const handleColumnDragOver = useCallback((e: DragEvent) => {
        if (!draggedColumn) return;
        e.preventDefault();
    }, [draggedColumn]);

    const handleColumnHover = useCallback((index: number, mouseX: number, columnRect: DOMRect) => {
        if (!draggedColumn) return;

        const columnMiddle = columnRect.left + columnRect.width / 2;

        // Determine if we should insert before or after this column
        const insertBefore = mouseX < columnMiddle;

        // Calculate the target position
        const targetIndex = insertBefore ? index : index + 1;

        setColumnDropPosition(targetIndex);
    }, [draggedColumn]);

    const handleContainerDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (draggedColumn && columnDropPosition !== null) {
            handleColumnDrop(draggedColumn.index, columnDropPosition);
        }
        setColumnHoverIndex(null);
    }, [draggedColumn, columnDropPosition, handleColumnDrop]);

    return (
        <div className="board-view">
            <CollectionProperties note={parentNote} />
            <BoardViewContext.Provider value={boardViewContext}>
                {byColumn && columns && <div
                    className="board-view-container"
                    onDragOver={handleColumnDragOver}
                    onDrop={handleContainerDrop}
                    onWheel={onWheelHorizontalScroll}
                >
                    {columns.map((column, index) => (
                        <>
                            {columnDropPosition === index && (
                                <div className="column-drop-placeholder show" />
                            )}
                            <Column
                                isInRelationMode={isInRelationMode}
                                api={api}
                                column={column}
                                columnIndex={index}
                                columnItems={byColumn.get(column)}
                                isDraggingColumn={draggedColumn?.column === column}
                                onColumnHover={handleColumnHover}
                                isAnyColumnDragging={!!draggedColumn}
                            />
                        </>
                    ))}
                    {columnDropPosition === columns?.length && draggedColumn && (
                        <div className="column-drop-placeholder show" />
                    )}

                    <AddNewColumn api={api} isInRelationMode={isInRelationMode} />
                </div>}
            </BoardViewContext.Provider>
        </div>
    );
}

/**
 * Names the first change in `loadResults` that the board has to redraw for, or null if none does.
 *
 * The checks are the same ones, in the same short-circuit order, that used to be `||`-chained
 * inline; naming the winner is what lets the profiler attribute a redraw to a cause instead of
 * reporting only that one happened.
 */
function findRefreshReason(loadResults: LoadResults, statusAttribute: string, noteIds: string[], parentNoteId: string): string | null {
    // A card moved between columns.
    if (loadResults.getAttributeRows().some(attr => attr.name === statusAttribute && noteIds.includes(attr.noteId ?? ""))) {
        return "status-attribute";
    }

    // Intended as "a card's title changed", but getNoteIds() reports every note in the change set,
    // so a plain content save of a card lands here too.
    if (loadResults.getNoteIds().some(noteId => noteIds.includes(noteId))) {
        return "note-row";
    }

    // Subchildren moved, added or removed.
    if (loadResults.getBranchRows().some(branch => noteIds.includes(branch.noteId ?? ""))) {
        return "branch";
    }

    if (loadResults.getAttributeRows().some(attr => [ "iconClass", "color" ].includes(attr.name ?? "") && noteIds.includes(attr.noteId ?? ""))) {
        return "icon-or-color";
    }

    // External changes to the board.json attachment arrive via the viewConfig prop
    // (see useViewModeConfig), which re-triggers the refresh effect.
    if (loadResults.getAttributeRows().some(attr => attr.name === "board:groupBy" && attr.noteId === parentNoteId)) {
        return "group-by";
    }

    return null;
}

function AddNewColumn({ api, isInRelationMode }: { api: BoardApi, isInRelationMode: boolean }) {
    const [ isCreatingNewColumn, setIsCreatingNewColumn ] = useState(false);

    const addColumnCallback = useCallback(() => {
        setIsCreatingNewColumn(true);
    }, []);

    const keydownCallback = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter") {
            setIsCreatingNewColumn(true);
        }
    }, []);

    return (
        <div
            className={`board-add-column ${isCreatingNewColumn ? "editing" : ""}`}
            onClick={addColumnCallback}
            onKeyDown={keydownCallback}
            tabIndex={300}
        >
            {!isCreatingNewColumn
                ? <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.add-column")}
                </>
                : (
                    <TitleEditor
                        placeholder={t("board_view.add-column-placeholder")}
                        save={async (columnName) => {
                            const created = await api.addNewColumn(columnName);
                            if (!created) {
                                toast.showMessage(t("board_view.column-already-exists"), undefined, "bx bx-duplicate");
                            }
                        }}
                        dismiss={() => setIsCreatingNewColumn(false)}
                        isNewItem
                        mode={isInRelationMode ? "relation" : "normal"}
                    />
                )}
        </div>
    );
}

export function TitleEditor({ currentValue, placeholder, save, dismiss, mode, isNewItem }: {
    currentValue?: string;
    placeholder?: string;
    save: (newValue: string) => void | Promise<void>;
    dismiss: () => void;
    isNewItem?: boolean;
    mode?: "normal" | "multiline" | "relation";
}) {
    const inputRef = useRef<any>(null);
    const focusElRef = useRef<Element>(null);
    const dismissOnNextRefreshRef = useRef(false);
    const shouldDismiss = useRef(false);

    useEffect(() => {
        focusElRef.current = document.activeElement !== document.body ? document.activeElement : null;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [ inputRef ]);

    useEffect(() => {
        if (dismissOnNextRefreshRef.current) {
            dismiss();
            dismissOnNextRefreshRef.current = false;
        }
    });

    const onKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement> | KeyboardEvent) => {
        // Skip processing during IME composition so the Enter that commits a
        // CJK conversion does not also save the title with unconfirmed text.
        if (isIMEComposing(e)) {
            return;
        }

        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (focusElRef.current instanceof HTMLElement) {
                shouldDismiss.current = (e.key === "Escape");
                focusElRef.current.focus();
            } else {
                dismiss();
            }
        }
    };

    const onBlur = (newValue: string) => {
        if (!shouldDismiss.current && newValue.trim() && (newValue !== currentValue || isNewItem)) {
            save(newValue);
            dismissOnNextRefreshRef.current = true;
        } else {
            dismiss();
        }
    };

    if (mode !== "relation") {
        const Element = mode === "multiline" ? FormTextArea : FormTextBox;

        return (
            <Element
                inputRef={inputRef}
                currentValue={currentValue ?? ""}
                placeholder={placeholder}
                autoComplete="trilium-title-entry" // forces the auto-fill off better than the "off" value.
                rows={mode === "multiline" ? 4 : undefined}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
            />
        );
    }
    return (
        <NoteAutocomplete
            inputRef={inputRef}
            noteId={currentValue ?? ""}
            opts={{
                hideAllButtons: true,
                allowCreatingNotes: true
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    dismiss();
                }
            }}
            onBlur={() => dismiss()}
            noteIdChanged={(newValue) => {
                save(newValue);
                dismiss();
            }}
        />
    );

}
