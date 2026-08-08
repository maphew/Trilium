import type { StandaloneDownloadResult } from "@triliumnext/commons";

/**
 * Backing up by download, which is the standalone platform's one and only backup.
 *
 * Standalone keeps no backups anywhere: the browser's storage holds the live database and could
 * rarely hold a copy of it beside itself, so a backup is streamed straight off the live database
 * into a browser download instead. The options screen and the setup screen both back up through
 * here, so the naming and the passphrase live in exactly one place.
 *
 * @module
 */

/** Whether this platform backs up by streaming a download, which is the standalone build. */
export function isBackupDownloadSupported(): boolean {
    return !!window.standaloneApi;
}

/**
 * How a downloaded backup is named: the same dated, readable shape the other platforms write
 * their setup backups under, with the encrypted container's extension, which is what the download
 * currently always carries.
 */
export function backupDownloadFileName(now: Date): string {
    const stamp = (value: number) => String(value).padStart(2, "0");
    const date = [ now.getFullYear(), stamp(now.getMonth() + 1), stamp(now.getDate()) ].join("-");
    const time = [ stamp(now.getHours()), stamp(now.getMinutes()), stamp(now.getSeconds()) ].join("-");

    return `Backup ${date} ${time}.tnbackup`;
}

/**
 * Starts the download and resolves with how it ended, which is when the stream behind it has been
 * fully produced — the closest thing to "finished" the application can see, with the browser's
 * own download UI carrying the transfer itself.
 */
export async function startBackupDownload(fileName: string): Promise<StandaloneDownloadResult> {
    const api = window.standaloneApi;
    if (!api) {
        return { status: "failed", message: "This platform does not back up by download." };
    }

    // TODO: ask the user for a passphrase instead; this fixed one exists only to test the
    // encrypted download path end to end.
    return await api.backup.downloadDatabase(fileName, "123456");
}
