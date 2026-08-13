import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

const setupMode = vi.hoisted(() => ({
    canBootToSetup: vi.fn(() => true),
    startOver: vi.fn(async () => "restarting" as string),
    isStartOverPending: vi.fn(async () => false),
    cancelStartOver: vi.fn(async () => {})
}));
vi.mock("../../../services/setup_mode", () => setupMode);

// The page header renders the note's own title, which needs a note context this spec has no use for.
vi.mock("./components/OptionsPageHeader", () => ({ default: () => null }));

import DatabaseSettings from "./database";

let container: HTMLDivElement;

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function renderPage() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<DatabaseSettings />, container);

    return container;
}

/** By name rather than by label: one label is a prefix of the other. */
function button(name: string): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(`button[name='${name}']`);
}

beforeEach(() => {
    vi.useFakeTimers();
    setupMode.canBootToSetup.mockReset().mockReturnValue(true);
    setupMode.startOver.mockReset().mockResolvedValue("restarting");
    setupMode.isStartOverPending.mockReset().mockResolvedValue(false);
    setupMode.cancelStartOver.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
});

describe("starting over from Options", () => {
    it("offers the button, and asks nothing of its own before handing over", async () => {
        renderPage();
        await settle();

        // The confirmation is the operating system's or the browser's, not one of this page's.
        expect(container.querySelector(".start-over-pending")).toBeNull();

        button("start-over-button")?.click();
        await settle();

        expect(setupMode.startOver).toHaveBeenCalled();
    });

    it("does not ask a build that restarts itself whether anything is pending", async () => {
        // There is nothing to wait for: the request is acted on by the restart it causes.
        renderPage();
        await settle();

        expect(setupMode.isStartOverPending).not.toHaveBeenCalled();
    });

    it("says a request is standing where the restart is somebody else's to make", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.startOver.mockResolvedValue("pending");
        renderPage();
        await settle();

        button("start-over-button")?.click();
        await settle();

        // Above the card, since a request left standing is the state of the whole page from here on.
        const notice = container.querySelector(".start-over-pending");
        expect(notice?.textContent).toContain("database.start_over_pending");
        expect(notice?.compareDocumentPosition(container.querySelector(".start-over") as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        // The button that made it stays where it was, so the row still reads as a whole — but it is
        // out of reach, since the request it would make has already been made.
        expect(button("start-over-button")?.disabled).toBe(true);
    });

    it("takes it back, which is all a server owner can do until they restart", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.isStartOverPending.mockResolvedValue(true);
        renderPage();
        await settle();

        // Read on arrival: the request outlives the page that made it, so reopening Options is
        // otherwise no way to find out that one is waiting.
        expect(container.querySelector(".start-over-pending")).not.toBeNull();

        button("cancel-start-over-button")?.click();
        await settle();

        expect(setupMode.cancelStartOver).toHaveBeenCalled();
        expect(container.querySelector(".start-over-pending")).toBeNull();
    });

    it("says nothing where the pending question cannot be answered", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.isStartOverPending.mockRejectedValue(new Error("no answer"));
        renderPage();
        await settle();

        // What is lost is a notice; the button below it is what the page is for.
        expect(container.querySelector(".start-over-pending")).toBeNull();
        expect(button("start-over-button")?.disabled).toBe(false);
    });
});
