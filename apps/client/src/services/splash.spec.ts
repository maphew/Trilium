import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hideSplash, showSplashError, updateSplashStatus } from "./splash";

function renderSplash() {
    document.body.innerHTML = `
        <div id="splash">
            <div class="splash-bar"></div>
            <div id="splash-status"></div>
        </div>`;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("splash", () => {
    it("updates the status line and switches to the error state", () => {
        renderSplash();

        updateSplashStatus("Opening your notes…");
        expect(document.getElementById("splash-status")?.textContent).toBe("Opening your notes…");

        showSplashError("something broke");
        expect(document.getElementById("splash")?.classList.contains("splash-error")).toBe(true);
        expect(document.getElementById("splash-status")?.textContent).toBe("something broke");
    });

    it("fades the splash out and removes it once the transition has run", () => {
        renderSplash();

        hideSplash();
        const splash = document.getElementById("splash");
        expect(splash?.classList.contains("splash-hidden")).toBe(true);

        vi.runAllTimers();
        expect(document.getElementById("splash")).toBeNull();
    });

    it("does nothing when the splash is not in the document", () => {
        expect(() => {
            updateSplashStatus("status");
            showSplashError("error");
            hideSplash();
        }).not.toThrow();
    });
});
