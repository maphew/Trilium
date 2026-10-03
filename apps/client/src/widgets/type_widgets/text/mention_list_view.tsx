import "./mention_list_view.css";

import type { MentionHostedList, MentionListEntry, MentionListState, MentionListView } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { NoteMentionList, type NoteMentionListHandle } from "../../react/NoteAutocomplete";
import Popup from "../../react/Popup";

/**
 * Draws a text editor's suggestion list (`#`/`~` attributes, `/` commands, emoji) as the note
 * autocomplete's menu, in a {@link Popup} at the caret, for the editor config's `mention.listView`.
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

/**
 * Lists the notes for the query typed after `@` as the note autocomplete does, for the editor config's
 * `mention.hostedFeeds`, and mentions the note picked as a reference link.
 */
export function createNoteMentionList({ allowCreatingNotes, preselect }: {
    allowCreatingNotes?: boolean;
    preselect?: boolean;
} = {}): MentionHostedList {
    const container = document.createElement("div");
    const handle: { current: NoteMentionListHandle | null } = { current: null };
    let element: HTMLDivElement | null = null;

    return {
        show(state) {
            render(<NoteMentionList
                query={state.query}
                // A new anchor each time the query changes, so it is placed again at the caret.
                anchor={{ getBoundingClientRect: state.caretRect, contextElement: state.editable ?? undefined }}
                allowCreatingNotes={allowCreatingNotes}
                preselect={preselect}
                onPick={(notePath) => state.commit(typeof notePath === "string"
                    ? toMention(notePath)
                    : notePath.then((path) => path ? toMention(path) : undefined))}
                handleRef={handle}
                elementRef={(el) => { element = el; }}
            />, container);
        },
        hide() {
            render(null, container);
            element = null;
        },
        handleKeyDown: (e) => handle.current?.handleKeyDown(e) ?? false,
        get element() {
            return element;
        },
        destroy() {
            render(null, container);
            element = null;
        }
    };
}

/** The mention `MentionCustomization` turns into a reference link to `notePath`. */
function toMention(notePath: string) {
    return { id: `@${notePath}`, notePath };
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
        menuRef.current?.querySelectorAll(":scope > .dropdown-item")[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }, [ selectedIndex, entries ]);

    return (
        <Popup
            // A new anchor each time the list changes, so it is placed again at the caret as it moves.
            // Its `contextElement` places it again as the containers around the editor scroll.
            anchor={{ getBoundingClientRect: state.caretRect, contextElement: state.editable ?? undefined }}
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

/** An entry as its feed's `itemRenderer` draws it, or by its id where the feed has none. */
function EntryContent({ entry }: { entry: MentionListEntry }) {
    const ref = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        ref.current?.replaceChildren(entry.render() ?? entry.item.id);
    }, [ entry.item, entry.marker ]);

    return <span ref={ref} />;
}
