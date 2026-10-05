import { describe, expect, it, vi } from "vitest";

import type Component from "../components/component";
import clipboard from "../services/clipboard";
import froca from "../services/froca";
import noteTypesService from "../services/note_types";
import { buildNote } from "../test/easy-froca";
import type { MenuItem } from "./context_menu";
import { buildTreeContextMenuItems, getDuplicateItems, type TreeCommandNames } from "./tree_context_menu";

vi.mock("../services/clipboard", () => ({ default: { isClipboardEmpty: vi.fn(() => true) } }));
vi.mock("../components/app_context", () => ({ default: { tabManager: { getActiveContext: () => undefined } } }));

describe("buildTreeContextMenuItems", () => {
    it("offers the paste actions only while something is cut or copied", async () => {
        vi.spyOn(noteTypesService, "loadNoteTypeData")
            .mockResolvedValue({ builtInTemplateNotes: [], userTemplateNotes: [], newTemplates: new Set() });
        const parent = buildNote({ title: "Parent", children: [ { title: "Child" } ] });
        const child = froca.notes[parent.children[0] ?? ""];
        const [ branch ] = child?.getParentBranches() ?? [];
        if (!child || !branch) throw new Error("expected the child and its branch");

        async function actions() {
            const items = await buildTreeContextMenuItems({
                note: child, branch, notePath: `${parent.noteId}/${child.noteId}`, component: {} as Component
            });
            const row = items.find((item): item is Extract<MenuItem<TreeCommandNames>, { kind: "actions" }> =>
                "kind" in item && item.kind === "actions");
            return row?.items.map((item) => item.command);
        }

        expect(await actions()).toStrictEqual([ "cutNotesToClipboard", "copyNotesToClipboard", "deleteNotes" ]);

        vi.mocked(clipboard.isClipboardEmpty).mockReturnValue(false);
        expect(await actions()).toStrictEqual([
            "cutNotesToClipboard", "copyNotesToClipboard", "pasteNotesFromClipboard", "pasteNotesAfterFromClipboard",
            "deleteNotes"
        ]);
    });
});

describe("getDuplicateItems", () => {
    it("offers the note-only copy as soon as one of the notes has children", () => {
        const leaf = buildNote({ title: "Leaf" });
        const parent = buildNote({ title: "Parent", children: [ { title: "Child" } ] });

        expect(getDuplicateItems([ leaf ])).toBeNull();

        const items = getDuplicateItems([ leaf, parent ]);
        expect(items?.map((item) => "command" in item && item.command))
            .toStrictEqual([ "duplicateSubtree", "duplicateNote" ]);
    });
});
