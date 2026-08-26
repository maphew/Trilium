/**
 * Drives the startup splash screen that index.html renders inline, before any script or
 * stylesheet is fetched. Status strings are English-only, as in the standalone error overlay:
 * the splash runs while the backend that serves the translation catalogues is still starting,
 * so no catalogue can be loaded yet.
 *
 * Kept free of imports: index.ts loads it before setupGlob() populates window.glob, which most
 * client modules read at module scope.
 */

/** Matches the `#splash` opacity transition in index.html. */
const SPLASH_FADE_MS = 400;

/** Replaces the status line under the progress bar. */
export function updateSplashStatus(status: string): void {
    const statusEl = document.getElementById("splash-status");
    if (statusEl) {
        statusEl.textContent = status;
    }
}

/** Switches the splash to its error state: the progress bar goes away and the message shows. */
export function showSplashError(message: string): void {
    const splashEl = document.getElementById("splash");
    if (!splashEl) {
        return;
    }
    splashEl.classList.add("splash-error");
    updateSplashStatus(message);
}

/** Fades the splash out and removes it, revealing the application behind it. */
export function hideSplash(): void {
    const splashEl = document.getElementById("splash");
    if (!splashEl) {
        return;
    }
    splashEl.classList.add("splash-hidden");
    setTimeout(() => splashEl.remove(), SPLASH_FADE_MS);
}
