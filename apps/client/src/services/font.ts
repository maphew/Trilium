/** Marks the server-generated fonts stylesheet so it can be replaced when a font option changes. */
const FONT_STYLESHEET_ATTR = "data-font-stylesheet";

let version = 0;

/** Creates the (marked) fonts stylesheet link. Used both at boot and when re-applying fonts live. */
export function createFontStylesheetLink(): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // A bumped query param busts the browser cache so the server regenerates the CSS from the latest options.
    link.href = version === 0 ? "api/fonts" : `api/fonts?v=${version}`;
    link.setAttribute(FONT_STYLESHEET_ATTR, "true");
    return link;
}

/**
 * Re-fetches the server-generated fonts stylesheet and swaps it in without reloading. The server returns an empty
 * stylesheet when font overrides are disabled, so this also correctly reverts to the theme defaults. The previous
 * stylesheet is removed only once the new one has loaded, keeping the swap free of a flash of unstyled content.
 */
export function applyFontsFromOptions() {
    version++;

    const oldLinks = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[${FONT_STYLESHEET_ATTR}]`));
    const newLink = createFontStylesheetLink();

    const anchor = oldLinks.at(-1);
    if (anchor) {
        anchor.after(newLink);
    } else {
        document.head.appendChild(newLink);
    }

    newLink.addEventListener("load", () => {
        for (const oldLink of oldLinks) {
            oldLink.remove();
        }
    }, { once: true });
    // If the new stylesheet fails to load, keep the previous one rather than dropping fonts entirely.
    newLink.addEventListener("error", () => newLink.remove(), { once: true });
}

/**
 * The font families installed on this device, sorted, for the font picker to offer. Deduplicated by
 * family: `queryLocalFonts()` reports one entry per face, so a family with four weights arrives four
 * times.
 *
 * Empty wherever the runtime does not answer — the API is Chromium-only, needs a secure context, and
 * rejects while the `local-fonts` permission is denied. Callers fall back to the stock list, which is
 * what every runtime other than the desktop app gets.
 */
export async function listSystemFontFamilies(): Promise<string[]> {
    if (typeof window.queryLocalFonts !== "function") {
        return [];
    }

    try {
        const faces = await window.queryLocalFonts();
        const families = [ ...new Set(faces.map(({ family }) => family)) ];
        const context = createProbeContext();

        // Nothing to draw on, so nothing is judged and every family stays on the list.
        const drawable = context ? families.filter((family) => rendersText(context, family)) : families;

        return drawable.sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

/**
 * One Latin and one CJK character, each drawn on its own. A character a family does not cover falls
 * back to one that does and paints, so a character that paints nothing can only be one the family
 * claims and cannot draw. Drawing them together would hide that: the covered one paints, and the
 * count says the family is fine.
 */
const PROBE_CHARACTERS = [ "A", "日" ];

/** Big enough that a light glyph still covers a pixel once it is rasterized. */
const PROBE_FONT_SIZE = 20;

/** The surface every family is drawn on, or `null` where the runtime offers no canvas. */
function createProbeContext() {
    const canvas = document.createElement("canvas");
    canvas.width = PROBE_FONT_SIZE * 2;
    canvas.height = PROBE_FONT_SIZE * 2;

    return canvas.getContext("2d", { willReadFrequently: true });
}

/**
 * Whether text set in `family` appears at all. A family can resolve, lend its metrics to the layout
 * and still draw nothing — GNU Unifont installs bitmap faces beside its outline one, and the name
 * matches a bitmap face that the engine measures but will not rasterize. Offering such a family
 * would let the interface be set in a font that leaves it correctly laid out and invisible.
 *
 * One `context` serves every family: each character is cleared before the next is drawn, and the
 * font is named again for each.
 */
function rendersText(context: CanvasRenderingContext2D, family: string): boolean {
    const { width, height } = context.canvas;

    for (const character of PROBE_CHARACTERS) {
        context.clearRect(0, 0, width, height);
        context.font = `${PROBE_FONT_SIZE}px "${family}"`;
        context.fillText(character, 0, PROBE_FONT_SIZE * 1.5);

        if (!isAnythingPainted(context.getImageData(0, 0, width, height))) {
            return false;
        }
    }

    return true;
}

/** Whether any pixel was covered, read from the alpha channel — the colour drawn in does not matter. */
function isAnythingPainted({ data }: ImageData): boolean {
    for (let offset = 3; offset < data.length; offset += 4) {
        if (data[offset] !== 0) {
            return true;
        }
    }

    return false;
}
