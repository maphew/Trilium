import clsx from "clsx";
import { Fragment } from "preact";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";
import { JSX } from "preact/jsx-runtime";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { ContextMenuEvent } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import { getHue, parseColor } from "../../../services/css_class_manager";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { DragData, TREE_CLIPBOARD_TYPE } from "../../note_tree";
import ActionButton from "../../react/ActionButton";
import Icon from "../../react/Icon";
import { IconPickerButton } from "../../react/IconPicker";
import { useStaticTooltip } from "../../react/hooks";
import { useScrollFade } from "../../react/scroll_fade";
import NoteLink from "../../react/NoteLink";
import { BoardActionsContext, BoardDragStateContext, TitleEditor } from ".";
import BoardApi from "./api";
import Card from "./card";
import { DEFAULT_COLUMN_ICON, INBOX_COLUMN } from "./columns";
import { openColumnContextMenu } from "./context_menu";

interface DragContext {
    column: string;
    columnIndex: number,
    columnItems?: { note: FNote, branch: FBranch }[];
}

export default function Column({
    column,
    columnIndex,
    columns,
    onMoveColumn,
    onFocusColumn,
    onFocusCard,
    icon,
    color,
    archived,
    collapsed,
    isActive,
    nested,
    limit,
    columnItems,
    api,
    parentNote,
    isInRelationMode
}: {
    columnItems?: { note: FNote, branch: FBranch }[];
    /** The stored icon class, absent until one is picked. Unused in relation mode. */
    icon?: string,
    /** The stored CSS colour, absent until one is picked. */
    color?: string,
    /** Whether the column is archived. Only ever rendered while archived notes are shown. */
    archived?: boolean,
    /** Whether the column is stored as collapsed. Selecting it opens it without clearing this. */
    collapsed?: boolean,
    /** Whether this is the column the reader is working in, which opens it while it is collapsed. */
    isActive?: boolean,
    /** Whether the inbox also collects notes deeper than the board's direct children. */
    nested?: boolean,
    /** The note limit, absent if disabled. */
    limit?: number,
    api: BoardApi,
    parentNote: FNote,
    isInRelationMode: boolean,
    /** The columns as drawn, which is what the menu offers to place this one among. */
    columns: string[],
    /** Moves a column to sit before the given position, as a drag onto that position would. */
    onMoveColumn: (fromIndex: number, toIndex: number) => void,
    onFocusColumn: (column: string) => void,
    onFocusCard: (noteId: string) => void
} & DragContext) {
    const [ isCreatingNewItem, setIsCreatingNewItem ] = useState(false);
    const { setColumnNameToEdit, setColumnLimitToEdit, setActiveColumn } =
        useContext(BoardActionsContext);
    const { branchIdToEdit, columnNameToEdit, dropTarget, draggedCard, dropPosition } = useContext(BoardDragStateContext);
    const isEditing = (columnNameToEdit === column);
    const editorRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollFade = useScrollFade(contentRef);
    const { handleDragOver, handleDragLeave, handleDrop } = useDragging({
        column, columnIndex, columnItems, isEditing, api, parentNote
    });

    // Measured rather than styled: the gap stands for the card being carried, which is whatever
    // height its own content gave it. A drag from the note tree carries no card, so the stock
    // height stands.
    const gapStyle = draggedCard?.height
        ? { height: `${draggedCard.height}px` }
        : undefined;

    // Read here rather than in the badge: the column body shows an outline as well.
    const isOverLimit = limit !== undefined && (columnItems?.length ?? 0) > limit;
    const isCollapsed = !!collapsed && !isActive;

    // Reported on the way in only. A column opened by being selected closes when another one is
    // selected, so nothing here watches for focus leaving: the menu, the icon picker and the limit
    // dialog all render outside the column, and each would otherwise close it as it opened.
    const select = useCallback(() => setActiveColumn(column), [ column, setActiveColumn ]);

    // Focus reaching a column closes whichever one was open, and opens nothing: a collapsed column
    // is walked onto without being disturbed, and is opened by a click or by Space instead.
    const handleFocusIn = useCallback(() => {
        if (!isActive) {
            setActiveColumn(undefined);
        }
    }, [ isActive, setActiveColumn ]);

    const openMenu = useCallback((e: ContextMenuEvent) => {
        openColumnContextMenu(api, e, {
            value: column,
            columns,
            index: columnIndex,
            color,
            archived,
            collapsed,
            canRename: !isCollapsed,
            nested,
            onEditTitle: () => setColumnNameToEdit(column),
            onNewItem: () => setIsCreatingNewItem(true),
            onAddColumn: async (direction) => {
                setColumnNameToEdit(await api.insertColumn(column, direction));
            },
            onSetLimit: () => setColumnLimitToEdit(column),
            onCollapse: (collapse) => {
                api.setColumnCollapsed(column, collapse);
                // The menu is opened from the column, which is therefore the open one. Closing it
                // here is what shows the reader that anything happened.
                if (collapse) {
                    setActiveColumn(undefined);
                }
            },
            onMoveColumn: (toIndex) => {
                onMoveColumn(columnIndex, toIndex);
                // Asked for by name: the move draws the board again, and the heading the menu was
                // opened from is the one left standing over another column afterwards.
                onFocusColumn(column);
            }
        });
    }, [
        api, column, color, archived, collapsed, isCollapsed, nested, columns, columnIndex,
        setColumnNameToEdit, setColumnLimitToEdit, setActiveColumn, onMoveColumn, onFocusColumn
    ]);

    // A fully desaturated colour has no hue to tint with, and leaves the column plain.
    const hue = useMemo(() => {
        const parsed = color ? parseColor(color) : undefined;
        return parsed ? getHue(parsed) : undefined;
    }, [ color ]);

    const handleTitleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "F2" && !isCollapsed) {
            setColumnNameToEdit(column);
        }
    }, [ column, isCollapsed ]);

    /** Allow using mouse wheel to scroll inside card, while also maintaining column horizontal scrolling. */
    const handleScroll = useCallback((event: JSX.TargetedWheelEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        if (!el) return;

        const needsScroll = el.scrollHeight > el.clientHeight;
        if (needsScroll) {
            event.stopPropagation();
        }
    }, []);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    return (
        <div
            data-column={column}
            className={clsx("board-column", {
                "drag-over": dropTarget === column && draggedCard?.fromColumn !== column,
                // The class the themes key a hue off, worn here as anywhere else that carries one.
                "with-hue": hue !== undefined,
                "board-column-archived": archived,
                "over-limit": isOverLimit,
                collapsed: isCollapsed
            })}
            onFocusIn={handleFocusIn}
            // A click and not a press: a press may be the start of a drag, which must leave the
            // column as it is, and a drag produces no click.
            onClick={select}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ "--board-column-custom-hue": hue }}
        >
            <h3
                className={`${isEditing ? "editing" : ""}`}
                // While collapsed the header is what opens the column, so it says so and answers
                // for the keys a button answers for. Open, it is a heading again and Space does
                // nothing, so neither is claimed.
                role={isCollapsed ? "button" : undefined}
                aria-expanded={isCollapsed ? false : undefined}
                onContextMenu={openMenu}
                onKeyDown={handleTitleKeyDown}
                tabIndex={300}
            >
                {isCollapsed ? (
                    <>
                        <ActionButton
                            className="column-menu"
                            icon="bx bx-dots-vertical-rounded"
                            text={t("board_view.column-menu")}
                            onClick={(e) => {
                                e.stopPropagation();
                                openMenu(e);
                            }}
                        />
                        <CountBadge items={columnItems} limit={limit} isOver={isOverLimit} />
                        <span className="title">
                            {isInRelationMode
                                ? <NoteLink notePath={column} />
                                : api.getColumnTitle(column)}
                        </span>
                        <Icon
                            className="column-icon"
                            icon={api.getColumnIcon(column) ?? DEFAULT_COLUMN_ICON}
                        />
                    </>
                ) : (<>
                {/* In relation mode the column is a note, and NoteLink already shows that note's
                    own icon, which is not the board's to change. */}
                {!isInRelationMode && (
                    <IconPickerButton
                        className="column-icon"
                        icon={api.getColumnIcon(column) ?? DEFAULT_COLUMN_ICON}
                        title={t("board_view.change-column-icon")}
                        onSelect={(picked) => api.setColumnIcon(column, picked)}
                        onReset={icon ? () => api.setColumnIcon(column, undefined) : undefined}
                    />
                )}

                {!isEditing ? (
                    <>
                        <span
                            className="title"
                            // In relation mode the title is a link to the note the column stands
                            // for, and the first of the two clicks has already followed it.
                            onDblClick={isInRelationMode
                                ? undefined
                                : () => setColumnNameToEdit(column)}
                        >
                            {isInRelationMode
                                ? <NoteLink notePath={column} showNoteIcon />
                                : api.getColumnTitle(column)}
                        </span>
                        <div className="spacer" />
                        <CountBadge items={columnItems} limit={limit} isOver={isOverLimit} />
                        <ActionButton
                            className="column-menu"
                            icon="bx bx-dots-vertical-rounded"
                            text={t("board_view.column-menu")}
                            onClick={(e) => {
                                // The header is the column's drag handle and opens this same menu
                                // on a right click; neither should also fire from the button.
                                e.stopPropagation();
                                openMenu(e);
                            }}
                        />
                    </>
                ) : (
                    <TitleEditor
                        currentValue={api.getColumnTitle(column)}
                        save={newTitle => api.setColumnTitle(column, newTitle)}
                        dismiss={() => setColumnNameToEdit(undefined)}
                        // The inbox is renamed as text even on a relation board, where every
                        // other column is renamed by picking a note.
                        mode={isInRelationMode && column !== INBOX_COLUMN ? "relation" : "normal"}
                    />
                )}
                </>)}
            </h3>

            {!isCollapsed && <div
                ref={contentRef}
                className={clsx("board-column-content", scrollFade.className)}
                style={scrollFade.style}
                onWheel={handleScroll}
            >
                {(columnItems ?? []).map(({ note, branch }, index) => {
                    const showIndicatorBefore = dropPosition?.column === column &&
                                            dropPosition.index === index &&
                                            draggedCard?.noteId !== note.noteId;

                    return (
                        <Fragment key={note.noteId}>
                            {showIndicatorBefore && (
                                <div className="board-drop-placeholder show" style={gapStyle} />
                            )}
                            <Card
                                api={api}
                                note={note}
                                branch={branch}
                                column={column}
                                index={index}
                                isDragging={draggedCard?.noteId === note.noteId}
                                isEditing={branch.branchId === branchIdToEdit}
                                onFocusCard={onFocusCard}
                            />
                        </Fragment>
                    );
                })}
                {dropPosition?.column === column && dropPosition.index === (columnItems?.length ?? 0) && (
                    <div className="board-drop-placeholder show" style={gapStyle} />
                )}

                <AddNewItem
                    api={api}
                    column={column}
                    itemCount={columnItems?.length ?? 0}
                    isCreating={isCreatingNewItem}
                    setIsCreating={setIsCreatingNewItem}
                />
            </div>}
        </div>
    );
}

