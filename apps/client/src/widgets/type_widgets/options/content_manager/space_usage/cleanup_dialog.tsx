import "./cleanup_dialog.css";

import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import dialogService from "../../../../../services/dialog";
import { t } from "../../../../../services/i18n";
import toast from "../../../../../services/toast";
import { formatSize, isStandalone } from "../../../../../services/utils";
import Button from "../../../../react/Button";
import { Card, CardSection } from "../../../../react/Card";
import DonutChart, { type DonutRing } from "../../../../react/charts/DonutChart";
import FormTextBox from "../../../../react/FormTextBox";
import FormToggle from "../../../../react/FormToggle";
import { useTriliumOptionJson } from "../../../../react/hooks";
import Modal from "../../../../react/Modal";
import {
    CLEANUP_ITEMS,
    type CleanupPhase,
    type CleanupToolOptions,
    computeCleanupSizes,
    hasWorkToDo,
    measureCompactionEstimate,
    readCleanupOptions,
    runCleanup
} from "./cleanup_operation";
import { useSpaceUsageFetch } from "./use_space_usage_fetch";

/**
 * Opens the cleanup dialog, and resolves once it has finished with the database: the bytes the run
 * was expected to reclaim, or `null` if the user backed out without running one. Callers await it to
 * know when their own figures are stale.
 *
 * Mounted on demand into a host of its own rather than kept in the page: the dialog measures the
 * whole database on open, which is not work to do for a page that merely *could* open it.
 */
export function showCleanupDialog(): Promise<number | null> {
    return new Promise((resolve) => {
        const host = document.body.appendChild(document.createElement("div"));

        render(
            <CleanupDialog onFinished={(reclaimed) => {
                resolve(reclaimed);
                render(null, host);
                host.remove();
            }} />,
            host
        );
    });
}

/**
 * What the cleanup can erase, picked item by item, with the space each would free drawn as one ring.
 *
 * The ring stands for everything reclaimable rather than for the current selection: every item keeps
 * its arc whether or not it is picked, unpicked ones drawn muted, so toggling one re-colors the
 * chart instead of re-laying it out — and the hole can read "this much of that much" against a whole
 * that holds still.
 */
