/**
 * The style switch, which used to take the markers with it.
 *
 * Everything a child of the map draws — the note markers, a GPX track — is a source and a layer of
 * the map's style, since a map has nowhere else to put them. Switching the style therefore dropped
 * them, and they were added again only once the new style had loaded: on a slow network the map
 * stood empty for as long as that took. They are handed to the incoming style instead.
 */
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { keepAdditions, styleContents } from "./map";

/** A style with the given sources and layers, as MapLibre serializes one. */
function style(sources: string[], layers: string[]): StyleSpecification {
    return {
        version: 8,
        sources: Object.fromEntries(sources.map((id) => [ id, { type: "geojson", data: { type: "FeatureCollection", features: [] } } ])),
        layers: layers.map((id) => ({ id, type: "background" } as LayerSpecification))
    };
}

/** The style with the markers on it, as the map stands once a child has added them. */
function withMarkers(base: StyleSpecification): StyleSpecification {
    return {
        ...base,
        sources: { ...base.sources, points: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [ ...base.layers, { id: "points-layer", type: "symbol", source: "points" } as LayerSpecification ]
    };
}

describe("keepAdditions", () => {
    const applied = style([ "openmaptiles" ], [ "background", "water" ]);
    const next = style([ "versatiles" ], [ "land", "roads" ]);

    it("carries what a child added over, and leaves the old map behind", () => {
        const transformed = keepAdditions(styleContents(applied))(withMarkers(applied), next);

        // The markers came across...
        expect(Object.keys(transformed.sources)).toContain("points");
        expect(transformed.layers.map((layer) => layer.id)).toContain("points-layer");
        // ...and the style they were sitting on did not, or it would still be drawn underneath.
        expect(Object.keys(transformed.sources)).not.toContain("openmaptiles");
        expect(transformed.layers.map((layer) => layer.id)).not.toContain("water");
        // The incoming style is otherwise untouched, and what was added is drawn over it.
        expect(transformed.layers.map((layer) => layer.id)).toEqual([ "land", "roads", "points-layer" ]);
        expect(Object.keys(transformed.sources)).toContain("versatiles");
    });

    it("hands the source over as it now stands, not as it was added", () => {
        const previous = withMarkers(applied);
        const features = [ { type: "Feature", geometry: { type: "Point", coordinates: [ 1, 2 ] }, properties: {} } ];
        previous.sources.points = { type: "geojson", data: { type: "FeatureCollection", features } as never };

        const transformed = keepAdditions(styleContents(applied))(previous, next);

        // The markers survive with the notes on them: an empty source carried across would blink
        // every marker off until the next build filled it again, which is the point of carrying it.
        expect(transformed.sources.points).toEqual(previous.sources.points);
    });

    it("leaves a style alone when there is nothing on it but itself", () => {
        const transformed = keepAdditions(styleContents(applied))(applied, next);

        expect(transformed.layers.map((layer) => layer.id)).toEqual([ "land", "roads" ]);
        expect(Object.keys(transformed.sources)).toEqual([ "versatiles" ]);
    });

    it("keeps the incoming style's own when an addition shares its name", () => {
        const clashing = style([ "points" ], [ "points-layer" ]);
        const transformed = keepAdditions(styleContents(applied))(withMarkers(applied), clashing);

        expect(transformed.sources.points).toEqual(clashing.sources.points);
        expect(transformed.layers).toHaveLength(1);
    });

    /**
     * A style named by URL is fetched by MapLibre, so we never see what is in it and cannot tell its
     * sources from a child's. Carrying nothing leaves the markers to be added again on `style.load`,
     * which is what happened before any of this.
     */
    it("carries nothing when the style it is switching from is not known", () => {
        const transformed = keepAdditions(undefined)(withMarkers(applied), next);

        expect(transformed).toBe(next);
    });
});
