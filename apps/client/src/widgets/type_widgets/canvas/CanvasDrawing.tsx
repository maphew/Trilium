import "./CanvasDrawing.css";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useRef } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { useColorScheme } from "../../react/hooks";
import { CanvasEditor } from "./Canvas";
import { getInlineFiles, parseContent, useCanvasDrawingPersistence } from "./persistence";

interface CanvasDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. Without it, or for an attachment of another note, it is read-only. */
    editor?: AttachmentEditor;
}

/** A canvas drawing saved in an attachment, edited in place inside the note that shows it. */
export default function CanvasDrawing({ attachment, editor }: CanvasDrawingProps) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const colorScheme = useColorScheme();
    const isEditable = !!editor?.canEdit(attachment) && !options.is("databaseReadonly");
    const persistence = useCanvasDrawingPersistence(
        attachment,
        isEditable ? editor : undefined,
        apiRef,
        colorScheme
    );

    return (
        <CanvasEditor
            apiRef={apiRef}
            isReadOnly={!isEditable}
            colorScheme={colorScheme}
            persistence={persistence}
            isEmbedded
        />
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
