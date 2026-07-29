import { ComponentChild, render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `isMobile()` is read at render time inside CustomColorCell; mock the module so both the
// desktop (no handler) and mobile (stopPropagation) branches can be exercised.
const isMobileMock = vi.fn(() => false);
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => isMobileMock()
}));

const setLabelMock = vi.fn();
const removeOwnedLabelByNameMock = vi.fn();
vi.mock("../../services/attributes", () => ({
    default: {
        setLabel: (...args: unknown[]) => setLabelMock(...args),
        removeOwnedLabelByName: (...args: unknown[]) => removeOwnedLabelByNameMock(...args)
    }
}));

import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import NoteColorPicker, { ColorPicker, DEFAULT_COLOR_PALETTE, tryParseColor } from "./NoteColorPicker";

/**
 * Mounts a `ColorPicker` inside `act()` so the mount effects run — in particular the one that
 * constructs the `Debouncer` behind the native colour input. Rendering outside `act()` leaves that
 * effect pending, and input changes are then silently dropped.
 */
async function renderColorPicker(vnode: ComponentChild) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(vnode);
    });
    if (!container) throw new Error("render produced no container");
    return container;
}

/** Renders and lets the mount effects (froca lookup, colour sync) settle. */
async function renderNotePicker(note: Parameters<typeof NoteColorPicker>[0]["note"]) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<NoteColorPicker note={note} />);
        // The note may be resolved through froca asynchronously; yield to the macrotask queue so
        // that promise chain settles and the follow-up `setNote` / colour-sync effects are
        // flushed within this same act() block.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (!container) throw new Error("render produced no container");
    return container;
}

function cells(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(".color-cell"));
}

function presetCells(container: HTMLElement) {
    return cells(container).filter((cell) =>
        !cell.classList.contains("color-cell-reset") && !cell.classList.contains("custom-color-cell"));
}

function resetCell(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".color-cell-reset");
}

function customCell(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".custom-color-cell");
}

