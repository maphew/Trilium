/**
 * Regression test for #10689: a newly added board column is persisted but not rendered until the
 * view is re-entered, and a subsequent column reorder then deletes it again.
 */
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
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

    async function setup(config: BoardViewData = DEFAULT_CONFIG) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
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
                    <Harness note={note} noteIds={note.getChildNoteIds()} initialConfig={config} />
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
            column.querySelector<HTMLElement>("h3 .edit-icon")?.click();
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
                        noteIds={other.getChildNoteIds()}
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
            column.querySelector<HTMLElement>("h3 .edit-icon")?.click();
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

    it("keeps the cards of the renamed column under it", async () => {
        const { container } = await setup();

        await renameSecondColumn(container, "In Progress");

        const cards = [ ...container.querySelectorAll<HTMLElement>(".board-column") ]
            .map(column => [ ...column.querySelectorAll(".board-note .title") ]
                .map(el => el.textContent));
        expect(cards).toEqual([ [ "First" ], [ "Second" ], [ "Third" ] ]);
    });
});
