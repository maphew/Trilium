import { afterEach, describe, expect, it } from "vitest";

import { cardInsertionIndex, columnAt } from "./drag_geometry";
import { measureBoard, toAreaY, toBoardX } from "./drag_measure";

let container: HTMLElement | undefined;

afterEach(() => {
    container?.remove();
    container = undefined;
});

/**
 * happy-dom lays nothing out, so every box is declared. The board is placed 50px into the page and
 * scrolled 200px along, which is what tells a content-space measurement from a viewport one.
 */
function buildBoard({ scrollLeft = 200, areaScrollTop = 20, cardCounts = [ 2, 1 ] } = {}) {
    container = document.createElement("div");
    container.className = "board-view-container";
    document.body.appendChild(container);
    place(container, { left: 50, top: 0, width: 500, height: 400 });
    Object.defineProperty(container, "scrollLeft", { value: scrollLeft, configurable: true });

    for (const [ index, cards ] of cardCounts.entries()) {
        const column = document.createElement("div");
        column.className = "board-column";
        column.dataset.column = [ "To Do", "Doing", "Done" ][index];
        container.appendChild(column);
        // On screen the columns have already been scrolled 200px to the left.
        place(column, { left: 50 + index * 120 - scrollLeft, top: 0, width: 100, height: 400 });

        const area = document.createElement("div");
        area.className = "board-column-content";
        column.appendChild(area);
        place(area, { left: 0, top: 40, width: 100, height: 360 });
        Object.defineProperty(area, "scrollTop", { value: areaScrollTop, configurable: true });

        for (let card = 0; card < cards; card++) {
            const note = document.createElement("div");
            note.className = "board-note";
            area.appendChild(note);
            // Stated where the card stands in the area's content, then drawn where that leaves it
            // on screen once the area has been scrolled.
            place(note, {
                left: 0,
                top: 40 + cardContentTop(card) - areaScrollTop,
                width: 100,
                height: 50
            });
        }
    }

    return container;
}

/** Where card `index` stands in its area's content, whatever the area is scrolled to. */
function cardContentTop(index: number) {
    return 10 + index * 60;
}

function place(element: HTMLElement, box: { left: number, top: number, width: number, height: number }) {
    element.getBoundingClientRect = () => ({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height
    }) as DOMRect;
}

describe("measureBoard", () => {
    it("leaves the copy being carried out of the columns it measures", () => {
        const board = buildBoard();
        const carried = board.querySelector<HTMLElement>(".board-column")?.cloneNode(true);
        if (!(carried instanceof HTMLElement)) throw new Error("expected a column to copy");

        carried.classList.add("board-drag-preview");
        board.appendChild(carried);
        place(carried, { left: 500, top: 0, width: 100, height: 400 });

        // One place per column drawn, and none for the copy: counting it would offer a place one
        // past every place the board has.
        expect(measureBoard(board).columns).toHaveLength(
            board.querySelectorAll(".board-column:not(.board-drag-preview)").length);
    });

    it("places the columns past the board's own scrolling", () => {
        const board = buildBoard();

        const { columns } = measureBoard(board);

        // On screen the first column starts at -150; in the board's content space it starts at 0.
        expect(columns.map((column) => ({ value: column.value, left: column.left })))
            .toEqual([ { value: "To Do", left: 0 }, { value: "Doing", left: 120 } ]);
    });

    it("places the cards past their own column's scrolling", () => {
        const expected = [ { top: 10, height: 50 }, { top: 70, height: 50 } ];

        // The same cards, drawn at different places on screen, measure to the same content.
        expect(measureBoard(buildBoard({ areaScrollTop: 0 })).columns[0].cards).toEqual(expected);
        container?.remove();
        expect(measureBoard(buildBoard({ areaScrollTop: 90 })).columns[0].cards).toEqual(expected);
    });

    it("hands back each column's card area, and counts a column holding none", () => {
        const board = buildBoard({ cardCounts: [ 0, 1 ] });

        const { columns, areas } = measureBoard(board);

        expect(columns[0].cards).toEqual([]);
        expect(areas.get("To Do")).toBe(board.querySelector(".board-column-content"));
    });

    /** A collapsed column draws no card area at all. */
    it("counts a column with no card area as holding no cards", () => {
        const board = buildBoard();
        board.querySelector(".board-column-content")?.remove();

        const { columns, areas } = measureBoard(board);

        expect(columns[0].cards).toEqual([]);
        expect(areas.has("To Do")).toBe(false);
    });

    it("measures nothing for a board with no columns", () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        place(container, { left: 0, top: 0, width: 100, height: 100 });

        expect(measureBoard(container).columns).toEqual([]);
    });
});

describe("reading a point against a measurement", () => {
    /** What a move does: two rectangles read, whatever the board holds. */
    it("finds the column and the place a card would take", () => {
        const board = buildBoard();
        const { columns, areas } = measureBoard(board);

        // Over the second column on screen, which starts at -30 and runs 100 wide.
        const column = columnAt(columns, toBoardX(board, 20));
        expect(column?.value).toBe("Doing");

        const area = areas.get("Doing");
        if (!area) throw new Error("expected a card area");

        // Its one card stands at 10 in the area's content and is 50 tall, so its place ends at 60.
        // The area is 20 scrolled and starts 40 down the page, so that end is at 80 on screen.
        expect(cardInsertionIndex(column?.cards ?? [], toAreaY(area, 70))).toBe(0);
        expect(cardInsertionIndex(column?.cards ?? [], toAreaY(area, 90))).toBe(1);
    });

    it("reads a point over the same column the same way however far the board is scrolled", () => {
        for (const scrollLeft of [ 0, 200, 640 ]) {
            const board = buildBoard({ scrollLeft });
            const { columns } = measureBoard(board);

            // Where the first column is drawn moves with the scrolling; what it measures to does
            // not, which is what leaves a measurement good for the whole gesture.
            const onScreen = 50 - scrollLeft + 10;
            expect(toBoardX(board, onScreen)).toBe(10);
            expect(columnAt(columns, toBoardX(board, onScreen))?.value).toBe("To Do");
            board.remove();
        }
    });
});
