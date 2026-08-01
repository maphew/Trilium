/** The font the note icons are drawn from, both in the page and on the map's canvas. */
export const ICON_FONT_FAMILY = "boxicons";

/**
 * The glyphs the given icon classes stand for, ready to be drawn on a canvas.
 *
 * An icon is a class in the page (`bx bx-file`) and a character in a font on the canvas, and only the
 * stylesheet knows which is which — the class sets it as the `content` of a pseudo-element. So each
 * class is asked of the browser once, by wearing it on an element of no consequence and reading back
 * what it resolved to, and the answers are kept for the drawing to look up per frame.
 *
 * @param host an element of the map to hang the probe off, so that it is styled as the map is.
 */
export function resolveIconGlyphs(iconClasses: Iterable<string>, host: HTMLElement) {
    const glyphs = new Map<string, string>();
    const probe = document.createElement("span");
    // Hidden, but laid out: a pseudo-element of a `display: none` element resolves to no content at
    // all, which is precisely what is being asked for here.
    probe.className = "icon-glyph-probe";
    host.appendChild(probe);

    try {
        for (const iconClass of new Set(iconClasses)) {
            probe.className = `icon-glyph-probe ${iconClass}`;
            // Quoted as it is written in the stylesheet — `"\ead5"` — or `none` for a class that
            // draws no icon at all.
            const content = window.getComputedStyle(probe, "::before").content;
            const glyph = content?.replace(/^["']|["']$/g, "");

            if (glyph && glyph !== "none") {
                glyphs.set(iconClass, glyph);
            }
        }
    } finally {
        probe.remove();
    }

    return glyphs;
}

/**
 * Waits for the icon font to be available to the canvas, which — unlike the page — falls back to
 * another font without a word when it is not, drawing a row of tofu where the icons should be.
 */
export async function loadIconFont() {
    try {
        await document.fonts?.load(`16px ${ICON_FONT_FAMILY}`);
    } catch {
        // Not being able to promise the font is no reason not to draw the map; at worst the icons of
        // its first paint are missing.
    }
}