/**
 * The editor a new card is named in, opened by the button below the column or by its menu. The
 * state is the column's rather than this component's, since the menu is raised from the header.
 */
function AddNewItem({ column, api, itemCount, isCreating, setIsCreating }: {
    column: string,
    api: BoardApi,
    /** How many cards stand above it, which is what moves it out of view as they come and go. */
    itemCount: number,
    isCreating: boolean,
    setIsCreating: (isCreating: boolean) => void
}) {
    const [ initialTitle, setInitialTitle ] = useState("");
    const slotRef = useRef<HTMLDivElement>(null);

    // Reaching the button means reaching the end of the column, so what is under it comes into view
    // with it. The browser scrolls only far enough to show the button itself.
    const scrollToEnd = useCallback(() => {
        const content = slotRef.current?.closest(".board-column-content");
        if (content) {
            content.scrollTop = content.scrollHeight;
        }
    }, []);

    // A card added lands above the button and pushes it out of sight, and the editor stands taller
    // than the button it replaces. Neither raises a focus event, so whatever is focused in here has
    // to be followed back into view.
    useLayoutEffect(() => {
        if (slotRef.current?.contains(document.activeElement)) {
            scrollToEnd();
        }
    }, [ itemCount, isCreating, scrollToEnd ]);

    const open = useCallback((title: string) => {
        setInitialTitle(title);
        setIsCreating(true);
    }, [ setIsCreating ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (isCreating) return;

        if (e.key === "Enter" && !e.ctrlKey) {
            open("");
            return;
        }

        // Typing on the button starts the note off with what was typed, rather than asking for it
        // twice. A printable key is one whose name is the character itself, which no modified press
        // and none of the named keys are.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            open(e.key);
        }
    }, [ isCreating, open ]);

    return (
        <div
            ref={slotRef}
            className={`board-new-item ${isCreating ? "editing" : ""}`}
            onClick={() => open("")}
            onKeyDown={handleKeyDown}
            onFocus={scrollToEnd}
            tabIndex={300}
        >
            {!isCreating ? (
                <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.new-item")}
                </>
            ) : (
                <TitleEditor
                    currentValue={initialTitle}
                    placeholder={t("board_view.new-item-placeholder")}
                    save={(title) => api.createNewItem(column, title)}
                    dismiss={() => setIsCreating(false)}
                    mode="multiline" isNewItem
                    selectOnFocus={false}
                />
            )}
        </div>
    );
}

