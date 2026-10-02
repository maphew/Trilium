import "./mention_list_view.css";

import type { MentionListEntry, MentionListState, MentionListView } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import type { Suggestion } from "../../../services/note_autocomplete";
import { renderNoteSuggestion } from "../../react/NoteAutocomplete";
import Popup from "../../react/Popup";

/**
 * Draws a text editor's suggestion list (`@` notes, `#`/`~` attributes, `/` commands, emoji) as the
 * note autocomplete's menu, in a {@link Popup} at the caret, for the editor config's
 * `mention.listView`.
 *
 * `TriliumMentionUI` keeps everything but the drawing: when the list opens and closes, the keys, the
 * selection and the commit. The menu never takes the focus, which stays in the editor.
 */
export function createMentionListView(): MentionListView {
    const container = document.createElement("div");
    let element: HTMLDivElement | null = null;
    // Set while the pointer moves the selection, which must not scroll the list under it.
    let selectedByPointer = false;

    return {
        show(state) {
            render(<MentionMenu
                state={state}
                elementRef={(el) => { element = el; }}
                scrollsToSelection={() => {
                    const scrolls = !selectedByPointer;
                    selectedByPointer = false;
                    return scrolls;
                }}
                onPointerSelect={(index) => {
                    selectedByPointer = true;
                    state.select(index);
                }}
            />, container);
        },
        hide() {
            render(null, container);
            element = null;
        },
        get element() {
            return element;
        },
        destroy() {
            render(null, container);
            element = null;
        }
    };
}

function MentionMenu({ state, elementRef, scrollsToSelection, onPointerSelect }: {
    state: MentionListState;
    elementRef(element: HTMLDivElement | null): void;
    scrollsToSelection(): boolean;
    onPointerSelect(index: number): void;
}) {
    const menuRef = useRef<HTMLMenuElement>(null);
    const lastPointer = useRef<{ x: number; y: number }>();
    const { entries, selectedIndex } = state;

    useLayoutEffect(() => {
        if (!scrollsToSelection() || selectedIndex < 0) return;
        menuRef.current?.children[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }, [ selectedIndex, entries ]);

    return (
        <Popup
            // A new anchor each time the list changes, so it is placed again at the caret as it moves.
            anchor={{ getBoundingClientRect: state.caretRect }}
            elementRef={elementRef}
            // The pointer moves the highlighted row, so `:hover` marks no second one.
            className={clsx("dropdown-menu show tn-dropdown-menu tn-menu-keyboard note-autocomplete-menu mention-list-menu", state.className)}
        >
            <menu
                ref={menuRef}
                className="tn-menu-scroll"
                role="listbox"
                // Keeps the focus in the editor, which closes the list without it.
                onMouseDown={(e) => e.preventDefault()}
            >
                {entries.map((entry, index) => (
                    <li
                        key={`${entry.marker}:${entry.item.id}`}
                        className={clsx("dropdown-item", index === selectedIndex && "tn-menu-active")}
                        role="option"
                        aria-selected={index === selectedIndex}
                        onMouseMove={(e) => {
                            // A row scrolled under a still pointer does not take the highlight.
                            const last = lastPointer.current;
                            if (last && last.x === e.clientX && last.y === e.clientY) return;
                            lastPointer.current = { x: e.clientX, y: e.clientY };
                            if (index !== selectedIndex) onPointerSelect(index);
                        }}
                        onClick={() => state.pick(index)}
                    >
                        <EntryContent entry={entry} />
                    </li>
                ))}
            </menu>
        </Popup>
    );
}

/**
 * A note as the note autocomplete draws it, and any other entry as its feed's `itemRenderer` does, or
 * by its id where the feed has none.
 */
function EntryContent({ entry }: { entry: MentionListEntry }) {
    const ref = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        const host = ref.current;
        if (!host) return;

        if (isNoteSuggestion(entry.item)) {
            // The row's content itself, as the note autocomplete lays it out in its `<span>`.
            host.replaceChildren(...renderNoteSuggestion(entry.item).childNodes);
        } else {
            host.replaceChildren(entry.render() ?? entry.item.id);
        }
    }, [ entry.item, entry.marker ]);

    return <span ref={ref} />;
}

function isNoteSuggestion(item: MentionListEntry["item"]): item is MentionListEntry["item"] & Suggestion {
    return "highlightedNotePathTitle" in item;
}
