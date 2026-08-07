import "./setup_existing.css";

import type { SetupExistingBackup } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "./services/i18n";
import open from "./services/open";
import server from "./services/server";
import { formatSize, isElectron } from "./services/utils";
import Admonition from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardOption, CardSection } from "./widgets/react/Card";
import FormRadioGroup from "./widgets/react/FormRadioGroup";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";
import SlidePages from "./widgets/react/SlidePages";

/**
 * What happens to the knowledge base that was already here.
 *
 * The wizard is normally the first thing an instance ever shows. When the app asks for it instead,
 * there is a database behind it, and every path onwards from here replaces or erases that database.
 * So this is the first screen, before the menu, and nothing else can be reached until it is answered.
 *
 * Three screens, one question. The choice, the wait while a backup is written, and what was written.
 * Every one of them can be left through Cancel, which puts the instance back the way it was: nothing
 * is touched until the last Continue.
 *
 * @module
 */

/** What the user decided to do with the database that is already here. */
type Choice = "back-up" | "delete";

const CHOICES: { value: Choice; label: string }[] = [
    { value: "back-up", label: "setup.existing-data-back-up" },
    { value: "delete", label: "setup.existing-data-delete" }
];

/** The three screens, in the order they can be reached, which is also the order they slide in. */
type Step = "choice" | "backing-up" | "backed-up";
const STEP_ORDER: Step[] = [ "choice", "backing-up", "backed-up" ];

/**
 * The whole question, as one step of the wizard.
 *
 * Owns its screens the way the restore flow owns its own: the wizard has one state for all of this,
 * and what the user has answered so far lives here rather than being spread through the wizard's own
 * state machine.
 *
 * @param onProceed the database is gone; carry on with the rest of setup.
 * @param onKept nothing was touched; the app is coming back.
 */
export default function ExistingData({ onProceed, onKept }: { onProceed: () => void; onKept: () => void }) {
    const [ step, setStep ] = useState<Step>("choice");
    const [ backup, setBackup ] = useState<SetupExistingBackup | null>(null);
    const [ error, setError ] = useState<string>();
    const [ errorId, setErrorId ] = useState(0);

    function raiseError(message: string) {
        setError(message);
        setErrorId((previous) => previous + 1);
    }

    /** Erases the database and moves on, which is the one irreversible thing these screens do. */
    async function erase() {
        try {
            await deleteExistingData();
            onProceed();
        } catch (e) {
            setStep("choice");
            raiseError(messageOf(e) ?? t("setup.existing-data-delete-failed"));
        }
    }

    async function backUp() {
        setStep("backing-up");

        try {
            setBackup(await backUpExistingData());
            setStep("backed-up");
        } catch (e) {
            // Back to the question with nothing done: there is no continuing past a backup that was
            // asked for and did not happen.
            setStep("choice");
            raiseError(messageOf(e) ?? t("setup.existing-data-backup-failed"));
        }
    }

    async function keep() {
        try {
            await keepExistingData();
            onKept();
        } catch (e) {
            setStep("choice");
            raiseError(messageOf(e) ?? t("setup.existing-data-keep-failed"));
        }
    }

    return (
        <SlidePages current={step} order={STEP_ORDER}>
            {(shown) => (
                <>
                    {shown === "choice" && (
                        <ExistingDataChoice
                            error={error}
                            errorId={errorId}
                            onBackUp={() => void backUp()}
                            onDelete={() => void erase()}
                            onCancel={() => void keep()}
                        />
                    )}
                    {shown === "backing-up" && <ExistingDataBackingUp />}
                    {shown === "backed-up" && backup && (
                        <ExistingDataBackedUp
                            backup={backup}
                            onContinue={() => void erase()}
                            onCancel={() => void keep()}
                        />
                    )}
                </>
            )}
        </SlidePages>
    );
}

