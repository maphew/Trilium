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
 * A pane docked at the trailing edge of the calendar, holding the note of the selected event — the
 * calendar reflowing beside it as it comes and goes.
 */
export default function DetailDock({ noteId, parentNote, isEditable, onClose }: {
    /** The note of the selected event, or `null` for a dock that is closed. */
    noteId: string | null;
    /** The calendar's own note, which is how the tree is told what the calendar holds a note by. */
    parentNote: FNote;
    /** The calendar may not be edited, which leaves the dock the ways of opening a note and no
     *  more — a calendar root's day notes are not events to be recoloured or taken off it. */
    isEditable: boolean;
    onClose(): void;
}) {
    const note = useNote(noteId ?? undefined);
    // Held through the closing slide, so the dock empties only once it is out of sight.
    const [ shownNote, setShownNote ] = useState<FNote>();
    const open = !!note;
    const contentNote = note ?? shownNote;
    const { noteContext, component: dockComponent } = useEmbeddedNoteContext(contentNote, DOCK_NTX_ID);

    useEffect(() => {
        if (note) setShownNote(note);
    }, [ note ]);

    // Closing announces the note context's removal, which is what the editors save on — the content
    // is still mounted through the slide, so the event still finds them.
    useEffect(() => {
        if (!open && shownNote) {
            void announceEmbeddedNoteClosing(dockComponent, DOCK_NTX_ID);
        }
    }, [ open ]);

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
                if (!open && e.propertyName === "width") setShownNote(undefined);
            }}
        >
            {contentNote && (
                <EmbeddedNoteScope component={dockComponent} noteContext={noteContext}>
                    <DockContent note={contentNote} parentNote={parentNote} isEditable={isEditable} onClose={onClose} />
                </EmbeddedNoteScope>
            )}
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
                        <EventDatesEditor note={note} />
                        <RecurrenceEditor note={note} />
                    </EventFieldList>
                )}

                <PromotedAttributes omit={EVENT_LABELS} />
                <NoteDetail />
            </div>
        </div>
    );
}
