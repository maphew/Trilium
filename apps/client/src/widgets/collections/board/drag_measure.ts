import { type CardBox, type ColumnBox } from "./drag_geometry";

/** What a drag measures once at its start, and reads for the rest of the gesture. */
export interface BoardMeasurement {
    /** The columns as drawn, in order, for {@link columnAt} and {@link columnInsertionIndex}. */
    columns: ColumnBox[];
    /** Each column's card area, which a point has to be read against to place a card in it. */
    areas: Map<string, HTMLElement>;
}

/**
 * Measures every column and card on the board.
 *
 * Called once when a drag starts. A gesture reads two rectangles per move afterwards, whatever the
 * board holds, where measuring per move would read one for every card on it.
 */
export function measureBoard(container: HTMLElement): BoardMeasurement {
    const origin = container.getBoundingClientRect().left - container.scrollLeft;
    const columns: ColumnBox[] = [];
    const areas = new Map<string, HTMLElement>();

    // The copy being carried is a column too, and measuring again mid-drag would count it as a
    // place to drop into, one past every place the board actually has.
    const drawn = container.querySelectorAll<HTMLElement>(".board-column:not(.board-drag-preview)");

    for (const element of drawn) {
        const value = element.dataset.column ?? "";
        const rect = element.getBoundingClientRect();
        const area = element.querySelector<HTMLElement>(".board-column-content");

        if (area) {
            areas.set(value, area);
        }

        columns.push({
            value,
            left: rect.left - origin,
            width: rect.width,
            top: rect.top,
            height: rect.height,
            cards: measureCards(area)
        });
    }

    return { columns, areas };
}

/** A point in the board's content space, which its horizontal scrolling does not move columns in. */
export function toBoardX(container: HTMLElement, clientX: number): number {
    return clientX - container.getBoundingClientRect().left + container.scrollLeft;
}

/**
 * A point in a card area's content space, which that column's vertical scrolling does not move its
 * cards in.
 */
export function toAreaY(area: HTMLElement, clientY: number): number {
    return clientY - area.getBoundingClientRect().top + area.scrollTop;
}

/**
 * The cards of one column, in the area's content space.
 *
 * The dragged card is measured with the rest: the index this leads to names a place in the list the
 * board holds, which is the list a move is expressed against.
 */
function measureCards(area: HTMLElement | null) {
    if (!area) {
        return [];
    }

    const top = area.getBoundingClientRect().top - area.scrollTop;
    const cards: CardBox[] = [];
    // The gap standing open for the carried card holds the cards under it a place lower than they
    // are measured to be. What a place is counted against is the column without the drag's own
    // doing in it, so the room the gap takes is given back to everything below it.
    let gap = 0;

    for (const child of area.children) {
        const rect = child.getBoundingClientRect();

        if (child.classList.contains("board-drop-placeholder")) {
            gap += rect.height + Number.parseFloat(getComputedStyle(child).marginBottom || "0");
            continue;
        }

        if (child.classList.contains("board-note")) {
            cards.push({ top: rect.top - top - gap, height: rect.height });
        }
    }

    return cards;
}
