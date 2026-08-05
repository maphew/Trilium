import { type MapGeoJSONFeature, type MapMouseEvent, type Offset, Popup } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import froca from "../../../services/froca";
import { renderTooltip } from "../../../services/note_tooltip";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { isHtmlEmpty } from "../../../services/utils";
import { ParentMap } from "./map";
import { MARKER_HEIGHT, MARKER_LAYER, MARKER_WIDTH } from "./Markers";

/**
 * How long the pointer has to rest on a marker before its note is read.
 *
 * A preview is a note's content, fetched from the server, so dragging the pointer across a crowded
 * map would otherwise read every note it happens to brush past. Deliberately shorter than the
 * {@link HOVER_DELAY} the preview itself sits out: the read begins part-way through that rest, so
 * the round trip happens *during* the remainder of the wait rather than after it. Waiting the whole
 * rest and only then reading is what made the preview arrive noticeably later here than anywhere
 * else in the app, whose tooltips race the render against the delay (see note_tooltip.ts).
 */
const READ_DELAY = 150;

/**
 * How long the pointer has to rest on a marker before its preview is shown.
 *
 * The same wait the tooltips everywhere else in the app make: a preview flashing up under every
 * passing pointer is flicker, not help. The note is read before this wait is over (see
 * {@link READ_DELAY}), but shown no sooner than this however fast the read comes back.
 */
const HOVER_DELAY = 500;

/**
 * How long the preview is left standing after the pointer leaves the marker.
 *
 * It is not closed at once because it is meant to be reached: the preview scrolls, carries the
 * note's links and a quick-edit button, and sits a little away from the pin — so getting to it
 * means crossing a gap where neither it nor the marker is under the pointer.
 */
const DISMISS_DELAY = 400;

/** How much air is left between the pin and the preview, whichever side it lands on. */
const MARKER_GAP = 8;

/** What it takes to get past the pin sideways, and to get above it. */
const CLEAR_SIDEWAYS = MARKER_WIDTH / 2 + MARKER_GAP;
const CLEAR_ABOVE = MARKER_HEIGHT + MARKER_GAP;

/**
 * Where the preview sits, for each placement MapLibre might choose.
 *
 * A pin stands on its coordinate rather than over it: everything it draws is *above* that point, and
 * within half its width either side. A preview pushed away from the point by one flat distance
 * therefore covers the very marker it belongs to, so each placement has to clear whichever part of
 * the pin it opens onto — which is not the same part each time, and is why MapLibre asks for the
 * offset per placement at all (see the `popupOffsets` example in its `Popup` documentation).
 *
 * What opens onto what is easy to get wrong. Placed straight above the point the preview meets the
 * pin's full height, and straight below it meets nothing. But a preview placed from a *corner* has
 * that corner on the point and spreads sideways from it, so what stands in its way there is the
 * pin's width, not its height — clearing only the height leaves the corner placements lying across
 * whichever half of the pin they open towards.
 */
const PREVIEW_OFFSET: Offset = {
    // Straight below the point, where the pin draws nothing.
    "top": [ 0, MARKER_GAP ],
    // Straight above it, with the whole pin standing in between.
    "bottom": [ 0, -CLEAR_ABOVE ],
    // Beside it: past the pin's width, and lifted to the middle of its height rather than left
    // hanging off the tip.
    "left": [ CLEAR_SIDEWAYS, -MARKER_HEIGHT / 2 ],
    "right": [ -CLEAR_SIDEWAYS, -MARKER_HEIGHT / 2 ],
    // From a corner, spreading sideways: past the pin's width in whichever direction it opens, and
    // clear of the point itself vertically. Getting past the width is what does the work here, so
    // there is no need to rise the pin's whole height as well and leave the preview stranded up in
    // the air away from the marker it belongs to.
    "top-left": [ CLEAR_SIDEWAYS, MARKER_GAP ],
    "top-right": [ -CLEAR_SIDEWAYS, MARKER_GAP ],
    "bottom-left": [ CLEAR_SIDEWAYS, -MARKER_GAP ],
    "bottom-right": [ -CLEAR_SIDEWAYS, -MARKER_GAP ],
    "center": [ 0, 0 ]
};

