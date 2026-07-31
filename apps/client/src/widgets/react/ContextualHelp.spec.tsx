import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tooltip itself is Bootstrap's; what this component decides is the configuration it hands over,
// so the hook is stubbed and the configuration asserted on.
const useStaticTooltip = vi.hoisted(() => vi.fn());
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip
}));

import ContextualHelp from "./ContextualHelp";

describe("ContextualHelp", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("is an info icon explaining itself through the app's tooltip, raised above any dialog", () => {
        act(() => render(<ContextualHelp helpMessage="What this figure covers." />, container));

        const span = container.querySelector("span");
        expect(span?.className).toBe("bx bx-info-circle contextual-help");
        // No title of its own: a native tooltip would open somewhere else, in its own styling.
        expect(span?.getAttribute("title")).toBeNull();

        expect(useStaticTooltip).toHaveBeenLastCalledWith(expect.anything(), {
            title: "What this figure covers.",
            placement: "bottom",
            customClass: "tooltip-top"
        });
    });

    it("hands the tooltip the same configuration until the message itself changes", () => {
        act(() => render(<ContextualHelp helpMessage="First." />, container));
        const [ , first ] = useStaticTooltip.mock.calls.at(-1) ?? [];

        // A re-render with the same message must not tear the tooltip down and build it again:
        // the hook rebuilds on any new configuration object.
        act(() => render(<ContextualHelp helpMessage="First." />, container));
        expect(useStaticTooltip.mock.calls.at(-1)?.[1]).toBe(first);

        act(() => render(<ContextualHelp helpMessage="Second." />, container));
        expect(useStaticTooltip.mock.calls.at(-1)?.[1]).not.toBe(first);
        expect(useStaticTooltip.mock.calls.at(-1)?.[1]).toMatchObject({ title: "Second." });
    });
});
