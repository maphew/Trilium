import { createPortal } from "preact/compat";

import { t } from "../../../../../services/i18n";
import FormText from "../../../../react/FormText";
import Modal from "../../../../react/Modal";
import { RevisionSettings } from "../../other";

interface RevisionLimitDialogProps {
    show: boolean;
    onHidden: () => void;
}

/**
 * Shown when the revisions cell is asked to erase excess snapshots while no limit is set: it says
 * why nothing would be erased and carries the options page's own Note revisions card, so the limit
 * can be set here and the action retried without leaving Space Usage.
 *
 * The card is the real one rather than a copy of its fields — it saves through the same options
 * hooks, so the setting is live the moment it is entered.
 */
export default function RevisionLimitDialog({ show, onHidden }: RevisionLimitDialogProps) {
    // Portalled to the body: rendered where it stands, the dialog would sit inside the settings
    // dialog's own stacking context and end up under the backdrop Bootstrap appends for it.
    return createPortal(
        <Modal
            className="space-usage-revision-limit-dialog"
            title={t("revisions_snapshot_limit.erase_excess_revision_snapshots")}
            size="md"
            show={show}
            onHidden={onHidden}
            // The settings dialog it is opened from stays where it is, underneath.
            stackable
        >
            <FormText>{t("space_usage.revisions_limit_required")}</FormText>

            <RevisionSettings />
        </Modal>,
        document.body
    );
}