/**
 * Whatever the failure has to say for itself.
 *
 * A rejected request is not an `Error`: the client's own layer rejects with the response body as a
 * string, or with a bare word when the browser dropped the request. Taking only `Error` here left
 * every server-side failure showing the generic sentence and nothing else.
 */
function messageOf(e: unknown): string | undefined {
    if (e instanceof Error) {
        return e.message;
    }
    if (typeof e === "string" && e) {
        return messageOfBody(e);
    }
    if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") {
        return e.message;
    }

    return undefined;
}

/** The sentence out of a JSON error body, or the body itself where it is not one. */
function messageOfBody(body: string): string {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null && "message" in parsed
            && typeof parsed.message === "string") {
            return parsed.message;
        }
    } catch {
        // Not JSON, so it is already whatever the server had to say.
    }

    return body;
}

export function ExistingDataChoice({ error, errorId, onBackUp, onDelete, onCancel }: {
    error?: string;
    errorId?: number;
    onBackUp: () => void;
    onDelete: () => void;
    onCancel: () => void;
}) {
    const [ choice, setChoice ] = useState<Choice | null>(null);

    return (
        <SetupPage
            className="existing-data"
            title={t("setup.existing-data")}
            description={t("setup.existing-data-description")}
            illustration={<Icon icon="bx bx-data" className="illustration-icon" />}
            error={error}
            errorId={errorId}
            footer={
                <>
                    <Button text={t("setup.existing-data-cancel")} onClick={onCancel} />
                    <Button
                        text={t("setup.continue")}
                        kind="primary"
                        // Neither is chosen to begin with: one of them erases a knowledge base, and a
                        // default would make that the answer of anyone who pressed on without reading.
                        disabled={choice === null}
                        onClick={() => (choice === "back-up" ? onBackUp() : onDelete())}
                    />
                </>
            }
        >
            <Card className="existing-data-choices">
                {/* A segment each, rather than two rows in one: this is the question the whole screen
                    is for, and one of the answers erases a knowledge base. Which is checked is held
                    here rather than by the browser's own grouping, so the two stay exclusive. */}
                {CHOICES.map(({ value, label }) => (
                    <CardSection key={value}>
                        <FormRadioGroup
                            name="existing-data-choice"
                            currentValue={choice ?? ""}
                            onChange={(chosen) => setChoice(chosen as Choice)}
                            values={[ { value, label: t(label) } ]}
                        />
                    </CardSection>
                ))}
            </Card>

            {choice === "delete" && (
                <Admonition type="caution" className="existing-data-warning">
                    {t("setup.existing-data-delete-warning")}
                </Admonition>
            )}
        </SetupPage>
    );
}

/**
 * The wait while the backup is written, which for a large knowledge base is minutes.
 *
 * Asks how far along it is rather than only spinning: most of that time is spent inside a single
 * write, and a screen that says nothing for six minutes is indistinguishable from one that has
 * stopped. The number is polled because the answer is one number and this is the only thing asking.
 */
export function ExistingDataBackingUp() {
    const [ fraction, setFraction ] = useState<number | null>(null);

    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const { fraction } = await server.get<{ fraction: number | null }>("setup/existing/status");
                setFraction(fraction);
            } catch {
                // The backup is what matters here; a missed reading is worth nothing being said about.
            }
        }, PROGRESS_INTERVAL_MS);

        return () => clearInterval(interval);
    }, []);

    return (
        <SetupPage
            className="existing-data-backing-up top-aligned"
            title={t("setup.existing-data-backing-up")}
            illustration={<Icon icon="bx bx-archive-out" className="illustration-icon" />}
        >
            <div class="existing-data-progress">
                <div class="existing-data-progress-message">
                    {/* The spinner is what stands in for a bar until the writer has said anything.
                        Once the bar is there it has nothing left to add, and two things moving at
                        once only compete. */}
                    {fraction === null && <span class="spinner-border" role="status" aria-hidden="true" />}
                    <span>{t("setup.existing-data-backing-up-message")}</span>
                </div>

                {fraction !== null && (
                    <div class="existing-data-progress-bar">
                        <progress value={fraction} max={1} />
                        <span>{Math.floor(fraction * 100)}%</span>
                    </div>
                )}
            </div>
        </SetupPage>
    );
}

