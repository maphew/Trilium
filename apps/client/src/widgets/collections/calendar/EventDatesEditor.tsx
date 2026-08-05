import "./EventDatesEditor.css";

import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import LabelValueInput from "../../attribute_widgets/label_value_input";
import FormCheckbox from "../../react/FormCheckbox";
import { useNoteLabel, useUniqueName } from "../../react/hooks";
import { EventField, EventFieldControls } from "./EventField";

/**
 * Edits when the event happens, through the date and time labels the calendar draws it by (see
 * event_builder.ts). Two shapes, told apart by the all-day switch: a whole-day event is a span of
 * days — a start date and, where it runs longer, an end date — while a timed one is a single day
 * and the hours within it. Rendered as {@link EventField} rows, standing in the dock's field column
 * beside the recurrence.
 *
 * Only the stock label names, as the dock reads only those (see EVENT_LABELS in DetailDock.tsx).
 */
export default function EventDatesEditor({ note }: { note: FNote }) {
    const [ startDate, setStartDate ] = useNoteLabel(note, "startDate");
    const [ endDate, setEndDate ] = useNoteLabel(note, "endDate");
    const [ startTime, setStartTime ] = useNoteLabel(note, "startTime");
    const [ endTime, setEndTime ] = useNoteLabel(note, "endTime");
    const startDateId = useUniqueName("event-start-date");
    const endDateId = useUniqueName("event-end-date");

    // All day is the absence of a start time, which is how the event builder reads it too. Held
    // locally so the switch answers the press at once — the labels the press writes come back only
    // with the server's echo — and follows the note's own state wherever it changes from.
    const storedAllDay = !startTime;
    const [ allDay, setAllDay ] = useState(storedAllDay);
    useEffect(() => setAllDay(storedAllDay), [ storedAllDay ]);

    const toggleAllDay = (on: boolean) => {
        setAllDay(on);
        if (on) {
            // A whole day has no hours; the dates stay as they were.
            setStartTime(null);
            setEndTime(null);
        } else {
            // A timed event is said within one day, so a span of days is let go rather than kept
            // where the fields no longer show it. The hours are a foothold to edit, not a guess.
            setStartTime(DEFAULT_START_TIME);
            setEndTime(endTime ?? DEFAULT_END_TIME);
            setEndDate(null);
        }
    };

    return (
        <>
            <FormCheckbox
                label={t("calendar.dates.all_day")}
                currentValue={allDay}
                onChange={toggleAllDay}
            />

            <EventField name={t("calendar.dates.start_date")} htmlFor={startDateId}>
                <LabelValueInput
                    labelType="date"
                    value={startDate ?? ""}
                    commitOn="blur"
                    // Never emptied: without a start date the note stops being an event at all, and
                    // the dock is no place to do that by accident. The field snaps back instead.
                    onCommit={(value) => value && setStartDate(value)}
                    inputProps={{ id: startDateId, className: "form-control" }}
                />
            </EventField>

            {allDay ? (
                <EventField name={t("calendar.dates.end_date")} htmlFor={endDateId}>
                    <LabelValueInput
                        labelType="date"
                        value={endDate ?? ""}
                        commitOn="blur"
                        // Emptied, the event is a single day: the label goes rather than staying
                        // blank, which is how the builder reads a day-long event.
                        onCommit={(value) => setEndDate(value || null)}
                        inputProps={{ id: endDateId, className: "form-control" }}
                    />
                </EventField>
            ) : (
                <EventField name={t("calendar.dates.time")}>
                    <EventFieldControls className="calendar-event-time-range">
                        <LabelValueInput
                            labelType="time"
                            value={startTime ?? ""}
                            commitOn="blur"
                            // Never emptied either: a timed event without a start time is the
                            // all-day shape, and the switch above is the way to say that.
                            onCommit={(value) => value && setStartTime(value)}
                            inputProps={{ className: "form-control", "aria-label": t("calendar.dates.start_time") }}
                        />
                        <span className="calendar-event-time-range-separator" aria-hidden="true">–</span>
                        <LabelValueInput
                            labelType="time"
                            value={endTime ?? ""}
                            commitOn="blur"
                            onCommit={(value) => value && setEndTime(value)}
                            inputProps={{ className: "form-control", "aria-label": t("calendar.dates.end_time") }}
                        />
                    </EventFieldControls>
                </EventField>
            )}
        </>
    );
}

/** The hours a day gets when it stops being whole: a meeting-sized block in mid-morning, put there
 *  to be edited rather than kept. An end time the note already had (a half-said timed event) is
 *  honoured instead. */
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "10:00";
