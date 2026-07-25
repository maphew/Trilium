import { becca, cls, date_utils, note_service as noteService } from "@triliumnext/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import sqlInit from "../../sql_init.js";
import graph from "./graph.js";
import { importSelection, mapWithConcurrency, resolveSubpageParents } from "./importer.js";

vi.mock("./graph.js", () => ({
    default: {
        getAccount: vi.fn(),
        listNotebooks: vi.fn(),
        listPages: vi.fn(),
        getPageContent: vi.fn(),
        getResource: vi.fn(),
        getThrottleStats: vi.fn(() => ({ requestCount: 0, waitMs: 0 })),
        resetThrottleStats: vi.fn()
    }
}));

// Delegates to the real converter, but lets a test force a content-processing failure for pages whose
// HTML carries the sentinel — the way to exercise "fetched fine, but processing threw".
vi.mock("./converter.js", async (importActual) => {
    const actual = await importActual<typeof import("./converter.js")>();
    const convertPageHtml = (html: string) => {
        if (html.includes("PROCESSING_BOOM")) {
            throw new Error("content conversion failed");
        }
        return actual.convertPageHtml(html);
    };
    return { ...actual, default: { ...actual.default, convertPageHtml } };
});

const graphMock = vi.mocked(graph);

describe("resolveSubpageParents", () => {
    it("keeps top-level pages directly under the section", () => {
        // No indentation: every page is a root (parent index -1).
        expect(resolveSubpageParents([0, 0, 0])).toEqual([-1, -1, -1]);
        expect(resolveSubpageParents([])).toEqual([]);
    });

    it("nests subpages and sub-subpages under the nearest shallower page", () => {
        // Two subpages share the first page as parent.
        expect(resolveSubpageParents([0, 1, 1])).toEqual([-1, 0, 0]);
        // A sub-subpage chains under its subpage.
        expect(resolveSubpageParents([0, 1, 2])).toEqual([-1, 0, 1]);
    });

    it("re-parents siblings correctly when stepping back out of nesting", () => {
        // 0:root, 1→0, 2→1, then back to level 1 (→0) and a new root.
        expect(resolveSubpageParents([0, 1, 2, 1, 0])).toEqual([-1, 0, 1, 0, -1]);
        // Each top-level page owns its own subpage.
        expect(resolveSubpageParents([0, 1, 0, 1])).toEqual([-1, 0, -1, 2]);
    });

    it("falls back to the section root for malformed indentation", () => {
        // Leading subpage with no parent, and a level jump that skips level 1.
        expect(resolveSubpageParents([1, 0])).toEqual([-1, -1]);
        expect(resolveSubpageParents([0, 2])).toEqual([-1, -1]);
    });
});

describe("mapWithConcurrency", () => {
    it("returns results in input order regardless of completion order", async () => {
        // Later items resolve sooner, so order can only be preserved by index, not completion.
        const out = await mapWithConcurrency([30, 20, 10], 3, (ms) => new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)));
        expect(out).toEqual([30, 20, 10]);
    });

    it("never runs more than `limit` workers at once", async () => {
        let inFlight = 0;
        let peak = 0;
        const work = async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
            return null;
        };

        await mapWithConcurrency(Array.from({ length: 20 }), 4, work);
        expect(peak).toBeLessThanOrEqual(4);
    });

    it("handles an empty list", async () => {
        expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    });
});

