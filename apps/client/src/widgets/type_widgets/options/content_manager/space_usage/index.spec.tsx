import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { type ComponentChildren, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";

const mocks = vi.hoisted(() => ({
    overview: undefined as unknown
}));

vi.mock("./use_space_usage_fetch", () => ({
    useSpaceUsageFetch: () => mocks.overview
}));

vi.mock("./browse", () => ({
    default: () => <div className="browse-stub" />
}));

vi.mock("./overview", () => ({
    default: () => <div className="overview-stub" />
}));

vi.mock("../../components/OptionsPageHeader", () => ({
    default: ({ actions, below }: { actions?: ComponentChildren, below?: ComponentChildren }) => (
        <div className="header-stub">{actions}{below}</div>
    )
}));

import type { ContentManagerSectionProps } from "../index";
import SpaceUsage from "./index";

// Only the switcher matters to this section; the note-context plumbing of TypeWidgetProps is the
// shell's business and stays unused here.
const SECTION_PROPS = {
    sectionSwitcher: <span className="switcher-stub" />
} as unknown as ContentManagerSectionProps;

const OVERVIEW: SpaceUsageOverviewResponse = {
    content: { size: 4000, noteCount: 12, attachmentsSize: 300, revisionsSize: 200 },
    notes: [],
    otherNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
    hiddenNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
    deletedNotes: { size: 900, noteCount: 3 },
    total: { size: 3500, revisionsSize: 0, noteCount: 12 }
};

let container: HTMLDivElement | undefined;

function renderSection() {
    container = document.body.appendChild(document.createElement("div"));
    render(<SpaceUsage {...SECTION_PROPS} />, container);
    return container;
}

function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.overview = undefined;
});

describe("SpaceUsage section", () => {
    it("shows the loading state without a status line until the overview arrives", () => {
        mocks.overview = undefined;
        const probe = renderSection();

        expect(probe.querySelector(".space-usage-loading")).not.toBeNull();
        expect(probe.querySelector(".space-usage-status")).toBeNull();
        expect(probe.querySelector(".switcher-stub")).not.toBeNull();
    });

    it("renders the overview with the two-part status line", () => {
        mocks.overview = OVERVIEW;
        const probe = renderSection();

        expect(probe.querySelector(".overview-stub")).not.toBeNull();
        expect(probe.querySelector(".browse-stub")).toBeNull();

        // Symmetric against the same t() call: meaningful with translations loaded, and still a
        // faithful comparison when the test i18n is uninitialized (t yields undefined → empty span).
        const [ contentSpan, , deletedSpan ] = [ ...probe.querySelectorAll(".space-usage-status span") ];
        expect(contentSpan.textContent?.trim()).toBe(t("space_usage.status_content", {
            count: 12,
            size: formatSize(4000),
            attachmentsSize: formatSize(300)
        }) ?? "");
        expect(deletedSpan.textContent?.trim()).toBe(t("space_usage.status_deleted", {
            count: 3,
            size: formatSize(900)
        }) ?? "");
    });

    it("switches to Browse and back, keeping the status line up", async () => {
        mocks.overview = OVERVIEW;
        const probe = renderSection();

        // Labels depend on the (uninitialized) test i18n; the inactive button is the other view.
        const inactiveViewButton = () =>
            [ ...probe.querySelectorAll<HTMLButtonElement>(".header-stub button") ]
                .find((button) => !button.classList.contains("active"));

        inactiveViewButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();
        expect(probe.querySelector(".browse-stub")).not.toBeNull();
        expect(probe.querySelector(".overview-stub")).toBeNull();
        expect(probe.querySelector(".space-usage-status")).not.toBeNull();

        inactiveViewButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();
        expect(probe.querySelector(".overview-stub")).not.toBeNull();
        expect(probe.querySelector(".browse-stub")).toBeNull();
    });
});
