/**
 * The board's drag and drop, which is hand-rolled on the HTML5 events rather than a library: a card
 * moved within the board, and a note dragged in from the tree, cloned or moved depending on
 * whether the board already holds it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import branches from "../../../services/branches";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { TREE_CLIPBOARD_TYPE } from "../../note_tree";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";

vi.mock("../../../services/branches", () => ({
    default: {
        cloneNoteToParentNote: vi.fn(async () => {}),
        cloneNoteAfter: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {}),
        moveBeforeBranch: vi.fn(async () => {})
    }
}));

/** What Preact registers each handler as where the DOM knows no property of that name. */
const PREACT_DRAG_EVENTS = {
    dragover: "DragOver",
    dragleave: "DragLeave",
    drop: "Drop"
} as const;

// Hoisted with the mock, which is lifted above everything a test file declares.
const layout = vi.hoisted(() => ({ onMobile: false }));

// Spread rather than replaced: the board reads far more of this than the one export a test steers.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isMobile: () => layout.onMobile
}));

describe("Board drag and drop", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(branches.cloneNoteToParentNote).mockClear();
        vi.mocked(branches.cloneNoteAfter).mockClear();
        vi.mocked(branches.moveAfterBranch).mockClear();
        vi.mocked(branches.moveBeforeBranch).mockClear();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("marks the card a drop would land before, from where the pointer is", async () => {
        const { columns } = await renderBoard();

        // Above the middle of the second card, so the drop lands between the two.
        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);

        const placeholders = [ ...columns[0].querySelectorAll(".board-column-content > *") ]
            .map(child => child.className);
        expect(placeholders[1]).toContain("board-drop-placeholder");
    });

    it("clears the mark once the pointer leaves the column altogether", async () => {
        const { columns } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);
        expect(columns[0].querySelector(".board-drop-placeholder")).toBeTruthy();

        await drag(columns[0], "dragleave", { types: [] });
        expect(columns[0].querySelector(".board-drop-placeholder")).toBeNull();
    });

    it("ignores a drag carrying something the board has no use for", async () => {
        const { columns } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ "text/uri-list" ] }, 120);

        expect(columns[0].querySelector(".board-drop-placeholder")).toBeNull();
    });

    it("clones a note dragged in from the tree, which the board does not hold", async () => {
        const { columns } = await renderBoard();
        const stranger = buildNote({ title: "Stranger" });

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 0);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: JSON.stringify([ { noteId: stranger.noteId, branchId: "far" } ]) }
        });

        // Dropped above every card, so it goes in as the first rather than after one.
        expect(branches.cloneNoteToParentNote)
            .toHaveBeenCalledWith(stranger.noteId, expect.any(String));
        expect(branches.cloneNoteAfter).not.toHaveBeenCalled();
    });

    it("clones it after the card it was dropped below", async () => {
        const { columns } = await renderBoard();
        const stranger = buildNote({ title: "Stranger" });

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: JSON.stringify([ { noteId: stranger.noteId, branchId: "far" } ]) }
        });

        expect(branches.cloneNoteAfter).toHaveBeenCalled();
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
    });

    it("moves rather than clones a note the board already holds", async () => {
        const { columns, cards } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: JSON.stringify([ { ...cards[0] } ]) }
        });

        expect(branches.moveAfterBranch).toHaveBeenCalled();
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
        expect(branches.cloneNoteAfter).not.toHaveBeenCalled();
    });

    it("does nothing for a drop carrying nothing it can read", async () => {
        const { columns } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: "not json at all" }
        });
        await drag(columns[0], "drop", { types: [ TREE_CLIPBOARD_TYPE ], data: {} });

        expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
        expect(branches.moveAfterBranch).not.toHaveBeenCalled();
    });

    /**
     * A collapsed column draws no cards, so the drop has nowhere to place one until it opens. It
     * stays open after the pointer leaves, which is what lets the card be aimed within it.
     */
    it("opens a collapsed column a card is dragged over, and leaves it open", async () => {
        const { columns } = await renderBoard({ collapsed: true });

        expect(columns[0].classList.contains("collapsed")).toBe(true);

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 50);
        expect(columns[0].classList.contains("collapsed")).toBe(false);
        expect(columns[0].querySelectorAll(".board-note")).toHaveLength(2);
        // At its full width at once, cards and all: the drop is measured as the column opens.
        expect(columns[0].classList.contains("quick-expand")).toBe(false);
        expect(columns[0].classList.contains("expanding")).toBe(false);

        await drag(columns[0], "dragleave", { types: [ TREE_CLIPBOARD_TYPE ] });
        expect(columns[0].classList.contains("collapsed")).toBe(false);
    });

    /**
     * The drag opens the column, the reader does not, so the stored flag stays as it is: the
     * column is a strip again once the card has been dropped and another column is selected.
     */
    it("writes nothing when a dragged card opens a collapsed column", async () => {
        const saveConfig = vi.fn();
        const { columns } = await renderBoard({ collapsed: true, saveConfig });

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 50);

        expect(columns[0].classList.contains("collapsed")).toBe(false);
        expect(saveConfig).not.toHaveBeenCalled();
    });

    /**
     * What the gesture is for: the same move the old clipboard drop made, made by pointer. The
     * board's own wiring is what this covers, the gesture itself being tested on its own.
     */
    it("moves a card carried by pointer to where it was let go", async () => {
        const { columns, cards } = await renderBoard();
        const card = columns[0].querySelector<HTMLElement>(".board-note");
        if (!card) throw new Error("expected a card");

        // The gesture listens from an effect, which Preact defers past the render the board is
        // drawn by. A reader could not press before that; a test can.
        await act(async () => { await settle(); });

        // The second card, carried up until its top stands above the first, so it lands before it.
        const second = columns[0].querySelectorAll<HTMLElement>(".board-note")[1];
        await pointer(second, "pointerdown", 50, 150);
        await pointer(columns[0], "pointermove", 50, 60);
        await act(async () => { await settle(); });
        await pointer(columns[0], "pointerup", 50, 60);
        await act(async () => { await settle(); });

        expect(branches.moveBeforeBranch)
            .toHaveBeenCalledWith([ cards[1].branchId ], cards[0].branchId);
    });

    /**
     * A board that scrolls one column at a time has its snapping off while something is carried, so
     * letting go would otherwise leave the reader looking at two half columns.
     */
    it("brings the column the card landed in to the middle, on a board that snaps", async () => {
        layout.onMobile = true;
        const revealed: { element: Element, options: unknown }[] = [];
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, options: unknown) {
            revealed.push({ element: this, options });
        } as typeof original;

        try {
            const { columns } = await renderBoard();
            const card = columns[0].querySelector<HTMLElement>(".board-note");
            if (!card) throw new Error("expected a card");
            await act(async () => { await settle(); });

            await pointer(card, "pointerdown", 50, 50);
            await pointer(columns[0], "pointermove", 50, 120);
            await pointer(columns[0], "pointerup", 50, 120);
            await act(async () => { await new Promise(requestAnimationFrame); });

            const landed = revealed.at(-1);
            expect(landed?.element).toBe(columns[0]);
            expect(landed?.options).toMatchObject({ inline: "center" });
        } finally {
            Element.prototype.scrollIntoView = original;
            layout.onMobile = false;
        }
    });

    /** Nothing is brought anywhere on a board the reader scrolls freely. */
    it("leaves the board where it is when it does not snap", async () => {
        const revealed: Element[] = [];
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element) {
            revealed.push(this);
        } as typeof original;

        try {
            const { columns } = await renderBoard();
            const card = columns[0].querySelector<HTMLElement>(".board-note");
            if (!card) throw new Error("expected a card");
            await act(async () => { await settle(); });

            await pointer(card, "pointerdown", 50, 50);
            await pointer(columns[0], "pointermove", 50, 120);
            await pointer(columns[0], "pointerup", 50, 120);
            await act(async () => { await new Promise(requestAnimationFrame); });

            expect(revealed.filter(element =>
                element.classList.contains("board-column"))).toEqual([]);
        } finally {
            Element.prototype.scrollIntoView = original;
        }
    });

    /**
     * The press focuses the card, the card is then taken out of the page, and a card that crossed
     * columns is drawn as a new element: whichever happened, the focus has to be put back.
     */
    it("focuses the card again once it is let go", async () => {
        const { columns } = await renderBoard();
        const card = columns[0].querySelector<HTMLElement>(".board-note");
        if (!card) throw new Error("expected a card");
        // Twice: the gesture listens from an effect, and the board redraws once more as its own
        // first refresh lands, which is what tells the effect the container is there.
        await act(async () => { await settle(); });
        await act(async () => { await settle(); });

        await pointer(card, "pointerdown", 50, 50);
        await pointer(columns[0], "pointermove", 50, 120);
        await pointer(columns[0], "pointerup", 50, 120);
        await act(async () => { await settle(); });

        expect(document.activeElement?.getAttribute("data-note-id"))
            .toBe(card.getAttribute("data-note-id"));
    });

    /** The gap stands in for the card, so it is the height the card was measured at. */
    it("holds open a gap the height of the card being carried", async () => {
        const { columns } = await renderBoard();
        const card = columns[0].querySelector<HTMLElement>(".board-note");
        if (!card) throw new Error("expected a card");
        await act(async () => { await settle(); });

        await pointer(card, "pointerdown", 50, 50);
        await pointer(columns[0], "pointermove", 50, 120);

        const gap = columns[0].querySelector<HTMLElement>(".board-drop-placeholder");
        expect(gap?.style.height).toBe("100px");
    });

    function place(
        element: HTMLElement | null,
        box: { left: number, top: number, width: number, height: number }
    ) {
        if (element) {
            element.getBoundingClientRect = () => ({
                ...box, right: box.left + box.width, bottom: box.top + box.height
            }) as DOMRect;
        }
    }

    async function pointer(target: HTMLElement, type: string, clientX: number, clientY: number) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [ name, value ] of Object.entries({
            clientX, clientY, pointerId: 1, button: 0, pointerType: "mouse"
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }
        await act(async () => {
            target.dispatchEvent(event);
            await settle();
        });
    }

    /** A board of one column of two cards, each given a height the pointer can be placed in. */
    async function renderBoard(
        { collapsed, saveConfig }: { collapsed?: boolean, saveConfig?: () => void } = {}
    ) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={note}
                        notePath={`root/${note.noteId}`}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        highlightedTokens={null}
                        viewConfig={{ columns: [ { value: "To Do", collapsed } ] }}
                        saveConfig={saveConfig ?? (() => {})}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();

        const columns = [ ...mountPoint.querySelectorAll<HTMLElement>(".board-column") ];
        // happy-dom lays nothing out, so the cards are given the geometry the drop maths reads.
        for (const [ index, card ] of [ ...columns[0].querySelectorAll(".board-note") ].entries()) {
            card.getBoundingClientRect = () => ({
                left: 0, top: index * 100, width: 100, height: 100
            }) as DOMRect;
        }

        // The pointer gesture measures the board itself, so its boxes are declared as well.
        const board = mountPoint.querySelector<HTMLElement>(".board-view-container");
        place(board, { left: 0, top: 0, width: 400, height: 400 });
        Object.defineProperty(board, "scrollLeft", { value: 0, configurable: true });
        place(columns[0], { left: 0, top: 0, width: 100, height: 400 });
        const area = columns[0].querySelector<HTMLElement>(".board-column-content");
        if (area) {
            place(area, { left: 0, top: 0, width: 100, height: 400 });
            Object.defineProperty(area, "scrollTop", { value: 0, configurable: true });
        }

        const cards = note.getChildBranches()
            .map(branch => ({ noteId: branch.noteId, branchId: branch.branchId }));

        return { note, columns, cards };
    }

    /** Dispatches one of the drag events, with the clipboard the board reads its payload from. */
    async function drag(
        target: HTMLElement,
        type: "dragover" | "dragleave" | "drop",
        clipboard: { types: string[], data?: Record<string, string> },
        clientY = 0
    ) {
        // happy-dom defines no `ondragover`/`ondrop` on elements, and Preact falls back to the
        // prop's own casing where the DOM knows no lowercase one. A `dragover` reaches nothing.
        const known = `on${type}` in document.createElement("div");
        const event = new Event(known ? type : PREACT_DRAG_EVENTS[type], {
            bubbles: true,
            cancelable: true
        });
        // Defined rather than assigned: these are accessors on the event, which a plain assignment
        // does not get past.
        for (const [ name, value ] of Object.entries({
            clientY,
            relatedTarget: null,
            dataTransfer: {
                types: clipboard.types,
                getData: (dataType: string) => clipboard.data?.[dataType] ?? ""
            }
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }

        await act(async () => {
            target.dispatchEvent(event);
            await settle();
        });
    }

    function settle() {
        return new Promise((resolve) => setTimeout(resolve));
    }
});

