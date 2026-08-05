import "./index.css";

import { Calendar as FullCalendar } from "@fullcalendar/core";
import { DateSelectArg, EventChangeArg, EventClickArg, EventMountArg, EventSourceFuncArg, LocaleInput, PluginDef } from "@fullcalendar/core/index.js";
import { DateClickArg } from "@fullcalendar/interaction";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import date_notes from "../../../services/date_notes";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_tooltip from "../../../services/note_tooltip";
import { escapeHtml, isMobile } from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import { useNoteLabel, useNoteLabelBoolean, useResizeObserver, useSpacedUpdate, useTriliumEvent, useTriliumOption, useTriliumOptionInt } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { ViewModeProps } from "../interface";
import { changeEvent, newEvent } from "./api";
import Calendar from "./calendar";
import EventPopover from "./EventPopover";
import GhostPopover from "./GhostPopover";
import { openCalendarContextMenu } from "./context_menu";
import { CalendarSelection, EventDraft } from "./selection";
import { buildEvents, buildEventsForCalendar } from "./event_builder";
import { formatDateToLocalISO, isValidDuration, parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "./utils";

interface CalendarViewData {

}

interface CalendarViewData {
    type: string;
    name: string;
    previousText: string;
    nextText: string;
}

const CALENDAR_VIEWS = [
    {
        type: "timeGridDay",
        name: t("calendar.day"),
        icon: "bx bx-calendar-event",
        previousText: t("calendar.day_previous"),
        nextText: t("calendar.day_next")
    },
    {
        type: "timeGridWeek",
        name: t("calendar.week"),
        icon: "bx bx-calendar-week",
        previousText: t("calendar.week_previous"),
        nextText: t("calendar.week_next")
    },
    {
        type: "dayGridMonth",
        name: t("calendar.month"),
        icon: "bx bx-calendar",
        previousText: t("calendar.month_previous"),
        nextText: t("calendar.month_next")
    },
    {
        type: "multiMonthYear",
        name: t("calendar.year"),
        icon: "bx bx-layer",
        previousText: t("calendar.year_previous"),
        nextText: t("calendar.year_next")
    },
    {
        type: "listMonth",
        name: t("calendar.list"),
        icon: "bx bx-list-ol",
        previousText: t("calendar.month_previous"),
        nextText: t("calendar.month_next")
    }
];

const SUPPORTED_CALENDAR_VIEW_TYPE = CALENDAR_VIEWS.map(v => v.type);

const DEFAULT_SLOT_DURATION = "00:15:00";
const DEFAULT_SLOT_LABEL_INTERVAL = "01:00:00";

// Here we hard-code the imports in order to ensure that they are embedded by webpack without having to load all the languages.
export const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, (() => Promise<{ default: LocaleInput }>) | null> = {
    de: () => import("@fullcalendar/core/locales/de"),
    es: () => import("@fullcalendar/core/locales/es"),
    fr: () => import("@fullcalendar/core/locales/fr"),
    it: () => import("@fullcalendar/core/locales/it"),
    hi: () => import("@fullcalendar/core/locales/hi"),
    id: () => import("@fullcalendar/core/locales/id"),
    ga: null,
    cn: () => import("@fullcalendar/core/locales/zh-cn"),
    cs: () => import("@fullcalendar/core/locales/cs"),
    tw: () => import("@fullcalendar/core/locales/zh-tw"),
    ro: () => import("@fullcalendar/core/locales/ro"),
    ru: () => import("@fullcalendar/core/locales/ru"),
    ja: () => import("@fullcalendar/core/locales/ja"),
    ko: () => import("@fullcalendar/core/locales/ko"),
    pt: () => import("@fullcalendar/core/locales/pt"),
    pl: () => import("@fullcalendar/core/locales/pl"),
    "pt_br": () => import("@fullcalendar/core/locales/pt-br"),
    uk: () => import("@fullcalendar/core/locales/uk"),
    en: null,
    "en-GB": () => import("@fullcalendar/core/locales/en-gb"),
    "en_rtl": null,
    ar: () => import("@fullcalendar/core/locales/ar")
};

export default function CalendarView({ note, noteIds }: ViewModeProps<CalendarViewData>) {
    const parentComponent = useContext(ParentComponent);
    const containerRef = useRef<HTMLDivElement>(null);
    const calendarRef = useRef<FullCalendar>(null);
    // The event the view's popovers stand for — a chip clicked, or a range just dragged out (see
    // CalendarSelection).
    const [ selection, setSelection ] = useState<CalendarSelection | null>(null);

    const [ calendarRoot ] = useNoteLabelBoolean(note, "calendarRoot");
    const [ workspaceCalendarRoot ] = useNoteLabelBoolean(note, "workspaceCalendarRoot");
    const [ firstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const [ hideWeekends ] = useNoteLabelBoolean(note, "calendar:hideWeekends");
    const [ weekNumbers ] = useNoteLabelBoolean(note, "calendar:weekNumbers");
    const [ calendarView, setCalendarView ] = useNoteLabel(note, "calendar:view");
    const [ initialDate ] = useNoteLabel(note, "calendar:initialDate");
    const [ slotDuration ] = useNoteLabel(note, "calendar:slotDuration");
    const [ slotLabelInterval ] = useNoteLabel(note, "calendar:slotLabelInterval");
    const initialView = useRef(calendarView);
    const viewSpacedUpdate = useSpacedUpdate(() => setCalendarView(initialView.current));
    useResizeObserver(containerRef, () => calendarRef.current?.updateSize());
    const isCalendarRoot = (calendarRoot || workspaceCalendarRoot);
    const isEditable = !isCalendarRoot;
    const eventBuilder = useMemo(() => {
        if (!isCalendarRoot) {
            return async () => await buildEvents(noteIds);
        }
        return async (e: EventSourceFuncArg) => await buildEventsForCalendar(note, e);
    }, [isCalendarRoot, noteIds]);

    const plugins = usePlugins(isEditable, isCalendarRoot);
    const locale = useLocale();

    const { eventDidMount } = useEventDisplayCustomization(note, parentComponent?.componentId);
    const editingProps = useEditing(note, isEditable, isCalendarRoot, parentComponent?.componentId,
        (draft, anchor) => setSelection({ draft, anchor }));

    // Turns the standing ghost into the note: created only now, at the commit, and — where the
    // reader typed nothing — named by the calendar's own titleTemplate, the very thing the old
    // title prompt used to override. The event popover takes over from the ghost, opening on the
    // new note at the ghost's own anchor — the chip itself has yet to be drawn.
    const commitDraft = useCallback(async (title: string) => {
        if (!selection || !("draft" in selection)) return;

        const created = await newEvent(note, {
            title: title.trim() || undefined,
            ...selection.draft,
            componentId: parentComponent?.componentId
        });
        if (created) {
            // The range has become an event and its shading has nothing left to stand for; the
            // chip takes its place. Said here because no press said it: committing is a key or a
            // button within the ghost, and the ghost is exempt from clearing the shading.
            calendarRef.current?.unselect();
            setSelection({ noteId: created.noteId, anchor: selection.anchor });
        }
    }, [ selection, note, parentComponent?.componentId ]);

    /**
     * The ghost given up on rather than pressed away from — Escape, or its own close button.
     * Neither is a press on anything that would settle the shading, so it is let go by hand.
     */
    const cancelDraft = useCallback(() => {
        calendarRef.current?.unselect();
        setSelection(null);
    }, []);

    /**
     * The ghost pressed away from, which is a different thing: the press itself settles what
     * becomes of the shading, and saying anything here would be saying it too early. A press on the
     * grid has already begun the next selection by the time this runs — the drag starts on the
     * press, `selectMinDistance` being 0 — so clearing here would wipe the very range just started,
     * which is why a click used to open a ghost over no shading at all while a drag kept its own
     * (the drag's later moves made the selection again). A press anywhere else clears it through
     * `unselectAuto`, and a press within the ghost is spared by `unselectCancel`.
     */
    const dismissDraft = useCallback(() => setSelection(null), []);

    // An event taken off the calendar takes the dock with it. Not in calendar-root mode, whose
    // events (day notes and their children) are not in the collection's noteIds at all.
    useEffect(() => {
        if (!isCalendarRoot && selection && "noteId" in selection && !noteIds.includes(selection.noteId)) {
            setSelection(null);
        }
    }, [ isCalendarRoot, selection, noteIds ]);

    // A click on an event opens it into the popover instead of navigating to the popup the
    // event's `url` names. Not on mobile, where a tap is already spoken for (see eventDidMount)
    // and the popover would take the whole of the screen.
    const onEventClick = useCallback((e: EventClickArg) => {
        if (isMobile()) return;

        // The chip is an anchor at the event's `url`, and the app's document-level link handler
        // (see the delegated listeners in link.ts) would open the popup it names no matter what
        // FullCalendar makes of the click — so the click must not reach the document at all.
        e.jsEvent.preventDefault();
        e.jsEvent.stopPropagation();

        // Which also keeps the click from the tooltip service, whose own document listener is what
        // ordinarily puts a preview away when something is done (see note_tooltip.ts). Said here
        // instead: a preview left standing would cover the very popover the click opens, at the
        // chip both of them are drawn beside.
        note_tooltip.dismissAllTooltips();

        const noteId = e.event.extendedProps.noteId;
        if (noteId) {
            // The click names which of the event's chips to stand by (see eventAnchorRect).
            setSelection({ noteId, anchor: { x: e.jsEvent.clientX, y: e.jsEvent.clientY } });
        }
    }, []);

    // React to changes.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const api = calendarRef.current;
        if (!api) return;

        // Subnote attribute change.
        if (loadResults.getAttributeRows(parentComponent?.componentId).some((a) => noteIds.includes(a.noteId ?? ""))) {
            // Defer execution after the load results are processed so that the event builder has the updated data to work with.
            setTimeout(() => api.refetchEvents(), 0);
            return; // early return since we'll refresh the events anyway
        }

        // Title change.
        for (const noteId of loadResults.getNoteIds().filter(noteId => noteIds.includes(noteId))) {
            const event = api.getEventById(noteId);
            const note = froca.getNoteFromCache(noteId);
            if (!event || !note) continue;
            // Only update the title if it has actually changed.
            // setProp() triggers FullCalendar's eventChange callback, which would
            // re-save the event's dates and cause unwanted side effects.
            if (event.title !== note.title) {
                event.setProp("title", note.title);
            }
        }
    });

    return (plugins &&
        <div className="calendar-view" ref={containerRef} tabIndex={100}>
            <CalendarCollectionProperties note={note} calendarRef={calendarRef} />
            <Calendar
                events={eventBuilder}
                calendarRef={calendarRef}
                plugins={plugins}
                initialView={initialView.current && SUPPORTED_CALENDAR_VIEW_TYPE.includes(initialView.current) ? initialView.current : "dayGridMonth"}
                headerToolbar={false}
                firstDay={firstDayOfWeek ?? 0}
                weekends={!hideWeekends}
                weekNumbers={weekNumbers}
                slotDuration={isValidDuration(slotDuration) ? slotDuration : DEFAULT_SLOT_DURATION}
                slotLabelInterval={isValidDuration(slotLabelInterval) ? slotLabelInterval : DEFAULT_SLOT_LABEL_INTERVAL}
                height="100%"
                nowIndicator
                handleWindowResize={false}
                initialDate={initialDate || undefined}
                locale={locale}
                {...editingProps}
                // The shading of a dragged range is FullCalendar's to keep and to clear, which it
                // does on the press that follows — except a press within the ghost standing for
                // that very range, which is what the exemption names. Letting it decide is what
                // spares a press on the grid: the next selection has already begun by then, and
                // FullCalendar knows not to clear what the same press has just made.
                unselectCancel=".calendar-ghost-popover"
                eventClick={onEventClick}
                // The event the popover stands for is marked as such, and asks for no hover
                // preview while it does: the popover beside it already says everything the
                // preview would, at full length and editable, and the two are drawn beside the
                // same chip. The geo map's marker previews keep clear of its detail pane the same
                // way (see Tooltips there).
                eventClassNames={(arg) => selection && "noteId" in selection && arg.event.extendedProps.noteId === selection.noteId
                    ? [ "calendar-event-selected", "no-tooltip-preview" ]
                    : []}
                eventDidMount={eventDidMount}
                viewDidMount={({ view }) => {
                    if (initialView.current !== view.type) {
                        initialView.current = view.type;
                        viewSpacedUpdate.scheduleUpdate();
                    }
                }}
            />
            {selection && "noteId" in selection && (
                <EventPopover
                    noteId={selection.noteId}
                    anchor={selection.anchor}
                    container={containerRef.current}
                    parentNote={note}
                    isEditable={isEditable}
                    onClose={() => setSelection(null)}
                />
            )}
            {selection && "draft" in selection && (
                <GhostPopover
                    draft={selection.draft}
                    anchor={selection.anchor}
                    container={containerRef.current}
                    onCommit={(title) => void commitDraft(title)}
                    onCancel={cancelDraft}
                    onDismiss={dismissDraft}
                />
            )}
        </div>
    );
}

