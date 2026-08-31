import $ from "jquery";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import FNote from "../entities/fnote";
import { renderInto } from "../test/render";
import { ReactWrappedWidget } from "./basic_widget";

const { dropdownInstances, getOrCreateInstance } = vi.hoisted(() => {
    const dropdownInstances: Array<{
        show: ReturnType<typeof vi.fn>;
        hide: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
        _menu: HTMLElement | null;
    }> = [];
    const instancesByToggle = new Map<HTMLElement, typeof dropdownInstances[number]>();
    const getOrCreateInstance = vi.fn((toggle: HTMLElement) => {
        let instance = instancesByToggle.get(toggle);
        if (!instance) {
            instance = {
                show: vi.fn(),
                hide: vi.fn(),
                update: vi.fn(),
                dispose: vi.fn(),
                _menu: null
            };
            instancesByToggle.set(toggle, instance);
            dropdownInstances.push(instance);
        }
        return instance;
    });
    return { dropdownInstances, getOrCreateInstance };
});

vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance },
    Tooltip: class {}
}));

const noteContext = vi.hoisted(() => ({
    initialNote: undefined as FNote | undefined,
    setNote: undefined as ((note: FNote) => void) | undefined
}));
const tooltipStub = vi.hoisted(() => ({ showTooltip: vi.fn(), hideTooltip: vi.fn() }));

vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => {
        const [ note, setNote ] = useState(noteContext.initialNote);
        noteContext.setNote = setNote;
        return { note, viewScope: { viewMode: "default" } };
    },
    useNoteLabel: () => [ undefined ],
    useStaticTooltip: () => {},
    useTooltip: () => tooltipStub
}));

vi.mock("../services/server", () => ({
    default: {
        get: vi.fn(async (url: string) => url === "other/icon-usage"
            ? { iconClassToCountMap: {} }
            : [])
    }
}));

vi.mock("../services/attributes", () => ({
    default: {
        setLabel: vi.fn(),
        removeAttributeById: vi.fn()
    }
}));

import NoteIcon from "./note_icon";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver
    ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

describe("NoteIcon", () => {
    it("stays in the legacy widget tree when the active note changes", () => {
        glob.iconRegistry = { sources: [] };
        noteContext.initialNote = buildNote("note-a");
        const widget = new ReactWrappedWidget(<NoteIcon />);
        widget.doRender();
        const liveContainer = document.createElement("div");
        document.body.appendChild(liveContainer);
        liveContainer.append(...widget.$widget.get());

        try {
            expect(liveContainer.querySelector("button")).not.toBeNull();

            void act(() => noteContext.setNote?.(buildNote("note-b")));

            expect(liveContainer.querySelector("button")?.classList.contains("bx-note-b")).toBe(true);
        } finally {
            widget.cleanup();
            liveContainer.remove();
        }
    });

    it("closes an open icon picker when the active note changes", () => {
        glob.iconRegistry = { sources: [] };
        noteContext.initialNote = buildNote("note-a");
        const container = renderInto(<NoteIcon />);
        const toggle = container.querySelector<HTMLButtonElement>("button");
        const dropdown = container.querySelector<HTMLElement>(".dropdown");
        expect(toggle).not.toBeNull();
        expect(dropdown).not.toBeNull();
        const pickerDropdown = dropdownInstances.at(-1);
        expect(pickerDropdown).toBeTruthy();

        void act(() => {
            toggle?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        });
        void act(() => {
            $(dropdown as HTMLElement).trigger("show.bs.dropdown");
        });
        expect(document.body.querySelector(".tn-dropdown-portal .icon-picker")).not.toBeNull();

        void act(() => noteContext.setNote?.(buildNote("note-a", "bx-updated")));

        expect(container.querySelector("button")).toBe(toggle);
        expect(toggle?.classList.contains("bx-updated")).toBe(true);
        expect(toggle?.classList.contains("show")).toBe(true);
        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
        expect(pickerDropdown?.dispose).not.toHaveBeenCalled();
        expect(document.body.querySelector(".tn-dropdown-portal .icon-picker")).not.toBeNull();

        void act(() => noteContext.setNote?.(buildNote("note-b")));

        expect(container.querySelector("button")?.classList.contains("bx-note-b")).toBe(true);
        expect(container.querySelector("button")).not.toBe(toggle);
        expect(pickerDropdown?.dispose).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector(".tn-dropdown-portal .icon-picker")).toBeNull();
    });
});

function buildNote(noteId: string, icon = `bx-${noteId}`) {
    return {
        noteId,
        isMetadataReadOnly: false,
        getIcon: () => icon,
        getOwnedLabels: () => [],
        hasOwnedLabel: () => false
    } as unknown as FNote;
}
