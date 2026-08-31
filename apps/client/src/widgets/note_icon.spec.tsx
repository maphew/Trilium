import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import FNote from "../entities/fnote";
import { renderInto } from "../test/render";

const shownNote = vi.hoisted(() => ({ current: undefined as FNote | undefined }));

vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => ({ note: shownNote.current, viewScope: { viewMode: "default" } }),
    useNoteLabel: () => [ undefined ]
}));

vi.mock("./react/IconPicker", () => ({
    IconPickerButton: () => {
        const [ shown, setShown ] = useState(false);
        return (
            <div>
                <button className="picker-toggle" onClick={() => setShown(true)}>
                    Open picker
                </button>
                {shown && <div className="picker">Picker</div>}
            </div>
        );
    }
}));

vi.mock("../services/attributes", () => ({
    default: {
        setLabel: vi.fn(),
        removeAttributeById: vi.fn()
    }
}));

import NoteIcon from "./note_icon";

describe("NoteIcon", () => {
    it("closes an open icon picker when the active note changes", () => {
        shownNote.current = buildNote("note-a");
        const container = renderInto(<NoteIcon />);
        const toggle = container.querySelector<HTMLButtonElement>(".picker-toggle");
        expect(toggle).not.toBeNull();

        act(() => toggle?.click());
        expect(container.querySelector(".picker")).not.toBeNull();

        shownNote.current = buildNote("note-b");
        act(() => render(<NoteIcon />, container));

        expect(container.querySelector(".picker")).toBeNull();
    });
});

function buildNote(noteId: string) {
    return {
        noteId,
        isMetadataReadOnly: false,
        getIcon: () => "bx bx-note",
        getOwnedLabels: () => [],
        hasOwnedLabel: () => false
    } as unknown as FNote;
}
