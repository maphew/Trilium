/** Marks the icon moved ahead of a node's text, both to dress it and to know it has been moved. */
export const LEAD_ICON_CLASS = "mind-map-lead-icon";

/**
 * Dresses the node icons a map carries as Trilium icon classes, and sets the first of them ahead of
 * the node's text.
 *
 * Mind Elixir renders an icon as text — its topic renderer escapes what it is given and drops it
 * into a `<span>` — so a class such as `bx bx-star` arrives as those very words. Putting the class
 * onto the span the text landed in and emptying it leaves the icon pack's own CSS to draw it, the
 * same way an icon is drawn anywhere else in Trilium.
 *
 * Called for the whole map after every layout, which is what follows any change to a node.
 *
 * @param container the element holding the rendered nodes.
 * @returns whether anything was changed, and with it the width of the node it sits on — the class
 *          takes far more room as words than as the icon it becomes, so a caller that has measured
 *          the map has to measure it again.
 */
export function renderIconClasses(container: HTMLElement) {
    let changed = false;

    for (const iconEl of container.querySelectorAll<HTMLElement>(".icons > span")) {
        const iconClass = iconEl.textContent?.trim() ?? "";
        if (!isIconClass(iconClass)) continue;

        iconEl.className = iconClass;
        // Emptied down to an empty text node rather than to nothing at all: Mind Elixir's SVG
        // exporter reads `span.childNodes[0].textContent` for every icon it comes across, and a
        // span holding no children at all throws — which failed the save of any map with an icon,
        // the preview being rendered through that exporter.
        iconEl.replaceChildren(document.createTextNode(""));
        changed = true;
    }

    return leadWithFirstIcon(container) || changed;
}

/**
 * Moves the first icon of every node ahead of its text, where a note wears its own.
 *
 * Mind Elixir builds a topic in an order of its own — the icons after the text — and the parts of
 * it are laid inline, so there is no reordering them but by moving one. It is moved back on every
 * render of the node, and this runs after every one of those.
 *
 * The ones that follow stay where they are, which is also what keeps the exporter reading them: it
 * looks for the icons inside their wrapper, and what leaves it is not drawn there. That costs
 * nothing today, an exported map carrying no icon font to draw any of them with.
 */
function leadWithFirstIcon(container: HTMLElement) {
    let moved = false;

    for (const topic of container.querySelectorAll<HTMLElement>("me-tpc")) {
        // One already at the front is this same pass having run before, the node not having been
        // rendered since; moving again would take the second icon along with it.
        if (topic.querySelector(`:scope > .${LEAD_ICON_CLASS}`)) continue;

        const firstIcon = topic.querySelector<HTMLElement>(":scope > .icons > span");
        const text = topic.querySelector(":scope > .text");
        if (!firstIcon || !text) continue;

        firstIcon.classList.add(LEAD_ICON_CLASS);
        topic.insertBefore(firstIcon, text);
        moved = true;
    }

    return moved;
}

/**
 * Tells a Trilium icon class from an icon that came from elsewhere — a map made in another tool
 * carries emoji, which are icons in their own right and are left as they are.
 */
function isIconClass(text: string) {
    const [ prefix, name, ...rest ] = text.split(" ");
    return !rest.length && !!name && (glob.iconRegistry?.sources ?? []).some((source) => source.prefix === prefix);
}
