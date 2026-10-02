import type { MentionListState } from "@triliumnext/ckeditor5";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMentionListView } from "./mention_list_view";

describe("createMentionListView", () => {
    const views: ReturnType<typeof createMentionListView>[] = [];

    afterEach(() => {
        for (const view of views.splice(0)) view.destroy?.();
        vi.restoreAllMocks();
    });

    function stateWith(overrides: Partial<MentionListState> = {}): MentionListState {
        const command = document.createElement("button");
        command.className = "ck ck-button ck-slash-command-button";
        command.textContent = "Heading";

        return {
            entries: [
                // The `@` feed's items carry the note autocomplete's fields beside the mention's own.
                { item: { id: "@Alpha", highlightedNotePathTitle: "<b>Al</b>pha", icon: "bx bx-file" } as MentionListState["entries"][0]["item"], marker: "@", render: () => undefined },
                { item: { id: "/heading" }, marker: "/", render: () => command },
                { item: { id: "#plain" }, marker: "#", render: () => undefined }
            ],
            className: "ck-mention-list",
            selectedIndex: 0,
            caretRect: () => new DOMRect(10, 10, 1, 16),
            select: vi.fn(),
            pick: vi.fn(),
            ...overrides
        };
    }

    async function show(state: MentionListState) {
        const view = createMentionListView();
        views.push(view);
        await act(async () => view.show(state));
        return view;
    }

    const rows = () => [ ...document.querySelectorAll<HTMLElement>(".mention-list-menu .tn-menu-scroll > .dropdown-item") ];

    it("draws the entries as the note autocomplete's menu at the caret, the selected one highlighted", async () => {
        const view = await show(stateWith());

        const menu = view.element;
        expect(menu?.className).toContain("dropdown-menu");
        expect(menu?.className).toContain("note-autocomplete-menu");
        expect(menu?.classList.contains("ck-mention-list")).toBe(true);
        expect(rows().map((row) => row.classList.contains("tn-menu-active"))).toEqual([ true, false, false ]);

        // A note as the note autocomplete draws it, the rest as their feeds do, or by their id.
        const [ note, command, plain ] = rows();
        expect(note.querySelector(".tn-icon")?.className).toContain("bx-file");
        expect(note.querySelector(".search-result-title")?.innerHTML).toBe("<b>Al</b>pha");
        expect(command.querySelector(".ck-slash-command-button")?.textContent).toBe("Heading");
        expect(plain.textContent).toBe("#plain");

        await act(async () => view.hide());
        expect(view.element).toBeNull();
        expect(document.querySelector(".mention-list-menu")).toBeNull();
    });

    it("reports the row the pointer moves onto and the one clicked, not a row under a still pointer", async () => {
        const state = stateWith();
        await show(state);
        const [ , second ] = rows();

        second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
        expect(state.select).toHaveBeenCalledWith(1);

        vi.mocked(state.select).mockClear();
        second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
        expect(state.select).not.toHaveBeenCalled();

        second.click();
        expect(state.pick).toHaveBeenCalledWith(1);

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        second.dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
    });

    it("scrolls a row the keys select into view, not one the pointer does", async () => {
        const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
        const state = stateWith();
        const view = await show(state);
        scroll.mockClear();

        await act(async () => view.show({ ...state, selectedIndex: 2 }));
        expect(scroll).toHaveBeenCalledOnce();
        expect(scroll.mock.contexts[0]).toBe(rows()[2]);

        scroll.mockClear();
        vi.mocked(state.select).mockImplementation((index) => void view.show({ ...state, selectedIndex: index }));
        await act(async () => {
            rows()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 9, clientY: 9 }));
        });
        expect(state.select).toHaveBeenCalledWith(1);
        expect(scroll).not.toHaveBeenCalled();
    });
});
