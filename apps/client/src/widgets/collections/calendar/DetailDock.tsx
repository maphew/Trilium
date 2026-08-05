import "./DetailDock.css";

import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { announceEmbeddedNoteClosing, EmbeddedNoteActions, EmbeddedNoteScope, NoteColorAction, OpenNoteActions, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import FormTextBox from "../../react/FormTextBox";
import { useLegacyComponentElement, useNote } from "../../react/hooks";
import { removeFromCalendar } from "./api";
import EventDatesEditor from "./EventDatesEditor";
import { EventFieldList } from "./EventField";
import RecurrenceEditor from "./RecurrenceEditor";

/**
 * The labels the dock already speaks for, so their fields are not repeated in the promoted grid:
 * the dates the calendar draws the event by, and the recurrence the dock's own field edits.
 * Only the stock names for now; a calendar naming its own (`calendar:startDate`) still shows those.
 */
const EVENT_LABELS = [ "startDate", "endDate", "startTime", "endTime", "recurrence" ];

/**
 * An event still being decided on: the range the reader dragged out, standing for a note that does
 * not exist yet. Nothing is created until the draft is committed (see {@link DraftForm}), so a
 * ghost dismissed costs nothing — no note to clean up, no tombstone in the sync history.
 */
export interface EventDraft {
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
}

/**
 * Which event the dock stands for, and why it came to be selected: the note of a chip clicked, or
 * a range just dragged out whose note is yet to be (see {@link EventDraft}).
 *
 * Owned by the calendar view rather than by the dock, because a click on a chip is not the only
 * way in, and state the dock kept to itself could not be set from the code that hands drafts over.
 */
export type DockSelection =
    | { noteId: string }
    | { draft: EventDraft };

/**
 * A pane docked at the trailing edge of the calendar, holding the note of the selected event — the
 * calendar reflowing beside it as it comes and goes — or, for a draft, the ghost form the event is
 * decided in (see {@link DraftForm}).
 */
export default function DetailDock({ selection, parentNote, isEditable, onCommitDraft, onClose }: {
    /** The event the dock stands for, or `null` for a dock that is closed. See {@link DockSelection}. */
    selection: DockSelection | null;
    /** The calendar's own note, which is how the tree is told what the calendar holds a note by. */
    parentNote: FNote;
    /** The calendar may not be edited, which leaves the dock the ways of opening a note and no
     *  more — a calendar root's day notes are not events to be recoloured or taken off it. */
    isEditable: boolean;
    /** Asks for the standing draft to become a note, under the given title — or, given a blank
     *  one, under whatever name the calendar's own titleTemplate writes. */
    onCommitDraft(title: string): void;
    onClose(): void;
}) {
    const draft = selection && "draft" in selection ? selection.draft : null;
    const note = useNote(selection && "noteId" in selection ? selection.noteId : undefined);
    // Held through the closing slide, so the dock empties only once it is out of sight.
    const [ shownNote, setShownNote ] = useState<FNote>();
    const [ shownDraft, setShownDraft ] = useState<EventDraft>();
    const open = !!note || !!draft;
    // The note keeps the pane until its closing has been announced (the effect below), so the
    // editors are still mounted when the announcement is raised — whether the pane is sliding
    // shut or a draft is taking it over.
    const contentNote = note ?? shownNote;
    const contentDraft = draft ?? (open ? undefined : shownDraft);
    const { noteContext, component: dockComponent } = useEmbeddedNoteContext(contentNote, DOCK_NTX_ID);

    useEffect(() => {
        if (note) setShownNote(note);
    }, [ note ]);

    useEffect(() => {
        if (draft) {
            setShownDraft(draft);
        } else if (note) {
            // Committed into the note the dock now holds, or moved on from: the form goes at once.
            setShownDraft(undefined);
        }
    }, [ draft, note ]);

    // The editors save through the note context's removal announcement, raised while they are
    // still mounted: a closing dock keeps them up through the slide, and a draft taking the pane
    // over lets them go only here, once the announcement is out.
    useEffect(() => {
        if (note || !shownNote) return;

        void announceEmbeddedNoteClosing(dockComponent, DOCK_NTX_ID);
        if (draft) setShownNote(undefined);
    }, [ note, draft, shownNote, dockComponent ]);

    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ open, onClose ]);

    return (
        <div
            className={clsx("calendar-detail-dock", open && "open")}
            onTransitionEnd={(e) => {
                if (!open && e.propertyName === "width") {
                    setShownNote(undefined);
                    setShownDraft(undefined);
                }
            }}
        >
            {contentNote ? (
                <EmbeddedNoteScope component={dockComponent} noteContext={noteContext}>
                    <DockContent note={contentNote} parentNote={parentNote} isEditable={isEditable} onClose={onClose} />
                </EmbeddedNoteScope>
            ) : contentDraft ? (
                <DraftForm draft={contentDraft} onCommit={onCommitDraft} onCancel={onClose} />
            ) : null}
        </div>
    );
}

