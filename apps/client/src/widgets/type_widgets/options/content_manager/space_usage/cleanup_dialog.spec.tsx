import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(() => -1)
}));

vi.mock("../../../../../services/options", () => ({
    default: { getInt: mocks.getInt }
}));

// Bootstrap's modal machinery is not what any of this is about; the stub renders the body and the
// footer inline so the dialog's own content can be read straight out of the DOM.
vi.mock("../../../../react/Modal", () => ({
    default: ({ children, footer, show }: { children: ComponentChildren, footer: ComponentChildren, show: boolean }) => (
        show ? <div className="modal-stub">{children}<div className="footer-stub">{footer}</div></div> : null
    )
}));

import CleanupDialog, { type CleanupEstimates } from "./cleanup_dialog";

const ESTIMATES: CleanupEstimates = {
    deletedEntities: 3000,
    unusedAttachments: 2000,
    revisionSnapshots: 5000
};

let container: HTMLDivElement | undefined;

function renderDialog(estimates = ESTIMATES) {
    container = document.body.appendChild(document.createElement("div"));
    render(<CleanupDialog show onHidden={() => {}} estimates={estimates} />, container);
    return container;
}

/** The dialog portals to `<body>`, so its content is looked up there rather than in the container. */
function rows() {
    return Array.from(document.body.querySelectorAll<HTMLElement>(".cleanup-item:not(.cleanup-item-nested)"));
}

/** The qualifiers under the revision item, which are card sections of their own. */
function nestedRows() {
    return Array.from(document.body.querySelectorAll<HTMLElement>(".cleanup-item-nested"));
}

function titlesOf(sections: HTMLElement[]) {
    return sections.map((section) => section.querySelector(".cleanup-item-title")?.textContent);
}

function textOf(selector: string) {
    return document.body.querySelector<HTMLElement>(selector)?.textContent ?? "";
}

/**
 * Flips the switch of the row at `index`, the way a click on it does. Translations are absent under
 * the test i18n, so rows are addressed by position rather than by their (empty) labels.
 */
async function toggleRow(index: number) {
    const toggle = rows()[index]?.querySelector<HTMLInputElement>(".switch-toggle");
    await act(async () => {
        toggle?.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("CleanupDialog", () => {
    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        mocks.getInt.mockReturnValue(-1);
    });

    it("lists every item with its own swatch, its estimate and a switch", () => {
        renderDialog();

        // Compared against the same t() calls, so the assertion holds with translations loaded and
        // stays faithful under the uninitialized test i18n (t yields undefined → empty span).
        expect(titlesOf(rows())).toEqual([
            t("space_usage.cleanup_deleted_entities") ?? "",
            t("space_usage.cleanup_unused_attachments") ?? "",
            t("space_usage.cleanup_revision_snapshots") ?? ""
        ]);

        const sizes = rows().map((row) => row.querySelector(".cleanup-item-size")?.textContent);
        expect(sizes).toEqual([ formatSize(3000), formatSize(2000), formatSize(5000) ]);

        // Each row names its item, which is what carries the color its swatch and its amount are
        // both painted from — so the list doubles as the ring's legend.
        expect(rows().map((row) => row.className)).toEqual([
            "tn-card-section cleanup-item cleanup-item-deletedEntities",
            "tn-card-section cleanup-item cleanup-item-unusedAttachments",
            "tn-card-section cleanup-item cleanup-item-revisionSnapshots"
        ]);
        expect(rows().every((row) => row.querySelector(".cleanup-item-swatch"))).toBe(true);
        expect(rows().every((row) => row.querySelector(".switch-toggle"))).toBe(true);
    });

    it("reads the picked total against the whole, which unpicking an item does not move", async () => {
        renderDialog();

        expect(textOf(".cleanup-chart-caption")).toBe(t("space_usage.cleanup_estimated") ?? "");
        expect(textOf(".cleanup-chart-amount")).toBe(formatSize(10000));
        expect(textOf(".cleanup-chart-total")).toBe(
            t("space_usage.cleanup_amount_of", { total: formatSize(10000) }) ?? "");

        // Unpicking the deleted entities takes their 3000 off the offer, never off the whole below
        // the rule: only the figure being read moves.
        await toggleRow(0);
        expect(textOf(".cleanup-chart-amount")).toBe(formatSize(7000));
        expect(textOf(".cleanup-chart-total")).toBe(
            t("space_usage.cleanup_amount_of", { total: formatSize(10000) }) ?? "");
    });

    it("keeps an unpicked item's arc on the ring, drawn muted rather than dropped", async () => {
        renderDialog();

        const arcs = () => Array.from(document.body.querySelectorAll(".donut-segment"))
            .map((segment) => segment.getAttribute("class") ?? "");
        expect(arcs().length).toBe(3);
        expect(arcs().some((className) => className.includes("cleanup-segment-unpicked"))).toBe(false);

        await toggleRow(1);
        expect(arcs().length).toBe(3);
        expect(arcs().filter((className) => className.includes("cleanup-segment-unpicked")).length).toBe(1);
    });

    it("qualifies the revision trimming only while it is actually being run", async () => {
        renderDialog();

        expect(titlesOf(nestedRows())).toEqual([
            t("space_usage.cleanup_snapshots_to_keep") ?? "",
            t("space_usage.cleanup_keep_named") ?? ""
        ]);

        // The revisions row is the last of the three; unpicking it takes its qualifiers with it.
        await toggleRow(2);
        expect(nestedRows()).toEqual([]);
    });

    it("offers the configured revision limit to keep, falling back where it keeps all or none", () => {
        const keptField = () => document.body.querySelector<HTMLInputElement>(".cleanup-item-number")?.value;

        // No limit configured: -1 keeps everything, which is no offer at all for a one-off trim.
        renderDialog();
        expect(keptField()).toBe("4");

        for (const [ configured, expected ] of [ [ 7, "7" ], [ 0, "4" ] ] as const) {
            render(null, container ?? document.createElement("div"));
            mocks.getInt.mockReturnValue(configured);
            renderDialog();
            expect(keptField()).toBe(expected);
        }
    });
});
