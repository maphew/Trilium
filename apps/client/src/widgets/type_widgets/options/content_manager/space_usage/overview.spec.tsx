import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    openContextMenu: vi.fn(),
    showDetails: vi.fn()
}));

vi.mock("../../../../../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: { getActiveContext: () => null }
    }
}));

// The menu itself is covered by its own spec; here only the wiring matters.
vi.mock("./context_menu", async (importOriginal) => ({
    ...await importOriginal<typeof import("./context_menu")>(),
    openSpaceUsageContextMenu: (...args: unknown[]) => mocks.openContextMenu(...args)
}));

// The treemap container never gets a real layout under happy-dom.
vi.mock("../../../../react/hooks", () => ({
    useElementSize: () => ({ width: 400, height: 300 })
}));

import Overview from "./overview";

const OVERVIEW: SpaceUsageOverviewResponse = {
    content: { size: 400, noteCount: 3, attachmentsSize: 0, revisionsSize: 0 },
    notes: [ { noteId: "n1", notePath: [ "n1" ], ownSize: 200, attachmentsSize: 0, revisionsSize: 0 } ],
    otherNotes: { size: 50, revisionsSize: 0, noteCount: 2 },
    hiddenNotes: { size: 80, revisionsSize: 0, noteCount: 10 },
    deletedNotes: { size: 70, noteCount: 1 },
    total: { size: 250, revisionsSize: 0, noteCount: 3 }
};

let container: HTMLDivElement | undefined;

function renderOverview() {
    container = document.body.appendChild(document.createElement("div"));
    render(<Overview overview={OVERVIEW} onShowDetails={mocks.showDetails} />, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.triggerCommand.mockClear();
    mocks.openContextMenu.mockClear();
    mocks.showDetails.mockClear();
});

describe("Overview", () => {
    it("renders a cell per note plus the three bucket cells", () => {
        const probe = renderOverview();

        expect(probe.querySelector('[data-href="#root/n1"]')).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-other")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-hidden")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-deleted")).not.toBeNull();
    });

    it("quick-edits a clicked note and offers the menu on right-click, while the bucket cells stay inert", () => {
        const probe = renderOverview();
        const cell = probe.querySelector('[data-href="#root/n1"]');

        cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/n1" });

        cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(mocks.openContextMenu).toHaveBeenCalledWith(
            expect.anything(), [ "root", "n1" ], mocks.showDetails);

        mocks.triggerCommand.mockClear();
        mocks.openContextMenu.mockClear();
        const bucket = probe.querySelector(".treemap-cell-deleted");
        bucket?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        bucket?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
        expect(mocks.openContextMenu).not.toHaveBeenCalled();
    });
});