function CalendarCollectionProperties({ note, calendarRef }: {
    note: FNote;
    calendarRef: RefObject<FullCalendar>;
}) {
    const { title, viewType: currentViewType } = useOnDatesSet(calendarRef);
    const currentViewData = CALENDAR_VIEWS.find(v => calendarRef.current && v.type === currentViewType);
    const isMobileLocal = isMobile();

    return (
        <CollectionProperties
            note={note}
            centerChildren={<>
                <ActionButton icon="bx bx-chevron-left" text={currentViewData?.previousText ?? ""} onClick={() => calendarRef.current?.prev()} />
                <span className="title">{title}</span>
                <ActionButton icon="bx bx-chevron-right" text={currentViewData?.nextText ?? ""} onClick={() => calendarRef.current?.next()} />
                <Button text={t("calendar.today")} onClick={() => calendarRef.current?.today()} />
                <PinDateButton note={note} calendarRef={calendarRef} />
                {isMobileLocal && <MobileCalendarViewSwitcher calendarRef={calendarRef} />}
            </>}
            rightChildren={<>
                {!isMobileLocal && <DesktopCalendarViewSwitcher calendarRef={calendarRef} />}
            </>}
        />
    );
}

function PinDateButton({ note, calendarRef }: {
    note: FNote;
    calendarRef: RefObject<FullCalendar>;
}) {
    const [ initialDate, setInitialDate ] = useNoteLabel(note, "calendar:initialDate");
    const isPinned = !!initialDate;

    return (
        <ActionButton
            icon={isPinned ? "bx bxs-pin" : "bx bx-pin"}
            text={isPinned ? t("calendar.unpin_date") : t("calendar.pin_date")}
            onClick={() => {
                if (isPinned) {
                    setInitialDate(null);
                } else {
                    const date = formatDateToLocalISO(calendarRef.current?.view.currentStart);
                    if (date) {
                        setInitialDate(date);
                    }
                }
            }}
        />
    );
}

