import "./DetailDock.css";

import clsx from "clsx";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useLegacyComponentElement, useNote } from "../../react/hooks";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";

/**
 * The dates the calendar already draws the event by, so their fields are not repeated in the dock.
 * Only the stock names for now; a calendar naming its own (`calendar:startDate`) still shows those.
 */
const EVENT_DATE_LABELS = [ "startDate", "endDate", "startTime", "endTime" ];

/**
 * A pane docked at the trailing edge of the calendar, holding the note of the selected event — the
 * calendar reflowing beside it as it comes and goes.
 *
 * SPIKE: the note-context plumbing is lifted from the geo map's DetailPane (see usePaneNoteContext
 * there); if this lands, the shared parts should be extracted rather than kept twice.
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
    const { noteContext, dockComponent } = useDockNoteContext(contentNote);

    useEffect(() => {
        if (note) setShownNote(note);
    }, [ note ]);

    // Closing announces the note context's removal, which is what the editors save on — the content
    // is still mounted through the slide, so the event still finds them. Not waited on, as the geo
    // pane does not wait: the save is under way by the time the call returns.
    useEffect(() => {
        if (!open && shownNote) {
            void dockComponent.handleEventInChildren("beforeNoteContextRemove", { ntxIds: [ DOCK_NTX_ID ] });
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
                <ParentComponent.Provider value={dockComponent}>
                    <NoteContextContext.Provider value={noteContext}>
                        <DockContent onClose={onClose} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            )}
        </div>
    );
}

/** The dock's own ntxId, as the geo pane and the quick editor have one of their own. */
const DOCK_NTX_ID = "_calendar-detail-dock";

/**
 * A note context of the dock's own, pointed at whichever event is selected, behind a component of
 * its own so the collection view around the calendar does not hear the dock's note switches and
 * rebind to them. Lifted from the geo map's usePaneNoteContext, where each choice is explained.
 */
function useDockNoteContext(note: FNote | undefined) {
    const parentComponent = useContext(ParentComponent);
    const [ noteContext ] = useState(() => new NoteContext(DOCK_NTX_ID));
    const [ dockComponent ] = useState(() => new Component());

    useEffect(() => {
        if (!parentComponent) return;

        parentComponent.child(dockComponent);
        return () => parentComponent.removeChild(dockComponent);
    }, [ parentComponent, dockComponent ]);

    useEffect(() => {
        noteContext.triggerEvent = (name, data) => dockComponent.handleEventInChildren(name, data);
    }, [ noteContext, dockComponent ]);

    useEffect(() => {
        if (!note) return;

        const notePath = note.getBestNotePathString(appContext.tabManager.getActiveContext()?.hoistedNoteId);
        void noteContext.setNote(notePath, {
            keepActiveDialog: true,
            viewScope: {
                readOnlyTemporarilyDisabled: !note.hasLabel("readOnly"),
                // The dock has a third of a note's width, which is not a toolbar's worth.
                floatingToolbar: true
            }
        });
    }, [ noteContext, note?.noteId ]);

    return { noteContext, dockComponent };
}

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

            <div className="calendar-detail-dock-body">
                <PromotedAttributes omit={EVENT_DATE_LABELS} />
                <NoteDetail />
            </div>
        </div>
    );
}
