import clsx from "clsx";
import { Fragment } from "preact";
import { flushSync } from "preact/compat";
import {
    useCallback, useContext, useEffect, useMemo, useRef, useState
} from "preact/hooks";
import { JSX } from "preact/jsx-runtime";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { ContextMenuEvent } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { getHue, parseColor } from "../../../services/css_class_manager";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { DragData, TREE_CLIPBOARD_TYPE } from "../../note_tree";
import ActionButton from "../../react/ActionButton";
import Icon from "../../react/Icon";
import { IconPickerButton } from "../../react/IconPicker";
import { useStaticTooltip } from "../../react/hooks";
import { useFlip } from "../../react/flip";
import { useScrollFade } from "../../react/scroll_fade";

/** How long a field waits for the card it made, after which it is taken down regardless. */
const HAND_OVER_MS = 2000;

/** How long an open takes. Matches `--board-expand-duration` in the board's own rules. */
const EXPAND_MS = 200;
import NoteLink from "../../react/NoteLink";
import { BoardActionsContext, BoardDragStateContext, TitleEditor } from ".";
import BoardApi from "./api";
import Card from "./card";
import CardTemplatePill from "./card_template_pill";
import { type CardTemplates } from "./card_templates";
import { DEFAULT_CARD_ICON, DEFAULT_COLUMN_ICON, INBOX_COLUMN } from "./columns";
import { openColumnContextMenu, openCreateCardMenu } from "./context_menu";

interface DragContext {
    column: string;
    columnIndex: number,
    columnItems?: { note: FNote, branch: FBranch }[];
    /** Whether this is the column just added, which is revealed on arrival. */
    isNew?: boolean;
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
    keepCollapsed,
    isActive,
    isPeeked,
    nested,
    limit,
    columnItems,
    isNew,
    cardTemplates,
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
    /** Whether the column is stored as collapsed. A drag opening it does not clear this. */
    collapsed?: boolean,
    /** Whether the column collapses again once opened, which keeps `collapsed` through an open. */
    keepCollapsed?: boolean,
    /** Whether this is the column the reader is working in, which opens it while it is collapsed. */
    isActive?: boolean,
    /** Whether the board is showing every collapsed column at once, which opens this one too. */
    isPeeked?: boolean,
    /** What a new card is made from, and how the reader picks something else. */
    cardTemplates: CardTemplates,
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
    /**
     * The card a field standing among the cards makes its own above, absent while no such field is
     * open and empty for one standing below the last card.
     *
     * The card below the field rather than the one above it, so the field keeps its place as it
     * makes cards: each one is drawn above the field, and a run of them stands in the order it was
     * typed. Named by the card above instead, the field would be carried down past every card it
     * made, and moving the element it is typed in takes focus out of it.
     */
    const [ insertBefore, setInsertBefore ] = useState<{ branchId?: string }>();
    /**
     * The cards as last drawn, for the callback that opens a field among them. Read through a ref
     * so that callback keeps one identity: rebuilt per refresh, it would be a new prop on every
     * card and no card could be left undrawn.
     */
    const itemsRef = useRef(columnItems);
    itemsRef.current = columnItems;
    /** Opens the field at a place among the cards, which is the index the card it makes takes. */
    const beginInsert = useCallback((index: number) => {
        setInsertBefore({ branchId: itemsRef.current?.[index]?.branch.branchId });
    }, []);
    /** The card the footer just made, which is revealed and scrolled to as it is drawn. */
    const [ createdNoteId, setCreatedNoteId ] = useState<string>();
    /**
     * The card a field standing among the others just made, which takes the field's place.
     *
     * The field stands where the card goes until the board has drawn it, so the card fades in
     * where the field was rather than opening out of a gap the column has to make for it.
     */
    const [ insertedNoteId, setInsertedNoteId ] = useState<string>();
    const cardInserted = useCallback((noteId: string | undefined) => {
        setInsertedNoteId(noteId);
        setCreatedNoteId(noteId);
    }, []);
    // `isNew` stays true until another column is added, so the reveal is recorded here rather than
    // replayed on every redraw of the board.
    const [ isRevealed, setIsRevealed ] = useState(false);
    const { setColumnNameToEdit, setColumnLimitToEdit, setActiveColumn } =
        useContext(BoardActionsContext);
    const { branchIdToEdit, columnNameToEdit, dropTarget, draggedCard, dropPosition } = useContext(BoardDragStateContext);
    const isEditing = (columnNameToEdit === column);
    const editorRef = useRef<HTMLInputElement>(null);
    const headerRef = useRef<HTMLHeadingElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollFade = useScrollFade(contentRef);
    // Cards slide to follow the drop gap opening and closing. No card opens out of nothing: one
    // made in the footer is shown by the scroll to the end and by its fade, and one made among the
    // others takes the place its field was standing in.
    useFlip(contentRef, { selector: ".board-note" });
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
    const isCollapsed = !!collapsed && !isActive && !isPeeked;
    // A column opened to take a dragged card takes its width at once, and its cards with it.
    const opensAtOnce = !!draggedCard || dropTarget === column;