function DesktopCalendarViewSwitcher({ calendarRef }: { calendarRef: RefObject<FullCalendar> }) {
    const { viewType: currentViewType } = useOnDatesSet(calendarRef);

    return (
        <>
            <ButtonGroup>
                {CALENDAR_VIEWS.map(viewData => (
                    <Button
                        key={viewData.type}
                        text={viewData.name}
                        className={currentViewType === viewData.type ? "active" : ""}
                        onClick={() => calendarRef.current?.changeView(viewData.type)}
                    />
                ))}
            </ButtonGroup>
        </>
    );
}

function MobileCalendarViewSwitcher({ calendarRef }: { calendarRef: RefObject<FullCalendar> }) {
    const { viewType: currentViewType } = useOnDatesSet(calendarRef);
    const currentViewTypeData = CALENDAR_VIEWS.find(view => view.type === currentViewType);

    return (
        <Dropdown
            text={currentViewTypeData?.name}
        >
            {CALENDAR_VIEWS.map(viewData => (
                <FormListItem
                    key={viewData.type}
                    selected={currentViewType === viewData.type}
                    icon={viewData.icon}
                    onClick={() => calendarRef.current?.changeView(viewData.type)}
                >{viewData.name}</FormListItem>
            ))}
        </Dropdown>
    );
}

