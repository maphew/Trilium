import { AddLayerObject, type GeoJSONSource } from "maplibre-gl";
import { useContext, useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { getReadableTextColor } from "../../../services/css_class_manager";
import { renderIconImage } from "../../../services/icon_glyphs";
import { useTriliumEvent } from "../../react/hooks";
import { ParentMap } from "./map";

export const LOCATION_ATTRIBUTE = "geolocation";
export const MARKER_LAYER = "points-layer";
const MARKER_SOURCE = "points";
const DEFAULT_MARKER_COLOR = "#2A81CB";

/** The pin, in the coordinates its SVG is drawn in. */
const MARKER_WIDTH = 25;
const MARKER_HEIGHT = 41;
/**
 * Room left around the pin for its shadow, in those same coordinates.
 *
 * The shadow is drawn by a filter and an SVG clips to its own viewport, so a canvas the size of the
 * pin cuts the blur off in a straight line down either side and across the tip — on a light map that
 * reads as a grey box behind the pin rather than as a shadow. Wide enough for the blur (about three
 * times its deviation) plus the distance it is pushed down.
 */
const MARKER_SHADOW_PADDING = 6;
const MARKER_ICON_SIZE = 20;
// Centred on the pin's round head, which is a circle of the pin's own width sitting at the top.
const MARKER_ICON_X = (MARKER_WIDTH - MARKER_ICON_SIZE) / 2;
const MARKER_ICON_Y = (MARKER_WIDTH - MARKER_ICON_SIZE) / 2;

const LABEL_LAYOUT: Extract<AddLayerObject, { type: "symbol" }>["layout"] = {
    "text-field": [ "get", "name" ],
    "text-font": [ "Open Sans Regular" ],
    "text-size": 12,
    "text-anchor": "top",
    "text-allow-overlap": true
};

/**
 * Every note that carries a location, drawn as one symbol layer.
 *
 * A layer rather than an element apiece: the map is meant to hold thousands of notes, and a DOM node
 * per note is what made that slow. The pin is rasterized once per colour and icon and handed to the
 * map as an image, which the layer then stamps on the GPU.
 */
export default function Markers({ notes, hideLabels }: { notes: FNote[], hideLabels: boolean }) {
    const map = useContext(ParentMap);
    const version = useNoteChangeVersion(notes);

    useEffect(() => {
        if (!map) return;

        let cancelled = false;
        let stopListening: (() => void) | undefined;

        async function render() {
            const { features, images } = await buildMarkerData(notes);
            if (cancelled || !map) return;

            /**
             * Puts the layer and its data back on the map. A style is a world of its own — switching
             * one wipes every source, layer and image added to the last — so this has to run again
             * after each style load, not only when the notes change.
             */
            function install() {
                if (!map) return;

                for (const [ id, image ] of images) {
                    if (!map.hasImage(id)) {
                        map.addImage(id, image, { pixelRatio: window.devicePixelRatio || 1 });
                    }
                }

                if (!map.getSource(MARKER_SOURCE)) {
                    map.addSource(MARKER_SOURCE, {
                        type: "geojson",
                        data: { type: "FeatureCollection", features: [] }
                    });
                }

                if (!map.getLayer(MARKER_LAYER)) {
                    map.addLayer({
                        id: MARKER_LAYER,
                        type: "symbol",
                        source: MARKER_SOURCE,
                        layout: {
                            "icon-image": [ "get", "icon" ],
                            "icon-size": 1,
                            "icon-anchor": "bottom",
                            // The image carries padding for the shadow, so its bottom edge sits
                            // below the pin's tip. Push it back down by exactly that much, or every
                            // marker would stand a shadow's width off its own coordinate.
                            "icon-offset": [ 0, MARKER_SHADOW_PADDING ],
                            "icon-allow-overlap": true,
                            ...(hideLabels ? {} : LABEL_LAYOUT)
                        },
                        paint: {
                            // Archived notes are drawn faintly, as they were when each marker was an
                            // element of its own wearing an `archived` class.
                            "icon-opacity": [ "case", [ "get", "archived" ], 0.5, 1 ],
                            "text-opacity": [ "case", [ "get", "archived" ], 0.5, 1 ],
                            "text-color": "#333",
                            "text-halo-color": "#fff",
                            "text-halo-width": 1
                        }
                    });
                }

                map.getSource<GeoJSONSource>(MARKER_SOURCE)?.setData({
                    type: "FeatureCollection",
                    features
                });
            }

            if (map.isStyleLoaded()) {
                install();
            }
            map.on("style.load", install);
            stopListening = () => map.off("style.load", install);
        }

        render();

        return () => {
            cancelled = true;
            stopListening?.();
            if (map.getLayer(MARKER_LAYER)) {
                map.removeLayer(MARKER_LAYER);
            }
            if (map.getSource(MARKER_SOURCE)) {
                map.removeSource(MARKER_SOURCE);
            }
        };
    }, [ map, notes, hideLabels, version ]);

    return null;
}

/** A GeoJSON feature per located note, and the pin image each of them asks for. */
async function buildMarkerData(notes: FNote[]) {
    const features: GeoJSON.Feature[] = [];
    const images = new Map<string, HTMLImageElement>();

    for (const note of notes) {
        const latLng = parseLocation(note.getLabelValue(LOCATION_ATTRIBUTE));
        if (!latLng) continue;

        const color = note.getLabelValue("color") ?? DEFAULT_MARKER_COLOR;
        const iconClass = note.getIcon();
        const id = markerImageId(color, iconClass);

        if (!images.has(id)) {
            const image = await buildMarkerImage(color, iconClass);
            if (image) {
                images.set(id, image);
            }
        }

        features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: latLng },
            properties: {
                id: note.noteId,
                name: note.title,
                archived: note.isLabelTruthy("archived"),
                icon: id
            }
        });
    }

    return { features, images };
}

