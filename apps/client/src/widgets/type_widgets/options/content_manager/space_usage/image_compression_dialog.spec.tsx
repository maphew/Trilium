import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CONFIGURED_MAX_DIMENSIONS, CONFIGURED_QUALITY, EMPTY_RESULT } = vi.hoisted(() => ({
    // Deliberately unlike the shipped defaults, so a field falling back to the image option cannot
    // pass for one falling back to a constant of its own.
    CONFIGURED_MAX_DIMENSIONS: 1600,
    CONFIGURED_QUALITY: 60,
    /** What a run reports when it found nothing; tests that care override it. */
    EMPTY_RESULT: {
        items: [], compressedCount: 0, skippedCount: 0, originalSize: 0, newSize: 0, savedSize: 0
    }
}));

/** A report of `count` images compressed, weighing `originalSize` before and `newSize` after. */
function resultOf(count: number, originalSize: number, newSize: number) {
    return {
        items: Array.from({ length: count }, (_, index) => ({ entityId: `img${index}` })),
        compressedCount: count,
        skippedCount: 0,
        originalSize,
        newSize,
        savedSize: originalSize - newSize
    };
}

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(),
    storedOption: "{}",
    save: vi.fn(async () => {}),
    postWithTimeout: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => EMPTY_RESULT),
    showMessage: vi.fn<(message: string, timeout?: number) => void>(),
    showPersistent: vi.fn<(options: { id: string, message: string }) => void>(),
    closePersistent: vi.fn<(id: string) => void>()
}));

vi.mock("../../../../../services/options", () => ({
    default: {
        get: () => mocks.storedOption,
        getInt: mocks.getInt,
        save: mocks.save
    }
}));

vi.mock("../../../../../services/server", () => ({
    default: {
        get: async () => [],
        postWithTimeout: (url: string, _timeoutMs: number, body?: object) => mocks.postWithTimeout(url, body)
    }
}));

