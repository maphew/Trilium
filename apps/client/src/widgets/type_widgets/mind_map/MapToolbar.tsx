import "./MapToolbar.css";

import type { MindElixirInstance } from "mind-elixir";
import type { ComponentChildren } from "preact";
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
 * Mind Elixir lays two bars of its own over a map — this corner and the one opposite (see
 * {@link DirectionToolbar}) — which are left out entirely (`toolBar: false`, see MindMap.tsx). They
 * were dressed in neither Trilium's buttons nor Trilium's colors, standing on a surface of their own
 * beside the node panel they share the map with. Everything they did is done here, over the same
 * instance.
 */
export default function MapToolbar({ mind }: MapToolbarProps) {
    const scale = useMapScale(mind);
    const isFocused = useMapFocus(mind);
    const [ isFullscreen, toggleFullscreen ] = useMapFullscreen(mind);

    const limits = { sensitivity: mind.scaleSensitivity, min: mind.scaleMin, max: mind.scaleMax };
    const zoomedIn = stepZoom(scale, 1, limits);
    const zoomedOut = stepZoom(scale, -1, limits);

    return (
        <Toolbar className="mind-map-view-toolbar">
            {/* Leaving focus mode is about the map rather than about any one node, so it stands
                here rather than in the menu a node is right-clicked for — which is where Mind
                Elixir kept it, offered on every node whether the map was narrowed or not. It is
                only here while there is something to leave, the map otherwise showing all it has. */}
            {isFocused && (
                <ToolbarButton
                    icon="bx bx-exit"
                    text={t("mind-map.cancelFocus")}
                    onClick={() => mind.cancelFocus()}
                />
            )}

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
        </Toolbar>
    );
}

/**
 * The bar standing in the top corner opposite: which way the map's branches run from its root —
 * to the left of it, to the right of it, or to either side.
 *
 * The three are a choice rather than three things to do, so the one the map is laid out by is shown
 * pressed. Their marks are Mind Elixir's own, kept because they draw the very thing they set and
 * nothing in Trilium's icon set says it (see MapToolbar.css).
 */
export function DirectionToolbar({ mind }: MapToolbarProps) {
    const direction = useMapDirection(mind);

    return (
        <Toolbar className="mind-map-direction-toolbar">
            {buildDirections().map(({ value, icon, label, apply }) => (
                <ToolbarButton
                    key={value}
                    icon={`mind-map-direction-icon ${icon}`}
                    text={label}
                    active={direction === value}
                    // The bar stands at the head of the map, where a tooltip over it would fall off.
                    titlePosition="bottom"
                    onClick={() => apply(mind)}
                />
            ))}
        </Toolbar>
    );
}

/**
 * The ways a map is laid out, in the order Mind Elixir offered them: each with the value
 * `mind.direction` reads as, the mark it wears, and the call that lays the map out that way.
 *
 * Named afresh on every render, which follows a change of locale.
 */
function buildDirections() {
    return [
        {
            value: 0,
            icon: "mind-map-direction-left",
            label: t("mind-map.direction-left"),
            apply: (mind: MindElixirInstance) => mind.initLeft()
        },
        {
            value: 1,
            icon: "mind-map-direction-right",
            label: t("mind-map.direction-right"),
            apply: (mind: MindElixirInstance) => mind.initRight()
        },
        {
            value: 2,
            icon: "mind-map-direction-side",
            label: t("mind-map.direction-side"),
            apply: (mind: MindElixirInstance) => mind.initSide()
        }
    ];
}

/** The surface both bars stand on, and the reach of the map they are kept out of. */
function Toolbar({ className, children }: { className: string, children: ComponentChildren }) {
    return (
        <div
            className={`mind-map-toolbar ${className}`}
            /* Keep interactions inside the bar from reaching the map underneath, which would
               otherwise take a press on a button for the start of a drag or a selection. */
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </div>
    );
}

/** Dressed as the buttons floating over a rendered diagram are (see SplitEditor's `PreviewButton`). */
function ToolbarButton({ titlePosition, ...props }: ActionButtonProps) {
    return <ActionButton
        {...props}
        className="tn-tool-button"
        noIconActionClass
        // Away from the edge of the map the bar stands at, where a tooltip would fall off it.
        titlePosition={titlePosition ?? "top"}
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

/** The way the map is laid out, followed as it changes. */
function useMapDirection(mind: MindElixirInstance) {
    return useMapState(mind, (mind) => mind.direction);
}

/** Whether the map is narrowed to one node's branch, followed as that comes and goes. */
function useMapFocus(mind: MindElixirInstance) {
    return useMapState(mind, (mind) => mind.isFocusMode);
}

/**
 * Follows something a map holds that it does not announce in its own right.
 *
 * Neither the direction nor the focus is spoken of directly: content carrying a direction of its own
 * is taken silently as a map is filled, and narrowing a map says only that it has been laid out
 * afresh. What every one of them does say is that the branches have been drawn, which is asked after
 * instead — it costs a read of what is wanted, and it is the one word that comes however the map
 * arrived at it.
 */
function useMapState<T>(mind: MindElixirInstance, read: (mind: MindElixirInstance) => T) {
    const [ value, setValue ] = useState(() => read(mind));
    // Read afresh on every report rather than closed over, so that a listener bound once follows a
    // reader the component hands over anew on each render.
    const readRef = useRef(read);
    readRef.current = read;

    useEffect(() => {
        const report = () => setValue(() => readRef.current(mind));

        report();
        mind.bus.addListener("linkDiv", report);
        return () => mind.bus.removeListener("linkDiv", report);
    }, [ mind ]);

    return value;
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
