/**
 * Regression test for #10689: a newly added board column is persisted but not rendered until the
 * view is re-entered, and a subsequent column reorder then deletes it again.
 */
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import contextMenu from "../../../menus/context_menu";
import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";
import { DEFAULT_COLUMN_ICON } from "./columns";

// Stands in for the server: by the time the bulk action resolves, the notes carry the new value,
// which is what makes the old column empty rather than merely renamed.
vi.mock("../../../services/bulk_action", () => ({
    executeBulkActions: vi.fn(async (
        noteIds: string[],
        actions: { name: string, labelName?: string, labelValue?: string }[]
    ) => {
        for (const noteId of noteIds) {
            for (const attribute of froca.getNoteFromCache(noteId)?.getAttributes() ?? []) {
                for (const action of actions) {
                    if (action.name === "updateLabelValue" && attribute.name === action.labelName) {
                        attribute.value = action.labelValue ?? "";
                    }
                }
            }
        }
    })
}));

/** Drains the async chain inside `refresh()` (getBoardData → setByColumn/setColumns). */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve));
}

const saved: BoardViewData[] = [];

/**
 * Mirrors how `useViewModeConfig` feeds the board: `saveConfig` publishes a *new wrapper* around the
 * config it was handed, so the `viewConfig` prop only changes identity if the caller passed a new
 * object. That is exactly the condition the board's refresh effect depends on.
 */
function Harness({ note, noteIds, initialConfig }: { note: ReturnType<typeof buildNote>, noteIds: string[], initialConfig: BoardViewData }) {
    const [ state, setState ] = useState<{ config: BoardViewData }>({ config: initialConfig });
    const saveConfig = useCallback((config: BoardViewData) => {
        saved.push(config);
        setState({ config });
    }, []);

    // `useViewModeConfig` restores the config of whichever note it is handed, so a board shown
    // after another starts from its own. The board itself is not remounted, which is the point.
    useEffect(() => {
        setState({ config: initialConfig });
    }, [ note ]);

    return (
        <BoardView
            note={note}
            notePath={`root/${note.noteId}`}
            noteIds={noteIds}
            highlightedTokens={null}
            viewConfig={state.config}
            saveConfig={saveConfig}
            media="screen"
            onReady={() => {}}
        />
    );
}

/** Files a fresh note under the board, the way an import or another client's write reaches it. */
function addCard(board: ReturnType<typeof buildNote>, status: string) {
    const card = buildNote({ title: "Added", "#status": status });
    const branchId = `${board.noteId}_${card.noteId}`;

    froca.branches[branchId] = new FBranch(froca, {
        branchId,
        notePosition: 100,
        fromSearchNote: false,
        noteId: card.noteId,
        parentNoteId: board.noteId
    });
    board.addChild(card.noteId, branchId, false);
}

/** Opens the title editor the way the keyboard does, the menu entry needing a rendered menu. */
function startEditingTitle(column: HTMLElement) {
    column.querySelector("h3")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
}

/** The icon class each column header wears, which is the class its picker button carries. */
function columnIcons(container: HTMLElement) {
    return [ ...container.querySelectorAll(".board-column h3 > .column-icon button") ]
        .map(el => [ ...el.classList ].filter(name => name.startsWith("bx")).join(" "));
}

function columnTitles(container: HTMLElement) {
    return [ ...container.querySelectorAll(".board-column h3 .title") ].map(el => el.textContent);
}

describe("Board column creation", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function setup() {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "card1", title: "First", "#status": "To Do" },
                { id: "card2", title: "Second", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness note={note} noteIds={[ "card1", "card2" ]} initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }} />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => {
            await flush();
        });

        return { note, container: mountPoint };
    }

    /** Clicks "Add column", types a name and blurs the editor, as the user would. */
    async function addColumn(container: HTMLElement, name: string) {
        await act(async () => {
            container.querySelector<HTMLElement>(".board-add-column")?.click();
            await flush();
        });

        const input = container.querySelector<HTMLInputElement>(".board-add-column input");
        if (!input) throw new Error("expected an inline editor for the new column");

        await act(async () => {
            input.focus();
            input.value = name;
            input.blur();
            await flush();
        });

        // The save re-publishes the config, which re-runs the (async) board refresh; that lands in a
        // later tick than the one `act` flushed above.
        await act(async () => {
            await flush();
        });
    }

    it("renders a newly added column without leaving the view", async () => {
        const { container } = await setup();
        expect(columnTitles(container)).toEqual([ "To Do", "Done" ]);

        await addColumn(container, "In Progress");

        expect(saved.at(-1)?.columns?.map(c => c.value)).toEqual([ "To Do", "Done", "In Progress" ]);
        expect(columnTitles(container)).toEqual([ "To Do", "Done", "In Progress" ]);
    });
});

