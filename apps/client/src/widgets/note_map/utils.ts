export type NoteMapWidgetMode = "ribbon" | "sidebar" | "hoisted" | "type";
export type MapType = "tree" | "link";

/** Whether the map is rooted at the note being read, rather than at a configured or hoisted note. */
export function isRootedAtCurrentNote(widgetMode: NoteMapWidgetMode) {
    return widgetMode === "ribbon" || widgetMode === "sidebar";
}

/** The map a note asks to be drawn as through its `mapType` label, the link map standing for anything else. */
export function toMapType(labelValue: string | null | undefined): MapType {
    return labelValue === "tree" ? "tree" : "link";
}

/** How much of the map's box is kept clear around the graph when the view is fitted to it. */
const FIT_PADDING: Record<NoteMapWidgetMode, number> = {
    // The sidebar's is not a fixed one — see getFitPadding.
    sidebar: 0,
    ribbon: 50,
    hoisted: 30,
    type: 30
};

/** What the sidebar's map is fitted with, between a map of a handful of notes and one of a crowd. */
const SIDEBAR_FIT_PADDING = { sparse: 20, dense: -25 };

/** The counts of framed notes those two are reached at, everything between being shared out evenly. */
const SIDEBAR_FIT_NOTES = { sparse: 5, dense: 25 };

/**
 * How much of the box to keep clear around the graph, given how many notes are being framed in it.
 *
 * Fixed everywhere but the sidebar, whose box is small enough that a graph fitted with room to spare
 * is a thumbnail of itself. A map of a crowd is fitted past the edges there (a negative padding): the
 * outermost notes are cropped rather than everything being shrunk to clear them, which is what the
 * room is better spent on when there is plenty left in the middle to look at.
 *
 * A map of a handful of notes has nothing to spare, and is mostly its labels — which the fit knows
 * nothing about, being measured on the notes alone — so those are given a margin instead, and the
 * maps between the two are shared out evenly.
 */
export function getFitPadding(widgetMode: NoteMapWidgetMode, framedNoteCount: number) {
    if (widgetMode !== "sidebar") {
        return FIT_PADDING[widgetMode];
    }

    const { sparse, dense } = SIDEBAR_FIT_NOTES;
    const crowdedness = Math.max(0, Math.min(1, (framedNoteCount - sparse) / (dense - sparse)));

    return SIDEBAR_FIT_PADDING.sparse + (SIDEBAR_FIT_PADDING.dense - SIDEBAR_FIT_PADDING.sparse) * crowdedness;
}

export function rgb2hex(rgb: string) {
    return `#${(rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/) || [])
        .slice(1)
        .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
        .join("")}`;
}

export function generateColorFromString(str: string, themeStyle: "light" | "dark") {
    if (themeStyle === "dark") {
        str = `0${str}`; // magic lightning modifier
    }

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    let color = "#";
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xff;

        color += `00${value.toString(16)}`.substr(-2);
    }
    return color;
}