/** The dock's own ntxId, as the geo pane and the quick editor have one of their own. */
const DOCK_NTX_ID = "_calendar-detail-dock";

/** The dock's contents, reading the note out of the context the dock provides. */
function DockContent({ note, parentNote, isEditable, onClose }: {
    note: FNote;
    parentNote: FNote;
    isEditable: boolean;
    onClose(): void;
}) {
    // The dock stands for its component in the DOM, which is how the text editor finds its host —
    // without this it resolves the widget enclosing the calendar instead (see the geo pane).
    const innerRef = useRef<HTMLDivElement>(null);
    useLegacyComponentElement(innerRef);

    return (
        <div className="calendar-detail-dock-inner" ref={innerRef}>
            <div className="calendar-detail-dock-header">
                <TitleRow compact />
                <ActionButton
                    className="calendar-detail-dock-close"
                    icon="bx bx-x"
                    text={t("calendar.close_details")}
                    onClick={onClose}
                />
            </div>

            <div className="calendar-detail-dock-body tn-embedded-note-pane">
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
                            // something was done: unlike the geo pane, the dock has no effect
                            // watching the note leave the calendar — a removed event is still a
                            // note of the collection.
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
 * The dock's ghost face: the form an event is decided in before its note exists. It asks for the
 * one thing the drag did not say — the name — and writes out the one thing it did; everything else
 * an event can hold waits for the note, one commit away. Dismissed — Escape, the close button, a
 * click that selects something else — the draft simply evaporates: nothing was created.
 *
 * Committing with the title blank is allowed and meaningful: the note is then named by the
 * calendar's own `#titleTemplate` where one is set (see getNewNoteTitle in trilium-core), which
 * the old title prompt used to override with whatever stood in its box.
 */
function DraftForm({ draft, onCommit, onCancel }: {
    draft: EventDraft;
    onCommit(title: string): void;
    onCancel(): void;
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

    return (
        <div className="calendar-detail-dock-inner calendar-detail-dock-draft">
            <div className="calendar-detail-dock-header">
                <span className="calendar-detail-dock-draft-heading">{t("calendar_view.new_event")}</span>
                <ActionButton
                    className="calendar-detail-dock-close"
                    icon="bx bx-x"
                    text={t("calendar.close_details")}
                    onClick={onCancel}
                />
            </div>

            <div className="calendar-detail-dock-body calendar-detail-dock-draft-body">
                <FormTextBox
                    autoFocus
                    currentValue={title}
                    placeholder={t("calendar_view.draft_title_placeholder")}
                    onChange={setTitle}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                    }}
                />

                <div className="calendar-detail-dock-draft-when">
                    <span className="bx bx-calendar" />
                    {describeDraft(draft)}
                </div>

                <div className="calendar-detail-dock-draft-actions">
                    <Button
                        kind="primary"
                        text={t("calendar_view.create_event")}
                        disabled={committing}
                        onClick={commit}
                    />
                </div>
            </div>
        </div>
    );
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

    const spansDays = !!endDate && endDate !== startDate;

    if (startTime) {
        return spansDays
            ? `${date(startDate)}, ${startTime} – ${date(endDate ?? startDate)}, ${endTime ?? ""}`
            : `${date(startDate)}, ${startTime}${endTime ? ` – ${endTime}` : ""}`;
    }

    return spansDays ? `${date(startDate)} – ${date(endDate ?? startDate)}` : date(startDate);
}