/** `lat,lng` as the label stores it, as the `[lng, lat]` GeoJSON wants, or `null` if unreadable. */
export function parseLocation(location: string | null | undefined): [number, number] | null {
    if (!location) return null;

    const [ lat, lng ] = location.split(",", 2).map((part) => parseFloat(part));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return [ lng, lat ];
}

function markerImageId(color: string, iconClass: string) {
    return `marker|${color}|${iconClass}`;
}

/** What has been rasterized already, since the same few pins are asked for over and over. */
const markerImages = new Map<string, Promise<HTMLImageElement | null>>();

function buildMarkerImage(color: string, iconClass: string) {
    const id = markerImageId(color, iconClass);

    let image = markerImages.get(id);
    if (!image) {
        image = drawMarkerImage(color, iconClass);
        markerImages.set(id, image);
    }
    return image;
}

async function drawMarkerImage(color: string, iconClass: string) {
    // Drawn through the shared icon service, so a marker wears the icon its note wears everywhere
    // else — including one from a pack the user brought along. It is cut straight out of the pin
    // rather than set on a disc of its own, so the note's colour is all that is seen; the icon
    // takes whichever of black or white stands out against that colour.
    const scale = window.devicePixelRatio || 1;
    const icon = await renderIconImage(`bx ${iconClass}`, {
        size: MARKER_ICON_SIZE,
        color: getReadableTextColor(color),
        scale
    });

    const badge = icon
        ? `<image href="${icon}" x="${MARKER_ICON_X}" y="${MARKER_ICON_Y}" width="${MARKER_ICON_SIZE}" height="${MARKER_ICON_SIZE}" preserveAspectRatio="xMidYMid meet" />`
        : "";

    // The viewBox starts at the padding's negative, so the pin and its icon keep the coordinates
    // they are drawn in and only the canvas around them grows.
    const canvasWidth = MARKER_WIDTH + 2 * MARKER_SHADOW_PADDING;
    const canvasHeight = MARKER_HEIGHT + 2 * MARKER_SHADOW_PADDING;

    return svgToImage(`\
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth * scale}" height="${canvasHeight * scale}" viewBox="${-MARKER_SHADOW_PADDING} ${-MARKER_SHADOW_PADDING} ${canvasWidth} ${canvasHeight}">
    <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="black" flood-opacity="0.35" />
        </filter>
    </defs>
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" filter="url(#shadow)" fill="${escapeXmlAttribute(color)}" />
    ${badge}
</svg>`);
}

/** A colour comes from a label the user typed, and lands in an attribute of a document we build. */
function escapeXmlAttribute(value: string) {
    return value.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function svgToImage(svgString: string) {
    return new Promise<HTMLImageElement | null>((resolve) => {
        const url = URL.createObjectURL(new Blob([ svgString ], { type: "image/svg+xml" }));
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        image.src = url;
    });
}

/**
 * A number that changes whenever something a marker is drawn from does.
 *
 * The notes are drawn into one layer rather than a component apiece, so there are no per-note hooks
 * to notice a title, colour, icon or location changing. Without this, moving a marker or taking one
 * off the map would leave the old drawing in place until the collection itself reloaded.
 */
function useNoteChangeVersion(notes: FNote[]) {
    const [ version, setVersion ] = useState(0);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteIds = new Set(notes.map((note) => note.noteId));
        const touched = loadResults.getAttributeRows().some((attribute) => !!attribute.noteId && noteIds.has(attribute.noteId))
            || loadResults.getNoteIds().some((noteId) => noteIds.has(noteId));

        if (touched) {
            setVersion((current) => current + 1);
        }
    });

    return version;
}
