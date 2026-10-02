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
    useSidePanel(rootRef, isEditable);

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
 * renders its container only once its language loads, after the box may have taken the focus.
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

/** The space between the drawing, the properties panel and the edges of the window, in rem. */
const SIDE_PANEL_GAP_REM = 0.5;

/**
 * Shows Excalidraw's properties panel beside the drawing while the drawing has the focus, in the
 * top layer so that no clip or stacking of the note covers it. Sets `data-side-panel` on the root
 * while the panel is there, and its position in `--side-panel-*`.
 */
export function useSidePanel(rootRef: RefObject<HTMLElement>, isEnabled: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>(".scrolling-container");
        const embedBody = root?.closest<HTMLElement>(".include-note-body");
        if (!root || !viewport || !embedBody || !isEnabled) return;

        let panel: HTMLElement | null = null;

        const update = () => {
            // `ContentEmbed` marks the body active while the drawing has the focus.
            const isShown = embedBody.classList.contains("active")
                && !document.fullscreenElement?.contains(root);
            const position = panel && isShown ? getSidePanelPosition(root, viewport, panel) : null;

            root.toggleAttribute("data-side-panel", !!position);
            if (position) {
                root.style.setProperty("--side-panel-left", `${position.left}px`);
                root.style.setProperty("--side-panel-top", `${position.top}px`);
                root.style.setProperty("--side-panel-max-height", `${position.maxHeight}px`);
            }
            setTopLayer(panel, !!position);
        };

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        resizeObserver.observe(viewport);
        const activeObserver = new MutationObserver(update);
        activeObserver.observe(embedBody, { attributes: true, attributeFilter: [ "class" ] });

        // The panel mounts when a shape is selected or a tool is picked, and its height follows
        // the properties of the selection.
        const watchPanel = () => {
            const current = root.querySelector<HTMLElement>(".App-menu__left");
            if (current === panel) return;

            if (panel) resizeObserver.unobserve(panel);
            panel = current;
            if (panel) resizeObserver.observe(panel);
            update();
        };
        const mutationObserver = new MutationObserver(watchPanel);
        mutationObserver.observe(root, { childList: true, subtree: true });
        viewport.addEventListener("scroll", update, { passive: true });
        document.addEventListener("fullscreenchange", update);
        watchPanel();
        update();

        return () => {
            resizeObserver.disconnect();
            activeObserver.disconnect();
            mutationObserver.disconnect();
            viewport.removeEventListener("scroll", update);
            document.removeEventListener("fullscreenchange", update);
            root.removeAttribute("data-side-panel");
            setTopLayer(panel, false);
        };
    }, [ rootRef, isEnabled ]);
}

/**
 * The position of `panel` beside the drawing `root`: on its right when the window has room there,
 * otherwise on its left, level with the top of the drawing and inside the window. `null` when
 * neither side has room or the drawing is scrolled out of `viewport`.
 */
function getSidePanelPosition(root: HTMLElement, viewport: HTMLElement, panel: HTMLElement) {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const gap = SIDE_PANEL_GAP_REM * rem;
    const drawing = root.getBoundingClientRect();
    const noteArea = getVisibleArea(viewport);
    if (drawing.bottom <= noteArea.top || drawing.top >= noteArea.bottom) {
        return null;
    }

    const area = getWindowArea();
    const left = getSidePanelLeft(drawing, area, panel.offsetWidth, gap);
    if (left === null) {
        return null;
    }

    const maxHeight = area.bottom - area.top - 2 * gap;
    const height = Math.min(panel.offsetHeight, maxHeight);
    const top = Math.max(area.top + gap, Math.min(drawing.top, area.bottom - gap - height));
    return { left, top, maxHeight };
}

/**
 * Moves `panel` into the top layer, or back into the drawing. The `popover` attribute is present
 * exactly while the panel is in the top layer; removing it hides the popover.
 */
function setTopLayer(panel: HTMLElement | null, isMoved: boolean) {
    if (!panel || isMoved === panel.hasAttribute("popover")) return;

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
 * The left edge of a panel `width` wide in the margin right of `drawing`, else in the margin left
 * of it, or `null` when neither margin fits the panel with a `gap` on both sides.
 */
function getSidePanelLeft(drawing: DOMRect, area: VisibleArea, width: number, gap: number) {
    const rightOfDrawing = drawing.right + gap;
    if (rightOfDrawing + width + gap <= area.right) {
        return rightOfDrawing;
    }

    const leftOfDrawing = drawing.left - gap - width;
    return leftOfDrawing >= area.left + gap ? leftOfDrawing : null;
}
