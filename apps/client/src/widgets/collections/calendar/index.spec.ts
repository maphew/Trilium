import { EventDisplayInfo } from "fullcalendar";
import { describe, expect, it } from "vitest";

import { roomForAttributes } from "./index.js";

/** As much of a chip as the question is asked of: which view it is drawn in, and how it sits there. */
function chip({ view, allDay = false, isShort = false, isNarrow = false }: {
    view: string, allDay?: boolean, isShort?: boolean, isNarrow?: boolean
}) {
    return { view: { type: view }, event: { allDay }, isShort, isNarrow } as EventDisplayInfo;
}

describe("roomForAttributes", () => {
    it("wraps a row chip, be it a month cell's or the all-day band's above a time grid", () => {
        expect(roomForAttributes(chip({ view: "dayGridMonth" }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "dayGridMonth", allDay: true }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "timeGridWeek", allDay: true }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "timeGridDay", allDay: true }))).toBe("wrapped");
        // Narrow as well — a phone's seven columns, where a few characters to the line is still
        // more than the nothing they used to say.
        expect(roomForAttributes(chip({ view: "dayGridMonth", isNarrow: true }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "timeGridWeek", allDay: true, isNarrow: true }))).toBe("wrapped");
    });

    it("lets a timed event on a time grid stack them, its content being a column already", () => {
        expect(roomForAttributes(chip({ view: "timeGridWeek" }))).toBe("stacked");
        expect(roomForAttributes(chip({ view: "timeGridDay" }))).toBe("stacked");
        // Too short to say anything beneath its title.
        expect(roomForAttributes(chip({ view: "timeGridWeek", isShort: true }))).toBe(null);
    });

    it("has nowhere to put them on a year's chips or in a list", () => {
        expect(roomForAttributes(chip({ view: "multiMonthYear" }))).toBe(null);
        expect(roomForAttributes(chip({ view: "listMonth" }))).toBe(null);
    });
});
