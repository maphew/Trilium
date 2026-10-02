import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const translate = vi.hoisted(() => (key: string) => `t:${key}`);
vi.mock("@excalidraw/excalidraw", () => ({
    useI18n: () => ({ t: translate, langCode: "en" })
}));

const { default: CanvasEmbedTools } = await import("./CanvasEmbedTools");
const {
    getContentEmbedTools, watchContentEmbedTools
} = await import("../text/content_embed_tools");

const MAIN_TOOL_IDS = [
    "hand", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image"
];
const EXTRA_TOOL_IDS = [ "selection", "eraser", "frame", "embeddable", "laser" ];
const ICON = expect.stringContaining("<svg");

describe("CanvasEmbedTools", () => {
    let container: HTMLElement;
    let api: ReturnType<typeof createApi>;
    let undo: Mock<() => void>;

    beforeEach(() => {
        api = createApi();
        undo = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** A drawing with Excalidraw's container and its undo and redo buttons. */
    function Drawing() {
        const rootRef = useRef<HTMLDivElement>(null);
        const apiRef = useRef<ExcalidrawImperativeAPI>(api.api);
        return (
            <figure className="include-note">
                <div ref={rootRef}>
                    <div className="excalidraw-container" tabIndex={0} />
                    <button type="button" data-testid="button-undo" onClick={() => undo()} />
                    <button type="button" data-testid="button-redo" disabled />
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
        const tools = provider.getTools();
        const count = MAIN_TOOL_IDS.length;
        expect(tools[0]).toEqual({
            id: "lock", label: "t:toolBar.lock", text: "1", isOn: false, group: "lock"
        });
        expect(tools.slice(1, count + 1)).toEqual(MAIN_TOOL_IDS.map((id, index) => ({
            id,
            label: `t:toolBar.${id}`,
            text: String(index + 2),
            isOn: false,
            group: "tools"
        })));
        expect(tools[count + 1]).toEqual({
            id: "moreTools",
            label: "t:toolBar.extraTools",
            icon: ICON,
            isOn: true,
            group: "moreTools",
            children: EXTRA_TOOL_IDS.map((id) => ({
                id, label: `t:toolBar.${id}`, isOn: id === "selection"
            }))
        });
        expect(tools.slice(count + 2)).toEqual([
            { id: "undo", label: "t:buttons.undo", icon: ICON, isEnabled: true, group: "history" },
            { id: "redo", label: "t:buttons.redo", icon: ICON, isEnabled: false, group: "history" },
            {
                id: "zoomOut",
                label: "t:buttons.zoomOut",
                icon: ICON,
                isEnabled: true,
                group: "zoom"
            },
            { id: "resetZoom", label: "t:buttons.resetZoom (100%)", icon: ICON, group: "zoom" },
            { id: "zoomIn", label: "t:buttons.zoomIn", icon: ICON, isEnabled: true, group: "zoom" }
        ]);

        await act(async () => render(null, container));
        expect(getContentEmbedTools(embed)).toBeNull();
        expect(api.unsubscribe).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(provider.getTools()).toEqual([]);
    });

    it("tells the editor around the drawing, and marks the drawing, about its tools", async () => {
        const inside = vi.fn();
        const outside = vi.fn();
        const stopInside = watchContentEmbedTools(container, inside);
        const stopOutside = watchContentEmbedTools(document.createElement("div"), outside);

        const { embed } = await mount();
        const root = embed.querySelector(":scope > div");
        expect(inside).toHaveBeenCalledTimes(1);
        expect(outside).not.toHaveBeenCalled();
        expect(root?.hasAttribute("data-embed-tools")).toBe(true);

        await act(async () => render(null, container));
        expect(root?.hasAttribute("data-embed-tools")).toBe(false);

        stopInside();
        stopOutside();
        await mount();
        expect(inside).toHaveBeenCalledTimes(1);
    });

    it("notifies its listeners when a tool, the zoom or the history changes", async () => {
        const { provider } = await mount();
        const listener = vi.fn();
        const unsubscribe = provider.subscribe(listener);
        const getEnabled = () => provider.getTools()
            .filter((tool) => tool.group === "history" || tool.group === "zoom")
            .map((tool) => `${tool.id}:${tool.isEnabled ?? true}`);
        const getOn = () => provider.getTools()
            .flatMap((tool) => [ tool, ...tool.children ?? [] ])
            .filter((tool) => tool.isOn)
            .map((tool) => tool.id);

        api.change({});
        expect(listener).not.toHaveBeenCalled();

        api.change({ activeTool: { type: "rectangle", locked: false } });
        api.change({ activeTool: { type: "rectangle", locked: true } });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(getOn()).toEqual([ "lock", "rectangle" ]);

        api.change({ activeTool: { type: "eraser", locked: true } });
        expect(listener).toHaveBeenCalledTimes(3);
        expect(getOn()).toEqual([ "lock", "moreTools", "eraser" ]);

        api.change({ zoom: { value: 30 } });
        expect(listener).toHaveBeenCalledTimes(4);
        expect(getEnabled()).toEqual([
            "undo:true", "redo:false", "zoomOut:true", "resetZoom:true", "zoomIn:false"
        ]);

        await act(async () => {
            container.querySelector("[data-testid=button-redo]")?.removeAttribute("disabled");
        });
        expect(listener).toHaveBeenCalledTimes(5);
        expect(getEnabled()).toContain("redo:true");

        unsubscribe();
        api.change({ zoom: { value: 0.1 } });
        expect(listener).toHaveBeenCalledTimes(5);
        expect(getEnabled()).toContain("zoomOut:false");
    });

    it("runs a tool with the focus in the drawing", async () => {
        const { provider } = await mount();

        provider.execute("rectangle");
        expect(api.setActiveTool).toHaveBeenCalledWith({ type: "rectangle" });
        expect(document.activeElement).toBe(container.querySelector(".excalidraw-container"));

        provider.execute("laser");
        expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "laser" });

        provider.execute("lock");
        expect(api.updateScene).toHaveBeenLastCalledWith({
            appState: { activeTool: expect.objectContaining({ type: "selection", locked: true }) }
        });

        provider.execute("undo");
        expect(undo).toHaveBeenCalledTimes(1);

        // Zooms around the center of the 800 × 400 view, as Excalidraw's zoom buttons do.
        provider.execute("zoomIn");
        expect(api.updateScene).toHaveBeenLastCalledWith({
            appState: {
                scrollX: expect.closeTo(10 + 400 / 1.1 - 400),
                scrollY: expect.closeTo(20 + 200 / 1.1 - 200),
                zoom: { value: 1.1 }
            }
        });

        api.change({ zoom: { value: 2 } });
        provider.execute("resetZoom");
        expect(api.updateScene).toHaveBeenLastCalledWith({
            appState: { scrollX: 210, scrollY: 120, zoom: { value: 1 } }
        });

        provider.execute("magicframe");
        provider.execute("moreTools");
        expect(api.setActiveTool).toHaveBeenCalledTimes(2);
        expect(api.updateScene).toHaveBeenCalledTimes(3);
    });
});

/** The part of Excalidraw's app state that the tools read. */
interface FakeAppState {
    activeTool: { type: string; locked: boolean };
    zoom: { value: number };
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
}

/** An Excalidraw API whose app state the spec changes. */
function createApi() {
    let appState: FakeAppState = {
        activeTool: { type: "selection", locked: false },
        zoom: { value: 1 },
        scrollX: 10,
        scrollY: 20,
        width: 800,
        height: 400
    };
    let onChange: ((elements: unknown[], appState: AppState) => void) | undefined;
    const unsubscribe = vi.fn();
    const setActiveTool = vi.fn();
    const updateScene = vi.fn();
    const getAppState = () => appState as unknown as AppState;

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
        change(next: Partial<FakeAppState>) {
            appState = { ...appState, ...next };
            onChange?.([], getAppState());
        }
    };
}
