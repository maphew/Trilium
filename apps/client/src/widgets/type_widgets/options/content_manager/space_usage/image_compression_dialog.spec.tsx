import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CONFIGURED_MAX_DIMENSIONS, CONFIGURED_QUALITY } = vi.hoisted(() => ({
    // Deliberately unlike the shipped defaults, so a field falling back to the image option cannot
    // pass for one falling back to a constant of its own.
    CONFIGURED_MAX_DIMENSIONS: 1600,
    CONFIGURED_QUALITY: 60
}));

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(),
    storedOption: "{}",
    save: vi.fn(async () => {})
}));

vi.mock("../../../../../services/options", () => ({
    default: {
        get: () => mocks.storedOption,
        getInt: mocks.getInt,
        save: mocks.save
    }
}));

// The harness loads no translations, so the real `t` answers undefined for every key. Echoing the
// key back instead lets each row be identified by the string it actually asked for, and lets the
// quality reading be read as the value it interpolates.
vi.mock("../../../../../services/i18n", () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    translationsInitializedPromise: Promise.resolve(),
    initLocale: async () => {},
    getAvailableLocales: () => [],
    getLocaleById: () => null,
    getCurrentLanguage: () => "en"
}));

// The real modal reports its close once the animation is done; the stub reports it as soon as it is
// told to hide, which is the signal the dialog's own flow keys off.
vi.mock("../../../../react/Modal", () => ({
    default: function ModalStub({ children, footer, show, onHidden }: {
        children: ComponentChildren, footer: ComponentChildren, show: boolean, onHidden: () => void
    }) {
        useEffect(() => {
            if (!show) {
                onHidden();
            }
            // Keyed on the visibility alone: the dialog hands down a fresh closure each render, and
            // following that identity would report the same close over and over.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [ show ]);

        return show ? <div className="modal-stub">{children}<div className="footer-stub">{footer}</div></div> : null;
    }
}));

import { showImageCompressionDialog } from "./image_compression_dialog";

function rows() {
    return Array.from(document.body.querySelectorAll<HTMLElement>(".image-compression-section"));
}

function titles() {
    return rows().map((row) => row.querySelector(".image-compression-section-title")?.textContent);
}

const numberField = () => document.body.querySelector<HTMLInputElement>(".image-compression-section-number");
const slider = () => document.body.querySelector<HTMLInputElement>(".slider");
const qualityReading = () => document.body.querySelector(".image-compression-section-value")?.textContent ?? "";
const toggles = () => Array.from(document.body.querySelectorAll<HTMLInputElement>(".switch-toggle"));
const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>(".footer-stub button"));
const cancelButton = () => buttons()[0];
const compressButton = () => buttons()[1];

/**
 * Opens the dialog. The pending close is handed back wrapped: returned bare, awaiting this helper
 * would adopt it and wait for the dialog to be dismissed.
 */
async function openDialog() {
    const closed = showImageCompressionDialog();
    await settle();
    return { closed };
}

function settle() {
    return act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function click(button: HTMLButtonElement | undefined) {
    await act(async () => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

/** Flips a switch, the way a click on it does. */
async function toggle(input: HTMLInputElement | null | undefined) {
    await act(async () => {
        input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Types into a field, the way the user does — the component reads the value off the element. */
async function type(field: HTMLInputElement | null | undefined, value: string) {
    await setAndDispatch(field, value, [ "input" ]);
}

/** Drags a range control: a real drag reports every step as an input and the release as a change. */
async function drag(range: HTMLInputElement | null | undefined, value: string) {
    await setAndDispatch(range, value, [ "input", "change" ]);
}

async function setAndDispatch(field: HTMLInputElement | null | undefined, value: string, events: string[]) {
    await act(async () => {
        if (field) {
            field.value = value;
            for (const event of events) {
                field.dispatchEvent(new Event(event, { bubbles: true }));
            }
        }
    });
}

beforeEach(() => {
    mocks.storedOption = "{}";
    vi.clearAllMocks();
    mocks.getInt.mockImplementation((name) => (
        name === "imageMaxWidthHeight" ? CONFIGURED_MAX_DIMENSIONS
            : name === "imageJpegQuality" ? CONFIGURED_QUALITY
                : null
    ));
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("showImageCompressionDialog", () => {
    it("lists the four settings, in reading order", async () => {
        await openDialog();

        expect(titles()).toEqual([
            "images.max_image_dimensions",
            "images.jpeg_quality",
            "space_usage.compress_convert_lossless",
            "space_usage.compress_process_child_notes"
        ]);
        expect(rows().map(controlOf)).toEqual([ "number", "slider", "toggle", "toggle" ]);

        // Both toggles turn on something with a consequence their label cannot carry — a permanent
        // quality loss, and a reach past the note the run was invoked on — so each explains itself
        // beside its title. The two numbered rows say all there is to say in their labels.
        expect(rows().map((row) => !!row.querySelector(".image-compression-section-title .contextual-help")))
            .toEqual([ false, false, true, true ]);
    });

    it("reads the quality out between its title and the slider", async () => {
        await openDialog();

        // A slider says which way it is going but never where it is, so the row reads
        // title, value, control — the reading placed before the control it reads.
        expect(Array.from(rows()[1].children).map((child) => child.classList[0])).toEqual([
            "image-compression-section-title",
            "image-compression-section-value",
            "slider"
        ]);
        expect(qualityReading()).toContain(String(CONFIGURED_QUALITY));

        await drag(slider(), "45");

        expect(qualityReading()).toContain("45");
    });

    it("opens on the image options when the setting has never been written", async () => {
        await openDialog();

        // Neither number has a default of its own: an unconfigured tool compresses the way
        // automatic compression is already set to.
        expect(numberField()?.value).toBe(String(CONFIGURED_MAX_DIMENSIONS));
        expect(slider()?.value).toBe(String(CONFIGURED_QUALITY));

        // Both toggles start off: a conversion that costs quality and a run that reaches beyond the
        // note it was invoked on are things to be asked for, never assumed.
        expect(toggles().map((input) => input.checked)).toEqual([ false, false ]);
    });

    it("reads a stored answer back, and lets it override the image options", async () => {
        mocks.storedOption = JSON.stringify({
            maxWidthHeight: 800, quality: 35, convertLossless: true, processChildNotes: true
        });

        await openDialog();

        expect(numberField()?.value).toBe("800");
        expect(slider()?.value).toBe("35");
        expect(toggles().map((input) => input.checked)).toEqual([ true, true ]);
    });

    it.each([
        [ "out of range", { quality: 500 } ],
        [ "fractional", { quality: 62.5 } ],
        [ "of the wrong type", { quality: "high" } ]
    ])("ignores a stored quality that is %s and falls back to the option", async (_label, stored) => {
        mocks.storedOption = JSON.stringify(stored);

        await openDialog();

        expect(slider()?.value).toBe(String(CONFIGURED_QUALITY));
    });

    it("ignores a nonsensical stored dimension and falls back to the option", async () => {
        mocks.storedOption = JSON.stringify({ maxWidthHeight: 0 });

        await openDialog();

        expect(numberField()?.value).toBe(String(CONFIGURED_MAX_DIMENSIONS));
    });

    it("writes every change straight back, so the next run opens where this one left off", async () => {
        await openDialog();

        await type(numberField(), "900");
        await drag(slider(), "45");
        await toggle(toggles()[0]);
        await toggle(toggles()[1]);

        // The last write carries the whole set, each change having been folded into the one before.
        expect(mocks.save).toHaveBeenLastCalledWith("imageCompressionToolOptions", JSON.stringify({
            maxWidthHeight: 900,
            quality: 45,
            convertLossless: true,
            processChildNotes: true
        }));
    });

    it("holds the dimension to at least one pixel, which is the least the server accepts", async () => {
        await openDialog();

        await type(numberField(), "0");

        expect(numberField()?.value).toBe("1");
    });

    it("hands back what was asked for once it has closed", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[0]);
        await click(compressButton());

        await expect(closed).resolves.toEqual({
            maxWidthHeight: CONFIGURED_MAX_DIMENSIONS,
            quality: CONFIGURED_QUALITY,
            convertLossless: true,
            processChildNotes: false
        });
        // Mounted on demand, and gone again with it: nothing is left in the page behind the dialog.
        expect(rows()).toEqual([]);
    });

    it("hands back nothing when the user backs out, settings remembered all the same", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[1]);
        await click(cancelButton());

        // The answer is "no run", but the settings are kept either way — the next run opens where
        // this one left off whether or not it was carried through.
        await expect(closed).resolves.toBeNull();
        expect(mocks.save).toHaveBeenCalledWith(
            "imageCompressionToolOptions", expect.stringContaining('"processChildNotes":true'));
    });
});

/** Which control a row carries, standing in for the setting it configures. */
function controlOf(row: HTMLElement) {
    if (row.querySelector(".image-compression-section-number")) {
        return "number";
    }
    if (row.querySelector(".slider")) {
        return "slider";
    }

    return row.querySelector(".switch-toggle") ? "toggle" : "none";
}