/** How often the screen asks how far along the backup is. */
const PROGRESS_INTERVAL_MS = 1000;

/**
 * What was written, before the database it was written from is erased.
 *
 * The path is shown in full and not abbreviated: a custom backup directory is an option in a
 * database that is about to stop existing, so this may be the last time the user can see where their
 * backup actually went.
 */
export function ExistingDataBackedUp({ backup, onContinue, onCancel }: {
    backup: SetupExistingBackup;
    onContinue: () => void;
    onCancel: () => void;
}) {
    return (
        <SetupPage
            className="existing-data-backed-up top-aligned"
            title={t("setup.existing-data-backed-up")}
            description={t("setup.existing-data-backed-up-description")}
            illustration={<Icon icon="bx bx-check-circle" className="illustration-icon" />}
            footer={
                <>
                    <Button text={t("setup.existing-data-cancel")} onClick={onCancel} />
                    <Button text={t("setup.continue")} kind="primary" onClick={onContinue} />
                </>
            }
        >
            <Card>
                <CardOption label={t("setup.existing-data-file-name")}>
                    <span class="existing-data-file-name">{backup.fileName}</span>
                </CardOption>

                <CardOption label={t("setup.existing-data-file-path")}>
                    <BackupDirectory path={backup.directoryPath} />
                </CardOption>

                <CardOption label={t("setup.existing-data-file-size")}>
                    {formatSize(backup.fileSize)}
                </CardOption>

                <CardSection className="existing-data-actions">
                    <Button
                        text={isElectron() ? t("setup.existing-data-save-as") : t("setup.existing-data-download")}
                        icon="bx bx-download"
                        onClick={() => downloadBackup(backup.filePath)}
                    />
                </CardSection>
            </Card>

            {backup.encrypted && (
                <Admonition type="warning" className="existing-data-warning">
                    {t("setup.existing-data-encrypted-warning")}
                </Admonition>
            )}
        </SetupPage>
    );
}

/**
 * How long the backup is given before the client stops waiting for its answer.
 *
 * The default minute is nothing next to what this takes: a large knowledge base is copied, and
 * compressed and encrypted where the instance is set up for that, which runs into minutes. Giving up
 * early would not stop any of it, only lose the answer and report a failure for something that was
 * still succeeding.
 */
const BACKUP_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Where the backup went, as something the user can act on.
 *
 * The directory rather than the whole path: the file name is on the line above, and what a user
 * wants from this line is to go and look. Only the desktop can open it, so everywhere else it stays
 * a plain, selectable line of text.
 */
function BackupDirectory({ path }: { path: string }) {
    if (!isElectron()) {
        return <span class="existing-data-path">{path}</span>;
    }

    return (
        <a
            class="existing-data-path existing-data-path-link"
            href="#"
            title={t("setup.existing-data-open-folder")}
            onClick={(e) => {
                e.preventDefault();
                void window.electronApi?.shell.openPath(path);
            }}
        >
            {path}
        </a>
    );
}

/** Saves a copy of the backup wherever the user says, through the platform's own download. */
function downloadBackup(filePath: string) {
    open.download(open.getUrlForDownload(
        `api/database/backup/download?filePath=${encodeURIComponent(filePath)}`));
}

/** Backs the existing database up, answering with what was written. */
export function backUpExistingData(): Promise<SetupExistingBackup> {
    return server.postWithTimeout<SetupExistingBackup>("setup/existing/backup", BACKUP_TIMEOUT_MS);
}

/** Erases it, which is the point of no return. */
export function deleteExistingData(): Promise<void> {
    return server.post("setup/existing/delete");
}

/** Leaves it alone and opens it, which is what every Cancel on these screens does. */
export function keepExistingData(): Promise<void> {
    return server.post("setup/existing/keep");
}