vi.mock("../../../../../services/toast", () => ({
    default: {
        showMessage: mocks.showMessage,
        showPersistent: mocks.showPersistent,
        closePersistent: mocks.closePersistent
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
import { IMAGE_COMPRESSION_TOAST_ID, type ImageCompressionTarget } from "./image_compression_operation";

const NOTE_TARGET: ImageCompressionTarget = { type: "note", noteId: "n1" };
const ATTACHMENT_TARGET: ImageCompressionTarget = { type: "attachment", attachmentId: "a1" };

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
async function openDialog(target: ImageCompressionTarget = NOTE_TARGET) {
    const closed = showImageCompressionDialog(target);
    await settle();
    return { closed };
}

/** The body of the one request a run made, or `undefined` if it made none. */
function postedBody() {
    return mocks.postWithTimeout.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
}

const postedUrl = () => mocks.postWithTimeout.mock.calls[0]?.[0];
const reportedMessage = () => mocks.showMessage.mock.calls[0]?.[0] ?? "";

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
    mocks.postWithTimeout.mockResolvedValue(EMPTY_RESULT);
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
    it("leads with each step, the bound nested under the one that measures against it", async () => {
        await openDialog();

        expect(titles()).toEqual([
            "space_usage.compress_reduce_resolution",
            "images.max_image_dimensions",
            // One switch per kind of image: recompressing the lossy ones, and letting the lossless
            // ones stop being lossless. Neither implies the other.
            "space_usage.compress_reencode",
            "space_usage.compress_convert_lossless",
            // Standing on its own rather than under either: every step above writes a JPEG.
            "images.jpeg_quality",
            "space_usage.compress_process_child_notes"
        ]);
        expect(rows().map(controlOf)).toEqual([ "toggle", "number", "toggle", "toggle", "slider", "toggle" ]);
        expect(rows().map(isNested)).toEqual([ false, true, false, false, false, false ]);

        // Each switch turns on something with a consequence its label cannot carry — what is left
        // untouched, a permanent quality loss, a reach past the note the run was invoked on — so
        // each explains itself beside its title. The two figures say all there is to say already.
        expect(rows().map((row) => !!row.querySelector(".image-compression-section-title .contextual-help")))
            .toEqual([ true, false, true, true, false, true ]);
    });

    it("shows the bound only while there is a step that measures against it", async () => {
        await openDialog();

        // Reading it off a switch that is off would present a figure still in force.
        await toggle(toggles()[0]);
        expect(titles()).not.toContain("images.max_image_dimensions");
        expect(numberField()).toBeNull();

        await toggle(toggles()[0]);
        expect(numberField()?.value).toBe(String(CONFIGURED_MAX_DIMENSIONS));
    });

    it("keeps the quality up whichever steps are on, being in force for all of them", async () => {
        await openDialog();

        await toggle(toggles()[0]);
        await toggle(toggles()[1]);
        await toggle(toggles()[2]);

        expect(titles()).toContain("images.jpeg_quality");
        expect(slider()).not.toBeNull();
    });

    it("drops the subtree row for an attachment, which has no subtree to reach into", async () => {
        await openDialog(ATTACHMENT_TARGET);

        expect(titles()).toEqual([
            "space_usage.compress_reduce_resolution",
            "images.max_image_dimensions",
            "space_usage.compress_reencode",
            "space_usage.compress_convert_lossless",
            "images.jpeg_quality"
        ]);
    });

    it("reads the quality out between its title and the slider", async () => {
        await openDialog();

        // A slider says which way it is going but never where it is, so the row reads
        // title, value, control — the reading placed before the control it reads.
        expect(Array.from(rows()[4].children).map((child) => child.classList[0])).toEqual([
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

        // All three steps start on — converting in particular, being where nearly all the saving
        // comes from. Reaching into the subtree does not: that widens what the run touches rather
        // than how hard it compresses, and a descendant may be a clone.
        expect(toggles().map((input) => input.checked)).toEqual([ true, true, true, false ]);
    });

    it("keeps a stored answer of off for a step, rather than reasserting the default", async () => {
        mocks.storedOption = JSON.stringify({ convertLossless: false });

        await openDialog();

        expect(toggles().map((input) => input.checked)).toEqual([ true, true, false, false ]);
    });

    it("reads a stored answer back, and lets it override the image options", async () => {
        mocks.storedOption = JSON.stringify({
            maxWidthHeight: 800, quality: 35, reencode: false, processChildNotes: true
        });

        await openDialog();

        expect(numberField()?.value).toBe("800");
        expect(slider()?.value).toBe("35");
        expect(toggles().map((input) => input.checked)).toEqual([ true, false, true, true ]);
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
        await toggle(toggles()[1]);
        await toggle(toggles()[3]);

        // The last write carries the whole set, each change having been folded into the one before.
        expect(mocks.save).toHaveBeenLastCalledWith("imageCompressionToolOptions", JSON.stringify({
            resize: true,
            maxWidthHeight: 900,
            reencode: false,
            convertLossless: true,
            quality: 45,
            processChildNotes: true
        }));
    });

    it("offers no run at all once every step is switched off", async () => {
        await openDialog();

        await toggle(toggles()[0]);
        await toggle(toggles()[1]);
        await toggle(toggles()[2]);

        // Every image would be visited and none of them changed; a button that provably does
        // nothing is not one to offer.
        expect(compressButton()?.disabled).toBe(true);

        // Any one of them is enough to make the run worth offering again.
        await toggle(toggles()[1]);
        expect(compressButton()?.disabled).toBe(false);
    });

    it("holds the dimension to at least one pixel, which is the least the server accepts", async () => {
        await openDialog();

        await type(numberField(), "0");

        expect(numberField()?.value).toBe("1");
    });

    it("hands back nothing when the user backs out, settings remembered all the same", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[3]);
        await click(cancelButton());

        // The answer is "no run", and nothing was asked of the server — but the settings are kept
        // either way, so the next run opens where this one left off.
        await expect(closed).resolves.toBeNull();
        expect(mocks.postWithTimeout).not.toHaveBeenCalled();
        expect(mocks.save).toHaveBeenCalledWith(
            "imageCompressionToolOptions", expect.stringContaining('"processChildNotes":true'));
    });
});

describe("running the compression", () => {
    it("sends the settings to the note endpoint, the subtree choice among them", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[3]);
        await click(compressButton());
        await closed;

        expect(postedUrl()).toBe("notes/n1/compress-images");
        expect(postedBody()).toEqual({
            resize: true,
            maxWidthHeight: CONFIGURED_MAX_DIMENSIONS,
            reencode: true,
            convertLossless: true,
            quality: CONFIGURED_QUALITY,
            recursive: true
        });
    });

    it("sends a step that was switched off as switched off, rather than leaving it out", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[0]);
        await click(compressButton());
        await closed;

        // The server defaults an omitted step to on, so silence would ask for the opposite.
        expect(postedBody()).toMatchObject({ resize: false, reencode: true, convertLossless: true });
    });

    it("sends nothing about subtrees to the attachment endpoint, which has no use for it", async () => {
        const { closed } = await openDialog(ATTACHMENT_TARGET);

        await click(compressButton());
        await closed;

        expect(postedUrl()).toBe("attachments/a1/compress-image");
        expect(postedBody()).not.toHaveProperty("recursive");
    });

    it("holds a spinner up for the length of the run, and takes it down once it is over", async () => {
        let finish: (result: unknown) => void = () => {};
        mocks.postWithTimeout.mockReturnValueOnce(new Promise<unknown>((resolve) => { finish = resolve; }));

        const { closed } = await openDialog();
        await click(compressButton());

        // The dialog is out of the way and the run is under way: nothing here can say how far along
        // it is, so the toast stays up rather than counting anything down.
        expect(mocks.showPersistent).toHaveBeenCalledWith(expect.objectContaining({
            id: IMAGE_COMPRESSION_TOAST_ID,
            message: "space_usage.compress_running",
            dismissible: false
        }));
        expect(mocks.closePersistent).not.toHaveBeenCalled();

        finish(resultOf(3, 100, 40));
        await closed;

        expect(mocks.closePersistent).toHaveBeenCalledWith(IMAGE_COMPRESSION_TOAST_ID);
    });

    it("reports what the run did, in real sizes", async () => {
        mocks.postWithTimeout.mockResolvedValueOnce(resultOf(10, 45 * 1024 * 1024, 7 * 1024 * 1024));

        const { closed } = await openDialog();
        await click(compressButton());
        const result = await closed;

        expect(reportedMessage()).toBe(
            'space_usage.compress_result {"count":10,"before":"45 MiB","after":"7 MiB"}');
        // Handed back as well as reported, so a caller knows its own figures are now stale.
        expect(result?.compressedCount).toBe(10);
    });

    it.each([
        [ "found no images at all", EMPTY_RESULT, "space_usage.compress_result_none" ],
        // Quoting "from 45 MiB to 45 MiB" would read as a failure to report, where it is in fact a
        // complete answer: the images were already as small as these settings can make them.
        [ "made nothing smaller", resultOf(4, 900, 900), 'space_usage.compress_result_no_gain {"count":4}' ]
    ])("says so plainly when the run %s", async (_label, response, expected) => {
        mocks.postWithTimeout.mockResolvedValueOnce(response);

        const { closed } = await openDialog();
        await click(compressButton());
        await closed;

        expect(reportedMessage()).toBe(expected);
    });

    it("takes the spinner down and claims nothing when the run fails", async () => {
        mocks.postWithTimeout.mockRejectedValueOnce(new Error("boom"));

        const { closed } = await openDialog();
        await click(compressButton());

        // Answered as no run: the request layer already reported the failure, and nothing here can
        // say what it managed to change before it failed.
        await expect(closed).resolves.toBeNull();
        expect(mocks.closePersistent).toHaveBeenCalledWith(IMAGE_COMPRESSION_TOAST_ID);
        expect(mocks.showMessage).not.toHaveBeenCalled();
        // Mounted on demand, and gone again with it, however the run ended.
        expect(rows()).toEqual([]);
    });
});

/** Whether a row is drawn as qualifying the one above it rather than standing beside it. */
function isNested(row: HTMLElement) {
    return row.classList.contains("image-compression-section-nested");
}

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
