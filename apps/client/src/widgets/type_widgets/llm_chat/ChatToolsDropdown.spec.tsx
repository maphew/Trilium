import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));

// Renders the toggle's face, class and tooltip, and the menu, without the popup machinery.
vi.mock("../../react/Dropdown.js", () => ({
    default: ({ text, title, buttonClassName, children }: {
        text?: ComponentChildren; title?: string; buttonClassName?: string; children: ComponentChildren;
    }) => (
        <div className="dropdown-stub">
            <button className={buttonClassName} title={title}>{text}</button>
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
    const toggle = target.querySelector<HTMLButtonElement>(".dropdown-stub > button");
    return {
        toggle,
        isToggleOn: () => {
            const icon = toggle?.querySelector(".llm-chat-tools-icon");
            expect(icon).not.toBeNull();
            return icon?.classList.contains("llm-chat-tools-on");
        },
        noteRow: rows.find((row) => row.textContent?.includes("llm_chat.note_tools")),
        webRow: rows.find((row) => row.textContent?.includes("llm_chat.web_search")),
        onNoteToolsChange,
        onWebSearchChange
    };
}

const isOn = (row: HTMLElement | undefined) => row?.querySelector<HTMLInputElement>("input[type='checkbox']")?.checked;

describe("ChatToolsDropdown", () => {
    it("shows a switch per tool group, and marks the toggle while any is on", () => {
        const off = renderMenu();
        expect(off.toggle?.title).toBe("llm_chat.tools");
        // The compact combo box of the model picker, which draws the dropdown caret.
        expect(off.toggle?.classList.contains("llm-chat-model-select")).toBe(true);
        expect(off.isToggleOn()).toBe(false);
        expect(isOn(off.noteRow)).toBe(false);
        expect(isOn(off.webRow)).toBe(false);

        const on = renderMenu({ enableWebSearch: true });
        expect(on.isToggleOn()).toBe(true);
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
        const { isToggleOn, webRow, onWebSearchChange } = renderMenu({ enableWebSearch: true, webSearchUnavailableReason: "Not on Gemini" });

        expect(isToggleOn()).toBe(false);
        expect(isOn(webRow)).toBe(false);
        expect(webRow?.classList.contains("disabled")).toBe(true);
        expect(webRow?.querySelector(".description")?.textContent).toBe("Not on Gemini");

        await act(async () => webRow?.click());
        expect(onWebSearchChange).not.toHaveBeenCalled();
    });
});