function CleanupDialog({ onFinished }: { onFinished: (reclaimed: number | null) => void }) {
    const [ shown, setShown ] = useState(true);
    const [ stored, setStored ] = useTriliumOptionJson<Partial<CleanupToolOptions>>("cleanupToolOptions");
    // The stored setting seeds the working copy; every change writes straight back to it, so the
    // next run opens where this one left off whether or not it was carried through.
    const [ options, setOptions ] = useState<CleanupToolOptions>(() => readCleanupOptions(stored));
    const update = (patch: Partial<CleanupToolOptions>) => {
        const next = { ...options, ...patch };
        setOptions(next);
        void setStored(next);
    };

    // Measured with the history erased outright: the whole the reading is "of", and fixed for as
    // long as the dialog is open, since no setting here can reclaim more than that.
    const everything = useSpaceUsageFetch<SpaceUsageNoteResponse>(`${ROOT_USAGE_URL}?snapshotsToKeep=0`);
    // Measured as the settings would trim it. The retention trails the field being typed in, so a
    // number entered digit by digit costs one measurement rather than one per keystroke.
    const settledSnapshotsToKeep = useDebouncedValue(options.snapshotsToKeep, ESTIMATE_DEBOUNCE_MS);
    const trimmed = useSpaceUsageFetch<SpaceUsageNoteResponse>(
        `${ROOT_USAGE_URL}?snapshotsToKeep=${settledSnapshotsToKeep}&keepNamedSnapshots=${options.keepNamedSnapshots}`);

    // What a rebuild would return, read once on open: only erasures move it, and none run while the
    // dialog is up. Absent in the build that cannot rebuild at all.
    const [ compaction, setCompaction ] = useState(0);
    useEffect(() => {
        if (!isStandalone) {
            void measureCompactionEstimate().then(setCompaction).catch(() => setCompaction(0));
        }
    }, []);

    const sizes = computeCleanupSizes(everything.data, trimmed.data, options, compaction);
    const measuring = everything.loading || trimmed.loading;
    // Nothing picked, or nothing to gain from what is: either way the run would be a no-op, and a
    // button that erases without recourse must not be offered for one.
    const nothingToDo = measuring || !hasWorkToDo(options, sizes.selected);

    const ring: DonutRing = useMemo(() => ({
        id: "cleanup",
        radius: DONUT_RADIUS,
        thickness: DONUT_THICKNESS,
        // A database with nothing to reclaim draws no segment at all; the track is what keeps the
        // reading in its hole from floating in an empty square.
        track: true,
        segments: [
            ...CLEANUP_ITEMS.map((item) => ({
                id: item.id,
                value: sizes.perItem[item.id],
                className: clsx(`cleanup-segment-${item.id}`, !options[item.id] && "cleanup-segment-unpicked"),
                tooltip: t(item.labelKey)
            })),
            // The free pages a rebuild would return stand for space as surely as the content above
            // does, so they take an arc of their own — which is what lets the row's swatch beside
            // them be read as naming one.
            ...(isStandalone ? [] : [ {
                id: "compactDatabase",
                value: sizes.compaction,
                className: clsx("cleanup-segment-compactDatabase",
                    !options.compactDatabase && "cleanup-segment-unpicked"),
                tooltip: t("space_usage.cleanup_compact_database")
            } ])
        ]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [ sizes.perItem.deletedEntities, sizes.perItem.unusedAttachments, sizes.perItem.revisionSnapshots,
        sizes.compaction, options.deletedEntities, options.unusedAttachments, options.revisionSnapshots,
        options.compactDatabase ]);

    // What the run was asked to do, held across the close: the operation starts once the dialog is
    // out of the way, by which time the state it was configured from is on its way out too.
    const pending = useRef<{ options: CleanupToolOptions, reclaimed: number } | null>(null);

    async function confirmAndClose() {
        if (!await dialogService.confirm(t("space_usage.cleanup_confirm"))) {
            return;
        }

        pending.current = { options, reclaimed: sizes.selected };
        setShown(false);
    }

    async function runPendingCleanup() {
        const work = pending.current;

        if (!work) {
            onFinished(null);
            return;
        }

        // What the estimate promised, standing in only if the run fails before it can be weighed.
        let reclaimed = work.reclaimed;

        try {
            reclaimed = await runCleanup(work.options, showCleanupProgress);
            toast.showMessage(t("space_usage.cleanup_done", { size: formatSize(reclaimed) }));
        } finally {
            toast.closePersistent(CLEANUP_TOAST_ID);
            // Settled either way: a run that failed part-way still changed the database, so whatever
            // was watching has to re-measure rather than keep the figures from before it. The
            // failure itself is already reported by the request layer.
            onFinished(reclaimed);
        }
    }

    return (
        <Modal
            className="space-usage-cleanup-dialog"
            title={t("space_usage.cleanup_title")}
            size="sm"
            minWidth={CLEANUP_DIALOG_MIN_WIDTH}
            show={shown}
            onHidden={() => void runPendingCleanup()}
            footer={<>
                <Button text={t("space_usage.cleanup_cancel")} onClick={() => setShown(false)} />
                <Button
                    text={t("space_usage.cleanup_clean")}
                    kind="primary"
                    disabled={nothingToDo}
                    onClick={() => void confirmAndClose()}
                />
            </>}
            stackable
        >
            <div className="cleanup-chart">
                <DonutChart rings={[ ring ]}>
                    <div className="cleanup-chart-center">
                        <span className="cleanup-chart-caption">{t("space_usage.cleanup_estimated")}</span>
                        <span className="cleanup-chart-amount">{formatSize(sizes.selected)}</span>
                        <div className="cleanup-chart-rule" aria-hidden="true" />
                        <span className="cleanup-chart-total">
                            {t("space_usage.cleanup_amount_of", { total: formatSize(sizes.total) })}
                        </span>
                    </div>
                </DonutChart>
            </div>

            <Card className="cleanup-items">
                {CLEANUP_ITEMS.map((item) => (
                    <CardSection
                        key={item.id}
                        // The item modifier carries its color, which the swatch and the amount
                        // inside the row are both painted from.
                        className={`cleanup-item cleanup-item-${item.id}`}
                        // Only the revision item has any: they qualify how far its trimming goes, so
                        // they are beside the point until it is actually being run.
                        subSectionsVisible={item.id === "revisionSnapshots" && options.revisionSnapshots}
                        subSections={item.id === "revisionSnapshots" ? [
                            <CardSection key="snapshots-to-keep" className="cleanup-item cleanup-item-nested">
                                <span className="cleanup-item-title">{t("space_usage.cleanup_snapshots_to_keep")}</span>
                                <FormTextBox
                                    className="cleanup-item-number"
                                    type="number"
                                    min={0}
                                    currentValue={String(options.snapshotsToKeep)}
                                    onChange={(value) => update({ snapshotsToKeep: Math.max(parseInt(value, 10) || 0, 0) })}
                                />
                            </CardSection>,
                            <CardSection key="keep-named" className="cleanup-item cleanup-item-nested">
                                <span className="cleanup-item-title">{t("space_usage.cleanup_keep_named")}</span>
                                <FormToggle
                                    currentValue={options.keepNamedSnapshots}
                                    onChange={(value) => update({ keepNamedSnapshots: value })}
                                />
                            </CardSection>
                        ] : undefined}
                    >
                        <span className="cleanup-item-swatch" aria-hidden="true" />
                        <span className="cleanup-item-title">{t(item.labelKey)}</span>
                        <span className="cleanup-item-size">{formatSize(sizes.perItem[item.id])}</span>
                        <FormToggle
                            currentValue={options[item.id]}
                            onChange={(value) => update({ [item.id]: value })}
                        />
                    </CardSection>
                ))}

                {/* Its figure is the pages already free inside the file, which only a rebuild
                    returns — no part of any content figure, and so an arc and a color of its own.
                    Absent where the endpoint is: vacuuming lives in the server build, not in the
                    one that runs the database in-process. */}
                {!isStandalone && (
                    <CardSection className="cleanup-item cleanup-item-compact">
                        <span className="cleanup-item-swatch" aria-hidden="true" />
                        <span className="cleanup-item-title">{t("space_usage.cleanup_compact_database")}</span>
                        <span className="cleanup-item-size">{formatSize(sizes.compaction)}</span>
                        <FormToggle
                            currentValue={options.compactDatabase}
                            onChange={(value) => update({ compactDatabase: value })}
                        />
                    </CardSection>
                )}
            </Card>
        </Modal>
    );
}

/** Both figures come from the root, whose subtree is the whole visible database. */
const ROOT_USAGE_URL = "space-usage/note/root";

/** Shared by every phase of a run, so the message is swapped in place rather than stacked. */
export const CLEANUP_TOAST_ID = "content-manager-cleanup";

/**
 * The app's in-progress toast, the same one printing raises: a spinning icon rather than a bar,
 * since none of this can say how far along it is. Compacting names itself, being the step that can
 * hold the server for minutes with nothing at all to show meanwhile.
 *
 * Raised again per phase rather than replaced — the toast service updates the one already carrying
 * this id, so the message changes in place instead of stacking a second toast beside the first.
 */
function showCleanupProgress(phase: CleanupPhase) {
    toast.showPersistent({
        id: CLEANUP_TOAST_ID,
        icon: "bx bx-loader-circle bx-spin",
        message: t(phase === "compacting" ? "space_usage.cleanup_compacting" : "space_usage.cleanup_running"),
        // Nothing here to cancel: the server carries on whatever the client does, so a close button
        // would read as a stop that stops nothing.
        dismissible: false
    });
}

/**
 * The width the dialog starts at, narrow on purpose: a short list of choices, read top to bottom
 * rather than scanned across. A floor rather than a size — item titles never wrap, so a long one
 * widens the dialog instead of folding onto a second line (see the stylesheet).
 */
const CLEANUP_DIALOG_MIN_WIDTH = "400px";

/**
 * The ring's geometry, in the chart's own viewBox units. The stylesheet sizes the center labels to
 * the hole these leave, so changing either means revisiting `--cleanup-donut-hole` there.
 */
const DONUT_RADIUS = 150;
const DONUT_THICKNESS = 40;

/** Long enough to type a two-digit retention through without measuring the database twice. */
const ESTIMATE_DEBOUNCE_MS = 500;

/** Trails `value` by `delay`, so a field being typed in does not fire a measurement per keystroke. */
function useDebouncedValue<T>(value: T, delay: number): T {
    const [ settled, setSettled ] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(timer);
    }, [ value, delay ]);

    return settled;
}
