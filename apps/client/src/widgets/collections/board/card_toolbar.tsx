import "./card_toolbar.css";

import { type ComponentChildren } from "preact";
import { createPortal } from "preact/compat";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

interface CardToolbarProps {
    /** The board's element, which the toolbar floats over rather than the card it belongs to. */
    host: HTMLElement;
    /** Whether the column places its cards itself, which leaves one place to insert at. */
    isSorted: boolean;
    /**
     * What taking the card away means: off the board, or the note deleted. A board with an inbox
     * keeps a card whose grouping value is cleared, so deleting the note is what takes it off.
     */
    removal: "board" | "note";
    onRename: () => void;
    onInsertAbove: () => void;
    onInsertBelow: () => void;
    /** Inserts at the foot of a sorted column, which places the card itself. */
    onInsertNew: () => void;
    onRemove: () => void;
    /** Opens the card's context menu, at the button. */
    onMore: (event: MouseEvent) => void;
    /** Reports focus leaving the toolbar, for the card to decide whether the toolbar stays. */
    onFocusOut: (event: FocusEvent) => void;
}

/**
 * What can be done with the focused card, on a rail flush with the board's trailing edge.
 *
 * Mobile only: a finger has no right button for the card's menu, and a tap opens the card. The rail
 * follows the focus, and is hidden while a card is carried (see card_toolbar.css).
 */
export default function CardToolbar({
    host, isSorted, removal, onRename, onInsertAbove, onInsertBelow, onInsertNew, onRemove,
    onMore, onFocusOut
}: CardToolbarProps) {
    return (
        <Rail host={host} onFocusOut={onFocusOut}>
            <OverlayControlButton
                title={t("board_view.edit-title")}
                icon="bx-rename"
                onClick={onRename}
            />
            {isSorted ? (
                <OverlayControlButton
                    title={t("board_view.insert-new")}
                    icon="bx-plus"
                    onClick={onInsertNew}
                />
            ) : (<>
                <OverlayControlButton
                    title={t("board_view.insert-above")}
                    icon="bx-list-plus"
                    className="board-insert-above-button"
                    onClick={onInsertAbove}
                />
                <OverlayControlButton
                    title={t("board_view.insert-below")}
                    icon="bx-list-plus"
                    onClick={onInsertBelow}
                />
            </>)}
            {removal === "board" ? (
                <OverlayControlButton
                    title={t("board_view.remove-from-board")}
                    icon="bx-task-x"
                    className="board-remove-button"
                    onClick={onRemove}
                />
            ) : (
                <OverlayControlButton
                    title={t("board_view.delete-note")}
                    icon="bx-trash"
                    className="board-remove-button"
                    onClick={onRemove}
                />
            )}
            <OverlayControlButton
                title={t("board_view.more-actions")}
                icon="bx-dots-vertical-rounded"
                onClick={onMore}
            />
        </Rail>
    );
}

interface SelectionToolbarProps {
    host: HTMLElement;
    /** How many cards are picked out. With none, there is nothing to press. */
    count: number;
    onDelete: () => void;
    /** Opens the context menu for the selection, at the button. */
    onMore: (event: MouseEvent) => void;
}

/**
 * What can be done with the cards picked out in selection mode: deleting them, or opening the
 * menu for all of them. Stands in for the focused card's rail while the mode lasts.
 */
export function SelectionToolbar({ host, count, onDelete, onMore }: SelectionToolbarProps) {
    return (
        <Rail host={host}>
            <OverlayControlButton
                title={t("board_view.delete-note")}
                icon="bx-trash"
                className="board-remove-button"
                disabled={count === 0}
                onClick={onDelete}
            />
            <OverlayControlButton
                title={t("board_view.more-actions")}
                icon="bx-dots-vertical-rounded"
                disabled={count === 0}
                onClick={onMore}
            />
        </Rail>
    );
}

interface RailProps {
    host: HTMLElement;
    onFocusOut?: (event: FocusEvent) => void;
    children: ComponentChildren;
}

/** The rail itself, flush with the board's trailing edge; what stands on it is the caller's. */
function Rail({ host, onFocusOut, children }: RailProps) {
    return createPortal(
        <div
            className="board-card-toolbar"
            // A press must not move the focus off the card, which would close the toolbar under
            // the finger, nor reach the board, which would take it for the start of a pan. Nor
            // the click: to the board, a click outside a card gives the selection up.
            onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onFocusOut={onFocusOut}
        >
            <OverlayControlGroup placement="middle-end" vertical overCanvas>
                {children}
            </OverlayControlGroup>
        </div>,
        host
    );
}
