import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAttribute } from "../../../services/attributes";
import dialog from "../../../services/dialog";
import { buildNote } from "../../../test/easy-froca";
import { changeEvent, removeFromCalendar } from "./api";

vi.mock("../../../services/attributes", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/attributes")>(),
    setAttribute: vi.fn()
}));

vi.mock("../../../services/dialog", () => ({
    default: { confirmDeleteNoteBoxWithNote: vi.fn() }
}));

vi.mock("../../../services/note_create", () => ({ default: { createNote: vi.fn() } }));
vi.mock("../../../services/note_deletion", () => ({ deleteNoteOrBranch: vi.fn() }));

/** The labels each call wrote or cleared, in order — the name and the value it was set to. */
const writtenLabels = () => vi.mocked(setAttribute).mock.calls.map((call) => [ call[2], call[3] ]);

describe("changeEvent", () => {
    beforeEach(() => vi.mocked(setAttribute).mockClear());

    it("writes the stock labels where the note renames none", async () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });

        await changeEvent(note, { startDate: "2026-06-06", endDate: "2026-06-08", startTime: "13:00", endTime: "14:00" });

        expect(writtenLabels()).toEqual([
            [ "startDate", "2026-06-06" ],
            [ "endDate", "2026-06-08" ],
            [ "startTime", "13:00" ],
            [ "endTime", "14:00" ]
        ]);
    });

    it("writes the labels a note renames for itself, and clears the stock fallback along with a renamed one", async () => {
        const note = buildNote({
            title: "Fair",
            "#calendar:startDate": "myStartDate", "#myStartDate": "2026-06-05",
            "#calendar:endDate": "myEndDate", "#myEndDate": "2026-06-07", "#endDate": "2026-06-06"
        });

        await changeEvent(note, { startDate: "2026-06-09", endDate: null, startTime: null, endTime: null });

        expect(writtenLabels()).toEqual([
            [ "myStartDate", "2026-06-09" ],
            // The stale stock end date goes with the renamed one: left behind, the event builder's
            // fallback would pick it up the moment the renamed label was gone.
            [ "myEndDate", null ],
            [ "endDate", null ],
            [ "startTime", null ],
            [ "endTime", null ]
        ]);
    });
});

describe("removeFromCalendar", () => {
    beforeEach(() => vi.mocked(setAttribute).mockClear());

    it("clears the start date under both its names, so the fallback cannot keep the event on", async () => {
        vi.mocked(dialog.confirmDeleteNoteBoxWithNote)
            .mockResolvedValue({ confirmed: true, isDeleteNoteChecked: false });
        const calendar = buildNote({ title: "Calendar" });
        // The renaming is configured but unfilled, so the event stands on the stock label alone —
        // removing only the renamed one would leave it on the calendar.
        const note = buildNote({ title: "Fair", "#calendar:startDate": "myStartDate", "#startDate": "2026-06-05" });

        expect(await removeFromCalendar(note, calendar)).toBe(true);
        expect(writtenLabels()).toEqual([
            [ "myStartDate", null ],
            [ "startDate", null ]
        ]);
    });

    it("does nothing where the dialog was dismissed", async () => {
        vi.mocked(dialog.confirmDeleteNoteBoxWithNote).mockResolvedValue(undefined);
        const calendar = buildNote({ title: "Calendar" });
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });

        expect(await removeFromCalendar(note, calendar)).toBe(false);
        expect(setAttribute).not.toHaveBeenCalled();
    });
});