function usePlugins(isEditable: boolean, isCalendarRoot: boolean) {
    const [ plugins, setPlugins ] = useState<PluginDef[]>();

    useEffect(() => {
        async function loadPlugins() {
            const plugins: PluginDef[] = [];
            plugins.push((await import("@fullcalendar/daygrid")).default);
            plugins.push((await import("@fullcalendar/timegrid")).default);
            plugins.push((await import("@fullcalendar/list")).default);
            plugins.push((await import("@fullcalendar/multimonth")).default);
            plugins.push((await import("@fullcalendar/rrule")).default);
            if (isEditable || isCalendarRoot) {
                plugins.push((await import("@fullcalendar/interaction")).default);
            }
            setPlugins(plugins);
        }

        loadPlugins();
    }, [ isEditable, isCalendarRoot ]);

    return plugins;
}

function useLocale() {
    const [ locale ] = useTriliumOption("locale");
    const [ formattingLocale ] = useTriliumOption("formattingLocale");
    const [ calendarLocale, setCalendarLocale ] = useState<LocaleInput>();

    useEffect(() => {
        const correspondingLocale = LOCALE_MAPPINGS[formattingLocale] ?? LOCALE_MAPPINGS[locale];
        if (correspondingLocale) {
            correspondingLocale().then((locale) => setCalendarLocale(locale.default));
        } else {
            setCalendarLocale(undefined);
        }
    }, [formattingLocale, locale]);

    return calendarLocale;
}

