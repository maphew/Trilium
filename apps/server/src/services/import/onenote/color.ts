/**
 * Small color helpers shared by the OneNote importer's HTML converter (table-shading correction in
 * converter.ts) and its InkML renderer (theme-adaptive ink in inkml.ts). Both correct the same
 * OneNote quirk — colors exported for one canvas lightness rendered on the opposite one — by
 * reflecting a color's HSL lightness (L → 1 − L) while leaving hue and saturation untouched.
 */

/** Parses a `#rgb` or `#rrggbb` colour to [r, g, b] (0-255), or null if it isn't a hex colour. */
export function parseHexColor(value: string): [number, number, number] | null {
    const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) {
        return null;
    }
    const hex = match[1].length === 3 ? match[1].replace(/(.)/g, "$1$1") : match[1];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Converts an [r, g, b] (0-255) colour to [h, s, l], each in [0, 1]. */
export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (delta === 0) {
        return [0, 0, lightness];
    }
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue: number;
    switch (max) {
        case r:
            hue = (g - b) / delta + (g < b ? 6 : 0);
            break;
        case g:
            hue = (b - r) / delta + 2;
            break;
        default:
            hue = (r - g) / delta + 4;
            break;
    }
    return [hue / 6, saturation, lightness];
}

/** Converts [h, s, l] (each in [0, 1]) back to a `#rrggbb` hex colour. */
export function hslToHex(h: number, s: number, l: number): string {
    const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");
    if (s === 0) {
        return `#${channel(l).repeat(3)}`;
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const component = (t: number) => {
        if (t < 0) {
            t += 1;
        }
        if (t > 1) {
            t -= 1;
        }
        if (t < 1 / 6) {
            return p + (q - p) * 6 * t;
        }
        if (t < 1 / 2) {
            return q;
        }
        if (t < 2 / 3) {
            return p + (q - p) * (2 / 3 - t) * 6;
        }
        return p;
    };
    return `#${channel(component(h + 1 / 3))}${channel(component(h))}${channel(component(h - 1 / 3))}`;
}