/**
 * The preview shown while the pointer rests on a marker.
 *
 * The same preview a note link shows anywhere else in the app — title and path, attributes, the
 * note's content and a quick-edit button — put together by the shared renderer. It is drawn into a
 * MapLibre popup rather than by the app's tooltip service because a marker is no longer an element:
 * the notes are drawn into one symbol layer (see {@link Markers}), and the service works by hovering
 * elements. What the layer gives us instead is the note behind the pixel under the pointer.
 *
 * Not every marker previews, and no preview outlives a click. The marker the detail pane stands for
 * shows nothing — the pane beside it already says everything the preview would, at full length. And
 * a click is always something being done — a marker opened into the pane, a place chosen, a pan
 * begun — whose result the preview would otherwise stand over; the app's tooltip service dismisses
 * on click for the same reason (see note_tooltip.ts). Without this, a preview whose marker was
 * clicked stood exactly where the pane then opened, and one still on its way landed on top of it.
 */
export default function Tooltips({ selectedNoteId }: {
    /** The note the detail pane stands for, or `null` while the pane is down and every marker
     *  previews. See the selection in DetailPane. */
    selectedNoteId: string | null;
}) {
    const map = useContext(ParentMap);

    useEffect(() => {
        if (!map) return;

        const tooltip = new Popup({
            closeButton: false,
            closeOnClick: false,
            offset: PREVIEW_OFFSET,
            // The preview brings its own width — `.tooltip-inner` caps it at 500px — and MapLibre's
            // 240px default would squeeze a note's content into a column half that wide.
            maxWidth: "none",
            // Otherwise MapLibre puts the caret on the first link in the preview the moment it
            // opens, so merely passing the pointer over a marker takes the focus out of whatever
            // the user was actually typing in.
            focusAfterOpen: false,
            className: "marker-tooltip"
        });

        // The note under the pointer, which is not necessarily the one the preview shows: reading a
        // note and rendering it is asynchronous, and a marker only skimmed past has usually been
        // left again by the time its preview is ready.
        let hovered: string | null = null;
        let shown: string | null = null;
        // Whether the pointer is on the preview itself, which is what keeps it open.
        let onTooltip = false;
        // Whether this binding of the effect has been torn down, which is what stops a show still
        // in flight from adding its popup to a map nothing manages any more.
        let cancelled = false;
        let showTimer: ReturnType<typeof setTimeout> | undefined;
        let dismissTimer: ReturnType<typeof setTimeout> | undefined;

        async function show(noteId: string, coordinates: [ number, number ]) {
            // The read raced against the rest of the wait rather than run after it: the preview
            // holds to the full HOVER_DELAY however fast the note comes back, but a round trip no
            // longer stretches that wait unless it outlasts what is left of it.
            const [ content ] = await Promise.all([
                froca.getNote(noteId).then((note) => renderTooltip(note)),
                new Promise((resolve) => setTimeout(resolve, HOVER_DELAY - READ_DELAY))
            ]);
            // A note with no content and no path renders to nothing; the pointer may well have
            // moved on to another marker while this one was being read; and a click may have
            // dismissed the preview while it was still on its way (see dismiss).
            if (cancelled || !map || hovered !== noteId || !content || isHtmlEmpty(content)) return;

            shown = noteId;
            tooltip
                .setLngLat(coordinates)
                .setHTML(buildTooltipHtml(content))
                .addTo(map);

            // The popup builds its element afresh every time it is added to a map, so what keeps it
            // open while the pointer is on it has to be bound per opening rather than once.
            const element = tooltip.getElement();
            element?.addEventListener("mouseenter", onTooltipEnter);
            element?.addEventListener("mouseleave", onTooltipLeave);
        }

        function hide() {
            clearTimeout(showTimer);
            shown = null;
            onTooltip = false;
            tooltip.remove();
        }

        /**
         * Closes the preview unless the pointer has landed on it — or on another marker — by the
         * time this runs.
         */
        function scheduleDismiss() {
            clearTimeout(dismissTimer);
            dismissTimer = setTimeout(() => {
                if (!hovered && !onTooltip) hide();
            }, DISMISS_DELAY);
        }

        function onMouseMove(e: MapMouseEvent & { features?: MapGeoJSONFeature[]; }) {
            const feature = e.features?.[0];
            if (!feature || feature.geometry.type !== "Point") return;

            const noteId = String(feature.properties.id);
            // Watched by the move rather than by `mouseenter`, which fires on entering the layer and
            // not on entering a marker: dragging the pointer from one pin straight onto the next
            // never leaves the layer, so the first note's preview would stay up over the second.
            if (noteId === hovered) return;

            hovered = noteId;
            clearTimeout(showTimer);
            // Whatever is up belongs to the marker just left, so it goes now rather than standing
            // there wrong for as long as the new one takes to read.
            if (shown && shown !== noteId) hide();

            // The marker the pane stands for gets no preview: the pane beside it already says
            // everything the preview would, at full length.
            if (noteId === selectedNoteId) return;

            const coordinates = feature.geometry.coordinates as [ number, number ];
            showTimer = setTimeout(() => show(noteId, coordinates), READ_DELAY);
        }

        /**
         * Puts the preview away — up or still on its way — because the map was clicked, whatever
         * the click was for. Clearing `hovered` is what drops a show already past its timer, at
         * the guard it shares with every other way of being overtaken; it also means the marker
         * clicked does not re-arm until the pointer has left it and come back, which is the
         * behaviour wanted of a marker that was just acted on.
         */
        function dismiss() {
            hovered = null;
            clearTimeout(dismissTimer);
            hide();
        }

        function onMouseLeave() {
            hovered = null;
            clearTimeout(showTimer);
            scheduleDismiss();
        }

        function onTooltipEnter() {
            onTooltip = true;
            clearTimeout(dismissTimer);
        }

        function onTooltipLeave() {
            onTooltip = false;
            scheduleDismiss();
        }

        map.on("mousemove", MARKER_LAYER, onMouseMove);
        map.on("mouseleave", MARKER_LAYER, onMouseLeave);
        // Bound to the map rather than to the marker layer: a click anywhere is something being
        // done, and the preview goes whether the click landed on a pin, a track or bare ground.
        map.on("click", dismiss);

        return () => {
            cancelled = true;
            clearTimeout(showTimer);
            clearTimeout(dismissTimer);
            map.off("mousemove", MARKER_LAYER, onMouseMove);
            map.off("mouseleave", MARKER_LAYER, onMouseLeave);
            map.off("click", dismiss);
            tooltip.remove();
        };
        // Depending on the selection makes every change of it a dismissal in itself, which covers
        // the selections no click announces: a note created onto the map is opened into the pane
        // by the code that created it (see index.tsx).
    }, [ map, selectedNoteId ]);

    return null;
}

/**
 * The rendered preview, in the shape the app's tooltip styles are written against.
 *
 * Those styles reach all the way down from `.tooltip.note-tooltip > .tooltip-inner`, so a preview
 * drawn outside Bootstrap has to put that shape on by hand or it inherits none of them — including
 * everything the theme says about the title, the attribute line and the quick-edit button. `show`
 * stands in for the class Bootstrap adds when it reveals a tooltip, without which the preview would
 * be rendered at zero opacity.
 *
 * The content is sanitized because a note's HTML reaches the client through paths CKEditor never
 * saw — the internal API, ETAPI and sync — exactly as the tooltip service sanitizes it.
 *
 * Written without a line break anywhere between the tags, because `.tooltip-inner` is `pre-line`:
 * every newline inside it is a newline the preview is drawn with, and laying this out as one would
 * lay out markup put a blank line above the preview and another below it.
 */
function buildTooltipHtml(content: string) {
    return `<div class="tooltip note-tooltip show" role="tooltip">`
        + `<div class="tooltip-inner">`
        + `<div class="note-tooltip-content">${sanitizeNoteContentHtml(content)}</div>`
        + `</div>`
        + `</div>`;
}
