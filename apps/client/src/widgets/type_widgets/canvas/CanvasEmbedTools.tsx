import { useI18n } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI, ToolType } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
    type ContentEmbedTool,
    type ContentEmbedToolProvider,
    registerContentEmbedTools
} from "../text/content_embed_tools";

/** The tools in the order of their buttons. Excalidraw also selects the first nine with 1 to 9. */
const TOOLS = [
    "selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image",
    "eraser", "hand", "frame", "embeddable", "laser"
] as const satisfies readonly ToolType[];
const LOCK = "lock";

type Tool = typeof TOOLS[number];
/** Excalidraw's `t()`, for a key such as `toolBar.rectangle`. */
type Translate = (key: string) => string;

interface CanvasEmbedToolsProps {
    /** The element of the drawing, inside the embed whose toolbar shows the tools. */
    rootRef: RefObject<HTMLElement>;
    apiRef: RefObject<ExcalidrawImperativeAPI>;
}

/**
 * Adds Excalidraw's tools to the toolbar of the embed that shows the drawing. Renders inside
 * `<Excalidraw>`, for its translations.
 */
export default function CanvasEmbedTools({ rootRef, apiRef }: CanvasEmbedToolsProps) {
    // Excalidraw types the key of `t()` as a union that TypeScript cannot check a string against.
    const { t, langCode } = useI18n() as unknown as { t: Translate; langCode: string };
    const [ tools ] = useState(() => new CanvasTools(rootRef));

    useEffect(() => tools.setTranslate(t), [ tools, t, langCode ]);

    useEffect(() => {
        const root = rootRef.current;
        const api = apiRef.current;
        if (!root || !api) return;

        const disconnect = tools.connect(api);
        const unregister = registerContentEmbedTools(root, tools);
        return () => {
            unregister();
            disconnect();
        };
    }, [ tools, rootRef, apiRef ]);

    return null;
}

/** Excalidraw's tools, as buttons of the toolbar of the embed that shows the drawing. */
export class CanvasTools implements ContentEmbedToolProvider {
    private api: ExcalidrawImperativeAPI | null = null;
    private translate: Translate | null = null;
    private listeners = new Set<() => void>();
    /** The active tool and its lock, to notify the listeners only when they change. */
    private shownTool = "";

    constructor(private readonly rootRef: RefObject<HTMLElement>) {}

    /** Follows the active tool of `api`, until the returned function is called. */
    connect(api: ExcalidrawImperativeAPI) {
        this.api = api;
        const unsubscribe = api.onChange((_elements, appState) => this.update(appState));
        this.update(api.getAppState());

        return () => {
            unsubscribe();
            this.api = null;
            this.shownTool = "";
            this.notify();
        };
    }

    setTranslate(translate: Translate) {
        this.translate = translate;
        this.notify();
    }

    getTools(): ContentEmbedTool[] {
        const activeTool = this.api?.getAppState().activeTool;
        if (!activeTool) {
            return [];
        }

        const tools = [
            ...TOOLS.map((type) => ({ id: type, isOn: activeTool.type === type })),
            { id: LOCK, isOn: activeTool.locked }
        ];
        return tools.map(({ id, isOn }, index) => ({
            id,
            label: String(index + 1),
            tooltip: this.translate?.(`toolBar.${id}`) ?? id,
            isOn
        }));
    }

    execute(id: string) {
        const api = this.api;
        if (!api) return;

        // The embed covers the drawing with a backdrop until the drawing has the focus.
        const container = this.rootRef.current?.querySelector<HTMLElement>(".excalidraw-container");
        if (container && !container.contains(document.activeElement)) {
            container.focus({ preventScroll: true });
        }

        const { activeTool } = api.getAppState();
        if (id === LOCK) {
            const locked = !activeTool.locked;
            api.updateScene({ appState: { activeTool: { ...activeTool, locked } } });
        } else if (isTool(id)) {
            api.setActiveTool({ type: id });
        }
    }

    subscribe(callback: () => void) {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    private update(appState: AppState) {
        const { type, locked } = appState.activeTool;
        const shownTool = `${type}:${locked}`;
        if (shownTool !== this.shownTool) {
            this.shownTool = shownTool;
            this.notify();
        }
    }

    private notify() {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

function isTool(id: string): id is Tool {
    return (TOOLS as readonly string[]).includes(id);
}
