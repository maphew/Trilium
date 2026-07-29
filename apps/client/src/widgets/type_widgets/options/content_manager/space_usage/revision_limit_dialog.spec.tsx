import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    optionValues: {
        revisionSnapshotNumberLimit: "-1",
        revisionSnapshotTimeInterval: "600",
        revisionSnapshotTimeIntervalTimeScale: "1"
    } as Record<string, string>,
    save: vi.fn(async (..._args: unknown[]) => undefined),
    post: vi.fn(async (..._args: unknown[]) => undefined)
}));

vi.mock("../../../../../services/options", () => ({
    default: {
        get: (key: string) => mocks.optionValues[key],
        getInt: (key: string) => parseInt(mocks.optionValues[key], 10),
        save: (...args: unknown[]) => mocks.save(...args)
    }
}));

// The shared setup already stands the server in for; only the writes this dialog makes are added.
vi.mock("../../../../../services/server", async (importOriginal) => {
    const actual = await importOriginal<{ default: object }>();

    return {
        default: {
            ...actual.default,
            post: (...args: unknown[]) => mocks.post(...args),
            put: (...args: unknown[]) => mocks.post(...args)
        }
    };
});

import RevisionLimitDialog from "./revision_limit_dialog";

let container: HTMLDivElement | undefined;

function renderDialog() {
    container = document.body.appendChild(document.createElement("div"));
    render(<RevisionLimitDialog show onHidden={() => {}} />, container);

    // Portalled to the body, so the dialog is not inside the container it was rendered from.
    const dialog = document.querySelector<HTMLElement>(".space-usage-revision-limit-dialog");
    if (!dialog) {
        throw new Error("dialog not rendered");
    }

    return dialog;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    document.querySelectorAll(".space-usage-revision-limit-dialog").forEach((el) => el.remove());
    vi.clearAllMocks();
});

describe("RevisionLimitDialog", () => {
    it("carries the options page's revision card, which saves the limit as it does there", () => {
        const dialog = renderDialog();
        const input = dialog.querySelector<HTMLInputElement>('input[name="revision-snapshot-number-limit"]');

        expect(input).not.toBeNull();
        expect(input?.value).toBe("-1");

        let seen = 0;
        if (input) {
            input.addEventListener("blur", () => seen++);
            input.value = "10";
            input.focus();
            input.blur();
        }

        console.log("SAVE CALLS", JSON.stringify(mocks.save.mock.calls), "BLUR SEEN", seen);
        expect(mocks.save).toHaveBeenCalledWith("revisionSnapshotNumberLimit", 10);
    });
});
