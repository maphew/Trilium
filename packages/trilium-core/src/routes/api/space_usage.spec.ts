import { SpaceUsageNoteResponse, SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { CoreApiTester } from "../../test/api_tester";
import { createTextNote, type CreatedNote } from "../../test/api_fixtures";

let api: CoreApiTester;
let parent: CreatedNote;
let child: CreatedNote;
let cloneTarget: CreatedNote;
let revisionHeavy: CreatedNote;

const PARENT_CONTENT = "<p>0123456789</p>";
const CHILD_CONTENT = `<p>${"x".repeat(5000)}</p>`;
const ATTACHMENT_CONTENT = "0123456789";
// Heavier than the child's body + attachment + revision combined, so that including revisions in
// the ranking demonstrably reorders the two.
const REVISION_HEAVY_CONTENT = `<p>${"r".repeat(12000)}</p>`;

async function getOverview(query: Record<string, string | number | boolean> = {}) {
    const res = await api.get<SpaceUsageOverviewResponse>("/api/space-usage/overview", { query });
    expect(res.status).toBe(200);
    return res.body;
}

async function getNoteUsage(noteId: string) {
    const res = await api.get<SpaceUsageNoteResponse>(`/api/space-usage/note/${noteId}`);
    expect(res.status).toBe(200);
    return res.body;
}

describe("Space usage API (core)", () => {
    beforeAll(async () => {
        api = CoreApiTester.build();

        parent = await createTextNote(api, { title: "Space usage parent", content: PARENT_CONTENT });
        child = await createTextNote(api, {
            parentNoteId: parent.noteId,
            title: "Space usage child",
            content: CHILD_CONTENT
        });
        cloneTarget = await createTextNote(api, { title: "Space usage clone target", content: "<p>tiny</p>" });

        const attachmentRes = await api.post(`/api/notes/${child.noteId}/attachments`, {
            body: { role: "file", mime: "text/plain", title: "Space usage attachment", content: ATTACHMENT_CONTENT }
        });
        expect(attachmentRes.status).toBe(204);

        const revisionRes = await api.post(`/api/notes/${child.noteId}/revision`);
        expect(revisionRes.status).toBe(200);

        const cloneRes = await api.put(`/api/notes/${child.noteId}/clone-to-note/${cloneTarget.noteId}`, { body: {} });
        expect(cloneRes.status).toBe(200);

        // A note whose weight sits almost entirely in its revision: big content revisioned away,
        // then replaced by a small body.
        revisionHeavy = await createTextNote(api, { title: "Space usage revision heavy", content: REVISION_HEAVY_CONTENT });
        const heavyRevisionRes = await api.post(`/api/notes/${revisionHeavy.noteId}/revision`);
        expect(heavyRevisionRes.status).toBe(200);
        const shrinkRes = await api.put(`/api/notes/${revisionHeavy.noteId}/data`, {
            body: { content: "<p>s</p>" }
        });
        expect(shrinkRes.status).toBe(204);
    });

    it("lists a large note with its size components and canonical path", async () => {
        const overview = await getOverview({ limit: 1000 });
        const entry = overview.notes.find((note) => note.noteId === child.noteId);

        expect(entry?.ownSize).toBe(CHILD_CONTENT.length);
        expect(entry?.attachmentsSize).toBe(ATTACHMENT_CONTENT.length);
        expect(entry?.revisionsSize).toBeGreaterThanOrEqual(CHILD_CONTENT.length);
        // Canonical placement is the original parent, not the later clone target.
        expect(entry?.notePath).toEqual([ parent.noteId, child.noteId ]);
    });

    it("orders by size, respects the limit and buckets the rest", async () => {
        const overview = await getOverview({ limit: 1000 });
        const noteIds = overview.notes.map((note) => note.noteId);
        expect(noteIds.indexOf(child.noteId)).toBeLessThan(noteIds.indexOf(parent.noteId));

        // The hidden subtree exists in every database, so it always has notes to aggregate.
        expect(overview.hiddenNotes.noteCount).toBeGreaterThan(0);
        expect(overview.total.noteCount).toBe(overview.notes.length + overview.otherNotes.noteCount);

        const limited = await getOverview({ limit: 1 });
        expect(limited.notes.length).toBe(1);
        expect(limited.otherNotes.noteCount).toBe(limited.total.noteCount - 1);
    });

    it("keeps zero-sized notes out of the individual listing", async () => {
        const empty = await createTextNote(api, { title: "Space usage empty", content: "" });
        const overview = await getOverview({ limit: 1000 });

        expect(overview.notes.some((note) => note.noteId === empty.noteId)).toBe(false);
    });

    it("moves revision weight into the ranking only when asked to", async () => {
        const withoutRevisions = await getOverview({ limit: 1000 });
        const heavyEntry = withoutRevisions.notes.find((note) => note.noteId === revisionHeavy.noteId);
        expect(heavyEntry?.revisionsSize).toBeGreaterThanOrEqual(REVISION_HEAVY_CONTENT.length);

        const rankWithout = withoutRevisions.notes.map((note) => note.noteId);
        expect(rankWithout.indexOf(child.noteId)).toBeLessThan(rankWithout.indexOf(revisionHeavy.noteId));

        const withRevisions = await getOverview({ limit: 1000, includeRevisions: true });
        const rankWith = withRevisions.notes.map((note) => note.noteId);
        expect(rankWith.indexOf(revisionHeavy.noteId)).toBeLessThan(rankWith.indexOf(child.noteId));
    });

    it("returns a note's children with whole-subtree totals", async () => {
        const usage = await getNoteUsage(parent.noteId);

        expect(usage.ownSize).toBe(PARENT_CONTENT.length);
        expect(usage.deletedNotes).toBeUndefined();

        const childEntry = usage.children.find((entry) => entry.noteId === child.noteId);
        expect(childEntry?.subtreeSize).toBe(CHILD_CONTENT.length + ATTACHMENT_CONTENT.length);
        expect(childEntry?.subtreeRevisionsSize).toBeGreaterThanOrEqual(CHILD_CONTENT.length);
        expect(childEntry?.subtreeNoteCount).toBe(1);
    });

    it("counts a cloned note only under its canonical parent", async () => {
        const usage = await getNoteUsage(cloneTarget.noteId);

        expect(usage.children.some((entry) => entry.noteId === child.noteId)).toBe(false);
    });

    it("lists a note's attachments individually", async () => {
        const usage = await getNoteUsage(child.noteId);
        const attachment = usage.attachments.find((entry) => entry.title === "Space usage attachment");

        expect(attachment?.role).toBe("file");
        expect(attachment?.size).toBe(ATTACHMENT_CONTENT.length);
        expect(usage.children).toEqual([]);
    });

    it("reports space held by deleted notes, at the root only", async () => {
        const doomed = await createTextNote(api, {
            title: "Space usage doomed",
            content: `<p>${"space-usage-doomed-".repeat(200)}</p>`
        });
        const doomedSize = `<p>${"space-usage-doomed-".repeat(200)}</p>`.length;

        const deleteRes = await api.delete(`/api/notes/${doomed.noteId}`, {
            query: { taskId: "space-usage-spec", last: true }
        });
        expect([ 200, 204 ]).toContain(deleteRes.status);

        const overview = await getOverview({ limit: 1000 });
        expect(overview.notes.some((note) => note.noteId === doomed.noteId)).toBe(false);
        expect(overview.deletedNotes.size).toBeGreaterThanOrEqual(doomedSize);
        expect(overview.deletedNotes.noteCount).toBeGreaterThanOrEqual(1);

        const rootUsage = await getNoteUsage("root");
        expect(rootUsage.deletedNotes?.size).toBeGreaterThanOrEqual(doomedSize);
    });

    it("404s for a missing note", async () => {
        const res = await api.get("/api/space-usage/note/spaceUsageMissing");
        expect(res.status).toBe(404);
    });
});
