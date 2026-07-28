import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    openContextWithNote: vi.fn()
}));

vi.mock("../../../../../components/app_context", () => ({
    default: {
        tabManager: {
            openContextWithNote: mocks.openContextWithNote,
            getActiveContext: () => null
        }
    }
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
    render(<Overview overview={OVERVIEW} />, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.openContextWithNote.mockClear();
});

describe("Overview", () => {
    it("renders a cell per note plus the three bucket cells", () => {
        const probe = renderOverview();

        expect(probe.querySelector('[data-href="#root/n1"]')).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-other")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-hidden")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-deleted")).not.toBeNull();
    });

    it("opens a clicked note in a new tab, while the bucket cells stay inert", () => {
        const probe = renderOverview();

        probe.querySelector('[data-href="#root/n1"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("n1", {
            activate: true,
            hoistedNoteId: null
        });

        mocks.openContextWithNote.mockClear();
        probe.querySelector(".treemap-cell-deleted")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mocks.openContextWithNote).not.toHaveBeenCalled();
    });
});
