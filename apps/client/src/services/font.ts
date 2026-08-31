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
        return [ ...new Set(faces.map(({ family }) => family)) ].sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}
