import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const translate = vi.hoisted(() => (key: string) => `t:${key}`);
vi.mock("@excalidraw/excalidraw", () => ({
    useI18n: () => ({ t: translate, langCode: "en" })
}));

const { default: CanvasEmbedTools } = await import("./CanvasEmbedTools");
const { getContentEmbedTools } = await import("../text/content_embed_tools");

type ActiveTool = AppState["activeTool"];

const TOOL_IDS = [
    "selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image",
    "eraser", "hand", "frame", "embeddable", "laser", "lock"
];

describe("CanvasEmbedTools", () => {
    let container: HTMLElement;
    let api: ReturnType<typeof createApi>;

    beforeEach(() => {
        api = createApi();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function Drawing() {
        const rootRef = useRef<HTMLDivElement>(null);
        const apiRef = useRef<ExcalidrawImperativeAPI>(api.api);
        return (
            <figure className="include-note">
                <div ref={rootRef}>
                    <div className="excalidraw-container" tabIndex={0} />
                    <CanvasEmbedTools rootRef={rootRef} apiRef={apiRef} />
                </div>
            </figure>
        );
    }

    async function mount() {
        await act(async () => render(<Drawing />, container));
        const embed = container.querySelector<HTMLElement>("figure.include-note");
        const provider = embed && getContentEmbedTools(embed);
        if (!embed || !provider) {
            throw new Error("Expected the tools of the drawing.");
        }
        return { embed, provider };
    }

    it("adds the tools to the toolbar of the embed while the drawing is mounted", async () => {
        const { embed, provider } = await mount();
        const listener = vi.fn();
        provider.subscribe(listener);

        expect(getContentEmbedTools(document.createElement("figure"))).toBeNull();
        expect(provider.getTools()).toEqual(TOOL_IDS.map((id, index) => ({
            id,
            label: String(index + 1),
            tooltip: `t:toolBar.${id}`,
            isOn: id === "selection"
        })));

        await act(async () => render(null, container));
        expect(getContentEmbedTools(embed)).toBeNull();
        expect(api.unsubscribe).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(provider.getTools()).toEqual([]);
    });

    it("notifies its listeners when the active tool or its lock changes", async () => {
        const { provider } = await mount();
        const listener = vi.fn();
        const unsubscribe = provider.subscribe(listener);

        api.change({ type: "selection", locked: false });
        expect(listener).not.toHaveBeenCalled();

        api.change({ type: "rectangle", locked: false });
        api.change({ type: "rectangle", locked: true });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(provider.getTools().filter((tool) => tool.isOn).map((tool) => tool.id))
            .toEqual([ "rectangle", "lock" ]);

        unsubscribe();
        api.change({ type: "text", locked: true });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("runs a tool with the focus in the drawing", async () => {
        const { provider } = await mount();

        provider.execute("rectangle");
        expect(api.setActiveTool).toHaveBeenCalledWith({ type: "rectangle" });
        expect(document.activeElement).toBe(container.querySelector(".excalidraw-container"));

        provider.execute("lock");
        expect(api.updateScene).toHaveBeenCalledWith({
            appState: { activeTool: expect.objectContaining({ type: "selection", locked: true }) }
        });

        provider.execute("magicframe");
        expect(api.setActiveTool).toHaveBeenCalledTimes(1);
        expect(api.updateScene).toHaveBeenCalledTimes(1);
    });
});

/** An Excalidraw API whose active tool the spec changes. */
function createApi() {
    let activeTool = { type: "selection", locked: false } as ActiveTool;
    let onChange: ((elements: unknown[], appState: AppState) => void) | undefined;
    const unsubscribe = vi.fn();
    const setActiveTool = vi.fn();
    const updateScene = vi.fn();
    const getAppState = () => ({ activeTool }) as AppState;

    const api = {
        getAppState,
        setActiveTool,
        updateScene,
        onChange: (callback: typeof onChange) => {
            onChange = callback;
            return unsubscribe;
        }
    } as unknown as ExcalidrawImperativeAPI;

    return {
        api,
        unsubscribe,
        setActiveTool,
        updateScene,
        change(next: Pick<ActiveTool, "type" | "locked">) {
            activeTool = { ...activeTool, ...next } as ActiveTool;
            onChange?.([], getAppState());
        }
    };
}