/**
 * How many cards a column holds, with a breakdown on hover.
 *
 * Archived cards are only included while the board is showing archived notes. Otherwise there are
 * none to count and the badge reports the total alone.
 */
function CountBadge({ items, limit, isOver }: {
    items?: { note: FNote }[],
    limit?: number,
    /** Whether the column is over its limit. The column body is outlined as well. */
    isOver?: boolean
}) {
    const badgeRef = useRef<HTMLSpanElement>(null);
    const archived = items?.filter(({ note }) => note.isArchived).length ?? 0;
    const total = items?.length ?? 0;

    const counts = archived
        ? t("board_view.card-count-with-archived", { count: total - archived, archived })
        : t("board_view.card-count", { count: total });
    const warning = t("board_view.card-count-over-limit");

    // The tooltip gets its own markup, since a title attribute cannot show a bold line. The
    // attribute keeps a plain version as a fallback. Memoised because `useStaticTooltip`
    // rebuilds the tooltip whenever the config changes identity.
    const tooltip = useMemo(() => ({
        html: true,
        title: isOver ? `${counts}<br><strong>${warning}</strong>` : counts
    }), [ counts, warning, isOver ]);
    useStaticTooltip(badgeRef, tooltip);

    return (
        <span
            ref={badgeRef}
            className={clsx("counter-badge", { "over-limit": isOver })}
            title={isOver ? `${counts}
${warning}` : counts}
        >
            {limit === undefined ? total : `${total}/${limit}`}
        </span>
    );
}

