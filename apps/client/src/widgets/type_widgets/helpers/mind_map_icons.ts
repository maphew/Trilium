/**
 * Dresses the node icons a map carries as Trilium icon classes.
 *
 * Mind Elixir renders an icon as text — its topic renderer escapes what it is given and drops it
 * into a `<span>` — so a class such as `bx bx-star` arrives as those very words. Putting the class
 * onto the span the text landed in and emptying it leaves the icon pack's own CSS to draw it, the
 * same way an icon is drawn anywhere else in Trilium.
 *
 * Called for the whole map after every layout, which is what follows any change to a node.
 *
 * @param container the element holding the rendered nodes.
 */
export function renderIconClasses(container: HTMLElement) {
    for (const iconEl of container.querySelectorAll<HTMLElement>(".icons > span")) {
        const iconClass = iconEl.textContent?.trim() ?? "";
        if (!isIconClass(iconClass)) continue;

        iconEl.className = iconClass;
        iconEl.textContent = "";
    }
}

/**
 * Tells a Trilium icon class from an icon that came from elsewhere — a map made in another tool
 * carries emoji, which are icons in their own right and are left as they are.
 */
function isIconClass(text: string) {
    const [ prefix, name, ...rest ] = text.split(" ");
    return !rest.length && !!name && (glob.iconRegistry?.sources ?? []).some((source) => source.prefix === prefix);
}
