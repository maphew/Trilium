import "./MapToolbar.css";

import type { MindElixirInstance } from "mind-elixir";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import ActionButton, { type ActionButtonProps } from "../../react/ActionButton";
import { centerMapOn, type MapPoint, readMapCenter, stepZoom } from "./viewport";

interface MapToolbarProps {
    mind: MindElixirInstance;
}

/**
 * The bar standing in the bottom corner of a mind map: the scale the map is drawn at, where it
 * stands, and how much of the screen it is given.
 *
 * Mind Elixir puts a bar of its own in that corner, which is hidden (see MindMap.css). It is the one
 * piece of furniture the library lays over the map, and it was dressed in neither Trilium's buttons
 * nor Trilium's colors — it kept its own icons and its own surface next to the node panel above it.
 * Everything it did is done here, over the same instance.
 */
export default function MapToolbar({ mind }: MapToolbarProps) {
    const scale = useMapScale(mind);
    const [ isFullscreen, toggleFullscreen ] = useMapFullscreen(mind);

    const limits = { sensitivity: mind.scaleSensitivity, min: mind.scaleMin, max: mind.scaleMax };
    const zoomedIn = stepZoom(scale, 1, limits);
    const zoomedOut = stepZoom(scale, -1, limits);

    return (
        <div
            className="mind-map-toolbar"
            /* Keep interactions inside the bar from reaching the map underneath, which would
               otherwise take a press on a button for the start of a drag or a selection. */
            onMouseDown={(e) => e.stopPropagation()}
        >
            <ToolbarButton
                icon="bx bx-zoom-in"
                text={t("mind-map.zoom-in")}
                disabled={zoomedIn === null}
                onClick={() => zoomedIn !== null && mind.scale(zoomedIn)}
            />

            <ToolbarButton
                icon="bx bx-zoom-out"
                text={t("mind-map.zoom-out")}
                disabled={zoomedOut === null}
                onClick={() => zoomedOut !== null && mind.scale(zoomedOut)}
            />

            <ToolbarButton
                icon="bx bx-current-location"
                text={t("mind-map.center-map")}
                onClick={() => mind.toCenter()}
            />

            <ToolbarButton
                icon={isFullscreen ? "bx bx-exit-fullscreen" : "bx bx-fullscreen"}
                text={isFullscreen ? t("mind-map.exit-fullscreen") : t("mind-map.fullscreen")}
                onClick={toggleFullscreen}
            />
        </div>
    );
}

/** Dressed as the buttons floating over a rendered diagram are (see SplitEditor's `PreviewButton`). */
function ToolbarButton(props: Omit<ActionButtonProps, "titlePosition">) {
    return <ActionButton
        {...props}
        className="tn-tool-button"
        noIconActionClass
        // The bar sits at the foot of the map, where a tooltip under it would fall off the edge.
        titlePosition="top"
    />;
}

/**
 * The scale the map is drawn at, followed as it changes — by these buttons, by the wheel, or by the
 * map fitting itself. What it is read for is whether there is any room left to zoom, which is what
 * leaves a button that would do nothing disabled instead.
 */
function useMapScale(mind: MindElixirInstance) {
    const [ scale, setScale ] = useState(mind.scaleVal);

    useEffect(() => {
        // The map may have been moved between being built and being listened to.
        setScale(mind.scaleVal);

        mind.bus.addListener("scale", setScale);
        return () => mind.bus.removeListener("scale", setScale);
    }, [ mind ]);

    return scale;
}

/**
 * Whether the map has the screen to itself, and the way to give it or take it back.
 *
 * What was in the middle of the view is put back in the middle of the new one: the map is drawn at
 * the same scale on a canvas of a different size, and would otherwise keep the offset it had and
 * slide off towards the corner it is pinned to. The point is taken as the change is asked for and
 * spent when it lands — a change is only reported once the view has already been resized, leaving
 * nothing to measure by then. A screen left by pressing Escape is therefore not followed, as it was
 * not by the bar this one replaces.
 */
function useMapFullscreen(mind: MindElixirInstance): [ boolean, () => void ] {
    const [ isFullscreen, setFullscreen ] = useState(() => document.fullscreenElement === mind.el);
    const center = useRef<MapPoint | null>(null);

    useEffect(() => {
        const onFullscreenChange = () => {
            setFullscreen(document.fullscreenElement === mind.el);

            const taken = center.current;
            center.current = null;
            if (taken) centerMapOn(mind, taken);
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, [ mind ]);

    const toggle = useCallback(() => {
        center.current = readMapCenter(mind);

        const changed = document.fullscreenElement ? document.exitFullscreen() : mind.el.requestFullscreen();
        // A refused request leaves the view the size it was, so there is nothing to put back — and
        // holding on to the point would move the map on whatever change came next.
        changed?.catch((e) => {
            center.current = null;
            console.warn("Could not change the mind map's fullscreen state:", e);
        });
    }, [ mind ]);

    return [ isFullscreen, toggle ];
}
