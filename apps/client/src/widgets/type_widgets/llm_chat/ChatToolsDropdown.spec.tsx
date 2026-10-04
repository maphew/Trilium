import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));

// Renders the toggle's class and tooltip, and the menu, without the popup machinery.
vi.mock("../../react/Dropdown.js", () => ({
    default: ({ title, buttonClassName, children }: {
        title?: string; buttonClassName?: string; children: ComponentChildren;
    }) => (
        <div className="dropdown-stub">
            <button className={buttonClassName} title={title} />
            <div className="menu">{children}</div>
        </div>
    )
}));

import ChatToolsDropdown from "./ChatToolsDropdown.js";

let host: HTMLElement | undefined;

afterEach(() => {
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
});

function renderMenu(props: Partial<Parameters<typeof ChatToolsDropdown>[0]> = {}) {
    const onNoteToolsChange = vi.fn();
    const onWebSearchChange = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    act(() => render(
        <ChatToolsDropdown
            enableNoteTools={false}
            enableWebSearch={false}
            onNoteToolsChange={onNoteToolsChange}
            onWebSearchChange={onWebSearchChange}
            {...props}
        />, target));

    const rows = [ ...target.querySelectorAll<HTMLElement>(".menu .dropdown-item") ];
    return {
        toggle: target.querySelector<HTMLButtonElement>(".dropdown-stub > button"),
        noteRow: rows.find((row) => row.textContent?.includes("llm_chat.note_tools")),
        webRow: rows.find((row) => row.textContent?.includes("llm_chat.web_search")),
        onNoteToolsChange,
        onWebSearchChange
    };
}

const isOn = (row: HTMLElement | undefined) => row?.querySelector<HTMLInputElement>("input[type='checkbox']")?.checked;

describe("ChatToolsDropdown", () => {
    it("shows a switch per tool group, and marks the toggle active while any is on", () => {
        const off = renderMenu();
        expect(off.toggle?.title).toBe("llm_chat.tools");
        expect(off.toggle?.classList.contains("active")).toBe(false);
        expect(isOn(off.noteRow)).toBe(false);
        expect(isOn(off.webRow)).toBe(false);

        const on = renderMenu({ enableWebSearch: true });
        expect(on.toggle?.classList.contains("active")).toBe(true);
        expect(isOn(on.noteRow)).toBe(false);
        expect(isOn(on.webRow)).toBe(true);
    });

    it("flips the group whose row is pressed", async () => {
        const { noteRow, webRow, onNoteToolsChange, onWebSearchChange } = renderMenu({ enableNoteTools: true });
        expect(noteRow).toBeDefined();
        expect(webRow).toBeDefined();

        await act(async () => noteRow?.click());
        expect(onNoteToolsChange).toHaveBeenCalledExactlyOnceWith(false);
        await act(async () => webRow?.click());
        expect(onWebSearchChange).toHaveBeenCalledExactlyOnceWith(true);
    });

    it("shows web search off and disabled, with the reason, when the model cannot combine it", async () => {
        const { toggle, webRow, onWebSearchChange } = renderMenu({ enableWebSearch: true, webSearchUnavailableReason: "Not on Gemini" });

        expect(toggle?.classList.contains("active")).toBe(false);
        expect(isOn(webRow)).toBe(false);
        expect(webRow?.classList.contains("disabled")).toBe(true);
        expect(webRow?.querySelector(".description")?.textContent).toBe("Not on Gemini");

        await act(async () => webRow?.click());
        expect(onWebSearchChange).not.toHaveBeenCalled();
    });
});
