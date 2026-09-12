import "./hover_name.css";

import {
    type Map as MapLibreGLMap, type MapGeoJSONFeature, type MapMouseEvent, Popup
} from "maplibre-gl";
import { useEffect, useRef } from "preact/hooks";

/**
 * How long the pointer has to rest on something before its name is shown.
 *
 * Shorter than the wait a marker's preview sits out, that one reading a note from the server while
 * these names are already in hand — but long enough that sweeping the pointer across a crowded
 * map does not name everything on the way past.
 */
const REST_DELAY = 200;

/** How far the name stands off what it names, be that a place's icon or the pointer itself. */
const NAME_OFFSET = 10;

/** A name to show, and with it the pointer saying the thing under it answers a click. */
export interface HoverName {
    /** Tells one thing from the next, so the pointer crossing between them replaces the name. */
    id: string;
    /** Where the name stands. */
    lngLat: [number, number];
    /** The boxicons classes of the mark beside the name, where the thing wears one. */
    icon?: string | null;
    text: string;
}

/**
 * What the pointer is resting on: a name to show, nothing at all, or something drawn above that
 * answers for it. The last is not the same as nothing — whatever stands above has set its own
 * cursor, so this leaves the cursor alone rather than clearing what that has just set.
 */
export type HoverAnswer = HoverName | null | "deferred";

interface HoverNameOptions {
    /** The layers the pointer is watched on, read afresh whenever the style changes. */
    layers: (map: MapLibreGLMap) => string[];
    /** What the pointer is resting on, given the features those layers reported under it. */
    answer: (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => HoverAnswer;
    /** Held off entirely, for a map busy with something the pointer means instead. */
    disabled?: boolean;
}

/**
 * The name of the thing under the pointer, shown in a small popup once the pointer has rested.
 *
 * What every hovered name over this map has in common, the caller saying only which layers to watch
 * and what it finds there: the base map's places (see Pois) and the shapes drawn onto it (see
 * ShapeLayer). Both are named from something already in hand, so neither waits on the server the
 * way a marker's preview does (see Tooltips).
 *
 * The name is put away on a click, whatever the click was for, and does not come back until the
 * pointer has left and returned — a click is always something being done, whose result the name
 * would otherwise stand over.
 */
export function useHoverName(
    parentMap: MapLibreGLMap | null, { layers, answer, disabled }: HoverNameOptions) {
    // Read through a ref so a caller can hand over plain arrows without the handlers being bound
    // again on every render.
    const latest = useRef({ layers, answer });
    latest.current = { layers, answer };

    useEffect(() => {
        if (!parentMap || disabled) return;
        // Aliased so the narrowing above carries into the functions below.
        const map = parentMap;

        const popup = new Popup({
            closeButton: false,
            closeOnClick: false,
            // Otherwise MapLibre puts the caret in the popup as it opens, taking the focus out of
            // whatever the user was typing in (see Tooltips).
            focusAfterOpen: false,
            offset: NAME_OFFSET,
            className: "geo-hover-name"
        });

        let bound: string[] = [];
        /** What the name belongs to, or what the last click was on until the pointer leaves it. */
        let named: string | null = null;
        let showTimer: ReturnType<typeof setTimeout> | undefined;

        const setCursor = (cursor: string) => { map.getCanvas().style.cursor = cursor; };

        function hide() {
            clearTimeout(showTimer);
            popup.remove();
        }

        function onMouseMove(e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) {
            const answered = latest.current.answer(e);

            if (answered === "deferred") {
                named = null;
                hide();
                return;
            }

            if (!answered) {
                named = null;
                setCursor("");
                hide();
                return;
            }

            setCursor("pointer");
            // Watched by the move rather than by `mouseenter`, which fires on entering the layer
            // rather than the thing: the pointer crossing from one to the next never leaves the
            // layer, and the first name would stay up over the second.
            if (answered.id === named) return;

            named = answered.id;
            hide();
            showTimer = setTimeout(() => {
                popup.setLngLat(answered.lngLat).setDOMContent(nameLabel(answered)).addTo(map);
            }, REST_DELAY);
        }

        function onMouseLeave() {
            named = null;
            setCursor("");
            hide();
        }

        function unbind() {
            if (bound.length) {
                map.off("mousemove", bound, onMouseMove);
                map.off("mouseleave", bound, onMouseLeave);
            }
            bound = [];
        }

        function bind() {
            const wanted = latest.current.layers(map);
            if (wanted.length === bound.length && wanted.every((id, i) => id === bound[i])) return;

            unbind();
            bound = wanted;
            if (bound.length) {
                map.on("mousemove", bound, onMouseMove);
                map.on("mouseleave", bound, onMouseLeave);
            }
        }

        bind();
        // Two ways the layers under the pointer change: a style switch replaces every one of them,
        // and a layer added or taken away within a style, a shape drawn or removed, changes which
        // of them there are. `bind` does nothing where they turn out to be the same, so the second,
        // which MapLibre reports freely, costs a comparison.
        map.on("style.load", bind);
        map.on("styledata", bind);
        // `named` is left standing rather than cleared, which is what keeps the name from coming
        // back over whatever the click has just opened: the thing under the pointer stays the one
        // already named until the pointer leaves it.
        map.on("click", hide);

        return () => {
            map.off("style.load", bind);
            map.off("styledata", bind);
            map.off("click", hide);
            unbind();
            hide();
            // The pointer is put back by hand, since this can be torn down while it sits on
            // something and the `mouseleave` that would have cleared it is no longer listened for.
            setCursor("");
        };
    }, [ parentMap, disabled ]);
}

/** The name as it is shown: the mark the thing wears, where it wears one, and what it is called. */
function nameLabel({ icon, text }: HoverName) {
    const label = document.createElement("span");
    label.className = "geo-hover-name-label";

    if (icon) {
        const mark = document.createElement("i");
        mark.className = icon;
        label.appendChild(mark);
    }

    const name = document.createElement("span");
    // A place is named by whatever OpenStreetMap holds and a shape by its note's title, neither of
    // which is ours to read as markup.
    name.textContent = text;
    label.appendChild(name);

    return label;
}
