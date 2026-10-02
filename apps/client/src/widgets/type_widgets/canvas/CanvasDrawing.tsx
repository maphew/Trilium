import "./CanvasDrawing.css";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { useColorScheme } from "../../react/hooks";
import { CanvasEditor } from "./Canvas";
import CanvasDrawingMenu from "./CanvasDrawingMenu";
import CanvasEmbedTools from "./CanvasEmbedTools";
import { getInlineFiles, parseContent, useCanvasDrawingPersistence } from "./persistence";

interface CanvasDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. Without it, or for an attachment of another note, it is read-only. */
    editor?: AttachmentEditor;
}

/** A canvas drawing saved in an attachment, edited in place inside the note that shows it. */
export default function CanvasDrawing({ attachment, editor }: CanvasDrawingProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const colorScheme = useColorScheme();
    const isEditable = !!editor?.canEdit(attachment) && !options.is("databaseReadonly");
    const persistence = useCanvasDrawingPersistence(
        attachment,
        isEditable ? editor : undefined,
        apiRef,
        colorScheme
    );
    const isToolbarOverPanel = useIsToolbarOverPanel(rootRef);
    useFocusFromEmbedBox(rootRef);
    useSidePanels(rootRef, isEditable);

    return (
        <div
            ref={rootRef}
            className={clsx("canvas-drawing-editor", isToolbarOverPanel && "toolbar-over-panel")}
        >
            <CanvasEditor
                apiRef={apiRef}
                isReadOnly={!isEditable}
                colorScheme={colorScheme}
                persistence={persistence}
                isEmbedded
            >
                <CanvasDrawingMenu apiRef={apiRef} isEditable={isEditable} />
                {isEditable && <CanvasEmbedTools rootRef={rootRef} apiRef={apiRef} />}
            </CanvasEditor>
        </div>
    );
}

/** A picture of the canvas drawing saved in `entity`, or `null` for an empty drawing. */
export async function renderCanvasDrawingPicture(entity: FNote | FAttachment) {
    const blob = await entity.getBlob();
    const content = parseContent(blob?.content ?? "", entity);
    const elements = (content.elements ?? []).filter((element) => !element.isDeleted);
    if (!elements.length) {
        return null;
    }

    const svg = await exportToSvg({
        elements,
        appState: { ...content.appState, exportBackground: true },
        files: getInlineFiles(content),
        exportPadding: 5
    });
    svg.classList.add("canvas-drawing-picture");
    return svg;
}

/**
 * Moves the focus into Excalidraw when the embed box around the drawing holds it. Excalidraw
 * renders its container only once its language loads, which can be after the box took the focus.
 */
function useFocusFromEmbedBox(rootRef: RefObject<HTMLElement>) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        // Returns whether the container exists, after which there is nothing left to wait for.
        const forwardFocus = () => {
            const container = root.querySelector<HTMLElement>(".excalidraw");
            if (container && document.activeElement === container.closest(".include-note-content")) {
                container.focus();
            }
            return !!container;
        };
        if (forwardFocus()) return;

        const observer = new MutationObserver(() => {
            if (forwardFocus()) {
                observer.disconnect();
            }
        });
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [ rootRef ]);
}

/**
 * Whether Excalidraw's toolbar reaches over the column of the properties panel, which then starts
 * below the toolbar instead of at the top of the canvas.
 */
export function useIsToolbarOverPanel(rootRef: RefObject<HTMLElement>) {
    const [ isOver, setIsOver ] = useState(false);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        // Compares the horizontal edges only, which do not depend on where the panel starts.
        const update = () => {
            const toolbar = root.querySelector(".App-toolbar-container")?.getBoundingClientRect();
            const panel = root.querySelector(".App-menu__left")?.getBoundingClientRect();
            if (toolbar && panel) {
                setIsOver(panel.left < toolbar.right && panel.right > toolbar.left);
            }
        };
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        // The panel mounts when a shape is selected or a tool is picked.
        const mutationObserver = new MutationObserver(update);
        mutationObserver.observe(root, { childList: true, subtree: true });

        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
        };
    }, [ rootRef ]);

    return isOver;
}

