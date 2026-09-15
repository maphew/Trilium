import "./card_toolbar.css";

import clsx from "clsx";
import { type ComponentChildren, createContext } from "preact";
import { createPortal, useSyncExternalStore } from "preact/compat";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

/**
 * How long the rail takes to slide off, which is how long whoever draws it keeps drawing it once it
 * is dismissed (see `useLingeringTrue`). Matches `--board-rail-exit-duration` in card_toolbar.css.
 */
export const RAIL_EXIT_MS = 400;

/**
 * Which rail stands on a board, one at a time. A rail arriving while another stands takes over in
 * place, neither sliding in over it nor waiting for it to slide off: the one it replaces is dropped
 * at once. A rail keeps its stand while it slides off, so a newcomer takes over from that too.
 */
export class RailStand {
    private owner: object | null = null;
    /** The rails another took over from, which stay dropped even once the stand is free again. */
    private superseded = new WeakSet<object>();
    private listeners = new Set<() => void>();

    /** Whether any rail stands, the one leaving included. */
    get isTaken() {
        return this.owner !== null;
    }

    isSuperseded(token: object) {
        return this.superseded.has(token);
    }

    claim(token: object) {
        if (this.owner === token) return;
        if (this.owner !== null) {
            this.superseded.add(this.owner);
        }
        this.owner = token;
        this.notify();
    }

    /** Gives the stand up, unless another rail has taken it over meanwhile. */
    release(token: object) {
        this.superseded.delete(token);
        if (this.owner !== token) return;
        this.owner = null;
        this.notify();
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify() {
        for (const listener of [ ...this.listeners ]) {
            listener();
        }
    }
}

/** The board's stand, provided by the board so that two boards side by side keep their own. */
export const BoardRailContext = createContext(new RailStand());

interface CardToolbarProps {
    /** The board's element, which the toolbar floats over rather than the card it belongs to. */
    host: HTMLElement;
    /** Whether the rail is on its way off, sliding back over the edge it came from. */
    isLeaving: boolean;
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
    host, isLeaving, isSorted, removal, onRename, onInsertAbove, onInsertBelow, onInsertNew,
    onRemove, onMore, onFocusOut
}: CardToolbarProps) {
    return (
        <Rail host={host} isLeaving={isLeaving} onFocusOut={onFocusOut}>
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
    isLeaving: boolean;
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
export function SelectionToolbar({
    host, isLeaving, count, onDelete, onMore
}: SelectionToolbarProps) {
    return (
        <Rail host={host} isLeaving={isLeaving}>
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
    isLeaving: boolean;
    onFocusOut?: (event: FocusEvent) => void;
    children: ComponentChildren;
}

/**
 * The rail itself, flush with the board's trailing edge; what stands on it is the caller's. It
 * slides in over that edge, and back out over it while `isLeaving` (see card_toolbar.css), unless
 * it takes over from another rail or another takes over from it (see {@link RailStand}).
 */
function Rail({ host, isLeaving, onFocusOut, children }: RailProps) {
    const stand = useContext(BoardRailContext);
    const token = useRef({}).current;
    // Decided as the rail arrives: whether it takes over in place rather than sliding in.
    const [ tookOver ] = useState(() => stand.isTaken);
    useEffect(() => {
        stand.claim(token);
        return () => stand.release(token);
    }, [ stand, token ]);
    const isSuperseded = useSyncExternalStore(
        useCallback((listener: () => void) => stand.subscribe(listener), [ stand ]),
        useCallback(() => stand.isSuperseded(token), [ stand, token ]));

    if (isLeaving && isSuperseded) {
        return null;
    }

    return createPortal(
        <div
            className={clsx("board-card-toolbar", { leaving: isLeaving, "takes-over": tookOver })}
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