describe("Board column reordering", () => {
    let container: HTMLElement | undefined;
    const saved: BoardViewData[] = [];

    beforeEach(() => {
        saved.length = 0;
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("drops a column to the right of the one it was let go over", async () => {
        const { columns } = await renderColumns();

        // Past the middle of the last column, which spans 200 to 300, so it lands after it.
        await carryColumn(columns[0], 280);

        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "Doing", "Done", "To Do" ]);
    });

    it("drops it to the left when let go over the first half of a column", async () => {
        const { columns } = await renderColumns();

        // Short of the middle of the second column, which spans 100 to 200.
        await carryColumn(columns[2], 120);

        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "To Do", "Done", "Doing" ]);
    });

    /**
     * The gap held open while a column is carried stands in for that column, and a collapsed one
     * is a strip. A placeholder of the stock width would promise a space the column will not fill.
     */
    it("holds open a gap the size of the column being carried", async () => {
        const { columns, board } = await renderColumns({ height: 140 });

        await carryColumn(columns[0], 280, { release: false });

        const placeholder = board.querySelector<HTMLElement>(".column-drop-placeholder");
        expect(placeholder?.style.width).toBe("100px");
        expect(placeholder?.style.height).toBe("140px");
    });

    /** happy-dom lays nothing out, which is what an element with no size on screen reports too. */
    it("leaves the gap at its stock size when the column measures nothing", async () => {
        const { columns, board } = await renderColumns({ width: 0 });

        await carryColumn(columns[0], 280, { release: false });

        const placeholder = board.querySelector<HTMLElement>(".column-drop-placeholder");
        expect(placeholder?.style.width).toBe("");
    });

    /** A copy of it is carried, capped so a tall column does not cover the board it is placed on. */
    it("carries a copy, hiding the column until it is let go", async () => {
        const { columns, board } = await renderColumns();

        await carryColumn(columns[0], 280, { release: false });
        const copy = board.querySelector<HTMLElement>(".board-column.board-drag-preview");
        expect(copy).toBeTruthy();
        expect(copy?.style.maxHeight).toBe("150px");
        expect(copy?.style.height).toBe("");
        // Nothing on the copy can be used, and the footer would stand under cards it cannot add to.
        expect(copy?.querySelector(".board-new-item")).toBeNull();
        expect(columns[0].style.display).toBe("none");

        await columnPointer(board, "pointerup", 280);
        expect(board.querySelector(".board-drag-preview")).toBeNull();
        expect(columns[0].style.display).toBe("");
    });

    /**
     * Let go either side of where it stands, a column lands where it started, and the board is not
     * written to for a move that moves nothing.
     */
    it("saves nothing for a column carried back to where it was", async () => {
        const { columns } = await renderColumns();

        await carryColumn(columns[1], 120);

        expect(saved).toEqual([]);
    });

    /** The board's row as it is laid out: the columns' wrapper is `display: contents`. */
    function laidOut(board: HTMLElement) {
        return [ ...board.children ].flatMap((child) =>
            child.classList.contains("board-columns") ? [ ...child.children ] : [ child ]);
    }

    /**
     * What a drop leads to: the board is drawn again with the columns in a new order. Their
     * elements are keyed, so Preact moves them, and it places what it moves against the parent's
     * own children. Anything among them it is not keeping track of can be stepped over.
     */
    it("keeps the button after every column once they are drawn in a new order", async () => {
        const { board } = await renderColumns();
        const order = () => laidOut(board)
            .filter(child => child.classList.contains("board-column")
                || child.classList.contains("board-add-column"))
            .map(child => child.getAttribute("data-column") ?? "add");

        expect(order()).toEqual([ "To Do", "Doing", "Done", "add" ]);

        await drawColumns([ "Done", "To Do", "Doing" ]);
        expect(order()).toEqual([ "Done", "To Do", "Doing", "add" ]);

        await drawColumns([ "Doing", "Done", "To Do" ]);
        expect(order()).toEqual([ "Doing", "Done", "To Do", "add" ]);
    });

    /**
     * The drop changes two things at once: the columns take a new order and the gap held open for
     * the carried one goes. Both land in a single redraw, which is where the button is placed.
     */
    it("keeps the button after every column once a carried one is let go", async () => {
        const { columns, board } = await renderColumns();
        const order = () => laidOut(board)
            .filter(child => (child.classList.contains("board-column")
                && !child.classList.contains("board-drag-preview"))
                || child.classList.contains("board-add-column"))
            .map(child => child.getAttribute("data-column") ?? "add");

        // Past the middle of the last column, so it is let go at the end.
        await carryColumn(columns[0], 280);

        expect(order()).toEqual([ "Doing", "Done", "To Do", "add" ]);
    });

    /** The button that adds a column stands at the end, whatever the gap does among the columns. */
    it("keeps the button that adds a column at the end while one is carried", async () => {
        const { columns, board } = await renderColumns();

        /** Whether the button stands after every column, the overlays after it being no columns. */
        const afterEveryColumn = () => {
            const children = laidOut(board);
            const button = children.findIndex(child =>
                child.classList.contains("board-add-column"));
            // The copy being carried wears the column's classes so the board's styling reaches it,
            // and is placed against the window rather than among them.
            const lastColumn = children.findLastIndex(child =>
                child.classList.contains("board-column")
                    && !child.classList.contains("board-drag-preview"));
            return button > lastColumn && button >= 0;
        };

        expect(afterEveryColumn()).toBe(true);

        // Over each column in turn, so the gap opens at every place among them.
        await carryColumn(columns[0], 120, { release: false });
        expect(afterEveryColumn()).toBe(true);

        await columnPointer(board, "pointermove", 220);
        expect(afterEveryColumn()).toBe(true);

        await columnPointer(board, "pointermove", 280);
        expect(afterEveryColumn()).toBe(true);

        await columnPointer(board, "pointerup", 280);
        expect(afterEveryColumn()).toBe(true);
    });

    /** Takes hold of a column by its heading, carries it to `clientX` and lets it go there. */
    async function carryColumn(
        column: HTMLElement,
        clientX: number,
        { release = true }: { release?: boolean } = {}
    ) {
        const heading = column.querySelector<HTMLElement>("h3");
        if (!heading) throw new Error("expected a column heading");

        const board = column.closest<HTMLElement>(".board-view-container");
        if (!board) throw new Error("expected a board");

        // Taken by a point inside the column, so where its middle stands follows the pointer.
        const { left, width } = column.getBoundingClientRect();
        await columnPointer(heading, "pointerdown", left + width / 2);
        await columnPointer(board, "pointermove", clientX);
        if (release) {
            await columnPointer(board, "pointerup", clientX);
        }
    }

    async function columnPointer(target: HTMLElement, type: string, clientX: number) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [ name, value ] of Object.entries({
            clientX, clientY: 0, pointerId: 1, button: 0, pointerType: "mouse"
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }
        await act(async () => {
            target.dispatchEvent(event);
            await settle();
        });
    }

    it("saves nothing for a column let go where it already was", async () => {
        const { columns, board } = await renderColumns();

        await dragColumn(columns[1], "dragstart");
        await dragColumn(columns[1], "dragover", 120);
        await dragColumn(board, "drop");

        expect(saved).toHaveLength(0);
    });

    /** A board of three columns, each given the geometry the drop maths reads. */
    let drawColumns: (order: string[]) => Promise<void> = async () => {};

    async function renderColumns({ width = 100, height = 400 } = {}) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "Doing" },
                { title: "Third", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        drawColumns = async (order: string[]) => {
            await act(async () => {
                render(
                    <ParentComponent.Provider value={new Component()}>
                        <BoardView
                            note={note}
                            notePath={`root/${note.noteId}`}
                            noteIds={[ ...note.getChildNoteIds() ]}
                            highlightedTokens={null}
                            viewConfig={{ columns: order.map(value => ({ value })) }}
                            saveConfig={(config) => saved.push(config)}
                            media="screen"
                            onReady={() => {}}
                        />
                    </ParentComponent.Provider>,
                    mountPoint
                );
                await settle();
            });
            await act(async () => { await settle(); });
        };

        await drawColumns([ "To Do", "Doing", "Done" ]);

        const columns = [ ...mountPoint.querySelectorAll<HTMLElement>(".board-column") ];
        for (const [ index, column ] of columns.entries()) {
            column.getBoundingClientRect = () => ({
                left: index * 100, top: 0, width, height
            }) as DOMRect;
        }

        const board = mountPoint.querySelector<HTMLElement>(".board-view-container");
        if (!board) throw new Error("expected the board container");

        board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height }) as DOMRect;
        Object.defineProperty(board, "scrollLeft", { value: 0, configurable: true });
        // The gesture listens from an effect, which Preact defers past the render.
        await act(async () => { await settle(); });

        return { columns, board };
    }

    /** Drags by the header, which is the handle, and drops on the board the columns stand in. */
    async function dragColumn(
        target: HTMLElement,
        type: "dragstart" | "dragover" | "dragend" | "drop",
        clientX = 0
    ) {
        const cased = {
            dragstart: "DragStart", dragover: "DragOver", dragend: "DragEnd", drop: "Drop"
        }[type];
        const event = new Event(`on${type}` in target ? type : cased, {
            bubbles: true,
            cancelable: true
        });

        for (const [ name, value ] of Object.entries({
            clientX,
            dataTransfer: { effectAllowed: "", types: [], setData: () => {}, getData: () => "" }
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }

        const from = type === "dragstart" || type === "dragend"
            ? target.querySelector("h3") ?? target
            : target;

        await act(async () => {
            from.dispatchEvent(event);
            await settle();
        });
    }

    function settle() {
        return new Promise((resolve) => setTimeout(resolve));
    }
});
