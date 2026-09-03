import { memo } from "preact/compat";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useRef, useState
} from "preact/hooks";
import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import BoardApi from "./api";
import { BoardActionsContext, TitleEditor } from ".";
import { ContextMenuEvent } from "../../../menus/context_menu";
import { openNoteContextMenu } from "./context_menu";
import { t } from "../../../services/i18n";
import UserAttributesDisplay from "../../attribute_widgets/UserAttributesList";
import { FLIP_SETTLE_MS } from "../../react/flip";
import {
    useNoteColorClass, useNoteIcon, useNoteLabelBoolean, useTriliumEvent
} from "../../react/hooks";

function Card({
    api,
    note,
    branch,
    column,
    index,
    statusAttribute,
    isNew,
    focusOnArrival,
    isDragging,
    isEditing,
    onFocusCard,
    onCreated
}: {
    api: BoardApi,
    note: FNote,
    branch: FBranch,
    column: string,
    index: number,
    /**
     * The label the board groups by, so that a card is not left reading it off `api`. The api keeps
     * one identity for the life of the board, which a `memo` comparison cannot see through.
     */
    statusAttribute: string,
    /** Whether this is the card just made, which is revealed on arrival. */
    isNew: boolean,
    /** Whether the card just made is also left focused, which an insert's is and the footer's is not. */
    focusOnArrival: boolean,
    isDragging: boolean,
    /**
     * Passed down rather than derived here from the drag state's `branchIdToEdit`, so that a card
     * subscribes only to the board's stable context and a drag leaves it off the render path.
     */
    isEditing: boolean,
    /** Puts focus back on this card once a change of column has drawn it under another one. */
    onFocusCard: (noteId: string) => void,
    /** Names the card inserted next to this one, which the column reveals as it draws it. */
    onCreated: (noteId: string | undefined) => void
}) {
    const { setBranchIdToEdit } = useContext(BoardActionsContext);
    // Tracks the `color` label, which the board does not redraw a card for.
    const colorClass = useNoteColorClass(note) || "";
    const editorRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [ isArchived ] = useNoteLabelBoolean(note, "archived");
    // The card stays the one just made until another is, so what has already been shown is
    // remembered here rather than played again by every redraw of the column.
    const [ isRevealed, setIsRevealed ] = useState(false);
    const [ title, setTitle ] = useState(note.title);
    // Tracks the `iconClass` label, which an attribute change carries and the note row never does.
    const icon = useNoteIcon(note);

    // A card owns its own title: the board does not redraw for a note-row change. Setting the value
    // already held is a no-op, so a save that left the title alone re-renders nothing.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const row = loadResults.getEntityRow("notes", note.noteId);
        if (row) {
            setTitle(row.title);
        }
    });

    const handleContextMenu = useCallback((e: ContextMenuEvent) => {
        openNoteContextMenu(api, e, note, branch.branchId, column, onFocusCard, onCreated);
    }, [ api, note, branch, column, onFocusCard, onCreated ]);

    const handleOpen = useCallback((e: MouseEvent) => {
        // A double click is one gesture, and its second click would open the note over itself: the
        // popup already standing is taken as the one to stack on, and closing that leaves neither.
        if (e.detail > 1) return;

        api.openNote(note.noteId);
    }, [ api, note ]);

    const handleEdit = useCallback((e: MouseEvent) => {
        e.stopPropagation(); // don't also open the note
        setBranchIdToEdit(branch.branchId);
    }, [ setBranchIdToEdit, branch ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.ctrlKey) {
            // Enter adds a card the way it adds a row in a spreadsheet, and Space is what opens
            // one. Shift adds it above instead of below.
            e.preventDefault();
            api.insertRowAtPosition(column, branch.branchId, e.shiftKey ? "before" : "after")
                .then(created => onCreated(created?.noteId));
        } else if (e.key === "F2") {
            setBranchIdToEdit(branch.branchId);
        }
    }, [ api, column, branch, setBranchIdToEdit, onCreated ]);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    // An insert opens the new card's title editor, which holds focus while a title is typed. The
    // card takes it from there, so that the arrow keys carry on from where the reader is.
    useEffect(() => {
        if (focusOnArrival && !isEditing) {
            cardRef.current?.focus();
        }
    }, [ focusOnArrival, isEditing ]);

    useEffect(() => {
        setTitle(note.title);
    }, [ note ]);

    // A new card can be out of sight on a full column. A card at either end scrolls its column to
    // that end, clear of the fade `useScrollFade` draws over the edges; one between others is only
    // scrolled into view.
    useLayoutEffect(() => {
        if (!isNew) {
            return;
        }

        const card = cardRef.current;
        const content = card?.closest(".board-column-content");
        if (!card || !content) {
            return;
        }

        const bring = () => {
            if (!card.nextElementSibling) {
                content.scrollTop = content.scrollHeight;
            } else if (!card.previousElementSibling) {
                content.scrollTop = 0;
            } else {
                card.scrollIntoView?.({ block: "nearest" });
            }
        };

        bring();
        // Again once the growth has finished: a card scrolled to while `useFlip` is still opening
        // it out is measured against a shorter column, and ends up past the edge.
        const settled = window.setTimeout(bring, FLIP_SETTLE_MS);

        return () => window.clearTimeout(settled);
    }, [ isNew ]);

    return (
        <div
            ref={cardRef}
            className={`board-note ${colorClass} ${isDragging ? 'dragging' : ''} ${isEditing ? "editing" : ""} ${isArchived ? "archived" : ""} ${isNew && !isRevealed ? "appearing" : ""}`}
            onAnimationEnd={(e) => {
                if (e.animationName === "board-item-appear") {
                    setIsRevealed(true);
                }
            }}
            data-note-id={note.noteId}
            onContextMenu={handleContextMenu}
            onClick={!isEditing ? handleOpen : undefined}
            onKeyDown={handleKeyDown}
            tabIndex={300}
        >
            {!isEditing ? (
                <>
                    <span className="title">
                        <span class={`icon ${icon}`} />
                        {title}
                    </span>
                    <span
                        className="edit-icon icon bx bx-edit"
                        title={t("board_view.edit-note-title")}
                        onClick={handleEdit}
                    />
                    <UserAttributesDisplay note={note} ignoredAttributes={[statusAttribute]} />
                </>
            ) : (
                <TitleEditor
                    returnFocusTo={cardRef}
                    currentValue={note.title}
                    save={newTitle => {
                        api.renameCard(note.noteId, newTitle);
                        setTitle(newTitle);
                    }}
                    dismiss={() => api.dismissEditingTitle()}
                    mode="multiline"
                />
            )}
        </div>
    )
}

/**
 * Memoized because a board holds hundreds of these and most redraws change none of them: a drag
 * moves one card, and the rest receive the same props they already had.
 *
 * This only works because a card reads nothing from the board's drag-state context -- Preact
 * re-renders a context consumer whatever its memo boundary says, so subscribing there would make
 * the comparison below unreachable. `isEditing` and `isDragging` arrive as props for that reason.
 *
 * `api` keeps one identity for as long as the board is mounted, so a refresh reaches only the cards
 * whose own props changed. Anything a card reads off the api while rendering has to arrive as a prop
 * instead, which is why `statusAttribute` is one.
 */
export default memo(Card);
