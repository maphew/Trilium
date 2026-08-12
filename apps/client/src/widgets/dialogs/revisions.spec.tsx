/**
 * A revision is stored as CKEditor's data downcast output, which is not always self-contained: the
 * constructs whose visible content the note view builds at render time arrive here as empty
 * elements carrying metadata. Rendering the stored HTML on its own therefore shows less than the
 * note does, and in the case of a link preview shows nothing at all (#10707).
 */
import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { RevisionContentText } from "./revisions";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

/**
 * Every fixture starts with a paragraph that is not the subject of its assertion: DOMPurify running
 * on happy-dom unwraps the outermost element of the fragment it is given (`<p>x</p>` sanitizes to
 * `x`), which real browsers do not do, so the element under test must not be the first one.
 */

/** Renders revision HTML and lets the reference-link lookups (froca, then the icon) settle. */
async function renderRevision(content: string) {
    const container = renderInto(<RevisionContentText content={content} />);
    await vi.waitFor(() => expect(container.querySelector(".ck-content")).toBeTruthy());
    return container;
}

describe("RevisionContentText", () => {
    it("renders an inline link preview that is stored as an empty element", async () => {
        const container = await renderRevision(
            '<p>before</p><p><span class="link-mention" data-url="https://github.com/TriliumNext/Trilium/issues"'
            + ' data-title="Issues · TriliumNext/Trilium"></span></p><p>after</p>'
        );

        const mention = await vi.waitFor(() => {
            const el = container.querySelector<HTMLAnchorElement>("span.link-mention a.link-embed-mention");
            expect(el).toBeTruthy();
            return el;
        });
        expect(mention?.textContent).toBe("Issues · TriliumNext/Trilium");
        expect(mention?.getAttribute("href")).toBe("https://github.com/TriliumNext/Trilium/issues");
    });

    it("renders a card link preview that is stored as an empty element", async () => {
        const container = await renderRevision(
            '<p>before</p><section class="link-embed" data-url="https://example.com/post" data-title="A post"'
            + ' data-site-name="Example"></section>'
        );

        await vi.waitFor(() => {
            expect(container.querySelector("section.link-embed")?.textContent).toContain("A post");
        });
    });

    it("resolves reference link titles against the current note tree", async () => {
        const note = buildNote({ title: "Target note" });
        const container = await renderRevision(
            `<p><a class="reference-link" href="#root/${note.noteId}">Stale title</a></p>`
        );

        // The stored title is whatever it was when the revision was taken; the note view replaces it
        // with the note's own, wrapped in the <span> the theme styles.
        await vi.waitFor(() => {
            const link = container.querySelector("a.reference-link > span");
            expect(link?.textContent).toContain("Target note");
        });
    });

    it("leaves a preview without a URL alone rather than rendering an empty card", async () => {
        const container = await renderRevision('<p>before</p><p><span class="link-mention" data-title="No URL"></span></p>');

        expect(container.querySelector("a.link-embed-mention")).toBeNull();
    });
});
