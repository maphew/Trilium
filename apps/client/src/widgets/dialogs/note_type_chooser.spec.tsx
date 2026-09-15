/**
 * Opening the chooser used to focus the parent-path search, so Enter did nothing useful.
 * Focus belongs on the first type (Text) so a second Enter creates a text note.
 */
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { ParentComponent } from "../react/react_utils";

vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../services/note_types", () => ({
    default: {
        getNoteTypeItems: () => Promise.resolve([
            { title: "Text", type: "text", uiIcon: "bx bx-note" },
            { title: "Code", type: "code", uiIcon: "bx bx-code" }
        ])
    }
}));

vi.mock("../react/NoteAutocomplete", () => ({
    default: function NoteAutocompleteStub() {
        return <input className="note-autocomplete" />;
    }
}));

vi.mock("../react/Modal", () => ({
    default: function ModalStub({
        show, children, onShown, modalRef, className
    }: {
        show: boolean;
        children: preact.ComponentChildren;
        onShown?: () => void;
        modalRef?: { current: HTMLDivElement | null };
        className: string;
    }) {
        const ref = useRef<HTMLDivElement>(null);

        useEffect(() => {
            if (modalRef) {
                modalRef.current = ref.current;
            }
            if (show) {
                onShown?.();
            }
        });

        if (!show) {
            return null;
        }

        return <div className={className} ref={ref}>{children}</div>;
    }
}));

import NoteTypeChooserDialogComponent from "./note_type_chooser";

describe("NoteTypeChooserDialog", () => {
    let container: HTMLElement;
    let host: Component;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        host = new Component();

        act(() => {
            render(
                <ParentComponent.Provider value={host}>
                    <NoteTypeChooserDialogComponent />
                </ParentComponent.Provider>,
                container
            );
        });
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("focuses Text on open so Enter creates a text note", async () => {
        const callback = vi.fn();

        await act(async () => {
            await host.handleEventInChildren("chooseNoteType", { callback });
        });
        await act(async () => {
            await Promise.resolve();
        });

        const textItem = container.querySelector<HTMLElement>('.dropdown-item[data-value="text,"]');
        expect(textItem).not.toBeNull();
        expect(document.activeElement).toBe(textItem);

        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        textItem?.dispatchEvent(event);

        expect(callback).toHaveBeenCalledExactlyOnceWith({
            success: true,
            noteType: "text",
            templateNoteId: "",
            notePath: undefined
        });
    });
});
