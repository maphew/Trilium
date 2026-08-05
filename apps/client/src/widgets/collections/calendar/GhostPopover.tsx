import "./GhostPopover.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import FormTextBox from "../../react/FormTextBox";
import Popover from "../../react/Popover";
import { AnchorPoint, EventDraft } from "./selection";

/**
 * The ghost: a popover standing beside the dragged-out range, holding the form an event is decided
 * in before its note exists. It asks for the one thing the drag did not say — the name — and writes
 * out the one thing it did; everything else an event can hold waits for the note, one commit away.
 * Dismissed — Escape, the close button, a press anywhere else — the draft simply evaporates:
 * nothing was created.
 *
 * A popover rather than the dock, because a draft is born of a place: the form appears beside the
 * range that called for it instead of at the far edge, and the grid does not reflow under the very
 * range just dragged. The dock takes over at the commit, opening on the note the draft became.
 *
 * Committing with the title blank is allowed and meaningful: the note is then named by the
 * calendar's own `#titleTemplate` where one is set (see getNewNoteTitle in trilium-core), which
 * the old title prompt used to override with whatever stood in its box.
 */
export default function GhostPopover({ draft, anchor, container, onCommit, onCancel, onDismiss }: {
    draft: EventDraft;
    /** Where the drag ended, in viewport coordinates — which of the shading's pieces to stand by,
     *  and the anchor of last resort when the shading cannot be found at all. */
    anchor: AnchorPoint | null;
    /** The calendar the range's shading is read out of (see {@link ghostAnchorRect}). */
    container: HTMLElement | null;
    onCommit(title: string): void;
    /** The draft given up on: Escape, or the close button. */
    onCancel(): void;
    /**
     * The draft pressed away from, which the host answers differently — the press itself decides
     * what becomes of the range's shading, and the ghost is in no position to say (see
     * dismissDraft in index.tsx).
     */
    onDismiss(): void;
}) {
    const [ title, setTitle ] = useState("");
    // Committing is asked for once, however many times Enter falls before the note arrives and
    // the form goes: each ask would make its own note.
    const [ committing, setCommitting ] = useState(false);

    const commit = () => {
        if (committing) return;
        setCommitting(true);
        onCommit(title);
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ onCancel ]);

    return (
        <Popover
            className="calendar-ghost-popover"
            placement={glob.isRtl ? "left-start" : "right-start"}
            getAnchorRect={() => ghostAnchorRect(container, anchor)}
            onDismiss={onDismiss}
        >
            <div className="calendar-ghost-header">
                <span className="calendar-ghost-heading">{t("calendar_view.new_event")}</span>
                <ActionButton
                    icon="bx bx-x"
                    text={t("calendar.close_details")}
                    onClick={onCancel}
                />
            </div>

            <div className="calendar-ghost-body">
                <FormTextBox
                    autoFocus
                    currentValue={title}
                    placeholder={t("calendar_view.draft_title_placeholder")}
                    onChange={setTitle}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                    }}
                />

                <div className="calendar-ghost-when">
                    <span className="bx bx-calendar" />
                    {describeDraft(draft)}
                </div>

                <div className="calendar-ghost-actions">
                    <Button
                        kind="primary"
                        text={t("calendar_view.create_event")}
                        disabled={committing}
                        onClick={commit}
                    />
                </div>
            </div>
        </Popover>
    );
}

/**
 * Where the ghost stands: beside the range's own shading, read back off the grid. FullCalendar
 * draws the selection as one `.fc-highlight` per row it crosses, so the piece under the mouseup is
 * the one pointed at — where the drag ended is where the eye is — falling back to the last piece
 * drawn, and to the bare point where no shading is on the grid at all. Read afresh on every
 * reposition (see Popover), so the ghost follows the shading through scrolls and redraws.
 */
function ghostAnchorRect(container: HTMLElement | null, point: AnchorPoint | null): DOMRect {
    const highlights = container?.querySelectorAll<HTMLElement>(".fc-highlight");

    if (highlights?.length) {
        let pick: HTMLElement | undefined;
        if (point) {
            for (const el of highlights) {
                const r = el.getBoundingClientRect();
                if (r.left <= point.x && point.x <= r.right && r.top <= point.y && point.y <= r.bottom) {
                    pick = el;
                    break;
                }
            }
        }
        return (pick ?? highlights[highlights.length - 1]).getBoundingClientRect();
    }

    return new DOMRect(point?.x ?? 0, point?.y ?? 0, 0, 0);
}

/**
 * When the draft happens, written out for the form: the one thing the drag already decided.
 * Decorative and short-lived — the note's real date fields take over the moment the draft is
 * committed — so the browser's own formatter is enough.
 */
function describeDraft({ startDate, endDate, startTime, endTime }: EventDraft) {
    // Taken apart by hand: `new Date("2026-08-05")` reads as UTC midnight, which is the evening
    // before in half the world's timezones.
    const date = (iso: string) => {
        const [ year, month, day ] = iso.split("-").map(Number);
        return new Date(year, month - 1, day)
            .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    };

    if (startTime) {
        return endDate && endDate !== startDate
            ? `${date(startDate)}, ${startTime} – ${date(endDate)}, ${endTime ?? ""}`
            : `${date(startDate)}, ${startTime}${endTime ? ` – ${endTime}` : ""}`;
    }

    return endDate && endDate !== startDate ? `${date(startDate)} – ${date(endDate)}` : date(startDate);
}
