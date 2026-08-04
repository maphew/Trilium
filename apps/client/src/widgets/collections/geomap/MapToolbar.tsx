import "./MapToolbar.css";

import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayToolbar, { OverlayToolbarButton } from "../../react/OverlayToolbar";
import { ParentMap } from "./map";

/**
 * The bar standing in the corner of a geo map: how close in the map is drawn.
 *
 * MapLibre offers a bar of its own for this (`NavigationControl`, which is what stood here), dressed
 * in neither Trilium's buttons nor Trilium's colors — a white box with two hairline-separated squares
 * in it, on a map that may well be dark. What it did is done here instead, on the surface every bar
 * standing over a canvas shares (see {@link OverlayToolbar}), which is what the mind map's own bar
 * stands on too.
 */
export default function MapToolbar() {
    const map = useContext(ParentMap);
    const zoom = useMapZoom(map);

    if (!map) return null;

    // Before the first report, which follows the very next tick: what the map already says it is.
    const current = zoom ?? map.getZoom();

    return (
        // The bar stands at the foot of the map, so its tooltips open away from that edge, where
        // they would otherwise fall off.
        <OverlayToolbar className="geo-map-toolbar" titlePosition="top">
            <OverlayToolbarButton
                icon="bx bx-zoom-in"
                text={t("geo-map.zoom-in")}
                disabled={current >= map.getMaxZoom()}
                onClick={() => map.zoomIn()}
            />

            <OverlayToolbarButton
                icon="bx bx-zoom-out"
                text={t("geo-map.zoom-out")}
                disabled={current <= map.getMinZoom()}
                onClick={() => map.zoomOut()}
            />
        </OverlayToolbar>
    );
}

/**
 * How close in the map is drawn, followed as it changes — by these buttons, by the wheel, or by the
 * view being restored. What it is read for is whether there is any room left to zoom, which is what
 * leaves a button that would do nothing disabled instead of idle: MapLibre clamps a step past either
 * end silently.
 *
 * `zoom` rather than `zoomend`, so that a button reaching the end of the range is disabled as the
 * map arrives there rather than a moment later — the two steps are animated.
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
