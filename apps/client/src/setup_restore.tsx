import "./setup_restore.css";

import type { DatabaseBackup, ExistingBackupsResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { uploadInChunks } from "./services/chunked_upload";
import { describeDatabaseFile } from "./services/database_files";
import { t } from "./services/i18n";
import server from "./services/server";
import { formatSize } from "./services/utils";
import Admonition from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import FormGroup from "./widgets/react/FormGroup";
import FormTextBox from "./widgets/react/FormTextBox";
import Icon from "./widgets/react/Icon";
import NoItems from "./widgets/react/NoItems";
import SetupPage from "./widgets/react/SetupPage";

/**
 * The setup screen's "restore from backup" path, from picking a backup to the restored database
 * being open.
 *
 * One component rather than three wizard states, because the steps are one decision followed by its
 * consequences: which backup, the passphrase it turns out to need, and then waiting. Going back from
 * the passphrase means picking again, which is what the wizard's own back button already means.
 *
 * @module
 */

/** What the restore is waiting on, as far as this screen is concerned. */
type Step = "picking" | "uploading" | "passphrase" | "restoring";

/** Failures the same backup can still get past, which send the user back to the passphrase rather than to the start. */
const PASSPHRASE_FAILURES = new Set([ "passphrase-required", "wrong-passphrase-or-damaged-header" ]);

export default function RestoreFromBackup({ onBack, onRestored }: { onBack: () => void; onRestored: () => void }) {
    const [ step, setStep ] = useState<Step>("picking");
    const [ selection, setSelection ] = useState<Selection | null>(null);
    const [ upload, setUpload ] = useState<UploadState | null>(null);
    const [ error, setError ] = useState<string | null>(null);
    const [ errorId, setErrorId ] = useState(0);
    const [ wrongPassphrase, setWrongPassphrase ] = useState(false);

    const raiseError = useCallback((message: string) => {
        setError(message);
        setErrorId((id) => id + 1);
    }, []);

    /** Sends the restore on its way, or asks for the passphrase first where the backup needs one. */
    const restore = useCallback(async (picked: Selection, passphrase?: string) => {
        setSelection(picked);

        if (picked.encrypted && !passphrase) {
            setStep("passphrase");
            return;
        }

        try {
            await server.post("setup/restore/start", {
                source: picked.source,
                filePath: picked.filePath,
                passphrase
            });
            setStep("restoring");
        } catch (e) {
            setStep("picking");
            raiseError(e instanceof Error ? e.message : String(e));
        }
    }, [ raiseError ]);

    async function uploadAndRestore(file: File) {
        setStep("uploading");
        setUpload({ sentBytes: 0, totalBytes: file.size, fraction: 0 });

        try {
            const uploaded = await uploadInChunks<{ fileName: string; encrypted: boolean }>({
                endpoint: "setup/restore/upload",
                blob: file,
                fileName: file.name,
                onProgress: ({ sentBytes, totalBytes, fraction }) => setUpload({ sentBytes, totalBytes, fraction })
            });

            await restore({ source: "uploaded", fileName: uploaded.fileName, encrypted: uploaded.encrypted });
        } catch (e) {
            setStep("picking");
            raiseError(t("setup.restore-upload-failed", { message: e instanceof Error ? e.message : String(e) }));
        }
    }

    function onRestoreFailed(failure: { error?: string; reason?: string }) {
        if (failure.reason && PASSPHRASE_FAILURES.has(failure.reason)) {
            // The backup is still on the server, so only the passphrase has to be given again.
            setWrongPassphrase(true);
            setStep("passphrase");
            return;
        }

        setStep("picking");
        raiseError(failure.error ?? t("setup.restore-failed-generic"));
    }

    return (
        <SetupPage
            className="restore-from-backup top-aligned"
            title={t("setup.restore-from-backup")}
            description={step === "picking" ? t("setup.restore-from-backup-page-description") : undefined}
            illustration={<Icon icon="bx bx-archive-in" className="illustration-icon" />}
            error={error}
            errorId={errorId}
            onBack={step === "restoring" ? undefined : onBack}
        >
            {step === "picking" && <PickBackup onPick={restore} onUpload={uploadAndRestore} />}
            {step === "uploading" && upload && <UploadProgress upload={upload} />}
            {step === "passphrase" && selection && (
                <AskPassphrase
                    fileName={selection.fileName}
                    wrong={wrongPassphrase}
                    onSubmit={(passphrase) => {
                        setWrongPassphrase(false);
                        void restore(selection, passphrase);
                    }}
                />
            )}
            {step === "restoring" && (
                <RestoreProgress onRestored={onRestored} onFailed={onRestoreFailed} />
            )}
        </SetupPage>
    );
}

/** Which backup is being restored, and where it is. */
interface Selection {
    source: "uploaded" | "existing";
    fileName: string;
    /** Only for a backup already on the server. */
    filePath?: string;
    encrypted?: boolean;
}

interface UploadState {
    sentBytes: number;
    totalBytes: number;
    fraction: number;
}

/** The backups already on this device, and the way to a file that is not. */
function PickBackup({ onPick, onUpload }: { onPick: (selection: Selection) => void; onUpload: (file: File) => void }) {
    const [ backups, setBackups ] = useState<DatabaseBackup[] | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        server.get<ExistingBackupsResponse>("database/backups")
            .then((response) => setBackups(response.backups))
            // An unreadable backup directory is not a reason to lose the "choose a file" path.
            .catch(() => setBackups([]));
    }, []);

    const sorted = [ ...(backups ?? []) ].sort((a, b) => (a.mtime < b.mtime ? 1 : -1));

    return (
        <>
            <Card heading={t("setup.restore-existing-backups")}>
                {backups === null ? (
                    <CardSection className="restore-loading">
                        <Icon icon="bx bx-loader-circle bx-spin" /> {t("setup.restore-looking-for-backups")}
                    </CardSection>
                ) : sorted.length > 0 ? (
                    sorted.map((backup) => (
                        <CardSection
                            key={backup.filePath}
                            className="restore-backup-row"
                            onAction={() => onPick({
                                source: "existing",
                                fileName: backup.fileName,
                                filePath: backup.filePath,
                                encrypted: backup.encrypted
                            })}
                        >
                            <Icon icon={backup.encrypted ? "bx bx-lock-alt" : "bx bx-data"} />

                            <div class="restore-backup-details">
                                <div class="restore-backup-name">{backup.fileName}</div>
                                <div class="restore-backup-description">{describeDatabaseFile(backup)}</div>
                            </div>

                            <Icon icon="bx bx-chevron-right" />
                        </CardSection>
                    ))
                ) : (
                    <CardSection>
                        <NoItems icon="bx bx-archive" text={t("setup.restore-no-backups")} />
                    </CardSection>
                )}
            </Card>

            <Card heading={t("setup.restore-from-a-file")}>
                <CardSection className="restore-file-section">
                    <p>{t("setup.restore-from-a-file-description")}</p>

                    <input
                        ref={fileInput}
                        type="file"
                        accept=".db,.tnbackup"
                        class="restore-file-input"
                        onChange={(e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file) {
                                onUpload(file);
                            }
                        }}
                    />

                    <Button
                        kind="primary"
                        icon="bx bx-folder-open"
                        text={t("setup.restore-choose-file")}
                        onClick={() => fileInput.current?.click()}
                    />
                </CardSection>
            </Card>
        </>
    );
}