/** The space between the drawing, the panels beside it and the edges of the window, in rem. */
const SIDE_PANEL_GAP_REM = 0.5;
/** The least height of a panel as tall as the drawing, in rem. */
const SIDE_PANEL_MIN_HEIGHT_REM = 20;

/** The panels of Excalidraw that go beside the drawing, in the order in which they take a side. */
const SIDE_PANELS = [
    // The item list of the library fills the height it is given and has none of its own.
    { selector: ".default-sidebar", hasDrawingHeight: true },
    { selector: ".App-menu__left", hasDrawingHeight: false }
];

type Side = "left" | "right";

/**
 * Shows Excalidraw's library and properties panel beside the drawing while the drawing has the
 * focus, in the top layer so that no clip or stacking of the note covers them. A panel there has
 * `data-side-panel`, and its position in `--side-panel-*`.
 */
export function useSidePanels(rootRef: RefObject<HTMLElement>, isEnabled: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>(".scrolling-container");
        const embedBody = root?.closest<HTMLElement>(".include-note-body");
        if (!root || !viewport || !embedBody || !isEnabled) return;

        const panels = new Map<string, HTMLElement>();

        const update = () => {
            // `ContentEmbed` marks the body active while the drawing has the focus.
            const isShown = embedBody.classList.contains("active")
                && !document.fullscreenElement?.contains(root);
            const layout = isShown ? getSideLayout(root, viewport) : null;
            const takenSides = new Set<Side>();
            for (const { selector, hasDrawingHeight } of SIDE_PANELS) {
                const panel = panels.get(selector);
                if (!panel) continue;

                const position = layout
                    && getSidePanelPosition(layout, panel, hasDrawingHeight, takenSides);
                if (position) {
                    takenSides.add(position.side);
                }
                placePanel(panel, position || null);
            }
        };

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        resizeObserver.observe(viewport);
        const activeObserver = new MutationObserver(update);
        activeObserver.observe(embedBody, { attributes: true, attributeFilter: [ "class" ] });

        // The panels mount when they open, and the properties panel takes the height of the
        // properties of the selection.
        const watchPanels = () => {
            let isChanged = false;
            for (const { selector } of SIDE_PANELS) {
                const current = root.querySelector<HTMLElement>(selector);
                const previous = panels.get(selector);
                if (current === previous) continue;

                isChanged = true;
                if (previous) resizeObserver.unobserve(previous);
                if (current) {
                    panels.set(selector, current);
                    resizeObserver.observe(current);
                } else {
                    panels.delete(selector);
                }
            }
            if (isChanged) update();
        };
        const mutationObserver = new MutationObserver(watchPanels);
        mutationObserver.observe(root, { childList: true, subtree: true });
        viewport.addEventListener("scroll", update, { passive: true });
        document.addEventListener("fullscreenchange", update);
        watchPanels();
        update();

        return () => {
            resizeObserver.disconnect();
            activeObserver.disconnect();
            mutationObserver.disconnect();
            viewport.removeEventListener("scroll", update);
            document.removeEventListener("fullscreenchange", update);
            for (const panel of panels.values()) {
                placePanel(panel, null);
            }
        };
    }, [ rootRef, isEnabled ]);
}

interface SideLayout {
    drawing: DOMRect;
    /** The window, which the panels stay inside. */
    area: VisibleArea;
    gap: number;
    /** The least height of a panel as tall as the drawing. */
    minHeight: number;
}

/** The layout of the panels beside `root`, or `null` while it is scrolled out of `viewport`. */
function getSideLayout(root: HTMLElement, viewport: HTMLElement): SideLayout | null {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const drawing = root.getBoundingClientRect();
    const noteArea = getVisibleArea(viewport);
    if (drawing.bottom <= noteArea.top || drawing.top >= noteArea.bottom) {
        return null;
    }

    return {
        drawing,
        area: getWindowArea(),
        gap: SIDE_PANEL_GAP_REM * rem,
        minHeight: SIDE_PANEL_MIN_HEIGHT_REM * rem
    };
}

