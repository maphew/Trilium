import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type LoadResults from "../../../../../services/load_results";

// Hoisted alongside the mock factories, which can run before this file's top-level constants exist.
const mocks = vi.hoisted(() => ({
    serverGet: undefined as unknown as (url: string) => Promise<unknown>,
    entitiesReloadedHandler: undefined as ((data: { loadResults: unknown }) => void) | undefined
}));
const serverGet = vi.fn<(url: string) => Promise<unknown>>();
mocks.serverGet = serverGet;

vi.mock("../../../../../services/server", () => ({
    default: { get: (url: string) => mocks.serverGet(url) }
}));

// A full mock, not a partial one: the real hooks module transitively imports half the app at module
// scope (app_context, keyboard actions), and the hook under test only needs this one export.
// The subscription is captured so a change can be fired without the app's event plumbing.
vi.mock("../../../../react/hooks", () => ({
    useTriliumEvent: (_name: string, handler: (data: { loadResults: unknown }) => void) => {
        mocks.entitiesReloadedHandler = handler;
    }
}));

function fireEntitiesReloaded(loadResults: LoadResults) {
    mocks.entitiesReloadedHandler?.({ loadResults });
}

// Import AFTER the mocks (vi.mock is hoisted, but the hook import must resolve the mocked deps).
import { useSpaceUsageFetch } from "./use_space_usage_fetch";

function Probe({ url }: { url: string }) {
    const { data, failed } = useSpaceUsageFetch<{ label: string }>(url);
    return <div>{data ? data.label : (failed ? "failed" : "loading")}</div>;
}

let container: HTMLDivElement | undefined;

function renderProbe(url: string) {
    container = container ?? document.body.appendChild(document.createElement("div"));
    render(<Probe url={url} />, container);
    return container;
}

function loadResultsWith(noteIds: string[]): LoadResults {
    return {
        getNoteIds: () => noteIds,
        getBranchRows: () => [],
        getAttachmentRows: () => []
    } as unknown as LoadResults;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.entitiesReloadedHandler = undefined;
    serverGet.mockReset();
    vi.useRealTimers();
});

describe("useSpaceUsageFetch", () => {
    it("fetches the url and renders the payload once it arrives", async () => {
        serverGet.mockResolvedValueOnce({ label: "first" });
        const probe = renderProbe("space-usage/overview");

        expect(probe.textContent).toBe("loading");
        await vi.waitFor(() => expect(probe.textContent).toBe("first"));
        expect(serverGet).toHaveBeenCalledWith("space-usage/overview");
    });

    it("keeps the previous payload while navigating, and through a failed fetch", async () => {
        serverGet.mockResolvedValueOnce({ label: "first" });
        const probe = renderProbe("space-usage/note/a");
        await vi.waitFor(() => expect(probe.textContent).toBe("first"));

        // The rejection must neither blank the chart nor escape as an unhandled rejection.
        serverGet.mockRejectedValueOnce(new Error("network down"));
        renderProbe("space-usage/note/b");
        await vi.waitFor(() => expect(serverGet).toHaveBeenCalledTimes(2));
        expect(probe.textContent).toBe("first");
    });

    it("reports a first fetch that fails, instead of measuring forever", async () => {
        // Nothing to fall back on yet, and a browser-rejected request is not even toasted, so a
        // silent catch would leave the view claiming to measure for as long as it stayed open.
        serverGet.mockRejectedValueOnce(new Error("rejected by browser"));
        const probe = renderProbe("space-usage/overview");
        await vi.waitFor(() => expect(probe.textContent).toBe("failed"));

        // ...and it clears itself the moment an attempt succeeds.
        serverGet.mockResolvedValueOnce({ label: "recovered" });
        renderProbe("space-usage/note/a");
        await vi.waitFor(() => expect(probe.textContent).toBe("recovered"));
    });

    it("drops a stale response that resolves after a newer request", async () => {
        let resolveSlow: ((value: unknown) => void) | undefined;
        serverGet.mockReturnValueOnce(new Promise((resolve) => { resolveSlow = resolve; }));
        const probe = renderProbe("space-usage/note/slow");

        serverGet.mockResolvedValueOnce({ label: "fast" });
        renderProbe("space-usage/note/fast");
        await vi.waitFor(() => expect(probe.textContent).toBe("fast"));

        resolveSlow?.({ label: "slow" });
        await Promise.resolve();
        expect(probe.textContent).toBe("fast");
    });

    it("refetches once, debounced, when notes change — and not on irrelevant reloads", async () => {
        serverGet.mockResolvedValue({ label: "data" });
        const probe = renderProbe("space-usage/overview");
        await vi.waitFor(() => expect(probe.textContent).toBe("data"));
        expect(serverGet).toHaveBeenCalledTimes(1);

        vi.useFakeTimers();
        fireEntitiesReloaded(loadResultsWith([]));
        await vi.advanceTimersByTimeAsync(1500);
        expect(serverGet).toHaveBeenCalledTimes(1);

        // A burst of changes coalesces into a single reload.
        fireEntitiesReloaded(loadResultsWith([ "changed" ]));
        fireEntitiesReloaded(loadResultsWith([ "changed" ]));
        await vi.advanceTimersByTimeAsync(1500);
        expect(serverGet).toHaveBeenCalledTimes(2);
    });
});
