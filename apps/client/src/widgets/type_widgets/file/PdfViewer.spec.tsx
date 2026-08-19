import { afterEach, describe, expect, it } from "vitest";

import { getPdfUrl } from "./PdfViewer";

describe("getPdfUrl", () => {
    afterEach(() => history.replaceState({}, "", "/"));

    it("resolves an API path against the deployment root, never relative to the viewer", () => {
        expect(getPdfUrl("attachments/abc123/open")).toBe("/api/attachments/abc123/open");

        // Trilium behind a reverse proxy on a subpath: the URL keeps the prefix, so pdf.js still
        // reaches the API without `../../` — which a proxy filtering traversal would reject (#8877).
        history.replaceState({}, "", "/trilium/#root/abc123");
        expect(getPdfUrl("notes/abc123/open")).toBe("/trilium/api/notes/abc123/open");

        expect(getPdfUrl("revisions/rev1/download")).not.toContain("..");
    });
});