/**
 * The position of `panel` beside the drawing: on its right when the window has room there and
 * no other panel took that side, otherwise on its left, level with the top of the drawing and
 * inside the window. `null` when no free side has room.
 */
function getSidePanelPosition(
    { drawing, area, gap, minHeight }: SideLayout,
    panel: HTMLElement,
    hasDrawingHeight: boolean,
    takenSides: ReadonlySet<Side>
) {
    const placement = getSidePanelLeft(drawing, area, panel.offsetWidth, gap, takenSides);
    if (!placement) {
        return null;
    }

    const maxHeight = area.bottom - area.top - 2 * gap;
    const contentHeight = hasDrawingHeight
        ? Math.max(drawing.height, minHeight)
        : panel.offsetHeight;
    const height = Math.min(contentHeight, maxHeight);
    const top = Math.max(area.top + gap, Math.min(drawing.top, area.bottom - gap - height));
    return { ...placement, top, maxHeight, height: hasDrawingHeight ? height : null };
}

type SidePanelPosition = NonNullable<ReturnType<typeof getSidePanelPosition>>;

/** Moves `panel` to `position` beside the drawing, or back into the drawing for `null`. */
function placePanel(panel: HTMLElement, position: SidePanelPosition | null) {
    panel.toggleAttribute("data-side-panel", !!position);
    if (position) {
        panel.style.setProperty("--side-panel-left", `${position.left}px`);
        panel.style.setProperty("--side-panel-top", `${position.top}px`);
        panel.style.setProperty("--side-panel-max-height", `${position.maxHeight}px`);
        if (position.height === null) {
            panel.style.removeProperty("--side-panel-height");
        } else {
            panel.style.setProperty("--side-panel-height", `${position.height}px`);
        }
    }
    setTopLayer(panel, !!position);
}

/**
 * Moves `panel` into the top layer, or back into the drawing. The `popover` attribute is present
 * exactly while the panel is in the top layer; removing it hides the popover.
 */
function setTopLayer(panel: HTMLElement, isMoved: boolean) {
    if (isMoved === panel.hasAttribute("popover")) return;

    if (isMoved) {
        panel.setAttribute("popover", "manual");
        panel.showPopover();
    } else {
        panel.removeAttribute("popover");
    }
}

interface VisibleArea {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The part of `viewport` that shows the note, without its scrollbars. */
function getVisibleArea(viewport: HTMLElement): VisibleArea {
    const rect = viewport.getBoundingClientRect();
    const left = rect.left + viewport.clientLeft;
    const top = rect.top + viewport.clientTop;
    return {
        left,
        top,
        right: left + viewport.clientWidth,
        bottom: top + viewport.clientHeight
    };
}

/** The window, without its scrollbars. */
function getWindowArea(): VisibleArea {
    const { clientWidth, clientHeight } = document.documentElement;
    return { left: 0, top: 0, right: clientWidth, bottom: clientHeight };
}

/**
 * The side and the left edge of a panel `width` wide in the margin right of `drawing`, else in
 * the margin left of it, or `null` when no side outside `takenSides` fits the panel with a `gap`
 * on both sides.
 */
function getSidePanelLeft(
    drawing: DOMRect,
    area: VisibleArea,
    width: number,
    gap: number,
    takenSides: ReadonlySet<Side>
): { side: Side; left: number } | null {
    const rightOfDrawing = drawing.right + gap;
    if (!takenSides.has("right") && rightOfDrawing + width + gap <= area.right) {
        return { side: "right", left: rightOfDrawing };
    }

    const leftOfDrawing = drawing.left - gap - width;
    if (!takenSides.has("left") && leftOfDrawing >= area.left + gap) {
        return { side: "left", left: leftOfDrawing };
    }
    return null;
}
