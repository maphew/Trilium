import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildChildrenSegments, buildCompositionSegments, type UsageTooltipKind } from "./donut_segments";
import { hueOf } from "./overview_model";

function usage(overrides: Partial<SpaceUsageNoteResponse> = {}): SpaceUsageNoteResponse {
    return {
        noteId: "note",
        ownSize: 0,
        attachmentsSize: 0,
        revisionsSize: 0,
        noteContentSize: 0,
        subtreeContentSize: 0,
        attachments: [],
        children: [],
        ...overrides
    };
}

function child(noteId: string, subtreeSize: number) {
    return { noteId, subtreeSize, subtreeRevisionsSize: 0, subtreeNoteCount: 1 };
}

const makeTooltip = (kind: UsageTooltipKind, title: string, size: number) => `${kind}:${title}/${size}`;

describe("buildCompositionSegments", () => {
    const options = { bodyLabel: "Body", revisionsLabel: "Revisions", othersLabel: "Others", makeTooltip };

    it("orders body, attachments largest-first, then revisions, with case-prefixed tooltips", () => {
        const segments = buildCompositionSegments(usage({
            noteId: "note",
            ownSize: 100,
            revisionsSize: 40,
            attachments: [
                { attachmentId: "small", title: "Small file", role: "file", size: 20 },
                { attachmentId: "big", title: "Big image", role: "image", size: 50 }
            ]
        }), options);

        expect(segments.map((segment) => segment.id)).toEqual([ "body", "attachment/big", "attachment/small", "revisions" ]);
        expect(segments[0]).toMatchObject({
            value: 100,
            className: "space-usage-segment-body",
            tooltip: "plain:Body/100",
            data: { noteId: "note" }
        });
        expect(segments[1]).toMatchObject({ value: 50, tooltip: "attachment:Big image/50", data: { attachmentId: "big" } });
        expect(segments[3]).toMatchObject({ value: 40, className: "space-usage-segment-revisions", tooltip: "plain:Revisions/40" });
    });

    it("consolidates segments below 2% of the ring into an inert Others", () => {
        const segments = buildCompositionSegments(usage({
            ownSize: 1000,
            attachments: [
                { attachmentId: "tiny1", title: "Tiny 1", role: "file", size: 10 },
                { attachmentId: "tiny2", title: "Tiny 2", role: "file", size: 5 }
            ]
        }), options);

        expect(segments.map((segment) => segment.id)).toEqual([ "body", "others" ]);
        expect(segments[1]).toMatchObject({
            value: 15,
            className: "space-usage-segment-others",
            tooltip: "plain:Others/15",
            data: {}
        });
    });

    it("drops empty components entirely", () => {
        const segments = buildCompositionSegments(usage({
            attachments: [ { attachmentId: "empty", title: "Empty", role: "file", size: 0 } ]
        }), options);

        expect(segments).toEqual([]);
    });
});

describe("buildChildrenSegments", () => {
    const options = {
        getTitle: (noteId: string) => `title of ${noteId}`,
        deletedNotesLabel: "Deleted notes",
        othersLabel: "Others",
        makeTooltip
    };

    it("weights children by subtree, largest first, each with its own stable hue", () => {
        const segments = buildChildrenSegments(usage({
            children: [ child("small", 10), child("big", 90), child("empty", 0) ]
        }), options);

        expect(segments.map((segment) => segment.id)).toEqual([ "child/big", "child/small" ]);
        expect(segments[0]).toMatchObject({
            value: 90,
            hue: hueOf("big"),
            tooltip: "child:title of big/90",
            data: { noteId: "big" }
        });
    });

    it("consolidates children below 0.5% of the ring into an inert Others", () => {
        const segments = buildChildrenSegments(usage({
            children: [ child("big", 10000), child("tiny1", 30), child("tiny2", 10) ]
        }), options);

        expect(segments.map((segment) => segment.id)).toEqual([ "child/big", "others" ]);
        expect(segments[1]).toMatchObject({ value: 40, tooltip: "plain:Others/40", data: {} });
        expect(segments[1].hue).toBeUndefined();
    });

    it("closes the root's ring with the deleted-notes segment, never folded into Others", () => {
        const segments = buildChildrenSegments(usage({
            // The deleted bucket is far below 0.5% of the ring, yet must stay its own segment.
            children: [ child("big", 100000) ],
            deletedNotes: { size: 25, noteCount: 3 }
        }), options);

        expect(segments.map((segment) => segment.id)).toEqual([ "child/big", "/deleted-notes" ]);
        expect(segments[1]).toMatchObject({
            value: 25,
            className: "space-usage-segment-deleted",
            tooltip: "plain:Deleted notes/25",
            data: {}
        });
    });

    it("omits the deleted-notes segment off the root or when nothing is deleted", () => {
        expect(buildChildrenSegments(usage(), options)).toEqual([]);
        expect(buildChildrenSegments(usage({ deletedNotes: { size: 0, noteCount: 0 } }), options)).toEqual([]);
    });
});
