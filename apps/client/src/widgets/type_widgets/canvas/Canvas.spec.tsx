import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { type RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const excalidrawProps = vi.fn((_props: ExcalidrawProps) => undefined);
vi.mock("@excalidraw/excalidraw", () => ({
    Excalidraw: (props: ExcalidrawProps) => {
        excalidrawProps(props);
        return <div className="mock-excalidraw" />;
    }
}));
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../react/hooks")>(),
    useTriliumOption: () => [ "en" ]
}));

const { CanvasEditor } = await import("./Canvas");

describe("CanvasEditor", () => {
    let container: HTMLElement;
    let refresh: ReturnType<typeof vi.fn>;
    let apiRef: RefObject<ExcalidrawImperativeAPI>;

    beforeEach(() => {
        excalidrawProps.mockClear();
        refresh = vi.fn();
        apiRef = { current: { refresh } as unknown as ExcalidrawImperativeAPI };
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(isEmbedded?: boolean) {
        await act(async () => {
            render(
                <CanvasEditor
                    apiRef={apiRef}
                    isReadOnly={false}
                    colorScheme="light"
                    persistence={{}}
                    isEmbedded={isEmbedded}
                />,
                container
            );
        });
        const excalidraw = container.querySelector(".canvas-render .mock-excalidraw");
        expect(excalidraw).not.toBeNull();
        return excalidraw;
    }

    function point(target: Element | null) {
        for (const type of [ "pointerover", "pointermove" ]) {
            target?.dispatchEvent(new PointerEvent(type, { bubbles: true }));
        }
    }

    it("reads its position again before pointer input when it is embedded in a note", async () => {
        point(await mount(true));

        expect(refresh).toHaveBeenCalledTimes(2);
        expect(excalidrawProps).toHaveBeenLastCalledWith(expect.objectContaining({ detectScroll: true }));
    });

    it("leaves the position to Excalidraw in a canvas note, which does not move", async () => {
        point(await mount());

        expect(refresh).not.toHaveBeenCalled();
        expect(excalidrawProps).toHaveBeenLastCalledWith(expect.objectContaining({ detectScroll: false }));
    });
});
