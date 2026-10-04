import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ triggerCommand: vi.fn() }));

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerCommand: mocks.triggerCommand } }));

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

import type { WebSearchState } from "../../../services/llm_providers.js";
import ChatToolsDropdown from "./ChatToolsDropdown.js";

let host: HTMLElement | undefined;

afterEach(() => {
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
    vi.clearAllMocks();
});

const TAVILY = { id: "s1", name: "Tavily", provider: "tavily" };

function renderMenu({ enableNoteTools = false, webSearch = { choice: "disabled", enableWebSearch: false } }: {
    enableNoteTools?: boolean;
    webSearch?: WebSearchState;
} = {}) {
    const onNoteToolsChange = vi.fn();
    const onWebSearchChoose = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    act(() => render(
        <ChatToolsDropdown
            enableNoteTools={enableNoteTools}
            onNoteToolsChange={onNoteToolsChange}
            webSearch={webSearch}
            searchProviders={[ TAVILY ]}
            onWebSearchChoose={onWebSearchChoose}
        />, target));

    const rows = [ ...target.querySelectorAll<HTMLElement>(".menu .dropdown-item") ];
    const row = (text: string) => {
        const found = rows.find((candidate) => candidate.textContent?.includes(text));
        expect(found).toBeDefined();
        return found;
    };
    const toggle = target.querySelector<HTMLButtonElement>(".dropdown-stub > button");
    return {
        toggle,
        isToggleOn: () => {
            const icon = toggle?.querySelector(".llm-chat-tools-icon");
            expect(icon).not.toBeNull();
            return icon?.classList.contains("llm-chat-tools-on");
        },
        row,
        /** The web search choices, by their text, that the menu marks as chosen. */
        marked: () => rows.filter((candidate) => candidate.getAttribute("aria-checked") === "true" || candidate.querySelector(".bx-check"))
            .map((candidate) => candidate.textContent),
        onNoteToolsChange,
        onWebSearchChoose
    };
}

const isOn = (row: HTMLElement | undefined) => row?.querySelector<HTMLInputElement>("input[type='checkbox']")?.checked;

describe("ChatToolsDropdown", () => {
    it("marks the toggle while note access or a usable web search is on", () => {
        const off = renderMenu();
        expect(off.toggle?.title).toBe("llm_chat.tools");
        // The compact combo box of the model picker, which draws the dropdown caret.
        expect(off.toggle?.classList.contains("llm-chat-model-select")).toBe(true);
        expect(off.isToggleOn()).toBe(false);
        expect(isOn(off.row("llm_chat.note_tools"))).toBe(false);

        expect(renderMenu({ enableNoteTools: true }).isToggleOn()).toBe(true);
        expect(renderMenu({ webSearch: { choice: "s1", enableWebSearch: true, webSearchProviderId: "s1" } }).isToggleOn()).toBe(true);
        // Chosen, but the model can't use it.
        expect(renderMenu({ webSearch: { choice: "builtin", enableWebSearch: false, builtInUnavailableKey: "no_builtin" } }).isToggleOn()).toBe(false);
    });

    it("marks the chosen web search source, and reports a pressed one or the note access switch", async () => {
        const menu = renderMenu({ enableNoteTools: true, webSearch: { choice: "s1", enableWebSearch: true, webSearchProviderId: "s1" } });
        expect(menu.marked()).toEqual([ "Tavily" ]);

        await act(async () => menu.row("llm_chat.web_search_builtin")?.click());
        expect(menu.onWebSearchChoose).toHaveBeenLastCalledWith("builtin");
        await act(async () => menu.row("llm_chat.web_search_disabled")?.click());
        expect(menu.onWebSearchChoose).toHaveBeenLastCalledWith("disabled");
        await act(async () => menu.row("llm_chat.note_tools")?.click());
        expect(menu.onNoteToolsChange).toHaveBeenCalledExactlyOnceWith(false);

        await act(async () => menu.row("llm_chat.manage_search_providers")?.click());
        expect(mocks.triggerCommand).toHaveBeenCalledExactlyOnceWith("showOptions", { section: "_optionsLlm" });
    });

    it("keeps a choice the model can't use listed, disabled, with the reason under it", async () => {
        const menu = renderMenu({ webSearch: {
            choice: "builtin", enableWebSearch: false,
            builtInUnavailableKey: "no_builtin", searchProviderUnavailableKey: "own_tools"
        } });

        const builtIn = menu.row("llm_chat.web_search_builtin");
        expect(builtIn?.classList.contains("disabled")).toBe(true);
        expect(builtIn?.querySelector(".description")?.textContent).toBe("no_builtin");
        expect(menu.row("Tavily")?.querySelector(".description")?.textContent).toBe("own_tools");

        await act(async () => menu.row("Tavily")?.click());
        expect(menu.onWebSearchChoose).not.toHaveBeenCalled();
    });
});