    /**
     * Whether the column is still widening, during which its cards are left unpainted.
     *
     * They are laid out again on every frame of the widening, their titles rewrapping as the
     * column grows, which is what the reader would otherwise watch. Read during the render that
     * opens the column, so there is no frame where they are painted into a narrow one.
     *
     * Unpainted rather than undrawn: the board focuses the card a keyboard open steps onto, and a
     * card that is not there yet is one it cannot hand focus to.
     */
    const [ isExpanding, setIsExpanding ] = useState(false);
    const [ wasCollapsed, setWasCollapsed ] = useState(isCollapsed);
    if (wasCollapsed !== isCollapsed) {
        setWasCollapsed(isCollapsed);
        setIsExpanding(!isCollapsed && !opensAtOnce);
    }

    useEffect(() => {
        if (!isExpanding) {
            return;
        }

        const timer = window.setTimeout(() => setIsExpanding(false), EXPAND_MS);
        return () => window.clearTimeout(timer);
    }, [ isExpanding ]);

    // Only while the column is open: the strip's own press opens it, which is what it says
    // instead. Memoised because `useStaticTooltip` rebuilds the tooltip on a new config.
    const headerTooltip = useMemo(
        () => ({ title: isCollapsed ? "" : t("board_view.collapse-hint") }), [ isCollapsed ]);
    useStaticTooltip(headerRef, headerTooltip);

    // Reported on the way in only. A column opened by being selected closes when another one is
    // selected, so nothing here watches for focus leaving: the menu, the icon picker and the limit
    // dialog all render outside the column, and each would otherwise close it as it opened.
    const select = useCallback(() => {
        setActiveColumn(column);

        // Opening the strip by hand opens the column for good, unless `keepCollapsed` says it
        // closes again. A column opened by a card dragged over it goes through `setActiveColumn`
        // instead, so it keeps the flag.
        if (isCollapsed && !keepCollapsed) {
            api.setColumnCollapsed(column, false);
        }
    }, [ api, column, isCollapsed, keepCollapsed, setActiveColumn ]);

    /**
     * Whether the collapse now being drawn is one the reader asked for, which runs faster than a
     * peek closing: only the peek closes behind the pointer, with the board shifting under it.
     */
    const [ isCollapsingByHand, setIsCollapsingByHand ] = useState(false);

    /** Collapses the column, closing the open one so that the change is drawn straight away. */
    const collapse = useCallback(() => {
        setIsCollapsingByHand(true);
        api.setColumnCollapsed(column, true);
        setActiveColumn(undefined);
    }, [ api, column, setActiveColumn ]);

    /**
     * Whether the header was a strip when the press began.
     *
     * The first click of a double click on a strip already opens the column, so by the time
     * `dblclick` arrives the header is a heading and collapsing it again would undo the open. Only
     * the press that starts a sequence is recorded, which `detail` counts.
     */
    const wasCollapsedOnPress = useRef(false);

    // Focus reaching a column closes whichever one was open, and opens nothing: a collapsed column
    // is walked onto without being disturbed, and is opened by a click or by Space instead.
    const handleFocusIn = useCallback(() => {
        if (isActive) {
            return;
        }

        // While the whole board is peeked, focus arriving settles the peek on this column rather
        // than closing every column: the reader has just gone to work in this one, and a press on
        // one of its cards is focus arriving before it is a click.
        setActiveColumn(isPeeked ? column : undefined);
    }, [ column, isActive, isPeeked, setActiveColumn ]);

