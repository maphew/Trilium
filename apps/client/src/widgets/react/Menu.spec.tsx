import { describe, expect, it } from "vitest";

import { rowInNextColumn } from "./Menu";

/** A row 20px tall, `left` into the menu and `top` down it. */
function row(left: number, top: number) {
    return { left, top, bottom: top + 20 };
}

describe("rowInNextColumn", () => {
    // Three rows in the first column, two in the second, one in the third.
    const columns = [
        row(0, 0), row(0, 20), row(0, 40),
        row(100, 0), row(100, 20),
        row(200, 0)
    ];

    it("goes to the row at the same height in the column beside", () => {
        expect(rowInNextColumn(columns, 1, "right")).toBe(4);
        expect(rowInNextColumn(columns, 4, "left")).toBe(1);
        // The nearest column, not the one after it.
        expect(rowInNextColumn(columns, 0, "right")).toBe(3);
    });

    it("goes to the nearest row where the column beside is shorter", () => {
        expect(rowInNextColumn(columns, 2, "right")).toBe(4);
        expect(rowInNextColumn(columns, 4, "right")).toBe(5);
    });

    it("finds nothing past the outermost column, in a single column, or for a row it cannot place", () => {
        expect(rowInNextColumn(columns, 0, "left")).toBeUndefined();
        expect(rowInNextColumn(columns, 5, "right")).toBeUndefined();
        expect(rowInNextColumn([ row(0, 0), row(0, 20) ], 0, "right")).toBeUndefined();
        expect(rowInNextColumn(columns, -1, "right")).toBeUndefined();
        // A row not laid out yet is passed over.
        expect(rowInNextColumn([ row(0, 0), undefined, row(100, 0) ], 0, "right")).toBe(2);
    });
});
