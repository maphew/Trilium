/** Flips a hovered submenu up, or to its other side, where it overflows the viewport as placed. */
export function repositionSubmenu(submenuEl: HTMLElement) {
    const CONTEXT_MENU_PADDING = 5;

    // Reset so the natural (downward, trailing) placement is measured on every hover.
    submenuEl.classList.remove("submenu-flip-up");
    submenuEl.classList.remove("submenu-flip-start");

    const rect = submenuEl.getBoundingClientRect();
    const clientHeight = document.documentElement.clientHeight;
    const clientWidth = document.documentElement.clientWidth;
    const overflowsBottom = rect.bottom > clientHeight - CONTEXT_MENU_PADDING;
    // Only flip up if there is actually more room above the parent than below, otherwise flipping
    // would just clip the other end.
    const fitsWhenFlippedUp = rect.top - rect.height >= CONTEXT_MENU_PADDING;

    if (overflowsBottom && fitsWhenFlippedUp) {
        submenuEl.classList.add("submenu-flip-up");
    }

    // The same for the side it opens on, which is the trailing one by default and the leading
    // one in a right-to-left page. Whichever edge it runs past, the flip puts it on the other
    // side of its parent, and only where the whole submenu fits there.
    const fitsWhenFlippedToStart = rect.left - rect.width >= CONTEXT_MENU_PADDING;
    const fitsWhenFlippedToEnd = rect.right + rect.width <= clientWidth - CONTEXT_MENU_PADDING;

    if ((rect.right > clientWidth - CONTEXT_MENU_PADDING && fitsWhenFlippedToStart)
            || (rect.left < CONTEXT_MENU_PADDING && fitsWhenFlippedToEnd)) {
        submenuEl.classList.add("submenu-flip-start");
    }
}
