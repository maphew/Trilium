import {
    type AdaptiveColorBand,
    type AdaptiveColorBands,
    type AdaptiveColorRole,
    DEFAULT_ADAPTIVE_COLOR_BANDS
} from "@triliumnext/commons";

import { readCssVar } from "../utils/css-var.js";

/**
 * The theme's limits for adaptive colors, read once from the `--adaptive-*` CSS variables declared
 * in `style.css`.
 */
export const ADAPTIVE_COLOR_BANDS = readAdaptiveColorBands(document.documentElement);

/**
 * Reads the `--adaptive-<role>-<light|dark>-<min-lightness|max-lightness|max-chroma>` variables.
 * A variable that is missing or not a number keeps its default; `none` means no chroma cap.
 */
export function readAdaptiveColorBands(element: HTMLElement): AdaptiveColorBands {
    return {
        text: readRole(element, "text", "text"),
        background: readRole(element, "background", "background"),
        tableBorder: readRole(element, "tableBorder", "table-border"),
        tableBackground: readRole(element, "tableBackground", "table-background")
    };
}

function readRole(element: HTMLElement, role: AdaptiveColorRole, name: string) {
    const defaults = DEFAULT_ADAPTIVE_COLOR_BANDS[role];
    return {
        light: readBand(element, `adaptive-${name}-light`, defaults.light),
        dark: readBand(element, `adaptive-${name}-dark`, defaults.dark)
    };
}

function readBand(element: HTMLElement, prefix: string, defaults: AdaptiveColorBand) {
    return {
        minLightness: readNumber(element, `${prefix}-min-lightness`, defaults.minLightness),
        maxLightness: readNumber(element, `${prefix}-max-lightness`, defaults.maxLightness),
        maxChroma: readNumber(element, `${prefix}-max-chroma`, defaults.maxChroma)
    };
}

function readNumber(element: HTMLElement, name: string, defaultValue: number) {
    const variable = readCssVar(element, name);
    if (variable.asString()?.trim() === "none") {
        return Infinity;
    }
    return variable.asNumber(defaultValue) ?? defaultValue;
}
