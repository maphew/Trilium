/**
 * Drives the startup splash screen that index.html renders inline, before any script or
 * stylesheet is fetched. Status strings are English-only, as in the standalone error overlay:
 * the splash runs while the backend that serves the translation catalogues is still starting,
 * so `initLocale()` has neither a locale nor an `assetPath` to fetch one with.
 *
 * Kept free of imports: index.ts loads it before setupGlob() populates window.glob, which most
 * client modules read at module scope.
 */

/** Matches the `#splash` opacity transition in index.html. */
const SPLASH_FADE_MS = 400;

/** One step of the startup sequence, drawn as its own segment of the progress bar. */
export interface SplashPhase {
    /** Name {@link reportSplashPhase} uses to announce that the step has started. */
    id: string;
    /** Relative cost of the step, which sets how wide its segment is. */
    weight: number;
    /** Shown under the bar while the step runs. */
    status: string;
}

/**
 * What a server or desktop client passes through, where the backend is already running and only
 * the frontend has to start. Standalone reports a longer sequence of its own first — see
 * `STANDALONE_STARTUP_PHASES` in apps/standalone/src/main.ts.
 */
export const CLIENT_STARTUP_PHASES: SplashPhase[] = [
    { id: "bootstrap", weight: 1, status: "Opening your notes…" },
    { id: "application", weight: 2, status: "Loading the application…" }
];

let phases: SplashPhase[] = [];

/** Index of the phase now running. Every earlier phase is drawn as complete. */
let currentPhase = -1;

/**
 * Splits the progress bar into one segment per phase, each sized by its weight. The first caller
 * wins, so standalone's longer sequence survives the client's own call later in the same startup.
 */
export function initSplashProgress(startupPhases: SplashPhase[]): void {
    if (phases.length) {
        return;
    }
    phases = startupPhases;

    const bar = document.querySelector("#splash .splash-bar");
    if (!bar) {
        return;
    }

    bar.classList.add("is-segmented");
    for (const phase of phases) {
        const segment = document.createElement("div");
        segment.className = "splash-seg";
        // The one genuinely computed value here: a segment is as wide as its phase is costly.
        segment.style.flexGrow = String(phase.weight);
        bar.append(segment);
    }
}

/**
 * Advances the bar to the named phase and shows its status. Never moves backwards, so a phase
 * that is reported late — or, in a follower tab, not at all — cannot undo the progress shown.
 */
export function reportSplashPhase(id: string): void {
    const index = phases.findIndex((phase) => phase.id === id);
    const phase = phases[index];
    if (!phase || index <= currentPhase) {
        return;
    }
    currentPhase = index;

    const segments = document.querySelectorAll<HTMLElement>("#splash .splash-seg");
    for (const [ segmentIndex, segment ] of segments.entries()) {
        segment.classList.toggle("is-done", segmentIndex < index);
        segment.classList.toggle("is-active", segmentIndex === index);
    }

    updateSplashStatus(phase.status);
}

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

    // Fill the bar before it goes, so the last phase is not left mid-flight behind the fade.
    for (const segment of splashEl.querySelectorAll<HTMLElement>(".splash-seg")) {
        segment.classList.remove("is-active");
        segment.classList.add("is-done");
    }

    splashEl.classList.add("splash-hidden");
    setTimeout(() => splashEl.remove(), SPLASH_FADE_MS);
}

