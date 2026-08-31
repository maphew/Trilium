import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    stored: {} as Record<string, string | boolean>,
    userFonts: [] as { noteId: string; title: string; blobId: string }[],
    systemFonts: [] as { family: string; monospace: boolean }[],
    /** The stock families this device can render, or `null` to let every one of them through. */
    availableFamilies: null as string[] | null
}));

// Only the desktop app can be asked what fonts the device has.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The picker asks for the user's own fonts and registers each one it is given; only the list is of
// interest here, so the registration is stood in for.
vi.mock("../../../services/custom_fonts", () => ({
    getCustomFonts: async () => mocks.userFonts,
    registerFontNote: async (_noteId: string, family: string) => ({ family })
}));

// happy-dom exposes no `queryLocalFonts`, so what the desktop app would find is stood in for.
vi.mock("../../../services/font", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/font")>()),
    listSystemFonts: async () => mocks.systemFonts,
    filterAvailableFamilies: (families: string[]) => mocks.availableFamilies ?? families
}));

// useNoteTitle names the font a font option points at; the listing above is what the picker lists.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteTitle: (noteId: string | undefined) => mocks.userFonts.find((font) => font.noteId === noteId)?.title,
    useTriliumOption: (name: string) => [ String(mocks.stored[name] ?? ""), vi.fn() ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === true, vi.fn() ]
}));

import Fonts from "./appearance_fonts";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.stored = {};
    mocks.userFonts = [];
    mocks.systemFonts = [];
    mocks.availableFamilies = null;
    Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { add: vi.fn(), delete: vi.fn() }
    });
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

/**
 * Renders the card fresh. The tree is torn down first so that a scenario changing a setting and
 * rendering again gets a clean mount, rather than a diff against what the previous values rendered.
 */
function open() {
    act(() => {
        render(null, host);
        render(<Fonts />, host);
    });
}

const fontRows = () => [ ...host.querySelectorAll(".font-option") ];
const listedFonts = () => [ ...document.querySelectorAll(".font-picker-list .dropdown-item") ].map((item) => item.textContent?.trim());
const listedHeaders = () => [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);

/**
 * Opens the picker of the first font on a server build, where the list is the stock one — the
 * families it holds are known, which is what a search can be checked against.
 */
async function openPicker() {
    mocks.electron = false;
    mocks.stored = { overrideThemeFonts: true };
    open();
    await act(async () => {});
    await act(async () => (fontRows()[0] as HTMLElement).click());
}

/** The generic entries, which head every list and are never measured against the device. */
const GENERIC_LABELS = [ "fonts.theme_defined", "fonts.system-default", "fonts.serif", "fonts.sans-serif", "fonts.monospace" ];

