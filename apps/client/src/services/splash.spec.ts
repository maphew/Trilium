import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SplashPhase } from "./splash";

const PHASES: SplashPhase[] = [
    { id: "first", weight: 1, status: "First…" },
    { id: "second", weight: 3, status: "Second…" },
    { id: "third", weight: 2, status: "Third…" }
];

/** The module tracks the reported phase, so each test needs a fresh copy of it. */
async function freshSplash(): Promise<typeof import("./splash")> {
    vi.resetModules();
    return import("./splash");
}

function renderSplash() {
    document.body.innerHTML = `
        <div id="splash">
            <div class="splash-bar"><div class="splash-bar-fill"></div></div>
            <div id="splash-status"></div>
        </div>`;
}

function segmentClasses() {
    return [ ...document.querySelectorAll(".splash-seg") ].map((seg) => ({
        done: seg.classList.contains("is-done"),
        active: seg.classList.contains("is-active")
    }));
}

beforeEach(() => {
    vi.useFakeTimers();
    renderSplash();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("splash", () => {
    it("updates the status line and switches to the error state", async () => {
        const { updateSplashStatus, showSplashError } = await freshSplash();

        updateSplashStatus("Opening your notes…");
        expect(document.getElementById("splash-status")?.textContent).toBe("Opening your notes…");

        showSplashError("something broke");
        expect(document.getElementById("splash")?.classList.contains("splash-error")).toBe(true);
        expect(document.getElementById("splash-status")?.textContent).toBe("something broke");
    });

    it("draws one segment per phase, sized by weight", async () => {
        const { initSplashProgress } = await freshSplash();
        initSplashProgress(PHASES);

        const bar = document.querySelector(".splash-bar");
        expect(bar?.classList.contains("is-segmented")).toBe(true);

        const segments = [ ...document.querySelectorAll<HTMLElement>(".splash-seg") ];
        expect(segments.map((seg) => seg.style.flexGrow)).toEqual([ "1", "3", "2" ]);
    });

    it("keeps the sequence the first caller installed", async () => {
        const { initSplashProgress, reportSplashPhase } = await freshSplash();
        initSplashProgress(PHASES);
        // Standalone claims the bar before the client's own, shorter list is offered.
        initSplashProgress([ { id: "other", weight: 1, status: "Other…" } ]);

        expect(document.querySelectorAll(".splash-seg")).toHaveLength(3);
        reportSplashPhase("other");
        expect(document.getElementById("splash-status")?.textContent).toBe("");
    });

    it("marks earlier phases done, the reported one active, and shows its status", async () => {
        const { initSplashProgress, reportSplashPhase } = await freshSplash();
        initSplashProgress(PHASES);

        reportSplashPhase("second");
        expect(segmentClasses()).toEqual([
            { done: true, active: false },
            { done: false, active: true },
            { done: false, active: false }
        ]);
        expect(document.getElementById("splash-status")?.textContent).toBe("Second…");
    });

    it("never moves backwards, and ignores an unknown phase", async () => {
        const { initSplashProgress, reportSplashPhase } = await freshSplash();
        initSplashProgress(PHASES);

        reportSplashPhase("third");
        // A phase reported late — or, in a follower tab, out of order — must not undo progress.
        reportSplashPhase("first");
        reportSplashPhase("nonexistent");
        expect(document.getElementById("splash-status")?.textContent).toBe("Third…");
        expect(segmentClasses()[2]).toEqual({ done: false, active: true });
    });

    it("fills the bar, then fades the splash out and removes it", async () => {
        const { initSplashProgress, reportSplashPhase, hideSplash } = await freshSplash();
        initSplashProgress(PHASES);
        reportSplashPhase("second");

        hideSplash();
        expect(segmentClasses().every((seg) => seg.done && !seg.active)).toBe(true);
        expect(document.getElementById("splash")?.classList.contains("splash-hidden")).toBe(true);

        vi.runAllTimers();
        expect(document.getElementById("splash")).toBeNull();
    });

    it("does nothing when the splash is not in the document", async () => {
        const {
            initSplashProgress, reportSplashPhase, updateSplashStatus, showSplashError, hideSplash
        } = await freshSplash();
        document.body.innerHTML = "";

        expect(() => {
            initSplashProgress(PHASES);
            reportSplashPhase("first");
            updateSplashStatus("status");
            showSplashError("error");
            hideSplash();
        }).not.toThrow();
    });
});
