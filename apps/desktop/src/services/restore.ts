import type { NativeBackupPickResult } from "@triliumnext/commons";
import { getLog, utils as coreUtils } from "@triliumnext/core";
import { setPendingBackup } from "@triliumnext/server/src/services/restore_session.js";
import { default as electron } from "electron";
import { t } from "i18next";
import { basename } from "path";

/**
 * Registers the desktop's own way of choosing a backup to restore, reachable only from the setup
 * screen's "restore from backup" step.
 *
 * The point is that a backup is a database: on a browser it has to be sent to the server before
 * anything can be done with it, which for one measured in gigabytes is an hour of uploading a file
 * that is already on the same disk. Here the file is simply pointed at and read where it lies.
 *
 * Security model: the renderer never supplies a path and never receives one. The OS dialog runs here
 * in the main process and is the only thing that can put a backup forward; what comes back is the
 * file's name and whether it is encrypted, which is all the screen needs to know. Unlike the native
 * import, no capability token crosses either — importing has to ask the user where the file should go
 * *after* they pick it, whereas picking a backup is the whole decision, so the pick can be acted on
 * at once and the renderer is left holding nothing it could replay.
 */
export function setupRestoreHandlers() {
    electron.ipcMain.handle("restore-pick-backup", async (): Promise<NativeBackupPickResult> => {
        const focusedWindow = electron.BrowserWindow.getFocusedWindow();
        if (!focusedWindow) {
            return { status: "cancelled" };
        }

        // Async dialog: showOpenDialogSync blocks the main process event loop (freezing the UI,
        // WebSockets and background tasks) for as long as the picker is open.
        const { canceled, filePaths } = await electron.dialog.showOpenDialog(focusedWindow, {
            title: t("restore.pick_backup_title"),
            properties: [ "openFile" ],
            filters: [
                { name: t("restore.backup_filter"), extensions: [ "db", "tnbackup" ] },
                { name: t("restore.any_file_filter"), extensions: [ "*" ] }
            ]
        });

        const filePath = canceled ? undefined : filePaths[0];
        if (!filePath) {
            return { status: "cancelled" };
        }

        try {
            const backup = setPendingBackup(filePath, basename(filePath), { consumable: false });
            getLog().info(`A backup was chosen for restoring (${backup.fileName}).`);

            return { status: "selected", ...backup };
        } catch (e) {
            // Setup being busy with something else is the expected one, e.g. a second window part-way
            // through its own restore.
            getLog().error(`A backup could not be chosen for restoring: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);

            return { status: "error", message: e instanceof Error ? e.message : String(e) };
        }
    });
}