/** Types into the picker's search box, as the user would. */
function searchFonts(query: string) {
    const search = document.querySelector<HTMLInputElement>(".font-picker-modal .settings-search input");
    if (!search) throw new Error("the font picker has no search box");

    search.value = query;
    search.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the font settings", () => {
    it("keeps the fonts on show with custom fonts off, greyed rather than gone", () => {
        open();

        // What turning the switch on would put in force is the whole reason for turning it on.
        expect(fontRows()).toHaveLength(4);
        expect(fontRows().every((row) => row.className.includes("disabled"))).toBe(true);
    });

    it("brings them within reach once custom fonts are on", () => {
        mocks.stored = { overrideThemeFonts: true };
        open();

        expect(fontRows()).toHaveLength(4);
        expect(fontRows().some((row) => row.className.includes("disabled"))).toBe(false);
    });

    it("nests them under the switch that governs them", () => {
        open();
        expect(fontRows().every((row) => row.className.includes("tn-card-section-nested"))).toBe(true);
    });

    it("offers the fonts the user labelled #customFont, one entry per note", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.userFonts = [
            { noteId: "fontNoteA1", title: "Iosevka", blobId: "b1" },
            { noteId: "fontNoteB2", title: "Inter", blobId: "b2" },
            // Two notes can carry the same name; each is its own entry, told apart by its note.
            { noteId: "fontNoteC3", title: "Inter", blobId: "b3" }
        ];
        open();
        await act(async () => {});

        await act(async () => (fontRows()[0] as HTMLElement).click());

        const picker = document.querySelector(".font-picker-list");
        const headers = [ ...(picker?.querySelectorAll(".dropdown-header") ?? []) ].map((header) => header.textContent);
        // Ahead of the stock families, which the user has to scroll past otherwise.
        expect(headers[0]).toBe("fonts.user-fonts");

        // Each is named by its note's own title, and stands for the note rather than for a family.
        const listed = [ ...(picker?.querySelectorAll(".dropdown-item") ?? []) ].map((item) => item.textContent?.trim());
        expect(listed.filter((entry) => entry === "Inter")).toHaveLength(2);
        expect(listed).toContain("Iosevka");
    });

    it("names a set custom font by its note's title, not by the reference the option holds", async () => {
        mocks.stored = { overrideThemeFonts: true, mainFontFamily: "customFont:fontNoteA1" };
        mocks.userFonts = [ { noteId: "fontNoteA1", title: "Iosevka", blobId: "b1" } ];
        open();
        await act(async () => {});

        expect(fontRows()[0].querySelector(".font-option-specimen")?.textContent).toBe("Iosevka");
    });

    it("lists only the built-in families when the user has labelled no fonts", async () => {
        mocks.stored = { overrideThemeFonts: true };
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).not.toContain("fonts.user-fonts");
        expect(headers).toContain("fonts.generic-fonts");
    });

    it("offers the fonts installed on the device in place of the guessed families", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [
            { family: "Adwaita Mono", monospace: true },
            { family: "Inter", monospace: false }
        ];
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        // Split by the one thing a browser can tell about an installed family.
        expect(headers).toContain("fonts.proportional-system-fonts");
        expect(headers).toContain("fonts.monospace-system-fonts");
        // The named families are a guess at what a device has, and go once there is an answer.
        expect(headers).not.toContain("fonts.sans-serif-system-fonts");
        // The generics resolve wherever Trilium runs, so they stay.
        expect(headers).toContain("fonts.generic-fonts");

        const listed = [ ...document.querySelectorAll(".font-picker-list .dropdown-item") ].map((item) => item.textContent?.trim());
        expect(listed).toEqual(expect.arrayContaining([ "Adwaita Mono", "Inter" ]));
    });

    it("heads only the half of the split that has fonts in it", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [ { family: "Inter", monospace: false } ];
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).toContain("fonts.proportional-system-fonts");
        expect(headers).not.toContain("fonts.monospace-system-fonts");
    });

    it("keeps the named families on a server build, which cannot ask what the device has", async () => {
        mocks.electron = false;
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [ { family: "Inter", monospace: false } ];
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).not.toContain("fonts.proportional-system-fonts");
        expect(headers).toContain("fonts.sans-serif-system-fonts");
    });

    it("narrows the named families to the ones the device can render", async () => {
        mocks.electron = false;
        mocks.stored = { overrideThemeFonts: true };
        // Nothing from the serif or handwriting groups, so both go entirely.
        mocks.availableFamilies = [ "Arial", "Verdana", "Courier New" ];
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        expect(listedFonts()).toEqual([ ...GENERIC_LABELS, "Arial", "Verdana", "Courier New" ]);
        // A group left with nothing goes, its header with it; the generics are never measured.
        expect(listedHeaders()).toEqual([
            "fonts.generic-fonts",
            "fonts.sans-serif-system-fonts",
            "fonts.monospace-system-fonts"
        ]);
    });

    it("narrows the list to the fonts matching what is searched for", async () => {
        await openPicker();
        await act(async () => searchFonts("georgia"));

        expect(listedFonts()).toEqual([ "Georgia" ]);
        // The groups left with nothing go, their headers with them.
        expect(listedHeaders()).toEqual([ "fonts.serif-system-fonts" ]);
    });

    it("keeps a whole group whose own name is searched for", async () => {
        await openPicker();
        await act(async () => searchFonts("handwriting"));

        // The group is what was asked for, so its fonts no longer have to match on their own.
        expect(listedFonts()).toEqual([ "Bradley Hand", "Brush Script MT", "Comic Sans MS", "Luminari" ]);
    });

    it("says so when nothing matches, rather than leaving an empty list", async () => {
        await openPicker();
        await act(async () => searchFonts("Nonesuch"));

        expect(document.querySelector(".font-picker-list")).toBeNull();
        expect(document.querySelector(".font-picker-empty")?.textContent).toContain("fonts.no_fonts_found");
    });

    it("brings the whole list back when the search is cleared", async () => {
        await openPicker();
        await act(async () => searchFonts("georgia"));

        // The field is the settings' own, so it comes with the button that empties it.
        const clear = document.querySelector<HTMLElement>(".font-picker-modal .settings-search-clear");
        expect(clear).not.toBeNull();

        await act(async () => clear?.click());
        expect(listedFonts()).toContain("Arial");
        expect(listedHeaders()).toContain("fonts.generic-fonts");
    });

    it("leaves ligatures alone, since they come from the theme's own font", () => {
        open();

        // Not nested under custom fonts: the setting is needed exactly when those are off.
        const ligatures = host.querySelector("input.switch-toggle[id^='monospace-ligatures-enabled-']");
        expect(ligatures?.closest(".tn-card-option")?.className).not.toContain("tn-card-section-nested");
        expect((ligatures as HTMLInputElement | null)?.disabled).toBe(false);
    });
});
