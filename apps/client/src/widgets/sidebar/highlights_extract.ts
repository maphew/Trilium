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
        if (processedElements.has(formattedEl)) continue;
        if (!formattedEl.textContent?.trim()) continue;
        if (isAlreadyReported(formattedEl, processedElements)) continue;

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

/**
 * Whether a run already recorded by the colour pass covers this element, making it a repeat.
 *
 * Either the element sits inside one, or one covers the whole of its text — the shape a
 * coloured run inside formatting takes, since `**==hl==**` renders as
 * `<strong><span style="background-color:…">hl</span></strong>`. The span is recorded first and
 * already reports the bold (the colour pass resolves formatting with `closest`), so listing the
 * `<strong>` too would repeat the same text, and drop the colour in the repeat.
 *
 * Formatting that only *partly* overlaps a recorded run is kept: in
 * `<strong>a <span style="color:red">b</span> c</strong>` the bold "a … c" is a run of its own
 * that nothing else reports.
 */
function isAlreadyReported(element: HTMLElement, processedElements: Set<Element>): boolean {
    const text = element.textContent?.trim();

    return Array.from(processedElements).some((processed) =>
        processed.contains(element)
        || (element.contains(processed) && processed.textContent?.trim() === text));
}
