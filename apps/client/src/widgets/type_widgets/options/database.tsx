import "./database.css";

import {
    AnonymizedDbResponse,
    DatabaseAnonymizeResponse,
    DatabaseCheckIntegrityResponse,
    DatabaseInfoResponse,
    ExistingAnonymizedDatabasesResponse
} from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import {
    canBootToSetup,
    cancelStartOver,
    isStartOverPending,
    startOver
} from "../../../services/setup_mode";
import toast from "../../../services/toast";
import { formatSize } from "../../../services/utils";
import { formatDateTime } from "../../../utils/formatters";
import Admonition from "../../react/Admonition";
import Button from "../../react/Button";
import { Card, CardOption } from "../../react/Card";
import DirectoryLink from "../../react/DirectoryLink";
import { useFetch } from "../../react/use_fetch";
import DatabaseFileList from "./components/DatabaseFileList";
import OptionsPageHeader from "./components/OptionsPageHeader";

/**
 * What can be done to the knowledge base as a whole, rather than to anything inside it: keeping the
 * database sound, handing a copy of it to someone else with the contents taken out, and replacing
 * it altogether.
 *
 * Starting over comes last, being the only thing in Options that leaves the application.
 */
export default function DatabaseSettings() {
    const startOverState = useStartOver();
    // Compacting is the one action on this page that changes what the card above it states, so the
    // figures are read again once a rebuild has finished rather than left saying what they did.
    const [ infoToken, setInfoToken ] = useState(0);
    const refreshInfo = useCallback(() => setInfoToken((token) => token + 1), []);

    return (
        <>
            <OptionsPageHeader />

            {/* Above the cards rather than under the button that caused it: a request left standing
                is the state of the whole page from here on, and the first thing its owner needs to
                know when they open this page again. */}
            {startOverState.pending && (
                <Admonition type="warning" className="start-over-pending">
                    <p>{t("database.start_over_pending")}</p>

                    <Button
                        name="cancel-start-over-button"
                        text={t("database.start_over_cancel")}
                        size="micro"
                        disabled={startOverState.busy}
                        onClick={() => void startOverState.cancel()}
                    />
                </Admonition>
            )}

            <DatabaseInfo refreshToken={infoToken} />
            <MaintenanceOptions onDatabaseCompacted={refreshInfo} />
            <AnonymizationOptions />
            <StartOverOption state={startOverState} />
        </>
    );
}

/**
 * What the database is, before anything is done to it: where its file is, how far back it goes, how
 * much it holds and how large it has grown.
 *
 * Nothing is shown until the figures arrive, and nothing at all where they cannot be had. A card of
 * empty rows would state no less than a card that is not there, and rather less clearly.
 */
function DatabaseInfo({ refreshToken }: { refreshToken: number }) {
    const { data: info } = useFetch<DatabaseInfoResponse>("database/info", refreshToken);

    if (!info) {
        return null;
    }

    return (
        <div className="options-section database-info">
            <Card heading={t("database.info")}>
                <CardOption label={t("database.info_location")}>
                    {/* The file is named in full, while the link opens the folder holding it: a
                        file manager is what the path is useful in, not the database's own reader. */}
                    <span className="database-info-value">
                        <DirectoryLink directory={info.directoryPath}>{info.filePath}</DirectoryLink>
                    </span>
                </CardOption>

                <CardOption label={t("database.info_created")}>
                    <span className="database-info-value">
                        {formatDateTime(info.utcDateCreated, "long", "none")}
                    </span>
                </CardOption>

                <CardOption label={t("database.info_content")}>
                    <span className="database-info-value">
                        {t("database.info_notes", { count: info.noteCount })}
                        {", "}
                        {t("database.info_attachments", { count: info.attachmentCount })}
                    </span>
                </CardOption>

                <CardOption label={t("database.info_size")}>
                    <span className="database-info-value">{formatSize(info.sizeBytes)}</span>
                </CardOption>
            </Card>
        </div>
    );
}

