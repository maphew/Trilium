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
