import "./File.css";

import { t } from "../../services/i18n";
import Alert from "../react/Alert";
import CodeBlock from "../react/CodeBlock";
import { useNoteBlob } from "../react/hooks";
import MediaPreview from "./file/MediaPreview";
import PdfPreview from "./file/Pdf";
import { TypeWidgetProps } from "./type_widget";

const TEXT_MAX_NUM_CHARS = 5000;

export default function FileTypeWidget({ note, parentComponent, noteContext, isVisible }: TypeWidgetProps) {
    const blob = useNoteBlob(note, parentComponent?.componentId);

    if (blob?.content) {
        return <TextPreview content={blob.content} mime={note.mime} />;
    } else if (note.mime === "application/pdf") {
        return noteContext && <PdfPreview blob={blob} note={note} componentId={parentComponent?.componentId} noteContext={noteContext} />;
    } else if (note.mime.startsWith("video/") || note.mime.startsWith("audio/")) {
        return <MediaPreview entity={note} environment="standalone" noteContext={noteContext} isVisible={isVisible} />;
    }
    return <NoPreview />;

}

export function TextPreview({ content, mime }: { content: string, mime?: string }) {
    const trimmedContent = content.substring(0, TEXT_MAX_NUM_CHARS);
    const isTooLarge = trimmedContent.length !== content.length;

    return (
        <>
            {isTooLarge && (
                <Alert type="info">
                    {t("file.too_big", { maxNumChars: TEXT_MAX_NUM_CHARS })}
                </Alert>
            )}
            {/* The copy button is dropped for a truncated preview — it could only copy the visible
                5000 characters, which reads as copying the whole file. */}
            <CodeBlock
                className="file-preview-content"
                code={trimmedContent}
                mimeType={mime}
                copyable={!isTooLarge}
            />
        </>
    );
}

function NoPreview() {
    return (
        <Alert className="file-preview-not-available" type="info">
            {t("file.file_preview_not_available")}
        </Alert>
    );
}
