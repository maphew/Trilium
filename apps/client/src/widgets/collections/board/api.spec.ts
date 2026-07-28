import { describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { BoardViewData } from ".";
import BoardApi from "./api";

vi.mock("../../../services/bulk_action", () => ({
    executeBulkActions: vi.fn(async () => {})
}));

function createApi(viewConfig: BoardViewData, columns: string[], parentNote?: FNote) {
    const saved: BoardViewData[] = [];
    const api = new BoardApi(
        new Map(),
        columns,
        parentNote ?? buildNote({ title: "Board" }),
        "status",
        viewConfig,
        (newConfig) => saved.push(newConfig),
        () => {}
    );
    return { api, saved };
}

describe("BoardApi column mutations", () => {
    /**
     * #10689: the view re-renders off the identity of the config object it is handed
     * (`useEffect(refresh, [ …, viewConfig ])`). A mutator that edits the config in place and saves
     * the same reference persists the change but never redraws the board.
     */
    it("hands the caller a new config object rather than mutating in place", async () => {
        const viewConfig: BoardViewData = { columns: [ { value: "To Do" }, { value: "Done" } ] };
        const { api, saved } = createApi(viewConfig, [ "To Do", "Done" ]);

        await api.addNewColumn("In Progress");
        await api.renameColumn("Done", "Shipped");
        await api.removeColumn("To Do");

        expect(saved).toHaveLength(3);
        for (const config of saved) {
            expect(config).not.toBe(viewConfig);
            expect(config.columns).not.toBe(viewConfig.columns);
        }
        expect(saved.map(config => config.columns?.map(col => col.value))).toEqual([
            [ "To Do", "Done", "In Progress" ],
            [ "To Do", "Shipped", "In Progress" ],
            [ "Shipped", "In Progress" ]
        ]);
    });

    it("does not save anything for a duplicate column", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);
        expect(await api.addNewColumn("To Do")).toBe(false);
        expect(saved).toHaveLength(0);
    });

    /**
     * #10689 (second symptom): `columns` is derived render state, so it can lag behind the persisted
     * config. Rebuilding the whole config from it drops every column it has not caught up with.
     */
    it("preserves persisted columns missing from the derived column list", () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" }, { value: "In Progress" } ] },
            [ "To Do", "Done" ]
        );

        api.reorderColumn(0, 2);

        expect(saved.at(-1)?.columns?.map(col => col.value)).toEqual([ "Done", "To Do", "In Progress" ]);
    });
});
