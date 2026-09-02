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
import { useNoteIcon, useNoteLabelBoolean, useTriliumEvent } from "../../react/hooks";

function Card({
    api,
    note,
    branch,
    column,
    index,
    statusAttribute,
    isNew,
    isDragging,
    isEditing,
    onFocusCard
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
    /** Whether this is the card the new-item editor has just made, which is revealed on arrival. */
    isNew: boolean,
    isDragging: boolean,
    /**
     * Passed down rather than derived here from the drag state's `branchIdToEdit`, so that a card
     * subscribes only to the board's stable context and a drag leaves it off the render path.
     */
    isEditing: boolean,
    /** Puts focus back on this card once a change of column has drawn it under another one. */
    onFocusCard: (noteId: string) => void
}) {
    const { setBranchIdToEdit } = useContext(BoardActionsContext);
    const colorClass = note.getColorClass() || '';
    const editorRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [ isArchived ] = useNoteLabelBoolean(note, "archived");
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
        openNoteContextMenu(api, e, note, branch.branchId, column, onFocusCard);
    }, [ api, note, branch, column, onFocusCard ]);

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
            api.insertRowAtPosition(column, branch.branchId, e.shiftKey ? "before" : "after");
        } else if (e.key === "F2") {
            setBranchIdToEdit(branch.branchId);
        }
    }, [ api, column, branch, setBranchIdToEdit ]);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    useEffect(() => {
        setTitle(note.title);
    }, [ note ]);

    // A card is added at the end of its column, which on a full column is below the fold. The
    // column is taken to its end rather than the card into view, so the card lands clear of the
    // fade the scrolling body draws over its bottom edge.
    useLayoutEffect(() => {
        if (!isNew) {
            return;
        }

        const content = cardRef.current?.closest(".board-column-content");
        if (content) {
            content.scrollTop = content.scrollHeight;
        }
    }, [ isNew ]);

    return (
        <div
            ref={cardRef}
            className={`board-note ${colorClass} ${isDragging ? 'dragging' : ''} ${isEditing ? "editing" : ""} ${isArchived ? "archived" : ""} ${isNew ? "appearing" : ""}`}
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
