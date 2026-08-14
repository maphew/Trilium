import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * Deleting across a collapsible's boundary.
 *
 * CKEditor's own `deleteContent` folds a block that a deletion left empty *into* the
 * <details> holding the other end of the range, renaming it to `summary` on the way. The
 * model that comes out is fine, but the editing view keeps the moved element's old view
 * element (reconverting a <details> re-slots its children rather than converting them
 * again), so the collapsible renders with no title at all and the next caret move throws
 * `mapping-model-offset-not-found`. Every test here asserts the *rendered* result, not
 * just the model — the model was never the broken half.
 */
describe("collapsible: deleting across the boundary", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
        root = editor.editing.view.getDomRoot() as HTMLElement;
    });

    function fireDelete(direction: "backward" | "forward" = "forward"): void {
        editor.editing.view.document.fire("delete", { direction, unit: "character", preventDefault: vi.fn() });
        editor.editing.view.forceRender();
    }

    /** The editing view of the outermost collapsible, as rendered. */
    function renderedCollapsible(): { title: string | null, body: string | null } {
        const details = root.querySelector("details.trilium-collapsible");
        return {
            title: details?.querySelector(":scope > summary")?.textContent ?? null,
            body: details?.querySelector(":scope > .trilium-collapsible-content")?.textContent ?? null
        };
    }

    describe("Delete on a blank line above a collapsible", () => {
        it("drops the blank line and moves the caret into the title", () => {
            setModelData(
                editor.model,
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>[]Title</summary><paragraph>body</paragraph></details>"
            );
            // The title still renders as a <summary> holding the model's text — the
            // regression replaced it with the blank line's <p>, leaving the browser to
            // draw its default "Details" marker.
            expect(renderedCollapsible()).toEqual({ title: "Title", body: "body" });
            // A second press used to throw mapping-model-offset-not-found.
            expect(() => fireDelete()).not.toThrow();
        });

        it("works the same on a collapsed collapsible", () => {
            setModelData(
                editor.model,
                "<paragraph>[]</paragraph>" +
                "<details><summary>Title</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details><summary>[]Title</summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible().title).toBe("Title");
        });

        it("moves into a nested collapsible from a blank body line", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>Outer</summary>" +
                    "<paragraph>[]</paragraph>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Outer</summary>" +
                    "<details open=\"true\"><summary>[]Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );
            expect(root.querySelectorAll("summary")).toHaveLength(2);
        });

        it("only moves the caret when the blank block is the title itself", () => {
            // An empty <summary> is a title, not a blank line: removing it would only make
            // the summary-invariant post-fixer put a fresh one back.
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[]</summary>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary></summary>" +
                    "<details open=\"true\"><summary>[]Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );
            expect(root.querySelectorAll("summary")).toHaveLength(2);
        });

        it("leaves a block with content to CKEditor's own merge", () => {
            setModelData(
                editor.model,
                "<paragraph>a[]</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            // Merged left: the title text joins the paragraph and the collapsible keeps an
            // empty title. Nothing was moved into the <details>, so the view is consistent.
            expect(getModelData(editor.model)).toBe(
                "<paragraph>a[]Title</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "", body: "body" });
        });
    });

    describe("selections running from above into a collapsible", () => {
        it("deletes the selected content without folding the blank line into the title", () => {
            setModelData(
                editor.model,
                "<paragraph>[</paragraph>" +
                "<details open=\"true\"><summary>Ti]tle</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary>tle</summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "tle", body: "body" });
        });

        it("holds when the selection reaches into the body", () => {
            setModelData(
                editor.model,
                "<paragraph>[</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>bo]dy</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>dy</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "", body: "dy" });
        });

        it("holds when the selection is typed over", () => {
            setModelData(
                editor.model,
                "<paragraph>[</paragraph>" +
                "<details open=\"true\"><summary>Ti]tle</summary><paragraph>body</paragraph></details>"
            );

            editor.execute("insertText", { text: "Z" });
            editor.editing.view.forceRender();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>Z[]</paragraph>" +
                "<details open=\"true\"><summary>tle</summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible().title).toBe("tle");
        });

        it("still merges when content survives in the block above", () => {
            setModelData(
                editor.model,
                "<paragraph>ab[c</paragraph>" +
                "<details open=\"true\"><summary>Ti]tle</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>ab[]tle</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>body</paragraph></details>"
            );
        });

        it("still merges a selection that stays inside one collapsible", () => {
            // Both ends share the same <details>, so nothing is moved into it — the title
            // is renamed into the body block it merges with, which reconverts correctly,
            // and the summary-invariant post-fixer restores a blank title.
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[Ti</summary><paragraph>bo]dy</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary></summary><paragraph>[]dy</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "", body: "dy" });
        });

        it("still merges when the selection runs out of a collapsible instead of into one", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>[x</paragraph></details>" +
                "<paragraph>y]z</paragraph>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>[]z</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "T", body: "z" });
        });
    });
});