function useDragging({ column, columnIndex, columnItems, isEditing, api, parentNote }: DragContext & { isEditing: boolean, api: BoardApi, parentNote: FNote }) {
    const { setDraggedColumn, setDropTarget, setDropPosition, setActiveColumn } =
        useContext(BoardActionsContext);
    const { draggedColumn, dropPosition } = useContext(BoardDragStateContext);
    /** Needed to track if current column is dragged in real-time, since {@link draggedColumn} is populated one render cycle later.  */
    const isDraggingRef = useRef(false);

    const handleColumnDragStart = useCallback((e: DragEvent) => {
        if (isEditing) return;

        isDraggingRef.current = true;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', column);

        const element = (e.currentTarget as HTMLElement).closest<HTMLElement>(".board-column");
        setDraggedColumn({
            column,
            index: columnIndex,
            size: element
                ? { width: element.offsetWidth, height: element.offsetHeight }
                : undefined
        });
        e.stopPropagation(); // Prevent card drag from interfering
    }, [column, columnIndex, setDraggedColumn, isEditing]);

    const handleColumnDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        setDraggedColumn(null);
    }, [setDraggedColumn]);

    const handleDragOver = useCallback((e: DragEvent) => {
        if (isEditing || draggedColumn || isDraggingRef.current) return; // Don't handle card drops when dragging columns
        // Cards are carried by pointer now; what still arrives this way comes from the note tree.
        if (!e.dataTransfer?.types.includes(TREE_CLIPBOARD_TYPE)) return;

        e.preventDefault();
        setDropTarget(column);
        // A collapsed column opens to take the card and stays open afterwards, so the card can be
        // placed among the ones already there.
        setActiveColumn(column);

        // Calculate drop position based on mouse position
        const cards = Array.from((e.currentTarget as HTMLElement)?.querySelectorAll('.board-note'));
        const mouseY = e.clientY;

        let newIndex = cards.length;
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i] as HTMLElement;
            const rect = card.getBoundingClientRect();
            const cardMiddle = rect.top + rect.height / 2;

            if (mouseY < cardMiddle) {
                newIndex = i;
                break;
            }
        }

        if (!(dropPosition?.column === column && dropPosition.index === newIndex)) {
            setDropPosition({ column, index: newIndex });
        }
    }, [column, setDropTarget, setActiveColumn, dropPosition, setDropPosition, isEditing]);

    const handleDragLeave = useCallback((e: DragEvent) => {
        const relatedTarget = e.relatedTarget as HTMLElement;
        const currentTarget = e.currentTarget as HTMLElement;

        if (!currentTarget.contains(relatedTarget)) {
            setDropTarget(null);
            setDropPosition(null);
        }
    }, [setDropTarget, setDropPosition]);

    const handleDrop = useCallback(async (e: DragEvent) => {
        if (draggedColumn) return; // Don't handle card drops when dragging columns
        e.preventDefault();
        setDropTarget(null);
        setDropPosition(null);

        const data = e.dataTransfer?.getData("text");
        if (!data) return;

        let dropped: DragData[];
        try {
            dropped = JSON.parse(data);
        } catch (e) {
            return;
        }

        if (Array.isArray(dropped)) {
            const { noteId, branchId } = dropped[0];
            const targetNote = await froca.getNote(noteId, true);
            const parentNoteId = parentNote.noteId;
            if (!dropPosition) return;

            const targetIndex = dropPosition.index - 1;
            const targetItems = columnItems || [];
            const targetBranch = targetIndex >= 0 ? targetItems[targetIndex].branch : null;

            await api.changeColumn(noteId, column);

            const parents = targetNote?.getParentNoteIds();
            if (!parents?.includes(parentNoteId)) {
                if (!targetBranch) {
                    // First.
                    await branches.cloneNoteToParentNote(noteId, parentNoteId);
                } else {
                    await branches.cloneNoteAfter(noteId, targetBranch.branchId);
                }
            } else if (targetBranch) {
                await branches.moveAfterBranch([ branchId ], targetBranch.branchId);
            }
        }
    }, [ api, draggedColumn, dropPosition, columnItems, column, setDropTarget, setDropPosition ]);

    return { handleColumnDragStart, handleColumnDragEnd, handleDragOver, handleDragLeave, handleDrop };
}