function UploadProgress({ upload }: { upload: UploadState }) {
    return (
        <Card className="restore-progress">
            <CardSection>
                <div class="restore-progress-label">
                    <Icon icon="bx bx-loader-circle bx-spin" /> {t("setup.restore-uploading")}
                </div>

                <progress value={upload.sentBytes} max={upload.totalBytes} />

                <div class="restore-progress-detail">
                    {t("setup.restore-uploaded-so-far", {
                        sent: formatSize(upload.sentBytes),
                        total: formatSize(upload.totalBytes)
                    })}
                </div>
            </CardSection>
        </Card>
    );
}

function AskPassphrase({ fileName, wrong, onSubmit }: { fileName: string; wrong: boolean; onSubmit: (passphrase: string) => void }) {
    const [ passphrase, setPassphrase ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => inputRef.current?.focus(), []);

    return (
        <form onSubmit={(e) => {
            e.preventDefault();
            if (passphrase) {
                onSubmit(passphrase);
            }
        }}>
            <Card heading={fileName}>
                <CardSection>
                    <FormGroup
                        name="backupPassphrase"
                        label={t("setup.restore-passphrase")}
                        description={t("setup.restore-passphrase-description")}
                        error={wrong ? t("setup.restore-wrong-passphrase") : undefined}
                    >
                        <FormTextBox
                            inputRef={inputRef}
                            type="password"
                            currentValue={passphrase}
                            onChange={setPassphrase}
                            autocomplete="off"
                        />
                    </FormGroup>
                </CardSection>
            </Card>

            <div class="restore-passphrase-actions">
                <Button kind="primary" text={t("setup.restore-continue")} disabled={!passphrase} />
            </div>
        </form>
    );
}

/** The stages the server works through, and which one it is on. */
const STAGES = [ "staging", "validating", "swapping", "migrating" ] as const;

function RestoreProgress({ onRestored, onFailed }: { onRestored: () => void; onFailed: (failure: { error?: string; reason?: string }) => void }) {
    const [ stage, setStage ] = useState<string>("staging");

    useEffect(() => {
        const interval = setInterval(async () => {
            let restore;
            try {
                ({ restore } = await server.get<{ restore: { stage: string; error?: string; reason?: string } | null }>("setup/restore/status"));
            } catch {
                // The database is detached for the moment it takes to exchange the files, which any
                // request landing in that moment cannot be answered through. The next one can.
                return;
            }

            if (!restore) {
                return;
            }
            if (restore.stage === "done") {
                clearInterval(interval);
                onRestored();
                return;
            }
            if (restore.stage === "failed") {
                clearInterval(interval);
                onFailed(restore);
                return;
            }

            setStage(restore.stage);
        }, 1000);

        return () => clearInterval(interval);
    }, [ onRestored, onFailed ]);

    const currentIndex = STAGES.indexOf(stage as typeof STAGES[number]);

    return (
        <>
            <Card className="restore-stages">
                {STAGES.map((name, index) => (
                    <CardSection key={name} className={index < currentIndex ? "completed" : index === currentIndex ? "active" : ""}>
                        <Icon icon={index < currentIndex ? "bx bx-check-circle" : index === currentIndex ? "bx bx-loader-circle bx-spin" : "bx bx-circle"} />{" "}
                        {t(`setup.restore-stage-${name}`)}
                    </CardSection>
                ))}
            </Card>

            <Admonition type="warning" className="restore-banner">
                {t("setup.restore-do-not-close")}
            </Admonition>
        </>
    );
}
