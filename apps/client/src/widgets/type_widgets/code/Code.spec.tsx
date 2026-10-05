// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { ParentComponent } from "../../react/react_utils";
import { EditableCode } from "./Code";

function fakeNote(noteId: string, content: string) {
    return {
        noteId,
        type: "code",
        mime: "text/x-markdown",
        getLabelValue: () => null,
        isLabelTruthy: () => false,
        isMarkdown: () => true,
        getBlob: async () => ({ content })
    } as any;
}

describe("EditableCode", () => {
    // A preview-only Markdown note keeps its (hidden) editor mounted and relies on this callback to
    // feed the preview, so it has to fire when a different note's content is loaded.
    it("reports the content of the new note after a note switch", async () => {
        const onContentChanged = vi.fn();
        const parent = { registerHandler() {}, removeHandler() {}, componentId: "c" } as any;
        const container = document.createElement("div");
        document.body.appendChild(container);

        const show = (note: any) => render(
            <ParentComponent.Provider value={parent}>
                <EditableCode note={note} ntxId="ntx" parentComponent={parent} noteContext={undefined} viewScope={undefined} onContentChanged={onContentChanged} />
            </ParentComponent.Provider>,
            container
        );

        await act(async () => { show(fakeNote("a", "# Note A")); });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenCalledWith("# Note A"));

        await act(async () => { show(fakeNote("b", "# Note B")); });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenCalledWith("# Note B"));
    });
});
