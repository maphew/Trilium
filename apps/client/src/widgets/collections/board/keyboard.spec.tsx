/**
 * The board's keyboard: the arrows, Home and End walk it, the same with Alt move what is focused,
 * and Space opens a card. Driven through the rendered board rather than the hook, since where focus
 * lands and what it lands on is the whole of what these keys do.
 */
import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import { FLIP_DURATION_MS, FLIP_SETTLE_MS } from "../../react/flip";
import contextMenu from "../../../menus/context_menu";
import froca from "../../../services/froca";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardApi from "./api";
import BoardView, { BoardViewData } from ".";

vi.mock("../../../services/branches", () => ({
    default: {
        moveBeforeBranch: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {}),
        cloneNoteToParentNote: vi.fn(async () => {}),
        cloneNoteAfter: vi.fn(async () => {}),
        deleteNotes: vi.fn(async () => {})
    }
}));

// The card menu opens with the link items on top, which want a tab manager this spec has none of.
vi.mock("../../../menus/link_context_menu", () => ({
    default: { getItems: () => [], handleLinkContextMenuItem: vi.fn() }
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: $.Deferred().resolve()
}));

describe("Board keyboard", () => {
    let container: HTMLElement | undefined;
    const saved: BoardViewData[] = [];

    beforeEach(() => {
        saved.length = 0;
        vi.restoreAllMocks();
        // A mocked module is not a spy, so restoring leaves its calls where the last test left.
        vi.mocked(branches.deleteNotes).mockClear();
        vi.mocked(branches.moveBeforeBranch).mockClear();
        vi.mocked(branches.moveAfterBranch).mockClear();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        vi.useRealTimers();
    });

    describe("moving about", () => {
        it("walks a column from its header, through its cards, to its button", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            expect(press(board, "ArrowDown")).toBe("First");
            expect(press(board, "ArrowDown")).toBe("Second");
            expect(press(board, "ArrowDown")).toBe("board_view.new-item");

            // The button under the column is the end of it.
            press(board, "ArrowDown");
            expect(focusedName(board)).toBe("board_view.new-item");

            expect(press(board, "ArrowUp")).toBe("Second");
            expect(press(board, "ArrowUp")).toBe("First");
            expect(press(board, "ArrowUp")).toBe("To Do");

            // And its header is the start.
            press(board, "ArrowUp");
            expect(focusedName(board)).toBe("To Do");
        });

        /**
         * What a move sends focus to is carried back to where it came from and let go, which turns
         * the move into a slide. The browser scrolls to where a thing is drawn, so a scroll asked
         * for while that slide runs finds it where it started and leaves the column alone.
         */
        it("brings what it focuses into view once the slide it made has run", async () => {
            const board = await renderBoard();
            const seen = vi.fn();
            for (const card of board.querySelectorAll(".board-note")) {
                Object.defineProperty(card, "scrollIntoView", {
                    value: seen, configurable: true, writable: true
                });
            }

            // Only around the press: the board is drawn with timers of its own to wait for.
            vi.useFakeTimers();
            focusHeader(board, 0);
            press(board, "ArrowDown");
            expect(seen).not.toHaveBeenCalled();

            // Not while the slide is still running, which is the whole point of the wait.
            act(() => { vi.advanceTimersByTime(FLIP_DURATION_MS - 20); });
            expect(seen).not.toHaveBeenCalled();

            act(() => { vi.advanceTimersByTime(FLIP_SETTLE_MS); });
            expect(seen).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
        });

        it("takes the column to its end for the last card, which a fade stands over", async () => {
            const board = await renderBoard();
            const content = board.querySelector<HTMLElement>(".board-column-content");
            if (!content) throw new Error("expected a scrollable column body");
            const seen = vi.fn();
            for (const card of board.querySelectorAll(".board-note")) {
                Object.defineProperty(card, "scrollIntoView", {
                    value: seen, configurable: true, writable: true
                });
            }
            Object.defineProperty(content, "scrollHeight", {
                value: 640, configurable: true, writable: true
            });
            content.scrollTop = 0;

            vi.useFakeTimers();
            focusHeader(board, 0);
            press(board, "ArrowDown");
            press(board, "ArrowDown");
            act(() => { vi.advanceTimersByTime(FLIP_SETTLE_MS + 10); });

            expect(focusedName(board)).toBe("Second");
            expect(content.scrollTop).toBe(640);
            // And still asked into view, which is what carries the board across to its column.
            expect(seen).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
        });

        it("crosses to the first card of the next column rather than to its header", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            expect(press(board, "ArrowRight")).toBe("Third");
            expect(press(board, "ArrowLeft")).toBe("First");
        });

        it("offers the button of an empty column, and the one that adds a column", async () => {
            const board = await renderBoard();
            focusHeader(board, 2);

            // The third column is empty, so its button is what crossing into it reaches.
            expect(press(board, "ArrowLeft")).toBe("Third");
            expect(press(board, "ArrowRight")).toBe("board_view.new-item");
            expect(press(board, "ArrowRight")).toBe("board_view.add-column");
            expect(press(board, "ArrowRight")).toBe("board_view.add-column");
            expect(press(board, "ArrowLeft")).toBe("board_view.new-item");
        });

        it("jumps to the ends of a column with Home and End", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            expect(press(board, "End")).toBe("Second");
            expect(press(board, "Home")).toBe("First");
        });

        /**
         * `Alt+Left` and `Alt+Right` are the app's own back and forward in note history, bound on
         * the document. A key the board answers must not also navigate away from it.
         */
        it("keeps the keys it answers from reaching what else is bound to them", async () => {
            const board = await renderBoard();
            const reachedDocument: string[] = [];
            const listener = (e: Event) => reachedDocument.push((e as KeyboardEvent).key);
            document.addEventListener("keydown", listener);

            try {
                focusCard(board, 0, 0);
                press(board, "ArrowDown");
                press(board, "ArrowRight", { ctrlKey: true });
                // Even at an edge it moves nothing from: the board owns the key while focused.
                focusCard(board, 0, 0);
                press(board, "ArrowLeft", { ctrlKey: true });
                press(board, "End", { ctrlKey: true });
                press(board, "ArrowRight", { ctrlKey: true, altKey: true });
                press(board, " ");

                expect(reachedDocument).toEqual([]);
            } finally {
                document.removeEventListener("keydown", listener);
            }
        });

        /**
         * Going back and forward through notes is bound on the document with Alt and an arrow. A
         * board is no reason for it to stop working, so the board answers to Ctrl instead.
         */
        it("lets Alt and an arrow through to the app's own back and forward", async () => {
            const board = await renderBoard();
            const reachedDocument: string[] = [];
            const listener = (e: Event) => reachedDocument.push((e as KeyboardEvent).key);
            document.addEventListener("keydown", listener);

            try {
                focusCard(board, 0, 0);
                press(board, "ArrowLeft", { altKey: true });
                press(board, "ArrowRight", { altKey: true });

                expect(reachedDocument).toEqual([ "ArrowLeft", "ArrowRight" ]);
                expect(saved).toHaveLength(0);
            } finally {
                document.removeEventListener("keydown", listener);
            }
        });

        it("leaves the keys alone while a title is being edited", async () => {
            const board = await renderBoard();
            const header = board.querySelectorAll<HTMLElement>(".board-column h3")[0];

            await act(async () => {
                header.focus();
                header.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
                await flush();
            });

            const editor = header.querySelector<HTMLInputElement>("input");
            if (!editor) throw new Error("expected the title editor");
            editor.focus();

            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
            expect(document.activeElement).toBe(editor);
        });
    });

    describe("the menu key", () => {
        it("asks the focused card and header for their own menus", async () => {
            const board = await renderBoard();
            const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);

            focusCard(board, 0, 0);
            press(board, "ContextMenu");
            expect(show).toHaveBeenCalledTimes(1);
            // The card menu, which is the only one offering to take a note off the board.
            expect(show.mock.calls[0][0].items.some(item =>
                item && "title" in item && item.title === "board_view.remove-from-board"
            )).toBe(true);

            focusHeader(board, 0);
            press(board, "ContextMenu");
            expect(show).toHaveBeenCalledTimes(2);
            expect(show.mock.calls[1][0].items.some(item =>
                item && "title" in item && item.title === "board_view.rename-column")).toBe(true);
        });

        it("leaves the key alone where nothing focused has a menu", async () => {
            const board = await renderBoard();
            const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);

            focusButton(board, 0);
            press(board, "ContextMenu");

            expect(show).not.toHaveBeenCalled();
        });
    });

    describe("taking a card off the board", () => {
        it("strips the grouping label with Delete, leaving the note where it is", async () => {
            const board = await renderBoard();
            const removed = noteOf(board, "First");
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            focusCard(board, 0, 0);

            press(board, "Delete");

            expect(strip)
                .toHaveBeenCalledWith(expect.objectContaining({ noteId: removed }), "status");
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });

        it("deletes the note itself with Shift and Delete", async () => {
            const board = await renderBoard();
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            focusCard(board, 0, 0);

            press(board, "Delete", { shiftKey: true });

            expect(branches.deleteNotes).toHaveBeenCalledWith(
                [ branchOf(board, "First") ], false, false);
            expect(strip).not.toHaveBeenCalled();
        });

        /**
         * The card is about to go, so focus is handed on as the key is pressed rather than left to
         * the redraw: until the card goes it still holds focus, and a redraw reaching the board
         * first would take that for the reader having chosen where to be.
         */
        it("hands focus to the card below the one that goes, before it goes", async () => {
            const board = await renderBoard();
            vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            const removed = noteOf(board, "First");
            focusCard(board, 0, 0);

            press(board, "Delete");
            expect(focusedName(board)).toBe("Second");

            setStatus(removed, "");
            await redraw();
            expect(focusedName(board)).toBe("Second");
        });

        it("takes the whole column off the board from its header, asking first", async () => {
            const board = await renderBoard();
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            const remove = vi.spyOn(BoardApi.prototype, "confirmAndRemoveColumn")
                .mockResolvedValue(true);
            focusHeader(board, 0);

            press(board, "Delete");

            expect(remove).toHaveBeenCalledWith("To Do");
            // The cards in it are the column'"'"'s to take, not this key'"'"'s.
            expect(strip).not.toHaveBeenCalled();
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });

        /** Escalating a column would take every note in it, which nothing else here offers. */
        it("leaves Shift and Delete on a header unanswered", async () => {
            const board = await renderBoard();
            const remove = vi.spyOn(BoardApi.prototype, "confirmAndRemoveColumn")
                .mockResolvedValue(true);
            focusHeader(board, 0);

            press(board, "Delete", { shiftKey: true });

            expect(remove).not.toHaveBeenCalled();
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });
    });

    describe("walking a board with a collapsed column", () => {
        const columnAt = (board: HTMLElement, index: number) =>
            [ ...board.querySelectorAll<HTMLElement>(".board-column") ][index];

        /**
         * A collapsed column draws neither cards nor the button under them, so the walk has only
         * its header to land on. Landing nowhere would carry focus straight past the column.
         */
        it("lands on a collapsed column's header instead of passing it", async () => {
            const board = await renderBoard("Doing");
            focusCard(board, 0, 0);

            press(board, "ArrowRight");

            expect(document.activeElement).toBe(columnAt(board, 1).querySelector("h3"));
            // Landing on it is not opening it.
            expect(columnAt(board, 1).classList.contains("collapsed")).toBe(true);
        });

        it("walks back out of a collapsed header the way it came", async () => {
            const board = await renderBoard("Doing");
            focusCard(board, 0, 0);

            press(board, "ArrowRight");
            press(board, "ArrowLeft");

            expect(focusedName(board)).toBe("First");
        });

        it("opens the column with Space and steps onto its first card", async () => {
            const board = await renderBoard("Doing");
            focusHeader(board, 1);

            press(board, " ");
            await act(async () => { await flush(); });

            expect(columnAt(board, 1).classList.contains("collapsed")).toBe(false);
            expect(focusedName(board)).toBe("Third");
            // Opened by hand, so the column stays open rather than shutting behind the reader.
            expect(saved.at(-1)?.columns?.find(col => col.value === "Doing")?.collapsed)
                .toBeUndefined();
        });

        /** Nothing to step onto, so the column opens and focus stays where it was. */
        it("opens an empty column with Space and leaves focus on its header", async () => {
            const board = await renderBoard("Done");
            focusHeader(board, 2);

            press(board, " ");
            await act(async () => { await flush(); });

            expect(columnAt(board, 2).classList.contains("collapsed")).toBe(false);
            expect(document.activeElement).toBe(columnAt(board, 2).querySelector("h3"));
        });

        it("opens it with Enter too, the header being announced as a button", async () => {
            const board = await renderBoard("Doing");
            focusHeader(board, 1);

            press(board, "Enter");
            await act(async () => { await flush(); });

            expect(columnAt(board, 1).classList.contains("collapsed")).toBe(false);
            expect(focusedName(board)).toBe("Third");
        });

        it("leaves Space and Enter alone on a column that is not collapsed", async () => {
            const board = await renderBoard();
            focusHeader(board, 1);

            press(board, " ");
            press(board, "Enter");

            expect(document.activeElement).toBe(columnAt(board, 1).querySelector("h3"));
            expect(columnAt(board, 1).querySelectorAll(".board-note")).toHaveLength(1);
        });
    });

    describe("moving what is focused", () => {
        /**
         * A collapsed column draws no cards, so the card carried into it would have nothing to be
         * focused on. The column has to open as part of the move.
         */
        it("opens a collapsed column a card is carried into, and focuses the card there", async () => {
            const board = await renderBoard("Doing");
            const columnAt = (index: number) =>
                [ ...board.querySelectorAll<HTMLElement>(".board-column") ][index];

            expect(columnAt(1).classList.contains("collapsed")).toBe(true);

            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });
            await redraw();

            // Open from the moment the move is asked for, not once the write has landed.
            expect(columnAt(1).classList.contains("collapsed")).toBe(false);

            setStatus(moved, "Doing");
            await redraw();

            expect(columnAt(1).classList.contains("collapsed")).toBe(false);
            expect(columnAt(1).querySelectorAll(".board-note")).toHaveLength(2);
            // The card that moved is what focus rests on, as for any other cross-column move.
            expect(columnOf(board, "First")).toBe(1);
            expect(focusedName(board)).toBe("First");
        });

        it("moves a card up and down its own column", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            expect(branches.moveBeforeBranch)
                .toHaveBeenCalledWith([ branchOf(board, "Second") ], branchOf(board, "First"));

            focusCard(board, 0, 0);
            press(board, "ArrowDown", { ctrlKey: true });
            // Placed past the card below it, which is the last, so it goes after that one.
            expect(branches.moveAfterBranch)
                .toHaveBeenCalledWith([ branchOf(board, "First") ], branchOf(board, "Second"));
        });

        it("sends a card to the end of the column beside it, keeping focus", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });
            await act(async () => { await flush(); });

            const [ url, body ] = vi.mocked(server.put).mock.calls.at(-1) ?? [];
            expect(url).toBe(`notes/${noteOf(board, "First")}/set-attribute`);
            expect(body).toMatchObject({ name: "status", value: "Doing" });
            expect(branches.moveAfterBranch)
                .toHaveBeenCalledWith([ branchOf(board, "First") ], branchOf(board, "Third"));
        });

        /**
         * The card is drawn again under another parent, so its element is a new one and whatever
         * held focus is gone. Two writes go out, each landing a redraw of its own, and the card is
         * only where it was asked to be after the second.
         */
        it("keeps focus on a card once it has actually crossed to the other column", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });

            // The first redraw arrives before the label the move writes has been applied.
            await redraw();
            expect(focusedName(board)).toBe("First");

            // The second carries it, and the card is drawn afresh in the column beside it.
            setStatus(moved, "Doing");
            await redraw();

            expect(columnOf(board, "First")).toBe(1);
            expect(focusedName(board)).toBe("First");
        });

        it("keeps focus on a card sent to the column on its left", async () => {
            const board = await renderBoard();
            focusCard(board, 1, 0);
            const moved = noteOf(board, "Third");

            press(board, "ArrowLeft", { ctrlKey: true });

            await redraw();
            setStatus(moved, "To Do");
            await redraw();

            expect(columnOf(board, "Third")).toBe(0);
            expect(focusedName(board)).toBe("Third");
        });

        it("carries the column from its header, which holds no card of its own", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            press(board, "ArrowRight", { ctrlKey: true });

            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);
            expect(focusedName(board)).toBe("To Do");
        });

        /**
         * A move still settling holds focus until its card arrives. Opening a note takes focus away
         * on purpose, and the hold would pull it straight back.
         */
        it("stops holding focus once the reader opens a note", async () => {
            const board = await renderBoard();
            const open = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);

            focusCard(board, 0, 0);
            press(board, "ArrowRight", { ctrlKey: true });
            press(board, " ");
            expect(open).toHaveBeenCalled();

            // Focus is let go of, so redrawing around the move does not take it back.
            const elsewhere = document.createElement("input");
            document.body.appendChild(elsewhere);
            elsewhere.focus();

            await redraw();
            expect(document.activeElement).toBe(elsewhere);
            elsewhere.remove();
        });

        it("keeps focus through the redraws that follow a card arriving", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });
            setStatus(moved, "Doing");
            await redraw();
            expect(focusedName(board)).toBe("First");

            // The second write lands its own redraw, and more arrive from elsewhere.
            await redraw();
            await redraw();
            expect(focusedName(board)).toBe("First");
        });

        it("keeps focus on a card sent across and then straight back", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });
            setStatus(moved, "Doing");
            await redraw();
            expect(columnOf(board, "First")).toBe(1);
            expect(focusedName(board)).toBe("First");

            press(board, "ArrowLeft", { ctrlKey: true });
            setStatus(moved, "To Do");
            await redraw();

            expect(columnOf(board, "First")).toBe(0);
            expect(focusedName(board)).toBe("First");
        });

        /**
         * Reordering keeps the card's element and moves it, and a browser blurs an element it
         * moves. happy-dom does not, so the blur is made here; without it the test would pass on
         * a board that loses focus in every browser there is.
         */
        it("takes focus back after a redraw has left it on nothing", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            (document.activeElement as HTMLElement | null)?.blur();
            await redraw();

            expect(focusedName(board)).toBe("Second");
        });

        it("leaves focus where the reader has since put it", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            focusHeader(board, 2);
            await redraw();

            expect(focusedName(board)).toBe("Done");
        });

        it("sends a card to either end of its column with Ctrl and Home or End", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "Home", { ctrlKey: true });
            expect(branches.moveBeforeBranch).toHaveBeenCalled();

            focusCard(board, 0, 0);
            press(board, "End", { ctrlKey: true });
            expect(branches.moveAfterBranch).toHaveBeenCalled();
        });

        it("sends a card the whole way with Ctrl, Shift and a sideways arrow", async () => {
            const board = await renderBoard();
            focusCard(board, 1, 0);
            const moved = noteOf(board, "Second");

            press(board, "ArrowRight", { ctrlKey: true, shiftKey: true });
            setStatus(moved, "Done");
            await redraw();
            expect(columnOf(board, "Second")).toBe(2);

            press(board, "ArrowLeft", { ctrlKey: true, shiftKey: true });
            setStatus(moved, "To Do");
            await redraw();
            expect(columnOf(board, "Second")).toBe(0);
        });

        it("moves no card already standing at the end it is sent to", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);

            press(board, "ArrowLeft", { ctrlKey: true, shiftKey: true });

            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
            expect(columnOf(board, "First")).toBe(0);
        });

        it("does nothing at the edges it cannot move past", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 0);
            press(board, "ArrowUp", { ctrlKey: true });
            press(board, "Home", { ctrlKey: true });
            press(board, "ArrowLeft", { ctrlKey: true });

            focusButton(board, 1);
            press(board, "ArrowUp", { ctrlKey: true });
            press(board, "ArrowLeft", { ctrlKey: true });

            expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
            expect(saved).toHaveLength(0);
        });

        it("moves the column from anywhere within it, keeping focus where it was", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 1);
            press(board, "ArrowRight", { ctrlKey: true, altKey: true });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);
            expect(focusedName(board)).toBe("Second");

            focusButton(board, 1);
            press(board, "ArrowLeft", { ctrlKey: true, altKey: true });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "To Do", "Doing", "Done" ]);
            expect(focusedName(board)).toBe("board_view.new-item");
        });

        it("moves no column past either end, and none from the button that adds one", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 0);
            press(board, "ArrowLeft", { ctrlKey: true, altKey: true });

            board.querySelector<HTMLElement>(".board-add-column")?.focus();
            press(board, "ArrowRight", { ctrlKey: true, altKey: true });

            expect(saved).toHaveLength(0);
        });

        it("moves the column its header stands on, keeping focus on that header", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            press(board, "ArrowRight", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });

            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);
            expect(focusedName(board)).toBe("To Do");
        });

        it("puts a new column after the one focus is in, and before it with Shift", async () => {
            const board = await renderBoard();

            focusCard(board, 1, 0);
            press(board, "Enter", { ctrlKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "To Do", "Doing", "board_view.new-column", "Done" ]);

            focusHeader(board, 0);
            press(board, "Enter", { ctrlKey: true, shiftKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([
                    "board_view.new-column 2", "To Do", "Doing", "board_view.new-column", "Done"
                ]);
        });

        it("sends a column to either end with Ctrl, Alt and Home or End", async () => {
            const board = await renderBoard();

            focusHeader(board, 1);
            press(board, "Home", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);

            focusHeader(board, 0);
            press(board, "End", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "To Do", "Done", "Doing" ]);
        });
    });

    it("opens the card under the cursor with Space", async () => {
        const board = await renderBoard();
        const open = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);

        focusCard(board, 0, 0);
        press(board, " ");

        expect(open).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: noteOf(board, "First") });
    });

    /** Which column a card is drawn in, counted as the reader sees them. */
    function columnOf(board: HTMLElement, title: string) {
        return [ ...board.querySelectorAll(".board-column") ]
            .findIndex(column => [ ...column.querySelectorAll(".board-note") ]
                .some(card => card.textContent?.includes(title)));
    }

    /** Applies a move the way the server's answer would, which nothing here waits for. */
    function setStatus(noteId: string | undefined, value: string) {
        for (const attribute of froca.getNoteFromCache(noteId ?? "")?.getAttributes() ?? []) {
            if (attribute.name === "status") {
                attribute.value = value;
            }
        }
    }

    /** Draws the board again, as the refresh that follows a write does. */
    async function redraw() {
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={boardNote}
                        notePath={`root/${boardNote.noteId}`}
                        noteIds={[ ...boardNote.getChildNoteIds() ]}
                        highlightedTokens={null}
                        viewConfig={{
                            columns: [ { value: "To Do" }, { value: "Doing" }, { value: "Done" } ]
                        }}
                        saveConfig={(config) => saved.push(config)}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                container as HTMLElement
            );
            await flush();
        });
        await act(async () => { await flush(); });
    }

    /** Presses a key on whatever holds focus, answering with what holds it afterwards. */
    function press(
        board: HTMLElement,
        key: string,
        options: { altKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean } = {}
    ) {
        act(() => {
            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
                key,
                altKey: options.altKey ?? false,
                ctrlKey: options.ctrlKey ?? false,
                shiftKey: options.shiftKey ?? false,
                bubbles: true,
                cancelable: true
            }));
        });

        return focusedName(board);
    }

    /**
     * What holds focus, named the way the reader would name it. Its own title where it has one, so
     * that a header is not read together with the count beside it.
     */
    function focusedName(board: HTMLElement) {
        const active = document.activeElement;
        if (!active || !board.contains(active)) return null;

        const named = active.querySelector(".title") ?? active;
        return named.textContent?.trim() ?? null;
    }

    function focusHeader(board: HTMLElement, column: number) {
        board.querySelectorAll<HTMLElement>(".board-column h3")[column].focus();
    }

    function focusCard(board: HTMLElement, column: number, item: number) {
        board.querySelectorAll(".board-column")[column]
            .querySelectorAll<HTMLElement>(".board-note")[item].focus();
    }

    function focusButton(board: HTMLElement, column: number) {
        board.querySelectorAll(".board-column")[column]
            .querySelector<HTMLElement>(".board-new-item")?.focus();
    }

    function noteOf(board: HTMLElement, title: string) {
        return [ ...board.querySelectorAll<HTMLElement>(".board-note") ]
            .find(card => card.textContent?.includes(title))?.dataset.noteId;
    }

    function branchOf(board: HTMLElement, title: string) {
        const noteId = noteOf(board, title);
        return [ ...boardNote.getChildBranches() ]
            .find(branch => branch.noteId === noteId)?.branchId;
    }

    let boardNote: ReturnType<typeof buildNote>;

    /** Two columns of cards, one empty column, and the button that adds another. */
    async function renderBoard(collapsed?: string) {
        boardNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" },
                { title: "Third", "#status": "Doing" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={boardNote}
                        notePath={`root/${boardNote.noteId}`}
                        noteIds={[ ...boardNote.getChildNoteIds() ]}
                        highlightedTokens={null}
                        viewConfig={{
                            columns: [ "To Do", "Doing", "Done" ].map(value => ({
                                value,
                                collapsed: value === collapsed ? true : undefined
                            }))
                        }}
                        saveConfig={(config) => saved.push(config)}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        return mountPoint;
    }

    function flush() {
        return new Promise((resolve) => setTimeout(resolve));
    }

});
