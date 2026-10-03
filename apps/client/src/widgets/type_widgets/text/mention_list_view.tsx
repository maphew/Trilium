import "./mention_list_view.css";

import type { ReferenceElement } from "@floating-ui/dom";
import type { EmojiSuggestion, MentionFeedObjectItem, MentionHostedList, MentionHostedListState, MentionListEntry, MentionListState, MentionListView, SlashCommandConfig, SlashCommandDefinition, SlashCommandItem, TriliumEmojiMention, TriliumSlashCommands } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { type ComponentChildren, render, type VNode } from "preact";
import { type MutableRef, useLayoutEffect, useRef } from "preact/hooks";

import { AutocompleteList, type AutocompleteListHandle } from "../../react/FormAutocomplete";
import { type CommandEntry, CommandMentionList, NoteMentionList } from "../../react/NoteAutocomplete";
import Popup from "../../react/Popup";

/** The editor a list for a plugin's marker is created for. */
type HostEditor = Parameters<NonNullable<SlashCommandConfig["list"]>>[0];

/** The least width of an {@link createAutocompleteMentionList} list, whose caret anchor has none. */
const AUTOCOMPLETE_MENTION_MIN_WIDTH = 220;

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
    return createHostedList((state, list) => (
        <NoteMentionList
            {...list}
            query={state.query}
            allowCreatingNotes={allowCreatingNotes}
            preselect={preselect}
            onPick={(notePath) => state.commit(typeof notePath === "string"
                ? toMention(notePath)
                : notePath.then((path) => path ? toMention(path) : undefined))}
        />
    ));
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
    return createHostedList((state, list) => (
        <AutocompleteList
            {...list}
            query={state.query}
            source={source}
            minWidth={AUTOCOMPLETE_MENTION_MIN_WIDTH}
            renderItem={renderItem}
            onPick={(item) => state.commit(toMention(item))}
        />
    ));
}

/**
 * Lists the `/` palette's entries for the query as the command palette lists its commands, for the
 * editor config's `slashCommand.list`, opening on the best match so that Enter runs it.
 */
export function createSlashCommandList(editor: HostEditor): MentionHostedList {
    const palette = editor.plugins.get("TriliumSlashCommands") as TriliumSlashCommands;
    const source = async (query: string) => palette.search(query).map(toCommandEntry);

    return createHostedList((state, list) => (
        <CommandMentionList<SlashCommandEntry>
            {...list}
            query={state.query}
            source={source}
            className="slash-command-menu"
            onPick={({ definition }) => state.commit(toSlashCommandItem(definition))}
        />
    ));
}

/**
 * Lists the emoji for the query typed after `:` as the command palette lists its commands, the emoji
 * in place of the icon, for the editor config's `emoji.list`.
 */
export function createEmojiList(editor: HostEditor): MentionHostedList {
    const emoji = editor.plugins.get("TriliumEmojiMention") as TriliumEmojiMention;
    const source = async (query: string) => emoji.search(query).map(toEmojiEntry);

    return createHostedList((state, list) => (
        <CommandMentionList<EmojiEntry>
            {...list}
            query={state.query}
            source={source}
            onPick={({ suggestion }) => state.commit(suggestion)}
        />
    ));
}

/** What a list drawn by {@link createHostedList} is given to draw itself with. */
interface HostedListProps {
    /** At the caret, placed again each time the query changes. */
    anchor: ReferenceElement;
    handleRef: MutableRef<AutocompleteListHandle | null>;
    elementRef(element: HTMLElement | null): void;
}

/**
 * A {@link MentionHostedList} that renders what `draw` returns for each query, and forwards the
 * editor's keys to it.
 */
function createHostedList(draw: (state: MentionHostedListState, list: HostedListProps) => VNode): MentionHostedList {
    const container = document.createElement("div");
    const handleRef: { current: AutocompleteListHandle | null } = { current: null };
    let element: HTMLElement | null = null;
    const elementRef = (el: HTMLElement | null) => { element = el; };
    const unmount = () => {
        render(null, container);
        element = null;
    };

    return {
        show(state) {
            // A new anchor each time, so the list is placed again at the caret. Its `contextElement`
            // places it again as the containers around the editor scroll.
            const anchor = { getBoundingClientRect: state.caretRect, contextElement: state.editable ?? undefined };
            render(draw(state, { anchor, handleRef, elementRef }), container);
        },
        hide: unmount,
        handleKeyDown: (e) => handleRef.current?.handleKeyDown(e) ?? false,
        get element() {
            return element;
        },
        destroy: unmount
    };
}

type SlashCommandEntry = CommandEntry & { definition: SlashCommandDefinition };

/** What the palette commits for an entry, which `TriliumSlashCommands` then runs. */
function toSlashCommandItem(definition: SlashCommandDefinition): SlashCommandItem {
    return { id: definition.id, definition };
}

/** A palette entry as a command row: a snippet's font icon in its colour, or the entry's SVG. */
function toCommandEntry(definition: SlashCommandDefinition): SlashCommandEntry {
    return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        icon: definition.iconClass ? clsx(definition.iconClass, definition.iconColorClass) : undefined,
        iconSvg: definition.iconClass ? undefined : definition.icon,
        definition
    };
}

type EmojiEntry = CommandEntry & { suggestion: EmojiSuggestion };

/** An emoji as a command row, the emoji its icon, or the entry that opens the picker. */
function toEmojiEntry(suggestion: EmojiSuggestion): EmojiEntry {
    return {
        id: suggestion.id,
        title: suggestion.title,
        icon: suggestion.opensPicker ? "bx bx-smile" : undefined,
        iconText: suggestion.opensPicker ? undefined : suggestion.text,
        suggestion
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
