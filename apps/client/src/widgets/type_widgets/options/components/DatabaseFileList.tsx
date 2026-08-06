import "./DatabaseFileList.css";

import { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import { t } from "../../../../services/i18n";
import open from "../../../../services/open";
import { formatSize } from "../../../../services/utils";
import { formatDateTime } from "../../../../utils/formatters";
import ActionButton from "../../../react/ActionButton";
import { Badge } from "../../../react/Badge";
import { Card, CardOption, CardSection } from "../../../react/Card";
import NoItems from "../../../react/NoItems";

export interface DatabaseFile {
    fileName: string;
    filePath: string;
    mtime: Date;
    /** Size of the file, in bytes. */
    fileSize: number;
    /**
     * Size of the database the file was made from, in bytes, where that differs from the file's own
     * size — a compressed backup, say. Both are then shown, so the saving is visible.
     */
    plaintextSize?: number;
}

interface DatabaseFileListProps<T extends DatabaseFile> {
    title: string;
    /** Sentence introducing the list — what it holds, or where the files are stored. */
    description?: ComponentChildren;
    /** Displayed sorted by modification date & time in a descending order. */
    files: T[];
    /** Endpoint the per-file download links point to; the file path is appended as a query parameter. */
    downloadEndpoint: string;
    downloadText: string;
    emptyIcon: string;
    emptyText: string;
    /** Labels individual files, for the ones that need telling apart — e.g. one kept somewhere else. */
    fileBadges?: (file: T) => string[];
    /** Extra card sections rendered below the list (e.g. an action button). */
    children?: ComponentChildren;
}

export default function DatabaseFileList<T extends DatabaseFile>(props: DatabaseFileListProps<T>) {
    const { title, description, files, downloadEndpoint, downloadText } = props;
    const { emptyIcon, emptyText, fileBadges, children } = props;

    const sortedFiles = useMemo(() => [...files].sort((a, b) => {
        if (a.mtime < b.mtime) return 1;
        if (a.mtime > b.mtime) return -1;
        return 0;
    }), [files]);

    return (
        <div className="options-section database-file-list">
            <Card heading={title} description={description}>
                {sortedFiles.length > 0 ? (
                    sortedFiles.map((file) => (
                        <CardOption
                            key={file.filePath}
                            label={
                                <span className="database-file-label">
                                    <span className="selectable-text">{file.fileName}</span>
                                    {fileBadges?.(file).map((badge) => (
                                        <Badge
                                            key={badge}
                                            className="database-file-badge"
                                            text={badge}
                                            outline
                                        />
                                    ))}
                                </span>
                            }
                            description={describeFile(file)}
                        >
                            <ActionButton
                                icon="bx bx-download"
                                text={downloadText}
                                onClick={() => downloadFile(downloadEndpoint, file.filePath)}
                            />
                        </CardOption>
                    ))
                ) : (
                    <CardSection>
                        <NoItems icon={emptyIcon} text={emptyText} size="small" />
                    </CardSection>
                )}

                {children}
            </Card>
        </div>
    );
}

function downloadFile(downloadEndpoint: string, filePath: string) {
    const url = `${downloadEndpoint}?filePath=${encodeURIComponent(filePath)}`;

    open.download(open.getUrlForDownload(url));
}

/**
 * When the file was written, and how big it is. A file made from a database larger than itself states
 * both, so what compressing it saved is visible rather than having to be worked out.
 */
function describeFile(file: DatabaseFile): string {
    const parts = [file.mtime ? formatDateTime(file.mtime) : "-"];

    if (file.plaintextSize && file.plaintextSize !== file.fileSize) {
        parts.push(formatSize(file.plaintextSize), t("database_file_list.size_on_disk", { size: formatSize(file.fileSize) }));
    } else {
        parts.push(formatSize(file.fileSize));
    }

    return parts.join(" • ");
}
