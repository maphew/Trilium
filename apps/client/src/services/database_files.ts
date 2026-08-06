import { formatDateTime } from "../utils/formatters.js";
import { t } from "./i18n.js";
import { formatSize } from "./utils.js";

/** A file holding a database: a backup, or an anonymized copy. */
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

/**
 * When the file was written, and how big it is.
 *
 * A file made from a database larger than itself states both, so what compressing it saved is
 * visible rather than having to be worked out.
 *
 * Shared by every list of these files — the backups in the options, the backups the setup screen
 * offers to restore from — so that one line reads the same wherever it appears.
 */
export function describeDatabaseFile(file: DatabaseFile): string {
    const parts = [ file.mtime ? formatDateTime(file.mtime) : "-" ];

    if (file.plaintextSize && file.plaintextSize !== file.fileSize) {
        parts.push(formatSize(file.plaintextSize), t("database_file_list.size_on_disk", { size: formatSize(file.fileSize) }));
    } else {
        parts.push(formatSize(file.fileSize));
    }

    return parts.join(" • ");
}
