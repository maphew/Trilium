import { randomString } from "../../services/utils";

/**
 * A formatted run of text, as the highlights sidebar consumes it. Every producer — the text
 * editor, read-only HTML, the Markdown preview — reduces its own representation to this.
 */
export interface RawHighlight {
    id: string;
    /** Inline HTML of the run, so nested content (e.g. maths) survives into the list. */
    text: string;
    attrs: {
        bold: boolean;
        italic: boolean;
        underline: boolean;
        color: string | undefined;
        background: string | undefined;
    }
}

export interface DomHighlight extends RawHighlight {
    element: HTMLElement;
}

/**
 * Collects the formatted runs of a rendered HTML tree: coloured runs first, then bold/italic/
 * underline ones that are not already inside a coloured run.
 *
 * Used both for read-only text notes and for the Markdown preview, whose rendered HTML this
 * treats identically — `**bold**` reaches here as `<strong>` like any other.
 */
export function extractHighlightsFromStaticHtml(el: HTMLElement | null) {
    if (!el) return [];

    const highlights: DomHighlight[] = [];
    const processedElements = new Set<Element>();

    // Find all elements with inline background-color or color styles
    const styledElements = el.querySelectorAll<HTMLElement>('[style*="background-color"], [style*="color"]');

    for (const styledEl of styledElements) {
        if (processedElements.has(styledEl)) continue;
        if (!styledEl.textContent?.trim()) continue;

        const attrs: RawHighlight["attrs"] = {
            bold: !!styledEl.closest("strong"),
            italic: !!styledEl.closest("em"),
            underline: !!styledEl.closest("u"),
            background: styledEl.style.backgroundColor,
            color: styledEl.style.color
        };

        if (Object.values(attrs).some(Boolean)) {
            processedElements.add(styledEl);

            highlights.push({
                id: randomString(),
                text: styledEl.innerHTML,
                element: styledEl,
                attrs
            });
        }
    }

    // Also find bold, italic, underline elements
    const formattingElements = el.querySelectorAll<HTMLElement>("strong, em, u, b, i");

    for (const formattedEl of formattingElements) {
        // Skip if already processed or inside a processed element
        if (processedElements.has(formattedEl)) continue;
        if (Array.from(processedElements).some(processed => processed.contains(formattedEl))) continue;
        if (!formattedEl.textContent?.trim()) continue;

        const attrs: RawHighlight["attrs"] = {
            bold: formattedEl.matches("strong, b"),
            italic: formattedEl.matches("em, i"),
            underline: formattedEl.matches("u"),
            background: formattedEl.style.backgroundColor,
            color: formattedEl.style.color
        };

        if (Object.values(attrs).some(Boolean)) {
            processedElements.add(formattedEl);

            highlights.push({
                id: randomString(),
                text: formattedEl.innerHTML,
                element: formattedEl,
                attrs
            });
        }
    }

    return highlights;
}
