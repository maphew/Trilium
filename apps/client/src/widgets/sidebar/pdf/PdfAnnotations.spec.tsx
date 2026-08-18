import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import PdfAnnotations, { isDark } from "./PdfAnnotations";

// The panel reads the note being displayed and the annotations the viewer iframe published; both
// arrive through hooks that need the whole app context, so they are handed over directly here.
const shown = vi.hoisted(() => ({
    note: null as FNote | null,
    annotations: null as { annotations: PdfAnnotationInfo[]; scrollToAnnotation: () => void } | null
}));
// i18next is not initialised for client specs, so t() would render every label as an empty
// string. Echoing the key and its interpolations instead keeps the assertions about which
// label the panel picks, rather than about the English wording.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}(${JSON.stringify(options ?? {})})`
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useActiveNoteContext: () => ({ note: shown.note }),
    useNoteProperty: (_note: FNote, property: string) => (shown.note as any)?.[property],
    useGetContextData: () => shown.annotations
}));

/** A `file` note holding a PDF — the only combination the panel renders for. */
function pdfNote() {
    return { type: "file", mime: "application/pdf" } as unknown as FNote;
}

function annotation(overrides: Partial<PdfAnnotationInfo>): PdfAnnotationInfo {
    return {
        id: "1R",
        type: "highlight",
        contents: "",
        highlightedText: "",
        author: "",
        pageNumber: 1,
        color: null,
        creationDate: null,
        modificationDate: null,
        ...overrides
    };
}

function renderPanel(annotations: PdfAnnotationInfo[]) {
    // The surrounding RightPanelWidget reads which panels the user collapsed from the options.
    options.set("rightPaneCollapsedItems", JSON.stringify([]));

    const container = document.createElement("div");
    document.body.append(container);
    shown.note = pdfNote();
    shown.annotations = { annotations, scrollToAnnotation: () => {} };
    render(<PdfAnnotations />, container);
    return container;
}

describe("PdfAnnotations", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        shown.note = null;
        shown.annotations = null;
    });

    it("names annotations that carry no text of their own by kind and page", () => {
        // A free-hand highlight is stored as ink and never has text; before #11059 it was
        // dropped, taking the whole panel with it when nothing else was annotated.
        const container = renderPanel([
            annotation({ id: "18R", type: "ink", pageNumber: 4 }),
            annotation({ id: "17R", type: "highlight", pageNumber: 2 }),
            annotation({ id: "5R", highlightedText: "quoted words", contents: "A remark" })
        ]);

        const rows = [ ...container.querySelectorAll(".pdf-annotation-item") ];
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector(".pdf-annotation-untitled")?.textContent)
            .toBe(`pdf.annotation_drawing({"pageNumber":4})`);
        expect(rows[1].querySelector(".pdf-annotation-untitled")?.textContent)
            .toBe(`pdf.annotation_highlight({"pageNumber":2})`);
        // An annotation with text of its own is described by that text, not by its kind.
        expect(rows[2].textContent).toContain("quoted words");
        expect(rows[2].textContent).toContain("A remark");
        expect(rows[2].querySelector(".pdf-annotation-untitled")).toBeNull();
    });

    it("flips the row's text to light on a dark annotation colour", () => {
        // The pen draws in black by default, and the row is tinted with the annotation's own
        // colour — the default dark text would be unreadable on it.
        const container = renderPanel([
            annotation({ id: "18R", type: "ink", color: "#000000" }),
            annotation({ id: "5R", color: "#ffff98" })
        ]);

        const rows = [ ...container.querySelectorAll(".pdf-annotation-item") ];
        expect(rows[0].classList.contains("on-dark")).toBe(true);
        expect(rows[1].classList.contains("on-dark")).toBe(false);
    });
});

describe("isDark", () => {
    it("separates colours needing light text from the rest", () => {
        expect(isDark("#000000")).toBe(true);
        expect(isDark("#1a3d7c")).toBe(true);
        expect(isDark("#ffff98")).toBe(false);
        expect(isDark("#ffffff")).toBe(false);
        // Green weighs heaviest in the luma formula, so a saturated green reads as light.
        expect(isDark("#00ff00")).toBe(false);
    });

    it("treats a missing or unparseable colour as light, matching the untinted row", () => {
        expect(isDark(null)).toBe(false);
        expect(isDark("rgb(0, 0, 0)")).toBe(false);
    });
});
