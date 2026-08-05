import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverGet = vi.fn<(url: string) => Promise<string | Uint8Array>>();

vi.mock("../../../services/server", () => ({
    default: { get: (url: string) => serverGet(url) }
}));

// Pinned rather than read from the environment: the tiles' units are what the assertions read,
// and the host machine's locale must not decide whether they say km or mi.
vi.mock("../../../utils/formatters", () => ({
    getMeasurementSystem: () => "metric"
}));

// i18next is never initialized under test, so t() is rendered deterministic instead: the key with
// the interpolated values appended, e.g. "gpx_preview.unit_km|11.1".
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => [ key, ...Object.values(opts ?? {}) ].join("|")
}));

const { default: GpxPreview } = await import("./GpxPreview");

type PreviewProps = Parameters<typeof GpxPreview>[0];

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
    <metadata><name>Ridge loop</name><desc>Up and back down</desc></metadata>
    <trk><trkseg>
        <trkpt lat="0" lon="0"><ele>100</ele><time>2024-06-01T10:00:00Z</time></trkpt>
        <trkpt lat="0" lon="0.05"><ele>150</ele><time>2024-06-01T10:30:00Z</time></trkpt>
        <trkpt lat="0" lon="0.1"><ele>120</ele><time>2024-06-01T11:00:00Z</time></trkpt>
    </trkseg></trk>
</gpx>`;

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
});

function mount({ noteId = "gpx1", title = "hike.gpx", color = null as string | null, blob = { blobId: "blobA" } } = {}) {
    const note = {
        noteId,
        title,
        mime: "application/gpx+xml",
        getLabelValue: () => color
    } as unknown as PreviewProps["note"];
    render(<GpxPreview note={note} blob={blob as PreviewProps["blob"]} />, container);
}

function tileValue(label: string): string | undefined {
    for (const tile of container.querySelectorAll(".gpx-stat")) {
        if (tile.querySelector(".gpx-stat-label")?.textContent === label) {
            return tile.querySelector(".gpx-stat-value")?.textContent ?? undefined;
        }
    }
    return undefined;
}

describe("GpxPreview", () => {
    it("fetches the file raw and lays the track's numbers out as tiles", async () => {
        serverGet.mockResolvedValue(GPX);

        mount();
        await vi.waitFor(() => expect(container.querySelector(".gpx-preview")).not.toBeNull());
        expect(serverGet).toHaveBeenCalledWith("notes/gpx1/open");

        // 0.1° along the equator ≈ 11.1 km, walked in an hour. The decimal separator is the
        // machine's, so the fraction is matched rather than spelled.
        expect(tileValue("gpx_preview.distance")).toMatch(/^gpx_preview\.unit_km\|11[.,]1$/);
        expect(tileValue("gpx_preview.duration")).toBe("gpx_preview.duration_hours_minutes|1|0");
        expect(tileValue("gpx_preview.avg_speed")).toMatch(/^gpx_preview\.unit_kmh\|11[.,]1$/);
        expect(tileValue("gpx_preview.elevation_gain")).toBe("gpx_preview.unit_m|50");
        expect(tileValue("gpx_preview.elevation_loss")).toBe("gpx_preview.unit_m|30");
        expect(tileValue("gpx_preview.max_elevation")).toBe("gpx_preview.unit_m|150");
        expect(tileValue("gpx_preview.points")).toBe("3");
        expect(tileValue("gpx_preview.segments")).toBe("1");
        // A single track and no routes/waypoints say nothing worth a tile.
        expect(tileValue("gpx_preview.tracks")).toBeUndefined();
        expect(tileValue("gpx_preview.routes")).toBeUndefined();
        expect(tileValue("gpx_preview.waypoints")).toBeUndefined();

        // The file's own name and description are shown (the note is titled differently).
        expect(container.querySelector(".gpx-preview-name")?.textContent).toBe("Ridge loop");
        expect(container.querySelector(".gpx-preview-description")?.textContent).toBe("Up and back down");

        // The elevation profile is drawn, spanning the track's extremes.
        expect(container.querySelector(".gpx-profile-line")).not.toBeNull();
        expect(container.querySelector(".gpx-profile-max")?.textContent).toBe("gpx_preview.unit_m|150");
        expect(container.querySelector(".gpx-profile-min")?.textContent).toBe("gpx_preview.unit_m|100");

        // And the way to the whole track is pointed out. (Inside a geo map's own pane the hint is
        // suppressed by the pane's CSS, which a DOM assertion here cannot see.)
        expect(container.querySelector(".gpx-preview-map-hint")?.textContent).toContain("gpx_preview.map_hint");
    });

    it("decodes a binary response and paints the profile in the note's own colour", async () => {
        serverGet.mockResolvedValue(new TextEncoder().encode(GPX));

        mount({ color: "#ff7700" });
        await vi.waitFor(() => expect(container.querySelector(".gpx-preview")).not.toBeNull());

        const plot = container.querySelector<HTMLElement>(".gpx-profile-plot");
        expect(plot?.style.color).toBe("#ff7700");
    });

    it("hides the file's name when it just repeats the note's title", async () => {
        serverGet.mockResolvedValue(GPX);

        mount({ title: "Ridge loop" });
        await vi.waitFor(() => expect(container.querySelector(".gpx-preview")).not.toBeNull());
        expect(container.querySelector(".gpx-preview-name")).toBeNull();
    });

    it("falls back to the not-available notice for a file that is not readable GPX", async () => {
        serverGet.mockResolvedValue("not gpx <at all");

        mount();
        await vi.waitFor(() => expect(container.querySelector(".file-preview-not-available")).not.toBeNull());
        expect(container.querySelector(".gpx-preview")).toBeNull();
    });

    it("shows nothing until the blob has arrived", () => {
        mount({ blob: null as unknown as { blobId: string } });
        expect(container.innerHTML).toBe("");
        expect(serverGet).not.toHaveBeenCalled();
    });
});