function useEditing(note: FNote, isEditable: boolean, isCalendarRoot: boolean, componentId: string | undefined,
    onDraft: (draft: EventDraft, anchor: { x: number; y: number } | null) => void) {
    const onCalendarSelection = useCallback(async (e: DateSelectArg) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e);
        if (!startDate) return;
        const { startTime, endTime } = parseStartEndTimeFromEvent(e);

        // On a phone the ghost does not open (see the event click), so the title is still asked
        // for up front, in the dialog this flow always led with. Unselected as the dialog closes,
        // rather than leaving the range shaded behind it until the next press lands.
        if (isMobile()) {
            const title = await dialog.prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });
            if (title?.trim()) {
                await newEvent(note, { title, startDate, endDate, startTime, endTime, componentId });
            }
            e.view.calendar.unselect();
            return;
        }

        // Nothing is created yet: the range is handed over as a draft for the ghost popover, and a
        // note is made only when the draft is committed (see commitDraft) — a stray drag dismissed
        // costs nothing. The range keeps its shading meanwhile, standing on the grid for the event
        // to be; the view lets it go when the draft resolves. Where the drag ended anchors the
        // ghost beside it (see ghostAnchorRect).
        onDraft(
            { startDate, endDate, startTime, endTime },
            e.jsEvent ? { x: e.jsEvent.clientX, y: e.jsEvent.clientY } : null
        );
    }, [ note, componentId, onDraft ]);

    const onEventChange = useCallback(async (e: EventChangeArg) => {
        // Only process actual date/time changes, not other property changes (e.g., title via setProp).
        const datesChanged = e.oldEvent.start?.getTime() !== e.event.start?.getTime()
            || e.oldEvent.end?.getTime() !== e.event.end?.getTime()
            || e.oldEvent.allDay !== e.event.allDay;
        if (!datesChanged) return;

        const { startDate, endDate } = parseStartEndDateFromEvent(e.event);
        if (!startDate) return;

        const { startTime, endTime } = parseStartEndTimeFromEvent(e.event);
        const note = await froca.getNote(e.event.extendedProps.noteId);
        if (!note) return;
        changeEvent(note, { startDate, endDate, startTime, endTime, componentId });
    }, [ componentId ]);

    // Called upon when clicking the day number in the calendar, opens or creates the day note but only if in a calendar root.
    const onDateClick = useCallback(async (e: DateClickArg) => {
        const eventNote = await date_notes.getDayNote(e.dateStr, note.noteId);
        if (eventNote) {
            appContext.triggerCommand("openInPopup", { noteIdOrPath: eventNote.noteId });
        }
    }, [ note ]);

    return {
        select: onCalendarSelection,
        eventChange: onEventChange,
        dateClick: isCalendarRoot ? onDateClick : undefined,
        editable: isEditable,
        selectable: isEditable
    };
}

