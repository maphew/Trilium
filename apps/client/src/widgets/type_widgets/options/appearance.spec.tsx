import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    mobile: false,
    stored: {} as Record<string, string | boolean>,
    userFonts: [] as { noteId: string; title: string; blobId: string }[],
    systemFonts: [] as string[]
}));

// Both the desktop card and the illustrated layout choices turn on which kind of client this is.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron,
    isMobile: () => mocks.mobile,
    reloadFrontendApp: vi.fn(),
    restartDesktopApp: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The theme card asks for the user's own themes as it mounts, and renders straight from the answer —
// an unanswered request leaves it reading `undefined`, which throws mid-render.
vi.mock("../../../services/server", () => ({
    default: {
        get: async (url: string) => (url === "options/user-themes" || url === "keyboard-actions" ? [] : {}),
        post: async () => ({}),
        put: async () => ({}),
        remove: async () => ({})
    }
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

// The font picker asks for the user's own fonts and registers each one it is given; only the list
// is of interest here, so the registration is stood in for.
vi.mock("../../../services/custom_fonts", () => ({
    getCustomFonts: async () => mocks.userFonts,
    registerFontNote: async (_noteId: string, family: string) => ({ family })
}));

// happy-dom exposes no `queryLocalFonts`, so what the desktop app would find is stood in for.
vi.mock("../../../services/font", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/font")>()),
    listSystemFontFamilies: async () => mocks.systemFonts
}));

// useNoteTitle names the font a font option points at; the listing above is what the picker lists.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteTitle: (noteId: string | undefined) => mocks.userFonts.find((font) => font.noteId === noteId)?.title,
    useTriliumOption: (name: string) => [ String(mocks.stored[name] ?? ""), vi.fn() ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === true, vi.fn() ]
}));

import AppearanceSettings from "./appearance";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.mobile = false;
    mocks.stored = {};
    mocks.userFonts = [];
    mocks.systemFonts = [];
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
 * Opens the page fresh. The tree is torn down first so that a scenario changing a setting and
 * reopening gets a clean mount, rather than a diff against what the previous values rendered.
 */
function open() {
    act(() => {
        render(null, host);
        render(<AppearanceSettings />, host);
    });
}

const fontRows = () => [ ...host.querySelectorAll(".font-option") ];

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
        mocks.systemFonts = [ "Adwaita Mono", "Inter" ];
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).toContain("fonts.system-fonts");
        // The named families are a guess at what a device has, and go once there is an answer.
        expect(headers).not.toContain("fonts.sans-serif-system-fonts");
        // The generics resolve wherever Trilium runs, so they stay.
        expect(headers).toContain("fonts.generic-fonts");

        const listed = [ ...document.querySelectorAll(".font-picker-list .dropdown-item") ].map((item) => item.textContent?.trim());
        expect(listed).toEqual(expect.arrayContaining([ "Adwaita Mono", "Inter" ]));
    });

    it("keeps the named families on a server build, which cannot ask what the device has", async () => {
        mocks.electron = false;
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [ "Inter" ];
        open();
        await act(async () => {});
        await act(async () => (fontRows()[0] as HTMLElement).click());

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).not.toContain("fonts.system-fonts");
        expect(headers).toContain("fonts.sans-serif-system-fonts");
    });

    it("leaves ligatures alone, since they come from the theme's own font", () => {
        open();

        // Not nested under custom fonts: the setting is needed exactly when those are off.
        const ligatures = host.querySelector("input.switch-toggle[id^='monospace-ligatures-enabled-']");
        expect(ligatures?.closest(".tn-card-option")?.className).not.toContain("tn-card-section-nested");
        expect((ligatures as HTMLInputElement | null)?.disabled).toBe(false);
    });
});

describe("the layout choices", () => {
    it("gives each an illustrated card of its own, side by side", () => {
        open();

        const cards = [ ...host.querySelectorAll(".appearance-layout-choices .tn-card") ];
        expect(cards).toHaveLength(2);
        expect(cards.every((card) => card.className.includes("thumbnail-selector-option-card"))).toBe(true);
        expect(host.querySelectorAll(".appearance-layout-choices .radio-with-illustration")).toHaveLength(2);
    });

    it("offers neither on a phone, where the window has no shape to choose", () => {
        mocks.mobile = true;
        open();

        expect(host.querySelector(".appearance-layout-choices")).toBeNull();
    });

    it("offers the ribbon setting only on the old layout, which is the only one that has one", () => {
        open();
        expect(host.querySelector("input.switch-toggle[id^='edited-notes-open-in-ribbon-']")).not.toBeNull();

        mocks.stored = { newLayout: true };
        open();
        expect(host.querySelector("input.switch-toggle[id^='edited-notes-open-in-ribbon-']")).toBeNull();
    });
});

describe("the desktop-only settings", () => {
    it("are offered with the way to apply them, and neither is on a server build", () => {
        open();
        expect(host.querySelector(".appearance-electron")).not.toBeNull();
        expect(host.querySelector(".restart-action")).not.toBeNull();

        mocks.electron = false;
        open();
        expect(host.querySelector(".appearance-electron")).toBeNull();
        expect(host.querySelector(".restart-action")).toBeNull();
    });
});
