import { render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import SvgSplitEditor from "./SvgSplitEditor";
import type { SplitEditorProps } from "./SplitEditor";

// svg-pan-zoom strips the SVG's `viewBox` attribute as soon as it initializes (it caches the
// original value internally and works off pan/zoom transforms afterwards) and its `destroy()`
// never puts it back. `useResizer` (SvgSplitEditor.tsx) is responsible for restoring it itself;
// this fake reproduces exactly that stripping-without-restoring behavior so the test exercises
// the real bug shape rather than a strawman.
vi.mock("svg-pan-zoom", () => ({
    default: vi.fn((svgEl: SVGElement) => {
        svgEl.removeAttribute("viewBox");
        const instance = {
            resize: () => instance,
            center: () => instance,
            fit: () => instance,
            zoom: () => instance,
            pan: () => instance,
            getPan: () => ({ x: 0, y: 0 }),
            getZoom: () => 1,
            destroy: () => {}
        };
        return instance;
    })
}));

// SplitEditor pulls in CodeMirror, Split.js and a Bootstrap ribbon that have nothing to do with
// the pan/zoom behavior under test; stub it down to just the preview pane, and fire the same
// `onContentChanged` callback the real editor would once content arrives.
vi.mock("./SplitEditor", () => ({
    default: ({ previewContent, onContentChanged }: SplitEditorProps) => {
        useEffect(() => {
            onContentChanged?.("gantt\nsection Test\nTask: 2024-01-01, 1d");
        }, []);
        return <div>{previewContent}</div>;
    },
    PreviewButton: () => null
}));

const ORIGINAL_VIEW_BOX = "0 0 1234 56";
const SVG_MARKUP = `<svg viewBox="${ORIGINAL_VIEW_BOX}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="10" height="10"/></svg>`;
const SVG_MARKUP_WITHOUT_VIEW_BOX = `<svg xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="10" height="10"/></svg>`;

describe("SvgSplitEditor", () => {
    it("restores the viewBox on cleanup, undoing what svg-pan-zoom stripped on init", async () => {
        const svgEl = await mountAndUnmount(SVG_MARKUP, (el) => {
            // Sanity check that the mocked library actually ran and stripped the attribute, so a
            // passing assertion below reflects the restore and not an untouched attribute.
            expect(el.getAttribute("viewBox")).toBeNull();
        });

        expect(svgEl.getAttribute("viewBox")).toBe(ORIGINAL_VIEW_BOX);
    });

    it("does not invent a viewBox for an SVG that never had one", async () => {
        const svgEl = await mountAndUnmount(SVG_MARKUP_WITHOUT_VIEW_BOX);

        expect(svgEl.getAttribute("viewBox")).toBeNull();
    });
});

/**
 * Mounts `SvgSplitEditor` around the given SVG markup, waits for the SVG to render, runs the
 * optional pre-unmount assertion, then unmounts to trigger the effect cleanup under test and
 * returns the (now detached) SVG element for post-cleanup assertions.
 */
async function mountAndUnmount(svgMarkup: string, beforeUnmount?: (svgEl: SVGElement) => void) {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
        render(<SvgSplitEditor {...svgSplitEditorProps(svgMarkup)} />, container);
    });

    await vi.waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const svgEl = container.querySelector("svg");
    if (!svgEl) {
        throw new Error("Expected the rendered SVG to be present after waiting for it.");
    }

    beforeUnmount?.(svgEl);

    // Unmounting tears the effect down (its only cleanup), which is where the fix lives.
    act(() => render(null, container));

    container.remove();
    return svgEl;
}

/**
 * Minimal props for `SvgSplitEditor`; SplitEditor is mocked away, so most of `SplitEditorProps`
 * is unused.
 */
function svgSplitEditorProps(svgMarkup: string) {
    const note = {
        noteId: "note1",
        title: "Gantt",
        getAttachments: async () => []
    };

    return {
        ntxId: "ntx1",
        note,
        noteContext: {},
        attachmentTitle: "gantt-export.svg",
        renderSvg: async () => svgMarkup
    } as unknown as Parameters<typeof SvgSplitEditor>[0];
}