/** Checks and repairs that act on the database file itself, rather than on what is kept in it. */
function MaintenanceOptions({ onDatabaseCompacted }: { onDatabaseCompacted: () => void }) {
    return (
        <div className="options-section database-maintenance">
            <Card heading={t("database.maintenance")}>
                <CardOption
                    label={t("database_integrity_check.check_integrity_label")}
                    description={t("database_integrity_check.check_integrity_description")}
                >
                    <Button
                        name="check-integrity-button"
                        text={t("database_integrity_check.check_button")}
                        size="micro"
                        onClick={checkIntegrity}
                    />
                </CardOption>

                <CardOption
                    label={t("consistency_checks.find_and_fix_label")}
                    description={t("consistency_checks.find_and_fix_description")}
                >
                    <Button
                        name="fix-consistency-issues-button"
                        text={t("consistency_checks.find_and_fix_button")}
                        size="micro"
                        onClick={fixConsistencyIssues}
                    />
                </CardOption>

                <CardOption
                    label={t("vacuum_database.vacuum_label")}
                    description={t("vacuum_database.vacuum_description")}
                >
                    <Button
                        name="vacuum-database-button"
                        text={t("vacuum_database.button_text")}
                        size="micro"
                        onClick={async () => {
                            await vacuumDatabase();
                            onDatabaseCompacted();
                        }}
                    />
                </CardOption>
            </Card>
        </div>
    );
}

/** Reports back either a clean bill of health, or whatever SQLite found, which is worth reading. */
async function checkIntegrity() {
    toast.showMessage(t("database_integrity_check.checking_integrity"));

    const { results } = await server.get<DatabaseCheckIntegrityResponse>("database/check-integrity");

    if (results.length === 1 && results[0].integrity_check === "ok") {
        toast.showMessage(t("database_integrity_check.integrity_check_succeeded"));
    } else {
        toast.showMessage(t("database_integrity_check.integrity_check_failed", { results: JSON.stringify(results, null, 2) }), 15000);
    }
}

async function fixConsistencyIssues() {
    toast.showMessage(t("consistency_checks.finding_and_fixing_message"));
    await server.post("database/find-and-fix-consistency-issues");
    toast.showMessage(t("consistency_checks.issues_fixed_message"));
}

async function vacuumDatabase() {
    toast.showMessage(t("vacuum_database.vacuuming_database"));
    // A rebuild runs in minutes on a large database — half an hour on 36 GiB — so the default
    // minute would report a failure for something still succeeding.
    await server.postWithTimeout("database/vacuum-database", VACUUM_TIMEOUT_MS);
    toast.showMessage(t("vacuum_database.database_vacuumed"));
}

/** Rebuilding runs in minutes on a large database, and the client must not give up before it ends. */
const VACUUM_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Copies of the database made to be handed out: the contents are taken out, so that what is left
 * says how the knowledge base is put together without saying what is in it.
 *
 * The copies are kept as files beside the database, so the list below the actions is the only place
 * they can be reached from once the toast that announced them is gone.
 */