function useEventDisplayCustomization(parentNote: FNote, componentId: string | undefined) {
    const eventDidMount = useCallback((e: EventMountArg) => {
        const { iconClass, promotedAttributes } = e.event.extendedProps;

        // The chip is tagged with its note, which is how the event popover finds the chip to
        // stand beside — FullCalendar redraws chips at will, so an element held onto would go
        // stale (see eventAnchorRect in EventPopover).
        if (e.event.extendedProps.noteId) {
            e.el.dataset.eventNoteId = String(e.event.extendedProps.noteId);
        }

        // Prepend the icon to the title, if any.
        if (iconClass) {
            let titleContainer: HTMLElement | null = null;
            switch (e.view.type) {
                case "timeGridDay":
                case "timeGridWeek":
                case "dayGridMonth":
                    titleContainer = e.el.querySelector(".fc-event-title");
                    break;
                case "multiMonthYear":
                    break;
                case "listMonth":
                    titleContainer = e.el.querySelector(".fc-list-event-title a");
                    break;
            }

            if (titleContainer) {
                const icon = /*html*/`<span class="${escapeHtml(iconClass)}"></span> `;
                titleContainer.insertAdjacentHTML("afterbegin", icon);
            }
        }

        // Disable the default context menu.
        e.el.dataset.noContextMenu = "true";

        // Append promoted attributes to the end of the event container.
        if (promotedAttributes) {
            let promotedAttributesHtml = "";
            for (const [name, value] of promotedAttributes) {
                promotedAttributesHtml = `${promotedAttributesHtml  /*html*/}\
                <div class="promoted-attribute">
                    <span class="promoted-attribute-name">${name}</span>: <span class="promoted-attribute-value">${value}</span>
                </div>`;
            }

            let mainContainer;
            switch (e.view.type) {
                case "timeGridDay":
                case "timeGridWeek":
                case "dayGridMonth":
                    mainContainer = e.el.querySelector(".fc-event-main");
                    break;
                case "multiMonthYear":
                    break;
                case "listMonth":
                    mainContainer = e.el.querySelector(".fc-list-event-title");
                    break;
            }
            $(mainContainer ?? e.el).append($(promotedAttributesHtml));
        }

        async function onContextMenu(contextMenuEvent: PointerEvent) {
            const note = await froca.getNote(e.event.extendedProps.noteId);
            if (!note) return;

            openCalendarContextMenu(contextMenuEvent, note, parentNote, componentId);
        }

        if (isMobile()) {
            e.el.addEventListener("click", onContextMenu);
        } else {
            e.el.addEventListener("contextmenu", onContextMenu);
        }
    }, []);
    return { eventDidMount };
}

function useOnDatesSet(calendarRef: RefObject<FullCalendar>) {
    const [ title, setTitle ] = useState<string>();
    const [ viewType ,setViewType ] = useState<string>();
    useEffect(() => {
        const api = calendarRef.current;
        if (!api) return;
        const handler = () => {
            setTitle(api.view.title);
            setViewType(api.view.type);
        };
        handler();
        api.on("datesSet", handler);
        return () => api.off("datesSet", handler);
    }, [calendarRef]);
    return { title, viewType };
}