    const openMenu = useCallback((e: ContextMenuEvent) => {
        openColumnContextMenu(api, e, {
            value: column,
            columns,
            index: columnIndex,
            color,
            archived,
            collapsed,
            canRename: !isCollapsed,
            isCollapsed,
            keepCollapsed,
            nested,
            onEditTitle: () => setColumnNameToEdit(column),
            onNewItem: () => setIsCreatingNewItem(true),
            onAddColumn: async (direction) => {
                setColumnNameToEdit(await api.insertColumn(column, direction));
            },
            onSetLimit: () => setColumnLimitToEdit(column),
            onCollapse: collapse,
            onKeepCollapsed: (keep) => {
                setIsCollapsingByHand(keep);
                api.setColumnKeepCollapsed(column, keep, !isCollapsed);
                // Turning it on collapses the column as well, so the open one is closed here for
                // the same reason `collapse` closes it.
                if (keep) {
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
        api, column, color, archived, collapsed, keepCollapsed, collapse, isCollapsed, nested,
        columns, columnIndex, setColumnNameToEdit, setColumnLimitToEdit, setActiveColumn,
        onMoveColumn, onFocusColumn
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
        if (!isCollapsed) {
            setIsCollapsingByHand(false);
        }
    }, [ isCollapsed ]);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    // The field is taken down only once the card it made stands in its place, so the column does
    // not close the gap the field held and open it again for the card.
    useEffect(() => {
        if (!insertedNoteId) {
            return;
        }

        const close = () => {
            setInsertBefore(undefined);
            setInsertedNoteId(undefined);
        };

        if (columnItems?.some(({ note }) => note.noteId === insertedNoteId)) {
            close();
            return;
        }

        // A card can be drawn in another column, which one made from a template carrying a value
        // of its own is, so the field is not left standing for a card that never arrives here.
        const timer = window.setTimeout(close, HAND_OVER_MS);
        return () => window.clearTimeout(timer);
    }, [ insertedNoteId, columnItems ]);

    // The field a card is inserted in, drawn where the reader asked for the card. The same field
    // as the one below the column, so a card is made the same way wherever it goes.
    const insertField = insertBefore && (
        <AddNewItem
            api={api}
            cardTemplates={cardTemplates}
            column={column}
            insert={{
                before: insertBefore.branchId,
                close: () => setInsertBefore(undefined)
            }}
            onCreated={cardInserted}
        />
    );

    return (
        <div
            data-column={column}
            className={clsx("board-column", {
                "drag-over": dropTarget === column && draggedCard?.fromColumn !== column,
                // The class the themes key a hue off, worn here as anywhere else that carries one.
                "with-hue": hue !== undefined,
                "board-column-archived": archived,
                "over-limit": isOverLimit,
                collapsed: isCollapsed,
                "quick-collapse": isCollapsingByHand,
                // Opening is drawn for the reader who asked for it. A column opened to take a
                // dragged card takes its width at once, since the drop is measured as it opens.
                "quick-expand": !isCollapsed && !opensAtOnce,
                expanding: isExpanding,
                appearing: isNew && !isRevealed
            })}
            onAnimationEnd={(e) => {
                if (e.animationName === "board-item-appear") {
                    setIsRevealed(true);
                }
            }}
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
                ref={headerRef}
                className={`${isEditing ? "editing" : ""}`}
                // While collapsed the header is what opens the column, so it says so and answers
                // for the keys a button answers for. Open, it is a heading again and Space does
                // nothing, so neither is claimed.
                role={isCollapsed ? "button" : undefined}
                aria-expanded={isCollapsed ? false : undefined}
                onContextMenu={openMenu}
                onMouseDown={(e) => {
                    if (e.detail <= 1) {
                        wasCollapsedOnPress.current = isCollapsed;
                    }
                }}
                onDblClick={() => {
                    if (!wasCollapsedOnPress.current) {
                        collapse();
                    }
                }}
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
                        <span className="title">
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
                    // The card being carried is out of the flow, so the gap stands in its own
                    // place too: held still, which a touch does before it moves, that is where it
                    // was picked up from.
                    const showIndicatorBefore = dropPosition?.column === column &&
                                            dropPosition.index === index;

                    return (
                        <Fragment key={note.noteId}>
                            {showIndicatorBefore && (
                                <div className="board-drop-placeholder show" style={gapStyle} />
                            )}
                            {insertBefore?.branchId === branch.branchId && insertField}
                            <Card
                                api={api}
                                note={note}
                                branch={branch}
                                column={column}
                                index={index}
                                statusAttribute={api.statusAttribute}
                                isNew={note.noteId === createdNoteId}
                                focusOnArrival={note.noteId === insertedNoteId}
                                isDragging={draggedCard?.noteId === note.noteId}
                                isEditing={branch.branchId === branchIdToEdit}
                                onFocusCard={onFocusCard}
                                onInsert={beginInsert}
                            />
                        </Fragment>
                    );
                })}
                {insertBefore && !insertBefore.branchId && insertField}
                {dropPosition?.column === column && dropPosition.index === (columnItems?.length ?? 0) && (
                    <div className="board-drop-placeholder show" style={gapStyle} />
                )}
            </div>}

            {!isCollapsed && <AddNewItem
                api={api}
                cardTemplates={cardTemplates}
                column={column}
                isCreating={isCreatingNewItem}
                setIsCreating={setIsCreatingNewItem}
                onCreated={setCreatedNoteId}
            />}
        </div>
    );
}

