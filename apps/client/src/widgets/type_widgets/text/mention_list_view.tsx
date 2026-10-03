import "./mention_list_view.css";

import type { ReferenceElement } from "@floating-ui/dom";
import type { EmojiSuggestion, MentionFeedObjectItem, MentionHostedList, MentionHostedListState, SlashCommandConfig, SlashCommandDefinition, SlashCommandItem, TriliumEmojiMention, TriliumSlashCommands } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { type ComponentChildren, render, type VNode } from "preact";
import type { MutableRef } from "preact/hooks";

import { AutocompleteList, type AutocompleteListHandle } from "../../react/FormAutocomplete";
import { type CommandEntry, CommandMentionList, NoteMentionList } from "../../react/NoteAutocomplete";

/** The editor a list for a plugin's marker is created for. */
type HostEditor = Parameters<NonNullable<SlashCommandConfig["list"]>>[0];

/** The least width of an {@link createAutocompleteMentionList} list, whose caret anchor has none. */
const AUTOCOMPLETE_MENTION_MIN_WIDTH = 220;

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

/**
 * An emoji as a command row, the emoji its icon, or the entry that opens the picker, set apart from
 * the emoji above it with the icon of the editor's emoji button.
 */
function toEmojiEntry(suggestion: EmojiSuggestion): EmojiEntry {
    return {
        id: suggestion.id,
        title: suggestion.title,
        iconSvg: suggestion.icon,
        iconText: suggestion.opensPicker ? undefined : suggestion.text,
        startsGroup: suggestion.opensPicker,
        suggestion
    };
}

/** The mention `MentionCustomization` turns into a reference link to `notePath`. */
function toMention(notePath: string) {
    return { id: `@${notePath}`, notePath };
}