describe("importSelection (real DB)", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    it("labels every imported page note with its Graph page id", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-abc", title: "Page One", level: 0 },
            { id: "1-def", title: "Page Two", level: 1 }
        ]);
        graphMock.getPageContent.mockResolvedValue({ html: "<p>hello</p>", inkml: "" });

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: "root",
            sections: [{ id: "sec-1", title: "Section", groupPath: [], notebookId: "nb-1", notebookTitle: "Notebook" }],
            taskId: "task-page-id-label"
        }));

        const pageOne = Object.values(becca.notes).find((note) => note.title === "Page One");
        const pageTwo = Object.values(becca.notes).find((note) => note.title === "Page Two");
        // The Graph page id enables a future "retry failed pages" / re-import dedup pass to map an
        // imported note back to its OneNote page.
        expect(pageOne?.getOwnedLabelValue("oneNotePageId")).toBe("1-abc");
        expect(pageTwo?.getOwnedLabelValue("oneNotePageId")).toBe("1-def");

        // Container notes (section, notebook) are not OneNote pages and must not carry the label.
        const sectionNote = Object.values(becca.notes).find((note) => note.title === "Section");
        expect(sectionNote?.getOwnedLabelValue("oneNotePageId")).toBeNull();
    });

    it("writes an import report as the root import note's content", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-abc", title: "Report Page One", level: 0 },
            { id: "1-def", title: "Report Page Two", level: 0 }
        ]);
        graphMock.getPageContent.mockResolvedValue({ html: "<p>hello</p>", inkml: "" });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "report parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-2", title: "Report Section", groupPath: [], notebookId: "nb-2", notebookTitle: "Report Notebook" }],
            taskId: "task-report"
        }));

        const rootImportNote = parent.getChildNotes()[0];
        const content = rootImportNote?.getContent() as string;
        expect(content).toContain('<tr><th scope="row">Pages imported successfully</th><td>2/2 (100%)</td></tr>');
        expect(content).toContain('<tr><th scope="row">Sections imported</th><td>1</td></tr>');
        // Nothing failed and no optional stats apply (no images, ink, links, or throttling), so the
        // happy-path report stays a compact summary table without failure sections or extra rows.
        expect(content).not.toContain("could not be");
        expect(content).not.toContain("Images");
    });

    it("imports a placeholder note when a page's content cannot be fetched, keeping the tree intact", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-good", title: "Ph Good", level: 0 },
            { id: "1-bad", title: "Ph Bad", level: 0 },
            { id: "1-sub", title: "Ph Sub", level: 1 }
        ]);
        graphMock.getPageContent.mockImplementation(async (_token, pageId) => {
            if (pageId === "1-bad") {
                throw new Error("Failed to fetch OneNote page content (HTTP 504)");
            }
            return { html: "<p>ok</p>", inkml: "" };
        });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "placeholder parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-3", title: "Ph Section", groupPath: [], notebookId: "nb-3", notebookTitle: "Ph Notebook" }],
            taskId: "task-placeholder"
        }));

        // The failed page becomes a placeholder note: findable by label, explains itself, and keeps
        // the page id so a later retry pass can re-fetch it.
        const badNote = Object.values(becca.notes).find((note) => note.title === "Ph Bad");
        expect(badNote?.hasOwnedLabel("oneNoteImportFailed")).toBe(true);
        expect(badNote?.getOwnedLabelValue("oneNotePageId")).toBe("1-bad");
        expect(badNote?.getContent()).toContain("could not be imported");
        expect(badNote?.getContent()).toContain("HTTP 504");

        // Subpage nesting resolves by index, so the placeholder must hold its parent spot in the tree.
        const subNote = Object.values(becca.notes).find((note) => note.title === "Ph Sub");
        expect(subNote?.getParentNotes()[0]?.noteId).toBe(badNote?.noteId);

        // The report counts the loss and links to the placeholder.
        const content = parent.getChildNotes()[0]?.getContent() as string;
        expect(content).toContain('<tr><th scope="row">Pages imported successfully</th><td>2/3 (66%)</td></tr>');
        expect(content).toContain("Pages that could not be imported");
        expect(content).toContain(`href="#root/${badNote?.noteId}"`);
    });

    it("imports a placeholder folder for a section whose pages can't be listed, keeping order and the rest", async () => {
        // The first (locked) section's page list fails, e.g. it's encrypted/password-protected; the
        // second succeeds. The locked section is ordered first to prove it doesn't abort the rest and
        // that its placeholder keeps its position.
        graphMock.listPages.mockImplementation(async (_token, sectionId) => {
            if (sectionId === "sec-locked") {
                throw new Error("Microsoft Graph request failed (HTTP 403: 20185: Encrypted sections are not accessible.)");
            }
            return [{ id: "1-ok", title: "Readable Page", level: 0 }];
        });
        graphMock.getPageContent.mockResolvedValue({ html: "<p>hi</p>", inkml: "" });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "skip parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [
                { id: "sec-locked", title: "Locked Section", groupPath: [], notebookId: "nb-skip", notebookTitle: "Skip Notebook" },
                { id: "sec-open", title: "Open Section", groupPath: [], notebookId: "nb-skip", notebookTitle: "Skip Notebook" }
            ],
            taskId: "task-skip"
        }));

        // The readable section still imports: one bad section must not abort the whole import.
        expect(Object.values(becca.notes).find((note) => note.title === "Readable Page")).toBeDefined();

        // The locked section becomes an empty placeholder folder: self-explaining, labeled, and keeping
        // the section id so a later retry pass can re-fetch it.
        const lockedNote = Object.values(becca.notes).find((note) => note.title === "Locked Section");
        expect(lockedNote?.hasOwnedLabel("oneNoteImportFailed")).toBe(true);
        expect(lockedNote?.getOwnedLabelValue("oneNoteSectionId")).toBe("sec-locked");
        expect(lockedNote?.getContent()).toContain("could not be imported");
        expect(lockedNote?.getContent()).toContain("Encrypted sections are not accessible.");
        expect(lockedNote?.getChildNotes()).toHaveLength(0);

        // Order is preserved: both sections share a notebook folder, and the locked placeholder keeps
        // its selected position ahead of the readable section.
        const notebookNote = lockedNote?.getParentNotes()[0];
        const orderedSectionTitles = notebookNote
            ?.getChildBranches()
            .slice()
            .sort((a, b) => a.notePosition - b.notePosition)
            .map((branch) => branch.getNote().title);
        expect(orderedSectionTitles).toEqual(["Locked Section", "Open Section"]);

        // The report records it (imported/total section count + a dedicated table linking to the
        // placeholder) and surfaces the Graph error verbatim.
        const content = parent.getChildNotes()[0]?.getContent() as string;
        expect(content).toContain('<tr><th scope="row">Sections imported</th><td>1/2</td></tr>');
        expect(content).toContain("Sections that could not be imported");
        expect(content).toContain(`href="#root/${lockedNote?.noteId}"`);
        expect(content).toContain("Encrypted sections are not accessible.");
    });

    it("preserves the OneNote page order even when #newNotesOnTop is inherited onto the target", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-ord-a", title: "Order Page A", level: 0 },
            { id: "1-ord-b", title: "Order Page B", level: 0 },
            { id: "1-ord-c", title: "Order Page C", level: 0 }
        ]);
        graphMock.getPageContent.mockResolvedValue({ html: "<p>hi</p>", inkml: "" });

        // The label the user reported: inheritable on the import target, so every note created during the
        // import (root, section, pages) sees it. Without explicit positions it would invert the page order.
        const parent = cls.init(() => {
            const note = noteService.createNewNote({
                parentNoteId: "root",
                title: "order parent",
                content: "",
                type: "text",
                mime: "text/html"
            }).note;
            note.addLabel("newNotesOnTop", "", true);
            return note;
        });

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-order", title: "Order Section", groupPath: [], notebookId: "nb-order", notebookTitle: "Order Notebook" }],
            taskId: "task-order"
        }));

        // Order lives in notePosition (becca's in-memory `children` is insertion order); the tree sorts
        // by it the way the client does. With the newNotesOnTop default each page would land above the
        // last (positions -10, -20, -30 → C, B, A); the fix's explicit ascending positions keep A, B, C.
        const sectionNote = Object.values(becca.notes).find((note) => note.title === "Order Section");
        const orderedTitles = sectionNote
            ?.getChildBranches()
            .slice()
            .sort((a, b) => a.notePosition - b.notePosition)
            .map((branch) => branch.getNote().title);
        expect(orderedTitles).toEqual(["Order Page A", "Order Page B", "Order Page C"]);
    });

    it("aborts the import when too many consecutive pages fail (systemic failure)", async () => {
        graphMock.listPages.mockResolvedValue(
            Array.from({ length: 8 }, (_, i) => ({ id: `1-cb${i}`, title: `CB Page ${i}`, level: 0 }))
        );
        graphMock.getPageContent.mockClear();
        graphMock.getPageContent.mockImplementation(async () => {
            throw new Error("Failed to fetch OneNote page content (HTTP 504)");
        });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "circuit breaker parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-4", title: "CB Section", groupPath: [], notebookId: "nb-4", notebookTitle: "CB Notebook" }],
            taskId: "task-circuit-breaker"
        }));

        // Six consecutive failures trip the breaker: the remaining pages are never fetched and the
        // import aborts without creating any notes (a placeholder-only tree would be worthless).
        expect(graphMock.getPageContent).toHaveBeenCalledTimes(6);
        expect(parent.getChildNotes()).toHaveLength(0);
    });

    it("does not trip the breaker when pages fetch but fail local processing", async () => {
        // All eight pages fetch successfully (Graph is healthy) but every one fails to convert. These
        // are isolated bad pages, not a systemic outage, so the import must finish with placeholders
        // rather than aborting the way a run of fetch failures does.
        graphMock.listPages.mockResolvedValue(
            Array.from({ length: 8 }, (_, i) => ({ id: `1-pf${i}`, title: `PF Page ${i}`, level: 0 }))
        );
        graphMock.getPageContent.mockClear();
        graphMock.getPageContent.mockResolvedValue({ html: "<p>PROCESSING_BOOM</p>", inkml: "" });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "processing failure parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-5", title: "PF Section", groupPath: [], notebookId: "nb-5", notebookTitle: "PF Notebook" }],
            taskId: "task-processing-failure"
        }));

        // Every page was fetched (no early abort) and imported as a placeholder.
        expect(graphMock.getPageContent).toHaveBeenCalledTimes(8);
        const pages = new Map(Object.values(becca.notes).filter((note) => /^PF Page \d+$/.test(note.title)).map((note) => [note.noteId, note]));
        expect(pages.size).toBe(8);
        expect([...pages.values()].every((note) => note.hasOwnedLabel("oneNoteImportFailed"))).toBe(true);
        expect([...pages.values()][0]?.getContent()).toContain("could not be imported");
    });

    it("prefers the authored created date from the page HTML over the Graph object's metadata", async () => {
        // A moved/copied/migrated page: the Graph page *object*'s createdDateTime is re-stamped to the
        // time of the move, while the date OneNote actually displays under the title lives in the page
        // HTML's `<meta name="created">`. The authored date must win; the object date remains the
        // fallback for pages whose HTML carries no meta.
        graphMock.listPages.mockResolvedValue([
            { id: "1-meta", title: "Authored Date Page", level: 0, createdDateTime: "2020-10-20T10:00:00Z", lastModifiedDateTime: "2021-03-04T05:06:07Z" },
            { id: "1-nometa", title: "Fallback Date Page", level: 0, createdDateTime: "2020-10-20T10:00:00Z" }
        ]);
        graphMock.getPageContent.mockImplementation(async (_token, pageId) => ({
            html: pageId === "1-meta"
                ? `<html><head><title>Authored Date Page</title><meta name="created" content="2019-01-19T20:24:00.0000000" /></head><body><p>hi</p></body></html>`
                : "<p>hi</p>",
            inkml: ""
        }));

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: "root",
            sections: [{ id: "sec-dates", title: "Date Section", groupPath: [], notebookId: "nb-dates", notebookTitle: "Date Notebook" }],
            taskId: "task-authored-dates"
        }));

        const authored = Object.values(becca.notes).find((note) => note.title === "Authored Date Page");
        // The meta value is offset-less wall-clock time and is parsed as server-local, so the expected
        // value goes through the same Date conversion to stay timezone-independent.
        expect(authored?.utcDateCreated).toBe(date_utils.utcDateTimeStr(new Date("2019-01-19T20:24:00.0000000")));
        // The modification date has no in-content counterpart and stays the Graph object's value.
        expect(authored?.utcDateModified).toBe("2021-03-04 05:06:07.000Z");

        const fallback = Object.values(becca.notes).find((note) => note.title === "Fallback Date Page");
        expect(fallback?.utcDateCreated).toBe("2020-10-20 10:00:00.000Z");
    });
});
