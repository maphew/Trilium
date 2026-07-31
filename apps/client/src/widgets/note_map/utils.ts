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