describe("Board column rename", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    const DEFAULT_CONFIG: BoardViewData = {
        columns: [ { value: "To Do" }, { value: "Doing" }, { value: "Done" } ]
    };

    async function setup(config: BoardViewData = DEFAULT_CONFIG, includeArchived = false) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            ...(includeArchived ? { "#includeArchived": "true" } : {}),
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=To Do;Doing;Done",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "Doing" },
                { title: "Third", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={config}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        return { note, container: mountPoint };
    }

    /** Renames the middle column, so a slot that is not the last one has to survive. */
    async function renameSecondColumn(container: HTMLElement, newName: string) {
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        await act(async () => {
            startEditingTitle(column);
            await flush();
        });

        const input = column.querySelector<HTMLInputElement>("h3 input");
        if (!input) throw new Error("expected an inline editor for the column title");

        await act(async () => {
            input.focus();
            input.value = newName;
            input.blur();
            await flush();
        });
        await act(async () => { await flush(); });
    }

    it("does not leave the old name behind as an empty column", async () => {
        const { container } = await setup();
        expect(columnTitles(container)).toEqual([ "To Do", "Doing", "Done" ]);

        await renameSecondColumn(container, "In Progress");

        expect(columnTitles(container)).toEqual([ "To Do", "In Progress", "Done" ]);
        expect(saved.at(-1)?.columns?.map(c => c.value))
            .toEqual([ "To Do", "In Progress", "Done" ]);
    });

    /**
     * `NoteList` renders the view unkeyed, so the board the user moves to is the same component
     * instance. A rename still pending on the one they left must not rewrite a column here that
     * happens to carry the old name.
     */
    it("does not carry a pending rename over to the next board", async () => {
        const { container } = await setup();
        await renameSecondColumn(container, "In Progress");

        const other = buildNote({
            title: "Other board",
            "#collection": "",
            "#viewType": "board",
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=Doing;Shipped",
            children: [
                { title: "Fourth", "#status": "Doing" },
                { title: "Fifth", "#status": "Shipped" }
            ]
        });

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={other}
                        noteIds={[ ...other.getChildNoteIds() ]}
                        initialConfig={{ columns: [ { value: "Doing" }, { value: "Shipped" } ] }}
                    />
                </ParentComponent.Provider>,
                container
            );
            await flush();
        });
        await act(async () => { await flush(); });

        expect(columnTitles(container)).toEqual([ "Doing", "Shipped" ]);
    });

    it("shows each column's icon, defaulting it, and keeps it while editing", async () => {
        const { container } = await setup({
            columns: [
                { value: "To Do" },
                { value: "Doing", icon: "bx bx-run" },
                { value: "Done" }
            ]
        });

        expect(columnIcons(container))
            .toEqual([ DEFAULT_COLUMN_ICON, "bx bx-run", DEFAULT_COLUMN_ICON ]);

        // The editor covers the title and its button, so the icon is still the one on the left.
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        await act(async () => {
            startEditingTitle(column);
            await flush();
        });

        expect(column.querySelector("h3 input")).toBeTruthy();
        expect(column.querySelector("h3 > .column-icon button")?.className).toContain("bx bx-run");
    });

    it("tints only the columns given a colour that has a hue", async () => {
        const { container } = await setup({
            columns: [
                { value: "To Do", color: "#4d99e6" },
                { value: "Doing", color: "#808080" },
                { value: "Done" }
            ]
        });

        const columns = [ ...container.querySelectorAll<HTMLElement>(".board-column") ];
        const hues = columns
            .map(column => column.style.getPropertyValue("--board-column-custom-hue"));

        expect(Math.round(Number(hues[0]))).toBe(210);
        // Grey has no hue of its own, leaving the column as plain as one with no colour.
        expect(hues.slice(1)).toEqual([ "", "" ]);
        expect(columns.map(column => column.classList.contains("with-hue")))
            .toEqual([ true, false, false ]);
    });

    it("hides an archived column, unless the board is set to show archived notes", async () => {
        const archivedConfig: BoardViewData = {
            columns: [ { value: "To Do" }, { value: "Doing", archived: true }, { value: "Done" } ]
        };

        const { container: hidden } = await setup(archivedConfig);
        expect(columnTitles(hidden)).toEqual([ "To Do", "Done" ]);

        // The column is only out of sight; nothing has been written out of the config.
        expect(saved.every(config => config.columns?.some(col => col.value === "Doing")))
            .toBe(true);

        render(null, hidden);
        hidden.remove();

        const { container: shown } = await setup(archivedConfig, true);
        expect(columnTitles(shown)).toEqual([ "To Do", "Doing", "Done" ]);
        expect([ ...shown.querySelectorAll(".board-column") ]
            .map(column => column.classList.contains("board-column-archived")))
            .toEqual([ false, true, false ]);
    });

    /**
     * The editor belongs to the column rather than to the button below it, so the header's menu
     * can raise the same one instead of a second way of making a card.
     */
    it("opens the new-item editor from the menu, as the button below the column does", async () => {
        const { container } = await setup();
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        expect(column.querySelector(".board-new-item textarea")).toBeNull();

        // Raised the way the header raises it, then the entry is invoked as the menu would.
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        column.querySelector("h3")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        const entry = (show.mock.calls.at(-1)?.[0].items ?? [])
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-plus");
        if (!entry || !("handler" in entry)) throw new Error("expected a new-item entry");

        await act(async () => {
            entry.handler?.(entry, {} as never);
            await flush();
        });
        expect(column.querySelector(".board-new-item.editing textarea")).toBeTruthy();

        show.mockRestore();
    });

    it("scrolls the column to its end when the new-item button takes focus", async () => {
        const { note, container } = await setup();
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        const content = column.querySelector<HTMLElement>(".board-column-content");
        if (!content) throw new Error("expected a scrollable column body");

        // happy-dom lays nothing out, so the scrollable height has to be stood in for.
        Object.defineProperty(content, "scrollHeight", { value: 500, configurable: true });
        expect(content.scrollTop).toBe(0);

        await act(async () => {
            column.querySelector<HTMLElement>(".board-new-item")?.focus();
            await flush();
        });

        expect(content.scrollTop).toBe(500);

        // The card just made lands above the button, pushing it out of sight again. Nothing is
        // focused afresh by that, so only the effect watching the count brings it back.
        Object.defineProperty(content, "scrollHeight", { value: 900, configurable: true });
        addCard(note, "Doing");
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={DEFAULT_CONFIG}
                    />
                </ParentComponent.Provider>,
                container
            );
            await flush();
        });
        await act(async () => { await flush(); });

        expect(columnTitles(container)).toEqual([ "To Do", "Doing", "Done" ]);
        expect(content.scrollTop).toBe(900);
    });

    it("starts the new item off with the character typed on its button", async () => {
        const { container } = await setup();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.dispatchEvent(new KeyboardEvent("keydown", { key: "R", bubbles: true }));
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        expect(editor?.value).toBe("R");
        // After the character rather than over it, so the next key carries on.
        expect([ editor?.selectionStart, editor?.selectionEnd ]).toEqual([ 1, 1 ]);
    });

    it("opens the new item empty for Enter, and ignores keys that are not characters", async () => {
        const { container } = await setup();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        for (const key of [ "Tab", "ArrowRight", "F2" ]) {
            await act(async () => {
                slot?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
                await flush();
            });
        }
        expect(slot?.querySelector("textarea")).toBeNull();

        await act(async () => {
            slot?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });
        expect(slot?.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    });

    it("keeps the cards of the renamed column under it", async () => {
        const { container } = await setup();

        await renameSecondColumn(container, "In Progress");

        const cards = [ ...container.querySelectorAll<HTMLElement>(".board-column") ]
            .map(column => [ ...column.querySelectorAll(".board-note .title") ]
                .map(el => el.textContent));
        expect(cards).toEqual([ [ "First" ], [ "Second" ], [ "Third" ] ]);
    });
});
