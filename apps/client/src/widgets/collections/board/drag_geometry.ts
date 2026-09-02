/**
 * Where a dragged card or column would land.
 *
 * Pure arithmetic over boxes measured once at the start of a drag, so a move costs no layout reads.
 * Two coordinate spaces are used, each chosen so that scrolling does not invalidate the measurement:
 * columns are placed along the board's content space, which the board's horizontal scrolling does
 * not move them in, and cards along their own column's card-area content space, which that column's
 * vertical scrolling does not move them in.
 */

/** A card, in the content space of the card area holding it. */
export interface CardBox {
    top: number;
    height: number;
}

/** A column, placed across in the board's content space and down in the page's. */
export interface ColumnBox {
    /** The grouping value identifying the column. */
    value: string;
    left: number;
    width: number;
    /**
     * Where it stands down the page, and how tall it is. The board does not scroll this way, so
     * these hold for the length of a drag. A collapsed column is only as tall as its heading, which
     * is what tells standing on it from standing in the empty space under it.
     */
    top: number;
    height: number;
    /**
     * The cards as drawn, in order, the dragged one included. Counting it keeps the index in the
     * same terms as the list the board holds, which is what a move is expressed in.
     */
    cards: CardBox[];
}

/**
 * The column a point falls in, or the nearest one where it falls between columns or past an end.
 *
 * Nearest rather than nothing, so a drag carried into the gap between two columns, or held past the
 * last one while the board scrolls itself, still has somewhere to go.
 *
 * @param columns the columns as drawn, in order.
 * @param x in the board's content space.
 */
export function columnAt(columns: ColumnBox[], x: number): ColumnBox | undefined {
    let nearest: ColumnBox | undefined;
    let shortest = Infinity;

    for (const column of columns) {
        if (x >= column.left && x < column.left + column.width) {
            return column;
        }

        const distance = x < column.left
            ? column.left - x
            : x - (column.left + column.width);

        if (distance < shortest) {
            shortest = distance;
            nearest = column;
        }
    }

    return nearest;
}

/**
 * Whether a point stands on a column itself, rather than merely being nearest to it or standing in
 * the empty space below it.
 *
 * @param x in the board's content space, and @param y down the page.
 */
export function columnCovers(column: ColumnBox, x: number, y: number): boolean {
    return x >= column.left && x < column.left + column.width
        && y >= column.top && y < column.top + column.height;
}

/**
 * Where a card would be inserted in a column: in the place the point falls in, or at the end.
 *
 * The line between one place and the next runs through the space between two cards, not through
 * the middle of a card. What is carried is placed by its top edge, which reaches that space half a
 * card before its middle does, so a middle would leave the gap trailing what is being carried.
 *
 * @param cards the column's cards, in order.
 * @param y the top of what is carried, in the content space of the card area holding them.
 */
export function cardInsertionIndex(cards: CardBox[], y: number): number {
    for (const [ index, card ] of cards.entries()) {
        const next = cards[index + 1];
        const boundary = next
            ? (card.top + card.height + next.top) / 2
            : card.top + card.height;

        if (y < boundary) {
            return index;
        }
    }

    return cards.length;
}

/**
 * Where a dragged column would be inserted: before the column the point is left of the middle of,
 * or after it.
 *
 * The answer counts the columns as they stand, the dragged one included, so it names a place in the
 * list rather than a place in the list without it.
 *
 * @param columns the columns as drawn, in order.
 * @param x in the board's content space.
 */
export function columnInsertionIndex(columns: ColumnBox[], x: number): number {
    if (!columns.length) {
        return 0;
    }

    for (const [ index, column ] of columns.entries()) {
        if (x < column.left + column.width / 2) {
            return index;
        }
    }

    return columns.length;
}

/**
 * Whether inserting at the given place would move the column at all. A column dropped just before
 * or just after where it already stands lands where it started.
 */
export function movesColumn(from: number, to: number): boolean {
    return to !== from && to !== from + 1;
}
