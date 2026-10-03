import "./mention_list_view.css";

import type { MentionFeedObjectItem, MentionHostedList, MentionListEntry, MentionListState, MentionListView, SlashCommandConfig, SlashCommandDefinition, SlashCommandItem, TriliumSlashCommands } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { type ComponentChildren, render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { AutocompleteList, type AutocompleteListHandle } from "../../react/FormAutocomplete";
import Icon from "../../react/Icon";
import { NoteMentionList } from "../../react/NoteAutocomplete";
import Popup from "../../react/Popup";
import RawHtml from "../../react/RawHtml";

/** The least width of an {@link createAutocompleteMentionList} list, whose caret anchor has none. */
const AUTOCOMPLETE_MENTION_MIN_WIDTH = 220;
/** The width of the `/` palette, which fits all but the longest descriptions. */
const SLASH_COMMAND_LIST_WIDTH = 350;

/**
 * Draws a text editor's suggestion list (emoji) as the note
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
    const handle: { current: AutocompleteListHandle | null } = { current: null };
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

/**
 * Lists what `source` has for the query typed after a marker as a form field's autocomplete lists
 * it, for the editor config's `mention.hostedFeeds`, and mentions the entry picked as `toMention`
 * makes it.
 */
export function createAutocompleteMentionList({ source, renderItem, toMention }: {
    source(query: string): Promise<string[]>;
    renderItem?(item: string): ComponentChildren;
    toMention(item: string): MentionFeedObjectItem;
}): MentionHostedList {
    const container = document.createElement("div");
    const handle: { current: AutocompleteListHandle | null } = { current: null };
    let element: HTMLElement | null = null;

    return {
        show(state) {
            render(<AutocompleteList
                query={state.query}
                source={source}
                // A new anchor each time the query changes, so it is placed again at the caret.
                anchor={{ getBoundingClientRect: state.caretRect, contextElement: state.editable ?? undefined }}
                minWidth={AUTOCOMPLETE_MENTION_MIN_WIDTH}
                renderItem={renderItem}
                onPick={(item) => state.commit(toMention(item))}
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

/**
 * Lists the `/` palette's entries for the query as a form field's autocomplete lists its own, for the
 * editor config's `slashCommand.list`, opening on the best match so that Enter runs it.
 */
export function createSlashCommandList(editor: Parameters<NonNullable<SlashCommandConfig["list"]>>[0]): MentionHostedList {
    const palette = editor.plugins.get("TriliumSlashCommands") as TriliumSlashCommands;
    const source = async (query: string) => palette.search(query);
    const container = document.createElement("div");
    const handle: { current: AutocompleteListHandle | null } = { current: null };
    let element: HTMLElement | null = null;

    return {
        show(state) {
            render(<AutocompleteList<SlashCommandDefinition>
                query={state.query}
                source={source}
                schedule={lookUpNow}
                // A new anchor each time the query changes, so it is placed again at the caret.
                anchor={{ getBoundingClientRect: state.caretRect, contextElement: state.editable ?? undefined }}
                minWidth={SLASH_COMMAND_LIST_WIDTH}
                className="slash-command-list"
                autoActivate
                keyOf={(definition) => definition.id}
                textOf={(definition) => definition.title}
                renderItem={(definition) => <SlashCommandRow definition={definition} />}
                onPick={(definition) => state.commit(toSlashCommandItem(definition))}
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

function toSlashCommandItem(definition: SlashCommandDefinition): SlashCommandItem {
    return { id: definition.id, definition };
}

/** Looks the palette's entries up at once: the catalog is in memory, so there is nothing to wait for. */
function lookUpNow(lookUp: () => Promise<void>) {
    void lookUp();
}

/** One entry of the `/` palette: its icon, its title and what it does. */
function SlashCommandRow({ definition }: { definition: SlashCommandDefinition }) {
    return (
        <span className="slash-command">
            {definition.iconClass
                ? <Icon className="slash-command-icon" icon={clsx(definition.iconClass, definition.iconColorClass)} />
                : <RawHtml className="slash-command-icon" html={definition.icon} />}
            <span className="slash-command-text">
                <span className="slash-command-title">{definition.title}</span>
                {definition.description && <span className="slash-command-description">{definition.description}</span>}
            </span>
        </span>
    );
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
            className="dropdown-menu show tn-dropdown-menu tn-menu-keyboard note-autocomplete-menu mention-list-menu"
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
