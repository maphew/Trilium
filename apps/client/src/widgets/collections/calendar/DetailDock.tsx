import "./DetailDock.css";

import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { announceEmbeddedNoteClosing, EmbeddedNoteScope, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useLegacyComponentElement, useNote } from "../../react/hooks";

/**
 * The dates the calendar already draws the event by, so their fields are not repeated in the dock.
 * Only the stock names for now; a calendar naming its own (`calendar:startDate`) still shows those.
 */
const EVENT_DATE_LABELS = [ "startDate", "endDate", "startTime", "endTime" ];

/**
 * A pane docked at the trailing edge of the calendar, holding the note of the selected event — the
 * calendar reflowing beside it as it comes and goes.
 */
export default function DetailDock({ noteId, onClose }: {
    /** The note of the selected event, or `null` for a dock that is closed. */
    noteId: string | null;
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
                    <DockContent onClose={onClose} />
                </EmbeddedNoteScope>
            )}
        </div>
    );
}

/** The dock's own ntxId, as the geo pane and the quick editor have one of their own. */
const DOCK_NTX_ID = "_calendar-detail-dock";

/** The dock's contents, reading the note out of the context the dock provides. */
function DockContent({ onClose }: { onClose(): void }) {
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
                <PromotedAttributes omit={EVENT_DATE_LABELS} />
                <NoteDetail />
            </div>
        </div>
    );
}
