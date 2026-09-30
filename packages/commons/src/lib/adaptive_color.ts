/** Whether a color is used for text (Font Color) or behind it (Font Background Color). */
export type AdaptiveColorRole = "text" | "background";

/**
 * Turns a color into a `light-dark(#light,#dark)` pair, so text and highlights stay readable in
 * both the light and the dark theme. The hue is kept; the CIELAB lightness is moved into the band
 * of the role and theme, and the chroma is capped.
 *
 * @param color a hex, `rgb()` or `hsl()` color. Anything else, including a color that is already
 *     a pair, is returned unchanged.
 */
export function adaptColor(color: string, role: AdaptiveColorRole): string {
    const rgb = parseColor(color.trim());
    if (!rgb) {
        return color;
    }

    const lab = rgbToLab(rgb);
    const bands = BANDS[role];
    return `light-dark(${fitToBand(lab, bands.light)},${fitToBand(lab, bands.dark)})`;
}

type Rgb = [number, number, number];
type Lab = [number, number, number];

interface Band {
    minLightness: number;
    maxLightness: number;
    maxChroma: number;
}

/**
 * The CIELAB lightness range and chroma cap per role and theme. The limits keep text at 4.5:1 or
 * more against the Next themes' page and against every highlight.
 */
const BANDS: Record<AdaptiveColorRole, Record<"light" | "dark", Band>> = {
    text: {
        light: { minLightness: 0, maxLightness: 40, maxChroma: Infinity },
        dark: { minLightness: 75, maxLightness: 100, maxChroma: 55 }
    },
    background: {
        light: { minLightness: 90, maxLightness: 100, maxChroma: 20 },
        dark: { minLightness: 0, maxLightness: 30, maxChroma: 30 }
    }
};

/** Below this CIELAB chroma a color counts as grey. */
const GREY_CHROMA = 1.5;

const D65_WHITE: Lab = [ 0.95047, 1, 1.08883 ];
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

function fitToBand([ lightness, a, b ]: Lab, band: Band): string {
    const chroma = Math.hypot(a, b);
    const hue = Math.atan2(b, a);

    // Greys are spread over the band instead of clamped, so each grey keeps a shade of its own.
    if (chroma < GREY_CHROMA) {
        const range = band.maxLightness - band.minLightness;
        return lchToHex(band.minLightness + (lightness / 100) * range, 0, hue);
    }

    const clamped = Math.min(Math.max(lightness, band.minLightness), band.maxLightness);
    return lchToHex(clamped, Math.min(chroma, band.maxChroma), hue);
}

/** Parses `#rgb`, `#rrggbb`, `rgb()` and `hsl()` without alpha into sRGB channels from 0 to 1. */
function parseColor(color: string): Rgb | undefined {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
    if (hex) {
        const full = hex.length === 3 ? [ ...hex ].map((digit) => digit + digit).join("") : hex;
        return [ 0, 2, 4 ].map((start) => parseInt(full.slice(start, start + 2), 16) / 255) as Rgb;
    }

    const match = /^(rgb|hsl)\(([^()]*)\)$/i.exec(color);
    const parts = match?.[2].split(/[\s,]+/).filter(Boolean);
    if (!match || parts?.length !== 3) {
        return undefined;
    }

    const numbers = parts.map((part) => parseFloat(part));
    if (numbers.some((value) => !Number.isFinite(value))) {
        return undefined;
    }

    if (match[1].toLowerCase() === "rgb") {
        return numbers.map((value, index) => {
            const channel = parts[index].endsWith("%") ? value / 100 : value / 255;
            return Math.min(1, Math.max(0, channel));
        }) as Rgb;
    }

    return hslToRgb(numbers[0], numbers[1] / 100, numbers[2] / 100);
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
    const s = Math.min(1, Math.max(0, saturation));
    const l = Math.min(1, Math.max(0, lightness));
    const amount = s * Math.min(l, 1 - l);
    const channel = (offset: number) => {
        const k = (offset + hue / 30) % 12;
        return l - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [ channel(0), channel(8), channel(4) ];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToLab(rgb: Rgb): Lab {
    const [ r, g, b ] = rgb.map(toLinear);
    const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
    const f = (t: number) => (t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116);
    const [ fx, fy, fz ] = [ x / D65_WHITE[0], y / D65_WHITE[1], z / D65_WHITE[2] ].map(f);
    return [ 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz) ];
}

function lchToLinearRgb(lightness: number, chroma: number, hue: number): Rgb {
    const fy = (lightness + 16) / 116;
    const fx = fy + (chroma * Math.cos(hue)) / 500;
    const fz = fy - (chroma * Math.sin(hue)) / 200;
    const inverse = (t: number) => (t ** 3 > LAB_EPSILON ? t ** 3 : (116 * t - 16) / LAB_KAPPA);
    const x = inverse(fx) * D65_WHITE[0];
    const yRatio = lightness > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : lightness / LAB_KAPPA;
    const y = yRatio * D65_WHITE[1];
    const z = inverse(fz) * D65_WHITE[2];
    return [
        3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
        -0.969266 * x + 1.8760108 * y + 0.041556 * z,
        0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    ];
}

const isInGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-7 && c <= 1 + 1e-7);

/** Converts to hex, lowering the chroma until the color fits sRGB so that the hue is kept. */
function lchToHex(lightness: number, chroma: number, hue: number): string {
    let rgb = lchToLinearRgb(lightness, chroma, hue);
    if (!isInGamut(rgb)) {
        let low = 0;
        let high = chroma;
        for (let step = 0; step < 30; step++) {
            const middle = (low + high) / 2;
            if (isInGamut(lchToLinearRgb(lightness, middle, hue))) {
                low = middle;
            } else {
                high = middle;
            }
        }
        rgb = lchToLinearRgb(lightness, low, hue);
    }

    return `#${rgb
        .map((c) => Math.round(fromLinear(Math.min(1, Math.max(0, c))) * 255))
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")}`;
}
