import "./backup.css";

import { BackupDatabaseNowResponse, BackupPassphraseStatus, DatabaseBackup, ExistingBackupsResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import dialogService from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import { Card, CardSection } from "../../react/Card";
import DirectoryLink from "../../react/DirectoryLink";
import FormPasswordWithConfirmation from "../../react/FormPasswordWithConfirmation";
import FormText from "../../react/FormText";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import Modal from "../../react/Modal";
import DatabaseFileList, { type DatabaseFile } from "./components/DatabaseFileList";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function BackupSettings() {
    const [backups, setBackups] = useState<DatabaseBackup[]>([]);
    const [backupFolderPath, setBackupFolderPath] = useState<string | null>(null);

    const refreshBackups = useCallback(() => {
        server.get<ExistingBackupsResponse>("database/backups").then((response) => {
            setBackups(response.backups);
            setBackupFolderPath(response.backupFolderPath);
        });
    }, []);

    useEffect(refreshBackups, []);

    return (
        <>
            <OptionsPageHeader />
            <BackupConfiguration />
            {/* Absent where there is no user-accessible location at all, e.g. backups kept in OPFS. */}
            {backupFolderPath && <BackupLocation backupFolderPath={backupFolderPath} refreshCallback={refreshBackups} />}
            {/* Desktop only: the passphrase needs an OS keyring to live in, which only the desktop has. */}
            {isElectron() && <BackupOptions />}
            <BackupList backups={backups} backupFolderPath={backupFolderPath} refreshCallback={refreshBackups} />
        </>
    );
}

export function BackupConfiguration() {
    const [dailyBackupEnabled, setDailyBackupEnabled] = useTriliumOptionBool("dailyBackupEnabled");
    const [weeklyBackupEnabled, setWeeklyBackupEnabled] = useTriliumOptionBool("weeklyBackupEnabled");
    const [monthlyBackupEnabled, setMonthlyBackupEnabled] = useTriliumOptionBool("monthlyBackupEnabled");

    return (
        <OptionsSection
            title={t("backup.automatic_backups_title")}
            description={t("backup.automatic_backups_description")}
        >
            <OptionsRowWithToggle
                name="daily-backup-enabled"
                label={t("backup.enable_daily_backup")}
                currentValue={dailyBackupEnabled}
                onChange={setDailyBackupEnabled}
            />

            <OptionsRowWithToggle
                name="weekly-backup-enabled"
                label={t("backup.enable_weekly_backup")}
                currentValue={weeklyBackupEnabled}
                onChange={setWeeklyBackupEnabled}
            />

            <OptionsRowWithToggle
                name="monthly-backup-enabled"
                label={t("backup.enable_monthly_backup")}
                currentValue={monthlyBackupEnabled}
                onChange={setMonthlyBackupEnabled}
            />
        </OptionsSection>
    );
}

/**
 * Where the backups go. The location can only be moved on the desktop application, which is the only
 * one with a directory picker to offer; a server is pointed elsewhere through `TRILIUM_BACKUP_DIR`.
 */
export function BackupLocation({ backupFolderPath, refreshCallback }: { backupFolderPath: string; refreshCallback: () => void }) {
    const [customDir, setCustomDir] = useTriliumOption("customDbBackupDir");
    const canSelect = isElectron();

    async function selectLocation() {
        const result = await window.electronApi?.dialog.pickDirectory({ defaultPath: backupFolderPath });
        if (result?.status !== "selected" || !result.path) {
            return;
        }

        await setCustomDir(result.path);
        refreshCallback();
    }

    async function resetToDefault() {
        if (!await dialogService.confirm(t("backup.reset_location_confirmation"))) {
            return;
        }

        await setCustomDir("");
        refreshCallback();
    }

    return (
        <div className="options-section backup-location">
            <Card heading={t("backup.location_title")}>
                <CardSection>
                    <Icon icon="bx bx-folder" className="backup-location-icon" />

                    <div className="backup-location-label">{t("backup.saved_in")}</div>
                    <div className="backup-location-path"><DirectoryLink directory={backupFolderPath} /></div>

                    <div className="backup-location-actions">
                        <Button
                            name="select-backup-location-button"
                            text={t("backup.select_location")}
                            size="micro"
                            disabled={!canSelect}
                            disabledTooltip={t("backup.select_location_desktop_only")}
                            onClick={selectLocation}
                        />

                        {customDir && (
                            <Button
                                name="reset-backup-location-button"
                                text={t("backup.reset_location")}
                                size="micro"
                                onClick={resetToDefault}
                            />
                        )}
                    </div>
                </CardSection>
            </Card>
        </div>
    );
}

/**
 * What a backup is written as: a plain database copy, or a backup container that is compressed,
 * encrypted, or both.
 *
 * Encryption hangs off a passphrase the OS keyring holds, so the controls follow what that keyring
 * can do. Without one there is nowhere safe to keep the passphrase, and an unattended backup cannot
 * ask for it, so the whole feature is unavailable rather than half-working.
 */
export function BackupOptions() {
    const [compressionEnabled, setCompressionEnabled] = useTriliumOptionBool("backupEnableCompression");
    const [encryptionEnabled, setEncryptionEnabled] = useTriliumOptionBool("backupEnableEncryption");
    const [passphrase, setPassphrase] = useState<BackupPassphraseStatus>({ available: false, set: false });
    const [passwordModalShown, setPasswordModalShown] = useState(false);

    const refreshPassphrase = useCallback(async () => {
        const status = await window.electronApi?.backupPassphrase.getStatus();
        if (status) {
            setPassphrase(status);
        }
    }, []);

    useEffect(() => { refreshPassphrase(); }, [refreshPassphrase]);

    async function storePassword(password: string) {
        if (!await window.electronApi?.backupPassphrase.set(password)) {
            toast.showError(t("backup.password_not_stored"));
            return;
        }

        await refreshPassphrase();
        await setEncryptionEnabled(true);
        setPasswordModalShown(false);
        toast.showMessage(t("backup.password_stored"));
    }

    // Switching encryption off forgets the passphrase with it: there is nothing left to keep it for,
    // and leaving it behind would mean a passphrase nobody remembers setting. Backups already written
    // keep the one they were written with.
    async function disableEncryption() {
        await window.electronApi?.backupPassphrase.clear();
        await setEncryptionEnabled(false);
        await refreshPassphrase();
    }

    return (
        <div className="options-section backup-options">
            <Card heading={t("backup.options_title")}>
                <CardSection className="backup-options-row">
                    <span className="backup-options-label">
                        {t("backup.enable_compression")}
                        <small className="backup-options-description">{t("backup.enable_compression_description")}</small>
                    </span>

                    <FormToggle currentValue={compressionEnabled} onChange={setCompressionEnabled} />
                </CardSection>

                <CardSection className="backup-options-row">
                    <span className="backup-options-label">
                        {t("backup.enable_encryption")}
                        <small className="backup-options-description">
                            {passphrase.available ? t("backup.enable_encryption_description") : t("backup.no_keyring")}
                        </small>
                    </span>

                    {passphrase.set ? (
                        <>
                            <Button
                                name="change-backup-password-button"
                                text={t("backup.change_password")}
                                size="micro"
                                onClick={() => setPasswordModalShown(true)}
                            />
                            <FormToggle
                                currentValue={encryptionEnabled}
                                onChange={(enabled) => enabled ? setEncryptionEnabled(true) : disableEncryption()}
                            />
                        </>
                    ) : (
                        <Button
                            name="turn-on-backup-encryption-button"
                            text={t("backup.turn_on_encryption")}
                            size="micro"
                            disabled={!passphrase.available}
                            onClick={() => setPasswordModalShown(true)}
                        />
                    )}
                </CardSection>
            </Card>

            <BackupPasswordModal
                show={passwordModalShown}
                onHidden={() => setPasswordModalShown(false)}
                onSave={storePassword}
            />
        </div>
    );
}

/** Asks for a backup password twice over, for setting the first one or replacing the one in place. */
function BackupPasswordModal({ show, onHidden, onSave }: { show: boolean; onHidden: () => void; onSave: (password: string) => void }) {
    const [password, setPassword] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <Modal
            className="backup-password-modal"
            title={t("backup.password_modal_title")}
            size="sm"
            // Options can themselves be a dialog; without this, showing here closes the one behind.
            stackable
            show={show}
            onShown={() => inputRef.current?.focus()}
            onHidden={onHidden}
            onSubmit={() => password && onSave(password)}
            footer={<Button text={t("backup.save_password")} kind="primary" disabled={!password} />}
        >
            <FormText>{t("backup.password_modal_description")}</FormText>

            <FormPasswordWithConfirmation inputRef={inputRef} onChange={setPassword} />
        </Modal>
    );
}

