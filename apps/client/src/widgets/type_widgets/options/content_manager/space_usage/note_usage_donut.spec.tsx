import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";

const mocks = vi.hoisted(() => ({
    openContextWithNote: vi.fn()
}));

vi.mock("../../../../../components/app_context", () => ({
    default: {
        tabManager: {
            openContextWithNote: mocks.openContextWithNote,
            getActiveContext: () => ({ hoistedNoteId: "hoistedNote" })
        }
    }
}));

// The real i18n is not initialized under test, so `Trans` would render the bare key and drop the
// interpolated value; the stub renders exactly what the component wires in.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string, components: { Size: preact.VNode } }) => (
        <span data-i18n-key={i18nKey}>{components.Size}</span>
    )
}));

import NoteUsageDonut, { segmentTooltip } from "./note_usage_donut";

const USAGE: SpaceUsageNoteResponse = {
    noteId: "n1",
    ownSize: 10000,
    attachmentsSize: 5010,
    revisionsSize: 3000,
    noteContentSize: 150,
    subtreeContentSize: 700,
    attachments: [
        { attachmentId: "a1", title: "Attachment one", role: "file", size: 5000 },
        // Below 2% of the ring: consolidates into the "others" segment.
        { attachmentId: "tiny", title: "Tiny attachment", role: "file", size: 10 }
    ],
    children: []
};

let container: HTMLDivElement | undefined;

function renderDonut() {
    container = document.body.appendChild(document.createElement("div"));
    render(
        <NoteUsageDonut
            usage={USAGE}
            title="My note"
            notePath={[ "root", "n1" ]}
            centerActions={<button className="extra-action" />}
        />,
        container
    );
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

describe("NoteUsageDonut", () => {
    it("renders the composition ring with the semantic segment classes", () => {
        const probe = renderDonut();

        expect(probe.querySelector("circle.space-usage-segment-body")).not.toBeNull();
        expect(probe.querySelector("circle.space-usage-segment-attachment")).not.toBeNull();
        expect(probe.querySelector("circle.space-usage-segment-revisions")).not.toBeNull();
        // The sub-2% attachment consolidated into the counted bucket.
        expect(probe.querySelector("circle.space-usage-segment-others")).not.toBeNull();
    });

    it("links the center title to the note and opens it in a new tab instead of navigating", () => {
        const probe = renderDonut();
        const title = probe.querySelector<HTMLAnchorElement>(".note-usage-donut-title");

        expect(title?.textContent).toBe("My note");
        expect(title?.getAttribute("href")).toBe("#root/n1");

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        title?.dispatchEvent(click);

        expect(click.defaultPrevented).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("n1", {
            activate: true,
            hoistedNoteId: "hoistedNote"
        });
    });

    it("shows the deduplicated note and subtree sizes, with the actions above the title", () => {
        const probe = renderDonut();
        const center = probe.querySelector<HTMLElement>(".donut-chart-center");
        const values = [ ...probe.querySelectorAll(".note-usage-donut-size-value") ].map((el) => el.textContent);

        expect(values).toEqual([ formatSize(150), formatSize(700) ]);
        expect(center?.firstElementChild?.classList.contains("extra-action")).toBe(true);
    });
});

describe("segmentTooltip", () => {
    it("routes each kind to its own wording", () => {
        expect(segmentTooltip("plain", "Body", 10))
            .toBe(t("space_usage.segment_tooltip", { title: "Body", size: formatSize(10) }));
        expect(segmentTooltip("attachment", "img.png", 20))
            .toBe(t("space_usage.attachment_tooltip", { title: "img.png", size: formatSize(20) }));
        expect(segmentTooltip("child", "Projects", 30))
            .toBe(t("space_usage.child_tooltip", { title: "Projects", size: formatSize(30) }));
    });
});
