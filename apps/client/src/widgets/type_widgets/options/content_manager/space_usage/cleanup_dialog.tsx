import "./cleanup_dialog.css";

import clsx from "clsx";
import { createPortal } from "preact/compat";
import { useMemo, useState } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import optionService from "../../../../../services/options";
import { formatSize } from "../../../../../services/utils";
import Button from "../../../../react/Button";
import { Card, CardSection } from "../../../../react/Card";
import DonutChart, { type DonutRing } from "../../../../react/charts/DonutChart";
import FormTextBox from "../../../../react/FormTextBox";
import FormToggle from "../../../../react/FormToggle";
import Modal from "../../../../react/Modal";

/** What each of the cleanup's items would reclaim, in bytes. */
export interface CleanupEstimates {
    deletedEntities: number;
    unusedAttachments: number;
    revisionSnapshots: number;
}

export interface CleanupDialogProps {
    show: boolean;
    onHidden: () => void;
    estimates: CleanupEstimates;
}

/**
 * What the cleanup can erase, picked item by item, with the space each would free drawn as one ring.
 *
 * The ring stands for everything reclaimable rather than for the current selection: every item keeps
 * its arc whether or not it is picked, unpicked ones drawn muted, so toggling one re-colors the
 * chart instead of re-laying it out — and the hole can read "this much of that much" against a whole
 * that holds still.
 */
export default function CleanupDialog({ show, onHidden, estimates }: CleanupDialogProps) {
    const [ picked, setPicked ] = useState<Record<CleanupItemId, boolean>>(
        { deletedEntities: true, unusedAttachments: true, revisionSnapshots: true });
    const [ snapshotsToKeep, setSnapshotsToKeep ] = useState(defaultSnapshotsToKeep);
    const [ keepNamedSnapshots, setKeepNamedSnapshots ] = useState(true);

    const ring: DonutRing = useMemo(() => ({
        id: "cleanup",
        radius: DONUT_RADIUS,
        thickness: DONUT_THICKNESS,
        segments: CLEANUP_ITEMS.map((item) => ({
            id: item.id,
            value: estimates[item.id],
            className: clsx(`cleanup-segment-${item.id}`, !picked[item.id] && "cleanup-segment-unpicked"),
            tooltip: t(item.labelKey)
        }))
    }), [ estimates, picked ]);

    const total = CLEANUP_ITEMS.reduce((sum, item) => sum + estimates[item.id], 0);
    const selected = CLEANUP_ITEMS.reduce(
        (sum, item) => sum + (picked[item.id] ? estimates[item.id] : 0), 0);

    return createPortal(
        <Modal
            className="space-usage-cleanup-dialog"
            title={t("space_usage.cleanup_title")}
            size="sm"
            minWidth={CLEANUP_DIALOG_MIN_WIDTH}
            show={show}
            onHidden={onHidden}
            footer={<>
                <Button text={t("space_usage.cleanup_cancel")} onClick={onHidden} />
                <Button text={t("space_usage.cleanup_clean")} kind="primary" />
            </>}
            stackable
        >
            <div className="cleanup-chart">
                <DonutChart rings={[ ring ]}>
                    <div className="cleanup-chart-center">
                        <span className="cleanup-chart-caption">{t("space_usage.cleanup_estimated")}</span>
                        <span className="cleanup-chart-amount">{formatSize(selected)}</span>
                        <div className="cleanup-chart-rule" aria-hidden="true" />
                        <span className="cleanup-chart-total">
                            {t("space_usage.cleanup_amount_of", { total: formatSize(total) })}
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
                        subSectionsVisible={item.id === "revisionSnapshots" && picked.revisionSnapshots}
                        subSections={item.id === "revisionSnapshots" ? [
                            <CardSection key="snapshots-to-keep" className="cleanup-item cleanup-item-nested">
                                <span className="cleanup-item-title">{t("space_usage.cleanup_snapshots_to_keep")}</span>
                                <FormTextBox
                                    className="cleanup-item-number"
                                    type="number"
                                    min={0}
                                    currentValue={String(snapshotsToKeep)}
                                    onChange={(value) => setSnapshotsToKeep(Math.max(parseInt(value, 10) || 0, 0))}
                                />
                            </CardSection>,
                            <CardSection key="keep-named" className="cleanup-item cleanup-item-nested">
                                <span className="cleanup-item-title">{t("space_usage.cleanup_keep_named")}</span>
                                <FormToggle currentValue={keepNamedSnapshots} onChange={setKeepNamedSnapshots} />
                            </CardSection>
                        ] : undefined}
                    >
                        <span className="cleanup-item-swatch" aria-hidden="true" />
                        <span className="cleanup-item-title">{t(item.labelKey)}</span>
                        <span className="cleanup-item-size">{formatSize(estimates[item.id])}</span>
                        <FormToggle
                            currentValue={picked[item.id]}
                            onChange={(value) => setPicked((current) => ({ ...current, [item.id]: value }))}
                        />
                    </CardSection>
                ))}
            </Card>
        </Modal>,
        document.body
    );
}

/** The cleanup's items, in the order they are both listed and drawn. */
const CLEANUP_ITEMS = [
    { id: "deletedEntities", labelKey: "space_usage.cleanup_deleted_entities" },
    { id: "unusedAttachments", labelKey: "space_usage.cleanup_unused_attachments" },
    { id: "revisionSnapshots", labelKey: "space_usage.cleanup_revision_snapshots" }
] as const;

type CleanupItemId = (typeof CLEANUP_ITEMS)[number]["id"];

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


/** Where the field starts when no limit is configured — see {@link defaultSnapshotsToKeep}. */
const FALLBACK_SNAPSHOTS_TO_KEEP = 4;

/**
 * How many snapshots the field offers to keep: whatever the note revision limit is set to, so the
 * cleanup starts out proposing the retention the user already chose. A limit of -1 keeps everything
 * and 0 keeps none — neither is a useful opening offer for a one-off trim, so both fall back to a
 * figure that plainly trims something without gutting the history.
 */
function defaultSnapshotsToKeep(): number {
    const configured = optionService.getInt("revisionSnapshotNumberLimit") ?? -1;

    return configured > 0 ? configured : FALLBACK_SNAPSHOTS_TO_KEEP;
}