/**
 * The editor a new card is named in, standing below the column or between two of its cards.
 *
 * Below the column it is opened by the button it replaces or by the column's menu, so that state
 * is the column's rather than this component's: the menu is raised from the header. Between two
 * cards it is opened by a card's own menu, and `insert` says where it stands.
 */
function AddNewItem({
    column, api, cardTemplates, isCreating, setIsCreating, onCreated, insert
}: {
    column: string,
    api: BoardApi,
    cardTemplates: CardTemplates,
    isCreating?: boolean,
    setIsCreating?: (isCreating: boolean) => void,
    /** Names the card just made, which the column shows once the board has drawn it. */
    onCreated: (noteId: string | undefined) => void,
    /**
     * Where a field standing among the cards puts what it makes: above the card it is given, or
     * at the end of the column where it is given none. Absent for the field below the column.
     */
    insert?: { before?: string, close: () => void }
}) {
    // A field standing among the cards is nothing else: there is no button for it to replace, and
    // it is taken down rather than closed.
    const isEditing = !!insert || !!isCreating;
    const close = useCallback(
        () => insert ? insert.close() : setIsCreating?.(false),
        [ insert, setIsCreating ]);
    // What the editor opens with: empty to begin with, then whatever was typed into it and left
    // unsaved, so that reaching for something else and coming back does not cost the title.
    const [ initialTitle, setInitialTitle ] = useState("");
    // Kept between cards, unlike the title: a run of cards is often a run of the same kind of card.
    const [ icon, setIcon ] = useState(DEFAULT_CARD_ICON);

    const open = useCallback((title: string) => {
        setInitialTitle(title);
        setIsCreating?.(true);
    }, [ setIsCreating ]);

    /** Puts a note that already exists into this column, for a field with nothing typed into it. */
    const addExistingItem = useCallback(async () => {
        const noteId = await dialog.chooseNote({
            title: t("board_view.add-existing-item-title"),
            okLabel: t("board_view.add-existing-item-ok")
        });

        if (noteId) {
            await api.addExistingItem(column, noteId, insert?.before);
        }
    }, [ api, column, insert ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (isCreating) return;

        if (e.key === "Enter" && !e.ctrlKey) {
            setIsCreating?.(true);
            return;
        }

        // Typing on the button starts the note off with what was typed, rather than asking for it
        // twice. A printable key is one whose name is the character itself, which no modified press
        // and none of the named keys are.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            open(e.key);
        }
    }, [ isCreating, open, setIsCreating ]);

    /** Makes the card, where the field stands or at the end of the column. */
    const create = useCallback(async (title: string, atStart?: boolean) => {
        const cardIcon = icon !== DEFAULT_CARD_ICON ? icon : undefined;

        if (insert) {
            // Left standing until the column has drawn the card, which takes the field's place.
            const noteId = await api.createNewItemBefore(
                column, insert.before, title, cardIcon, cardTemplates.current);
            if (noteId) {
                onCreated(noteId);
            } else {
                insert.close();
            }
            return;
        }

        onCreated(await api.createNewItem(
            column, title, atStart ? "top" : "bottom", cardIcon, cardTemplates.current));
    }, [ api, cardTemplates, column, icon, insert, onCreated ]);

    return (
        <div
            className={clsx("board-new-item", { editing: isEditing, inserting: !!insert })}
            onClick={!insert ? () => flushSync(() => setIsCreating?.(true)) : undefined}
            onKeyDown={!insert ? handleKeyDown : undefined}
            tabIndex={!insert ? 300 : undefined}
        >
            {!isEditing ? (
                <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.new-item")}
                </>
            ) : (
                <TitleEditor
                    currentValue={initialTitle}
                    placeholder={t("board_view.new-item-placeholder")}
                    save={create}
                    dismiss={close}
                    mode="multiline" isNewItem
                    selectOnFocus={false}
                    saveAndContinue
                    handsOver={!!insert}
                    abandon={setInitialTitle}
                    whenEmpty={{
                        title: t("board_view.add-existing-item"),
                        onClick: addExistingItem
                    }}
                    submitTitle={t("board_view.create-new-note")}
                    // Only the field below the column offers both ends. One standing among the
                    // cards is already at the end the reader asked for.
                    openPlacements={!insert ? openCreateCardMenu : undefined}
                    footer={(hold) => <CardTemplatePill {...cardTemplates} {...hold} />}
                    icon={{
                        current: icon,
                        onSelect: setIcon,
                        onReset: icon !== DEFAULT_CARD_ICON
                            ? () => setIcon(DEFAULT_CARD_ICON)
                            : undefined
                    }}
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