export function BackupList({ backups, backupFolderPath, refreshCallback }: { backups: DatabaseBackup[]; backupFolderPath: string | null; refreshCallback: () => void }) {
    const [backupInProgress, setBackupInProgress] = useState(false);
    const [customDir] = useTriliumOption("customDbBackupDir");

    // With a custom location in use the list also carries whatever stayed in — or was redirected to —
    // the default one, and a row shows only a file name, so those need telling apart.
    const fileBadge = useCallback((file: DatabaseFile) => (
        customDir && backupFolderPath && !isInsideDirectory(backupFolderPath, file.filePath)
            ? t("backup.default_location")
            : undefined
    ), [customDir, backupFolderPath]);

    return (
        // Where the backups live is stated by the "Backup location" card above, not repeated here.
        <DatabaseFileList
            title={t("backup.existing_backups")}
            files={backups}
            fileBadge={fileBadge}
            downloadEndpoint="api/database/backup/download"
            rowName="existing-backup"
            downloadText={t("backup.download")}
            emptyIcon="bx bx-archive"
            emptyText={t("backup.no_backup_yet")}
        >
            <OptionsRow name="backup-now" centered>
                <Button
                    name="backup-database-now-button"
                    text={t("backup.backup_database_now")}
                    size="micro"
                    disabled={backupInProgress}
                    onClick={async () => {
                        setBackupInProgress(true);
                        try {
                            const { backupFile } = await server.post<BackupDatabaseNowResponse>("database/backup-database");
                            toast.showMessage(t("backup.database_backed_up_to", { backupFilePath: backupFile }), 10000);
                            refreshCallback();
                        } finally {
                            setBackupInProgress(false);
                        }
                    }}
                />
            </OptionsRow>
        </DatabaseFileList>
    );
}

/** Both paths come already resolved from the server, so a prefix test settles containment on either platform. */
function isInsideDirectory(directory: string, filePath: string) {
    const rest = filePath.slice(directory.length);

    return filePath.startsWith(directory) && (rest.startsWith("/") || rest.startsWith("\\"));
}
