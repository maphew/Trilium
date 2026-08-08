import "./setup_backup.css";

import { useMemo, useState } from "preact/hooks";

import { backupDownloadFileName, startBackupDownload } from "./services/backup_download";
import { t } from "./services/i18n";
import Admonition from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";

/**
 * Backing up by download, which on the standalone platform happens here rather than while the
 * application runs.
 *
 * A backup is streamed off the database page by page and takes minutes on a large one. Nothing may
 * write to the database in between, or the pages would come from two different versions of it — and
 * a running Trilium writes constantly. So the application restarts into setup, where the database is
 * open but nothing is loaded against it: no becca, no sync, no migration. This screen is what it
 * restarts into, and leaving it puts the application back the way it was.
 *
 * @module
 */

/** Where the download stands, and the one thing that can be done about it. */
export interface BackupDownload {
    fileName: string;
    state: "idle" | "running" | "done" | "failed";
    /** What stopped it, once `failed`. */
    error?: string;
    start: () => void;
}

/**
 * Owns a download and the file it is named after, which is fixed when the screen appears rather
 * than when the button is pressed: the name is shown before the download starts.
 */
export function useBackupDownload(): BackupDownload {
    const fileName = useMemo(() => backupDownloadFileName(new Date()), []);
    const [ state, setState ] = useState<BackupDownload["state"]>("idle");
    const [ error, setError ] = useState<string>();

    return {
        fileName,
        state,
        error,
        start: () => {
            setState("running");
            setError(undefined);
            void startBackupDownload(fileName).then((result) => {
                setState(result.status === "done" ? "done" : "failed");
                setError(result.status === "done" ? undefined : result.message);
            });
        }
    };
}

/**
 * The download itself: the button that starts it and what became of it.
 *
 * Shared by the two screens that offer one, so a backup taken before a restore and a backup taken
 * for its own sake are the same thing to a user.
 */
export function BackupDownloadPanel({ download }: { download: BackupDownload }) {
    return (
        <div class="backup-download">
            <Button
                text={t("setup.existing-data-download")}
                icon="bx bx-download"
                kind="primary"
                disabled={download.state === "running"}
                onClick={download.start}
            />

            {download.state === "running" && (
                <div class="backup-download-message">
                    <span class="spinner-border" role="status" aria-hidden="true" />
                    <span>{t("setup.existing-data-downloading-in-progress")}</span>
                </div>
            )}
            {download.state === "done" && <span>{t("setup.existing-data-downloading-done")}</span>}
            {download.state === "failed" && (
                <Admonition type="warning" className="backup-download-error">
                    {download.error ?? t("setup.existing-data-download-failed")}
                </Admonition>
            )}
        </div>
    );
}

/**
 * The whole of the wizard, when the wizard was opened to take a backup and nothing else.
 *
 * Unlike every other screen here, this one leads nowhere: there is no next step, because the
 * database it was opened over is the one the application is going back to. Continue is available
 * from the start, so a user who changes their mind is not trapped on a screen that only exists to
 * offer them something.
 *
 * @param onDone leave setup and open the database that was there all along.
 */
export default function SetupBackupDatabase({ onDone }: { onDone: () => void }) {
    const download = useBackupDownload();

    return (
        <SetupPage
            className="setup-backup-database top-aligned"
            title={t("setup.backup-database")}
            description={t("setup.backup-database-description", { fileName: download.fileName })}
            illustration={<Icon icon="bx bx-archive-out" className="illustration-icon" />}
            footer={
                <Button
                    text={download.state === "done" ? t("setup.backup-database-finish") : t("setup.continue")}
                    kind="primary"
                    disabled={download.state === "running"}
                    onClick={onDone}
                />
            }
        >
            <BackupDownloadPanel download={download} />

            <Admonition type="note" className="setup-backup-note">
                {t("setup.backup-database-note")}
            </Admonition>
        </SetupPage>
    );
}