function AnonymizationOptions() {
    const [databases, setDatabases] = useState<AnonymizedDbResponse[]>([]);
    const [anonymizedFolderPath, setAnonymizedFolderPath] = useState<string | null>(null);
    const [anonymizationInProgress, setAnonymizationInProgress] = useState(false);

    const refreshAnonymizedDatabases = useCallback(() => {
        server.get<ExistingAnonymizedDatabasesResponse>("database/anonymized-databases").then((response) => {
            setDatabases(response.databases);
            setAnonymizedFolderPath(response.anonymizedFolderPath);
        });
    }, []);

    useEffect(refreshAnonymizedDatabases, []);

    async function anonymize(type: "full" | "light") {
        setAnonymizationInProgress(true);
        try {
            toast.showMessage(type === "full"
                ? t("database_anonymization.creating_fully_anonymized_database")
                : t("database_anonymization.creating_lightly_anonymized_database"));
            const resp = await server.post<DatabaseAnonymizeResponse>(`database/anonymize/${type}`);

            if (!resp.success) {
                toast.showError(t("database_anonymization.error_creating_anonymized_database"));
                return;
            }

            toast.showMessage(type === "full"
                ? t("database_anonymization.successfully_created_fully_anonymized_database", { anonymizedFilePath: resp.anonymizedFilePath })
                : t("database_anonymization.successfully_created_lightly_anonymized_database", { anonymizedFilePath: resp.anonymizedFilePath }), 10000);
            refreshAnonymizedDatabases();
        } finally {
            setAnonymizationInProgress(false);
        }
    }

    return (
        <>
            <div className="options-section database-anonymization">
                <Card
                    heading={t("database_anonymization.title")}
                    description={t("database_anonymization.description")}
                >
                    <CardOption
                        label={t("database_anonymization.full_anonymization")}
                        description={t("database_anonymization.full_anonymization_description")}
                    >
                        <Button
                            name="full-anonymization-button"
                            text={t("database_anonymization.save_fully_anonymized_database")}
                            size="micro"
                            disabled={anonymizationInProgress}
                            onClick={() => void anonymize("full")}
                        />
                    </CardOption>

                    <CardOption
                        label={t("database_anonymization.light_anonymization")}
                        description={t("database_anonymization.light_anonymization_description")}
                    >
                        <Button
                            name="light-anonymization-button"
                            text={t("database_anonymization.save_lightly_anonymized_database")}
                            size="micro"
                            disabled={anonymizationInProgress}
                            onClick={() => void anonymize("light")}
                        />
                    </CardOption>
                </Card>
            </div>

            <DatabaseFileList
                title={t("database_anonymization.existing_anonymized_databases")}
                description={anonymizedFolderPath && (
                    <span className="selectable-text">
                        {t("database_anonymization.anonymized_databases_location", {
                            anonymizedFolder: anonymizedFolderPath
                        })}
                    </span>
                )}
                files={databases}
                downloadEndpoint="api/database/anonymized/download"
                downloadText={t("database_anonymization.download")}
                emptyIcon="bx bx-glasses"
                emptyText={t("database_anonymization.no_anonymized_database_yet")}
            />
        </>
    );
}

/** Headingless: the row names the feature itself, and nothing else belongs beside it. */
function StartOverOption({ state }: { state: ReturnType<typeof useStartOver> }) {
    return (
        <div className="options-section start-over">
            <Card>
                <CardOption
                    label={t("database.start_over")}
                    description={t("database.start_over_description")}
                >
                    <Button
                        name="start-over-button"
                        text={t("database.start_over")}
                        icon="bx-reset"
                        size="micro"
                        disabled={state.busy || state.pending}
                        onClick={() => void state.begin()}
                    />
                </CardOption>
            </Card>
        </div>
    );
}

/**
 * Going back to the setup screen, from where the knowledge base can be replaced.
 *
 * Two shapes, decided by whether the instance can restart itself. The desktop and the browser-only
 * build go there and then, so pressing the button is the whole of it. A server is restarted by
 * whoever runs it, so the request outlives the page that made it, and the page has to say that a
 * start-over is waiting and offer to call it off.
 *
 * Held by the page rather than by the row it belongs to, since the notice about a standing request
 * is the state of the whole page and sits at the top of it.
 */
function useStartOver() {
    const [ pending, setPending ] = useState(false);
    const [ busy, setBusy ] = useState(false);

    useEffect(() => {
        // Only ever true where nothing acts on the request until a human restarts the server, which
        // is also the only place the answer is worth waiting for.
        if (canBootToSetup()) {
            return;
        }

        void isStartOverPending().then(setPending).catch(() => {
            // The page still works without knowing; the button is what it is for.
        });
    }, []);

    async function begin() {
        setBusy(true);
        try {
            setPending(await startOver() === "pending");
        } finally {
            setBusy(false);
        }
    }

    async function cancel() {
        setBusy(true);
        try {
            await cancelStartOver();
            setPending(false);
        } finally {
            setBusy(false);
        }
    }

    return { pending, busy, begin, cancel };
}
