import "./EventPopover.css";

import { useCallback, useEffect, useRef } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { announceEmbeddedNoteClosing, EmbeddedNoteActions, EmbeddedNoteScope, NoteColorAction, OpenNoteActions, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useLegacyComponentElement, useNote } from "../../react/hooks";
import Popover from "../../react/Popover";
import { removeFromCalendar } from "./api";
import EventDatesEditor from "./EventDatesEditor";
import { EventFieldList } from "./EventField";
import RecurrenceEditor from "./RecurrenceEditor";
import { AnchorPoint } from "./selection";

/**
 * The labels the popover already speaks for, so their fields are not repeated in the promoted grid:
 * the dates the calendar draws the event by, and the recurrence the popover's own field edits.
 * Only the stock names for now; a calendar naming its own (`calendar:startDate`) still shows those.
 */
const EVENT_LABELS = [ "startDate", "endDate", "startTime", "endTime", "recurrence" ];

/**
 * The whole of an event, in a popover standing beside its chip: the note's title, its own fields —
 * when it happens, how it repeats — its promoted attributes and its content, each edited exactly as
 * it is anywhere else (the embedded-note arrangement the geo map's pane makes; see
 * EmbeddedNotePane). Anchored to the chip that was clicked rather than docked at an edge, so the
 * grid never reflows and the event is read where it was found.
 *
 * One popover for the selection rather than one per event: clicking another chip is a note switch
 * within a standing popover — the editors hear it and save — with the surface re-anchoring to the
 * new chip (see the updateKey handed to Popover).
 */
export default function EventPopover({ noteId, anchor, container, parentNote, isEditable, onClose }: {
    noteId: string;
    /** Where the chip was clicked — which of the event's segments to stand by, and the anchor of
     *  last resort when no chip is on the grid at all (a note just committed from a ghost, whose
     *  chip has yet to be drawn). */
    anchor: AnchorPoint | null;
    /** The calendar the chips are read out of (see {@link eventAnchorRect}). */
    container: HTMLElement | null;
    /** The calendar's own note, which is how the tree is told what the calendar holds a note by. */
    parentNote: FNote;
    /** The calendar may not be edited, which leaves the popover the ways of opening a note and no
     *  more — a calendar root's day notes are not events to be recoloured or taken off it. */
    isEditable: boolean;
    onClose(): void;
}) {
    const note = useNote(noteId);
    const { noteContext, component } = useEmbeddedNoteContext(note ?? undefined, POPOVER_NTX_ID);

    /**
     * Lets the popover go, having given whatever is being edited in it the chance to save — the
     * geo pane's bargain (see its closePane): announced first, while the editors are still
     * mounted, and not waited on. Every way out leads through here; the popover closes at once,
     * there being no slide to hold the editors up through.
     */
    const close = useCallback(() => {
        void announceEmbeddedNoteClosing(component, POPOVER_NTX_ID);
        onClose();
    }, [ component, onClose ]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ close ]);

    if (!note) {
        return null;
    }

    return (
        <Popover
            className="calendar-event-popover"
            placement={glob.isRtl ? "left-start" : "right-start"}
            getAnchorRect={() => eventAnchorRect(container, noteId, anchor)}
            updateKey={noteId}
            // A press on another chip is not a dismissal but a switch: the click behind it re-points
            // this popover at that event (see onEventClick), which would otherwise have to tear the
            // popover down on the press and build it again on the click.
            keepOpenSelector=".fc-event"
            onDismiss={close}
        >
            <EmbeddedNoteScope component={component} noteContext={noteContext}>
                <EventDetails note={note} parentNote={parentNote} isEditable={isEditable} onClose={close} />
            </EmbeddedNoteScope>
        </Popover>
    );
}

/** The popover's own ntxId, as the geo pane and the quick editor have one of their own. */
const POPOVER_NTX_ID = "_calendar-event-popover";

/** The popover's contents, reading the note out of the context the popover provides. */
function EventDetails({ note, parentNote, isEditable, onClose }: {
    note: FNote;
    parentNote: FNote;
    isEditable: boolean;
    onClose(): void;
}) {
    // The popover stands for its component in the DOM, which is how the text editor finds its
    // host — without this it resolves the widget enclosing the calendar instead (see the geo pane).
    const innerRef = useRef<HTMLDivElement>(null);
    useLegacyComponentElement(innerRef);

    return (
        <div className="calendar-event-popover-inner" ref={innerRef}>
            <div className="calendar-event-popover-header">
                <TitleRow compact />
                <ActionButton
                    icon="bx bx-x"
                    text={t("calendar.close_details")}
                    onClick={onClose}
                />
            </div>

            <div className="calendar-event-popover-body tn-embedded-note-pane">
                {/* What can be done with the event: the ways of opening its note (see
                    OpenNoteActions), then the ways of changing it — left out rather than disabled
                    where the calendar may not be edited, as the geo pane leaves them out. */}
                <EmbeddedNoteActions>
                    <OpenNoteActions note={note} />

                    {isEditable && <>
                        {/* Named for the chip it dresses, the colour it sets being worn everywhere
                            the note shows (see NoteColorPicker). */}
                        <NoteColorAction note={note} title={t("calendar_view.event_color")} />

                        <ActionButton
                            className="tn-embedded-note-remove"
                            icon="bx bx-trash"
                            text={t("calendar_view.remove_from_calendar")}
                            // Whether the note goes with its event is asked before anything
                            // happens, the two being different wishes. Closed by hand where
                            // something was done: a removed event is still a note of the
                            // collection, so no watcher stands the popover down.
                            onClick={() => void removeFromCalendar(note, parentNote)
                                .then((removed) => removed && onClose())}
                        />
                    </>}
                </EmbeddedNoteActions>

                {/* The event's own fields — when it happens, how it repeats — which are ways of
                    changing it, so they go where the calendar may be edited: a calendar root's day
                    notes are days, and a day neither moves nor recurs. */}
                {isEditable && (
                    <EventFieldList>
                        {/* The repeats field is handed to the dates editor to stand beside its
                            all-day switch, the two being the one line of shape-of-the-event
                            switches (see EventDatesEditor). */}
                        <EventDatesEditor note={note} repeats={<RecurrenceEditor note={note} />} />
                    </EventFieldList>
                )}

                <PromotedAttributes omit={EVENT_LABELS} />
                <NoteDetail />
            </div>
        </div>
    );
}

/**
 * Where the popover stands: beside the event's own chip, read back off the grid by the note id the
 * chips are tagged with (see eventDidMount in index.tsx). An event crossing rows draws a chip per
 * row, so the one under the click is the one pointed at, falling back to the first drawn, and to
 * the bare click point where no chip is on the grid at all. Read afresh on every reposition (see
 * Popover), so the popover follows the chip through scrolls and redraws.
 */
function eventAnchorRect(container: HTMLElement | null, noteId: string, point: AnchorPoint | null): DOMRect {
    const chips = container?.querySelectorAll<HTMLElement>(`.fc-event[data-event-note-id="${CSS.escape(noteId)}"]`);

    if (chips?.length) {
        let pick: HTMLElement | undefined;
        if (point) {
            for (const el of chips) {
                const r = el.getBoundingClientRect();
                if (r.left <= point.x && point.x <= r.right && r.top <= point.y && point.y <= r.bottom) {
                    pick = el;
                    break;
                }
            }
        }
        return (pick ?? chips[0]).getBoundingClientRect();
    }

    return new DOMRect(point?.x ?? 0, point?.y ?? 0, 0, 0);
}
