import { type MapGeoJSONFeature, type MapMouseEvent, Popup } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import froca from "../../../services/froca";
import { renderTooltip } from "../../../services/note_tooltip";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { isHtmlEmpty } from "../../../services/utils";
import { ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

/**
 * How long the pointer has to rest on a marker before its note is read.
 *
 * The same wait the tooltips everywhere else in the app make, and for the same reason: a preview is
 * a note's content, so dragging the pointer across a crowded map would otherwise read every note it
 * happens to brush past.
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

/**
 * The preview shown while the pointer rests on a marker.
 *
 * The same preview a note link shows anywhere else in the app — title and path, attributes, the
 * note's content and a quick-edit button — put together by the shared renderer. It is drawn into a
 * MapLibre popup rather than by the app's tooltip service because a marker is no longer an element:
 * the notes are drawn into one symbol layer (see {@link Markers}), and the service works by hovering
 * elements. What the layer gives us instead is the note behind the pixel under the pointer.
 */
export default function Tooltips() {
    const map = useContext(ParentMap);

    useEffect(() => {
        if (!map) return;

        const tooltip = new Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
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
        let showTimer: ReturnType<typeof setTimeout> | undefined;
        let dismissTimer: ReturnType<typeof setTimeout> | undefined;

        async function show(noteId: string, coordinates: [ number, number ]) {
            const note = await froca.getNote(noteId);
            const content = await renderTooltip(note);
            // A note with no content and no path renders to nothing, and the pointer may well have
            // moved on to another marker while this one was being read.
            if (!map || hovered !== noteId || !content || isHtmlEmpty(content)) return;

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

            const coordinates = feature.geometry.coordinates as [ number, number ];
            showTimer = setTimeout(() => show(noteId, coordinates), HOVER_DELAY);
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

        return () => {
            clearTimeout(showTimer);
            clearTimeout(dismissTimer);
            map.off("mousemove", MARKER_LAYER, onMouseMove);
            map.off("mouseleave", MARKER_LAYER, onMouseLeave);
            tooltip.remove();
        };
    }, [ map ]);

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