describe("tryParseColor", () => {
    it("parses valid colors and returns null for invalid input", () => {
        expect(tryParseColor("#ff0000")?.hex().toLowerCase()).toBe("#ff0000");
        expect(tryParseColor("red")?.hex().toLowerCase()).toBe("#ff0000");

        // The invalid branch logs via console.error; silence it so the run stays clean.
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(tryParseColor("definitely-not-a-color")).toBeNull();
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

describe("ColorPicker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isMobileMock.mockReturnValue(false);
    });

    it("renders a reset cell, one cell per preset and a custom cell", () => {
        const container = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);

        expect(container.querySelector(".note-color-picker")).not.toBeNull();
        expect(resetCell(container)).not.toBeNull();
        expect(customCell(container)).not.toBeNull();
        expect(presetCells(container)).toHaveLength(DEFAULT_COLOR_PALETTE.length);
        // Each preset drives its swatch colour through the `--color` custom property.
        expect(presetCells(container)[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[0]);
    });

    it("accepts a custom preset list and an extra class name", () => {
        const container = renderInto(
            <ColorPicker currentValue={null} onChange={vi.fn()} presets={["#111111", "#222222"]} className="extra" />);

        expect(container.querySelector(".note-color-picker")?.classList.contains("extra")).toBe(true);
        expect(presetCells(container)).toHaveLength(2);
    });

    it("marks the reset cell selected when there is no colour", () => {
        const container = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);

        expect(resetCell(container)?.classList.contains("selected")).toBe(true);
        expect(presetCells(container).some((cell) => cell.classList.contains("selected"))).toBe(false);
    });

    it("marks the matching preset selected, normalising the incoming colour", () => {
        // Given in a different notation and casing than the palette entry it must match.
        const container = renderInto(<ColorPicker currentValue="RGB(230, 77, 77)" onChange={vi.fn()} />);

        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[0]);
        expect(resetCell(container)?.classList.contains("selected")).toBe(false);
        // A colour that is in the palette is not "custom".
        expect(customCell(container)?.classList.contains("selected")).toBe(false);
    });

    it("marks the custom cell selected for a colour outside the palette", () => {
        const container = renderInto(<ColorPicker currentValue="#123456" onChange={vi.fn()} />);

        expect(customCell(container)?.classList.contains("selected")).toBe(true);
        expect(presetCells(container).some((cell) => cell.classList.contains("selected"))).toBe(false);
    });

    it("treats an unparseable current value as no colour", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = renderInto(<ColorPicker currentValue="not-a-color" onChange={vi.fn()} />);
        consoleError.mockRestore();

        expect(resetCell(container)?.classList.contains("selected")).toBe(true);
    });

    it("reports the picked preset colour and null when cleared", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue={null} onChange={onChange} />);

        presetCells(container)[2].click();
        expect(onChange).toHaveBeenLastCalledWith(DEFAULT_COLOR_PALETTE[2]);

        resetCell(container)?.click();
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("marks cells disabled and swallows clicks when disabled", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue={null} onChange={onChange} disabled />);

        expect(cells(container).every((cell) => cell.classList.contains("disabled-color-cell"))).toBe(true);
        expect(container.querySelector<HTMLInputElement>("input[type=color]")?.disabled).toBe(true);

        presetCells(container)[0].click();
        resetCell(container)?.click();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("debounces the native colour input and reports the picked value once", async () => {
        vi.useFakeTimers();
        try {
            const onChange = vi.fn();
            const container = await renderColorPicker(<ColorPicker currentValue={null} onChange={onChange} />);
            const input = container.querySelector<HTMLInputElement>("input[type=color]");
            expect(input).not.toBeNull();
            if (!input) return;

            // Two rapid changes within the debounce interval collapse into a single report.
            await act(async () => {
                input.value = "#aabbcc";
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.value = "#ddeeff";
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
            expect(onChange).not.toHaveBeenCalled();

            await act(async () => { vi.advanceTimersByTime(250); });
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith("#ddeeff");
        } finally {
            vi.useRealTimers();
        }
    });

    it("re-reports the already picked custom colour when the custom cell is clicked again", async () => {
        vi.useFakeTimers();
        try {
            const onChange = vi.fn();
            const container = await renderColorPicker(<ColorPicker currentValue={null} onChange={onChange} />);
            const input = container.querySelector<HTMLInputElement>("input[type=color]");
            if (!input) return;

            await act(async () => {
                input.value = "#aabbcc";
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await act(async () => { vi.advanceTimersByTime(250); });
            onChange.mockClear();

            // The cell's handler re-opens the native picker via `input.click()`. Under happy-dom
            // that click bubbles back up to the same cell and recurses, so stub it out — the
            // behaviour under test is the re-emission, not the native dialog.
            const nativeClick = vi.spyOn(input, "click").mockImplementation(() => {});

            // Clicking the cell after a colour was picked re-emits it (rather than only
            // re-opening the native picker).
            await act(async () => { customCell(container)?.click(); });
            expect(onChange).toHaveBeenCalledWith("#aabbcc");
            expect(nativeClick).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("stops click propagation on the custom cell only on mobile", () => {
        isMobileMock.mockReturnValue(true);
        const mobileContainer = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);
        const mobileWrapper = mobileContainer.querySelector(".custom-color-cell")?.parentElement;
        const mobileEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const mobileStop = vi.spyOn(mobileEvent, "stopPropagation");
        mobileWrapper?.dispatchEvent(mobileEvent);
        expect(mobileStop).toHaveBeenCalled();

        isMobileMock.mockReturnValue(false);
        const desktopContainer = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);
        const desktopWrapper = desktopContainer.querySelector(".custom-color-cell")?.parentElement;
        const desktopEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const desktopStop = vi.spyOn(desktopEvent, "stopPropagation");
        desktopWrapper?.dispatchEvent(desktopEvent);
        expect(desktopStop).not.toHaveBeenCalled();
    });

    it("derives a contrasting foreground for light and dark custom colours", () => {
        // Light background -> black foreground; dark background -> white.
        const light = renderInto(<ColorPicker currentValue="#eeeeee" onChange={vi.fn()} />);
        const lightWrapper = light.querySelector(".custom-color-cell")?.parentElement;
        expect(lightWrapper?.getAttribute("style")?.toLowerCase()).toContain("#000000");

        const dark = renderInto(<ColorPicker currentValue="#111111" onChange={vi.fn()} />);
        const darkWrapper = dark.querySelector(".custom-color-cell")?.parentElement;
        expect(darkWrapper?.getAttribute("style")?.toLowerCase()).toContain("#ffffff");

        // No colour at all falls back to `inherit`.
        const none = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);
        const noneWrapper = none.querySelector(".custom-color-cell")?.parentElement;
        expect(noneWrapper?.getAttribute("style")).toContain("inherit");
    });
});

describe("NoteColorPicker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isMobileMock.mockReturnValue(false);
    });

    it("renders nothing when no note is given", () => {
        expect(renderInto(<NoteColorPicker note={null} />).innerHTML).toBe("");
    });

    it("renders the note's current colour as the selected preset", async () => {
        const note = buildNote({ title: "Coloured", "#color": DEFAULT_COLOR_PALETTE[1] });

        const container = await renderNotePicker(note);

        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[1]);
    });

    it("resolves a note passed by ID through froca and enables the picker", async () => {
        const note = buildNote({ title: "By id", "#color": DEFAULT_COLOR_PALETTE[3] });
        const getNote = vi.spyOn(froca, "getNote");

        const container = await renderNotePicker(note.noteId);

        expect(getNote).toHaveBeenCalledWith(note.noteId, true);
        // Once resolved the cells are no longer disabled.
        expect(cells(container).some((cell) => cell.classList.contains("disabled-color-cell"))).toBe(false);
        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[3]);
        getNote.mockRestore();
    });

    it("stays disabled when the note ID cannot be resolved", async () => {
        const getNote = vi.spyOn(froca, "getNote").mockResolvedValue(null as never);

        const container = await renderNotePicker("missing");

        expect(cells(container).every((cell) => cell.classList.contains("disabled-color-cell"))).toBe(true);
        getNote.mockRestore();
    });

    it("writes the picked colour to the note's colour label", async () => {
        const note = buildNote({ title: "Writable" });

        const container = await renderNotePicker(note);

        presetCells(container)[4].click();

        expect(setLabelMock).toHaveBeenCalledWith(note.noteId, "color", DEFAULT_COLOR_PALETTE[4]);
        expect(removeOwnedLabelByNameMock).not.toHaveBeenCalled();
    });

    it("picks up a note that arrives after the first render", async () => {
        // A parent that mounts with `note={null}` while it loads and supplies the note afterwards
        // must end up with an enabled picker: the note-resolving effect has to re-run on the prop
        // change rather than only on mount.
        const note = buildNote({ title: "Late arrival", "#color": DEFAULT_COLOR_PALETTE[2] });
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NoteColorPicker note={null} />);
        });
        expect(container!.innerHTML).toBe("");

        // Re-render into the same container so Preact updates the existing component instance
        // (a fresh `renderInto` would mount a brand new one and hide the bug).
        await act(async () => {
            render(<NoteColorPicker note={note} />, container!);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(cells(container!).some((cell) => cell.classList.contains("disabled-color-cell"))).toBe(false);
        const selected = presetCells(container!).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[2]);
    });

    it("removes the colour label when the colour is cleared", async () => {
        const note = buildNote({ title: "Clearable", "#color": DEFAULT_COLOR_PALETTE[0] });

        const container = await renderNotePicker(note);

        resetCell(container)?.click();

        expect(removeOwnedLabelByNameMock).toHaveBeenCalledWith(note, "color");
        expect(setLabelMock).not.toHaveBeenCalled();
    });
});
