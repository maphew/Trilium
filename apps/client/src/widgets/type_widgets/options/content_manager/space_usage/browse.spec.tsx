import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { type ComponentChildren, render } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DonutRing } from "../../../../react/charts/DonutChart";
import type { UsageSegmentData } from "./donut_segments";

interface CapturedDonutProps {
    usage: SpaceUsageNoteResponse;
    title: string;
    notePath: string[];
    outerRings: DonutRing<UsageSegmentData>[];
    centerActions: ComponentChildren;
    onTitleContextMenu: (event: MouseEvent) => void;
}

const mocks = vi.hoisted(() => ({
    usage: undefined as unknown,
    fetchedUrls: [] as string[],
    donutProps: undefined as unknown,
    openContextMenu: vi.fn()
}));

vi.mock("./context_menu", () => ({
    openSpaceUsageContextMenu: (...args: unknown[]) => mocks.openContextMenu(...args)
}));

vi.mock("./use_space_usage_fetch", () => ({
    useSpaceUsageFetch: (url: string) => {
        mocks.fetchedUrls.push(url);
        return mocks.usage;
    }
}));

// The donut is covered by its own spec; here it captures its props and renders the center actions
// so the back button is reachable.
vi.mock("./note_usage_donut", () => ({
    default: (props: CapturedDonutProps) => {
        mocks.donutProps = props;
        return <div className="donut-stub">{props.centerActions}</div>;
    },
    segmentTooltip: (kind: string, title: string, size: number) => `${kind}:${title}:${size}`
}));

vi.mock("../../../../react/ActionButton", () => ({
    default: ({ className, disabled, onClick }: { className?: string, disabled?: boolean, onClick?: () => void }) => (
        <button type="button" className={`back-stub ${className ?? ""}`} disabled={disabled} onClick={onClick} />
    )
}));

vi.mock("../../../../../services/froca", () => ({
    default: {
        getNotes: async (noteIds: string[]) => noteIds.map((noteId) => ({ noteId, title: `title:${noteId}` }))
    }
}));

import Browse from "./browse";

function usageOf(noteId: string, children: string[]): SpaceUsageNoteResponse {
    return {
        noteId,
        ownSize: 10,
        attachmentsSize: 0,
        revisionsSize: 0,
        subtreeRevisionsContentSize: 0,
        noteContentSize: 10,
        subtreeContentSize: 100,
        attachments: [],
        children: children.map((childId) => ({
            noteId: childId,
            subtreeSize: 40,
            subtreeNoteCount: 2
        }))
    };
}

let container: HTMLDivElement | undefined;

/** The path is owned by the section in the app; here a minimal host stands in for it. */
function BrowseHost() {
    const [ path, setPath ] = useState([ "root" ]);

    return <Browse path={path} onPathChange={setPath} />;
}

function renderBrowse() {
    container = document.body.appendChild(document.createElement("div"));
    render(<BrowseHost />, container);
    return container;
}

function donutProps() {
    return mocks.donutProps as CapturedDonutProps;
}

/** State set in event handlers and froca's async titles both land on later ticks. */
function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

function crumbTexts(probe: HTMLElement) {
    return [ ...probe.querySelectorAll(".space-usage-crumb") ].map((crumb) => crumb.textContent);
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.usage = undefined;
    mocks.fetchedUrls = [];
    mocks.donutProps = undefined;
    mocks.openContextMenu.mockClear();
});

describe("Browse", () => {
    it("shows the loading state until the usage arrives", () => {
        mocks.usage = undefined;
        const probe = renderBrowse();

        expect(probe.querySelector(".space-usage-loading")).not.toBeNull();
        expect(probe.querySelector(".donut-stub")).toBeNull();
        expect(mocks.fetchedUrls).toEqual([ "space-usage/note/root" ]);
    });

    it("renders the donut for the root with its children ring and resolved titles", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        // The titles arrive via an effect, which Preact schedules a frame later than state updates.
        await vi.waitFor(() => expect(donutProps().title).toBe("title:root"));
        expect(donutProps().notePath).toEqual([ "root" ]);
        expect(crumbTexts(probe)).toEqual([ "title:root" ]);

        const ring = donutProps().outerRings[0];
        expect(ring.segments[0]).toMatchObject({
            data: { noteId: "child1" },
            tooltip: "child:title:child1:40"
        });

        // Nowhere to go back to from the root.
        expect(probe.querySelector<HTMLButtonElement>(".back-stub")?.disabled).toBe(true);
    });

    it("descends into a clicked child, then navigates back via button and breadcrumb", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        donutProps().outerRings[0].onSegmentClick?.({ id: "child/child1", value: 40, data: { noteId: "child1" } });
        await flushRender();

        expect(mocks.fetchedUrls).toContain("space-usage/note/child1");
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root", "title:child1" ]));

        const back = probe.querySelector<HTMLButtonElement>(".back-stub");
        expect(back?.disabled).toBe(false);
        back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        // Descend twice, then jump straight home through the first crumb.
        donutProps().outerRings[0].onSegmentClick?.({ id: "child/child1", value: 40, data: { noteId: "child1" } });
        await flushRender();
        donutProps().outerRings[0].onSegmentClick?.({ id: "child/child2", value: 40, data: { noteId: "child2" } });
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root", "title:child1", "title:child2" ]));

        probe.querySelector<HTMLButtonElement>("button.space-usage-crumb")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));
    });

    it("ignores clicks on segments that name no note, like the deleted bucket", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        donutProps().outerRings[0].onSegmentClick?.({ id: "/deleted-notes", value: 5, data: {} });
        await flushRender();

        expect(crumbTexts(probe)).toEqual([ "title:root" ]);
    });

    it("opens the shared menu on a child's own path and on the current note, descending on show-details", async () => {
        mocks.usage = usageOf("root", [ "child1" ]);
        const probe = renderBrowse();
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root" ]));

        const event = new MouseEvent("contextmenu");
        const ring = donutProps().outerRings[0];
        ring.onSegmentContextMenu?.({ id: "child/child1", value: 40, data: { noteId: "child1" } }, event);
        expect(mocks.openContextMenu).toHaveBeenCalledWith(event, [ "root", "child1" ], expect.any(Function));

        donutProps().onTitleContextMenu(event);
        expect(mocks.openContextMenu).toHaveBeenLastCalledWith(event, [ "root" ], expect.any(Function));

        // Showing a note's details from within Browse is this view's own descent.
        mocks.openContextMenu.mock.calls[0][2]([ "root", "child1" ]);
        await vi.waitFor(() => expect(crumbTexts(probe)).toEqual([ "title:root", "title:child1" ]));

        // A segment naming no note has nothing to offer.
        mocks.openContextMenu.mockClear();
        ring.onSegmentContextMenu?.({ id: "/deleted-notes", value: 5, data: {} }, event);
        expect(mocks.openContextMenu).not.toHaveBeenCalled();
    });
});
