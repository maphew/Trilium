import "./MapToolbar.css";

import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { useFullscreen, useStaticTooltip } from "../../react/hooks";
import { ParentMap } from "./map";

/**
 * The controls standing in the corner of a geo map: how close in the map is drawn, and how much of
 * the screen it is given.
 *
 * MapLibre offers bars of its own for both (`NavigationControl`, which is what stood here, and
 * `FullscreenControl`), dressed in neither Trilium's buttons nor Trilium's colors — a white box with
 * hairline-separated squares in it, on a map that may well be dark. What they do is done here
 * instead, on the control group the image viewer's zoom buttons stand on (`tn-overlay-control-group`,
 * see {@link ImageViewer}): a step out, a step in, and between them a readout saying how close in
 * the map is. The readout only says it — a map has no fitted view to be reset to the way an image
 * has, and the whole world is a place worth going back to only rarely.
 *
 * At the group's leading end stands the tilt, after Google Maps's own button: 3D leans the view
 * over, 2D lays it flat again. Which of the two it offers is read off the view itself rather than
 * remembered from the last press — MapLibre tilts for Ctrl and a drag as well, and a button that
 * only watched itself would go on offering a 3D the reader is already in.
 */

/** How far the button leans the view over — a lean rather than the horizon, as Google Maps takes
 *  it. Ctrl and a drag go further, all the way to MapLibre's own limit. */
const TILTED_PITCH = 45;
export default function MapToolbar() {
    const map = useContext(ParentMap);
    const zoom = useMapZoom(map);
    const pitch = useMapPitch(map);
    // The map itself rather than the whole view: what is around it is the note's own chrome, and
    // everything the bar above the map offers is on the map's right-click menu as well.
    const [ isFullscreen, toggleFullscreen ] = useFullscreen(map?.getContainer());

    const tiltRef = useRef<HTMLButtonElement>(null);
    const zoomOutRef = useRef<HTMLButtonElement>(null);
    const zoomInRef = useRef<HTMLButtonElement>(null);
    const fullscreenRef = useRef<HTMLButtonElement>(null);

    // Whether the reader is in a 3D view however they got there — the button, or Ctrl and a drag.
    const isTilted = (pitch ?? map?.getPitch() ?? 0) > 0;

    // The group stands at the foot of the map, so its tooltips open away from that edge, where
    // they would otherwise fall off.
    useStaticTooltip(tiltRef, {
        title: isTilted ? t("geo-map.exit-3d") : t("geo-map.enter-3d"),
        placement: "top"
    });
    useStaticTooltip(zoomOutRef, { title: t("geo-map.zoom-out"), placement: "top" });
    useStaticTooltip(zoomInRef, { title: t("geo-map.zoom-in"), placement: "top" });
    useStaticTooltip(fullscreenRef, {
        title: isFullscreen ? t("geo-map.exit-fullscreen") : t("geo-map.fullscreen"),
        placement: "top"
    });

    if (!map) return null;

    // Before the first report, which follows the very next tick: what the map already says it is.
    const current = zoom ?? map.getZoom();

    return (
        <div
            className="geo-map-toolbar tn-overlay-control-group"
            /* Keep a press on the controls from reaching the canvas underneath, which would
               otherwise take it for the start of a drag. */
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Its face names the view it offers, not the one in force — Google Maps's way round. */}
            <button
                ref={tiltRef}
                type="button"
                className="tn-overlay-text-button geo-map-tilt-button"
                aria-label={isTilted ? t("geo-map.exit-3d") : t("geo-map.enter-3d")}
                onClick={() => map.easeTo({ pitch: isTilted ? 0 : TILTED_PITCH })}
            >
                {isTilted ? "2D" : "3D"}
            </button>
            <button
                ref={zoomOutRef}
                type="button"
                className="tn-overlay-icon-button bx bx-minus-circle"
                aria-label={t("geo-map.zoom-out")}
                disabled={current <= map.getMinZoom()}
                onClick={() => map.zoomOut()}
            />
            {/* The readout is told, not asked: the image viewer's presses this to go back to the
                fitted view, but a map has no such view to offer — so it only says where between the
                ends the zoom stands, whole levels being all anyone does anything with. Disabled
                rather than a plain span so it stays a child the group's styling knows; the refused
                look is taken off it by `tn-overlay-readout` (see theme-next/forms.css). */}
            <button
                type="button"
                className="tn-overlay-text-button tn-overlay-readout geo-map-zoom-level"
                disabled
            >
                {Math.round(current)}
            </button>
            <button
                ref={zoomInRef}
                type="button"
                className="tn-overlay-icon-button bx bx-plus-circle"
                aria-label={t("geo-map.zoom-in")}
                disabled={current >= map.getMaxZoom()}
                onClick={() => map.zoomIn()}
            />
            <button
                ref={fullscreenRef}
                type="button"
                className={`tn-overlay-icon-button bx ${isFullscreen ? "bx-exit-fullscreen" : "bx-fullscreen"}`}
                aria-label={isFullscreen ? t("geo-map.exit-fullscreen") : t("geo-map.fullscreen")}
                // Nothing here is measured across the change: the map keeps the middle of its view
                // through a resize of its own accord, and it is told of the new size by the view
                // itself (see `useElementSize` in map.tsx).
                onClick={() => void toggleFullscreen()}
            />
        </div>
    );
}

/**
 * How close in the map is drawn, followed as it changes — by these buttons, by the wheel, or by the
 * view being restored. Read for the readout between the steps, and for whether there is any room
 * left to zoom, which is what leaves a button that would do nothing disabled instead of idle:
 * MapLibre clamps a step past either end silently.
 *
 * `zoom` rather than `zoomend`, so that the readout counts through the animated step rather than
 * jumping at its end, and a button reaching the end of the range is disabled as the map arrives
 * there rather than a moment later.
 */
function useMapZoom(map: MapLibreGLMap | null) {
    const [ zoom, setZoom ] = useState<number | null>(null);

    useEffect(() => {
        if (!map) return;

        const report = () => setZoom(map.getZoom());
        // The map may have been moved between being built and being listened to.
        report();

        map.on("zoom", report);
        return () => { map.off("zoom", report); };
    }, [ map ]);

    return zoom;
}

/**
 * How far the view is leaned over, followed as it changes — by the tilt button, or by Ctrl and a
 * drag, which MapLibre honours without being asked. Read for which view the button should offer:
 * a tilt entered by hand is as much a 3D view as one the button gave.
 */
function useMapPitch(map: MapLibreGLMap | null) {
    const [ pitch, setPitch ] = useState<number | null>(null);

    useEffect(() => {
        if (!map) return;

        const report = () => setPitch(map.getPitch());
        // The map may have been tilted between being built and being listened to.
        report();

        map.on("pitch", report);
        return () => { map.off("pitch", report); };
    }, [ map ]);

    return pitch;
}
