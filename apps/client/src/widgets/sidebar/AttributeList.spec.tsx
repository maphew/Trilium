import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

// The panel follows whichever note is being read; the tests hand it one directly. Handing it another
// redraws it, as the real hook does by listening for the switch — rendering the panel a second time
// would not: the same element with no props of its own is the same vnode to Preact, which skips it.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null, listeners: new Set<() => void>() }));
vi.mock("../react/hooks", async (importOriginal) => {
    const { useEffect, useState } = await import("preact/hooks");

    return {
        ...(await importOriginal<typeof import("../react/hooks")>()),
        useActiveNoteContext: () => {
            const [ , setRevision ] = useState(0);
            useEffect(() => {
                const listener = () => setRevision((revision) => revision + 1);
                shownNote.listeners.add(listener);
                return () => shownNote.listeners.delete(listener);
            }, []);

            return { note: shownNote.current };
        }
    };
});

// Deleting is confirmed first, and adding goes through a menu; neither dialog belongs to this widget.
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../services/dialog", () => ({ default: { confirm } }));
const showContextMenu = vi.hoisted(() => vi.fn(async (_opts: AddMenuCall) => {}));
vi.mock("../../menus/context_menu", () => ({ default: { show: showContextMenu } }));

/** What the add button asks the context menu to show: a kind per entry, and a rule between groups. */
interface AddMenuCall {
    items: { kind?: string; handler?: () => void }[];
}

// A relation's target is picked in an Algolia autocomplete bound to jQuery, which is not loaded here.
vi.mock("../react/NoteAutocomplete", () => ({ default: () => null }));

import appContext from "../../components/app_context";
import FAttribute, { FAttributeRow } from "../../entities/fattribute";
import type { Attribute } from "../../services/attribute_parser";
import froca from "../../services/froca";
import noteAttributeCache from "../../services/note_attribute_cache";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import AttributeList, { getAttributeKind, getDisplayName, listInherited, listInternal, listOwned, splitIntoSections } from "./AttributeList";

describe("listOwned", () => {
    it("orders by position and leaves out the attributes Trilium maintains itself", () => {
        const rows = listOwned([
            attribute({ name: "second", position: 20 }),
            attribute({ type: "relation", name: "internalLink", value: "target", position: 30 }),
            attribute({ name: "first", position: 10, value: "red", isInheritable: true })
        ]);

        expect(rows.map((row) => row.name)).toEqual([ "first", "second" ]);
        expect(rows[0]).toMatchObject({
            type: "label", name: "first", value: "red", isInheritable: true
        });
    });
});

describe("listInherited", () => {
    it("keeps only what comes from other notes, grouped by the note it comes from", () => {
        const rows = listInherited([
            attribute({ noteId: "bbb", name: "fromB2", position: 20 }),
            attribute({ noteId: "own", name: "ownLabel" }),
            attribute({ noteId: "aaa", name: "fromA" }),
            attribute({ noteId: "bbb", name: "fromB1", position: 10 })
        ], "own");

        expect(rows.map((row) => row.name)).toEqual([ "fromA", "fromB1", "fromB2" ]);
        expect(rows.map((row) => row.noteId)).toEqual([ "aaa", "bbb", "bbb" ]);
    });
});

describe("listInternal", () => {
    it("keeps exactly what the owned list leaves out: what Trilium wrote from the note's content", () => {
        const rows = listInternal([
            attribute({ name: "author", value: "Elian" }),
            attribute({ type: "relation", name: "internalLink", value: "target", position: 30 }),
            attribute({ type: "relation", name: "imageLink", value: "image", position: 20 })
        ]);

        expect(rows.map((row) => row.name)).toEqual([ "imageLink", "internalLink" ]);
    });
});

describe("splitIntoSections", () => {
    it("sets the definitions of either aside, the note's own first, and splits the rest by ownership", () => {
        const sections = splitIntoSections(
            [ plain("cssClass"), plain("label:priority"), plain("relation:owner") ],
            [ plain("archived", "parent"), plain("label:status", "template") ]
        );

        expect(sections.owned.map((entry) => entry.attribute.name)).toEqual([ "cssClass" ]);
        expect(sections.inherited.map((entry) => entry.attribute.name)).toEqual([ "archived" ]);
        expect(sections.definitions.map((entry) => entry.attribute.name))
            .toEqual([ "label:priority", "relation:owner", "label:status" ]);
        // Which of the definitions the note may edit is the row's to know, the card holding both.
        expect(sections.definitions.map((entry) => entry.isOwned)).toEqual([ true, true, false ]);
    });

    it("sorts the names Trilium reads for itself last, each group keeping its order", () => {
        const { owned } = splitIntoSections(
            [ plain("cssClass"), plain("priority"), plain("archived"), plain("author") ],
            []
        );

        expect(owned.map((entry) => entry.attribute.name)).toEqual([ "priority", "author", "cssClass", "archived" ]);
        expect(owned.map((entry) => entry.isSystem)).toEqual([ false, false, true, true ]);
    });
});

describe("getAttributeKind / getDisplayName", () => {
    it("tells a definition from what it defines, and shows it without its prefix", () => {
        const cases: [ FAttributeRow["type"], string, string, string ][] = [
            // type, name, expected kind, expected displayed name
            [ "label", "color", "label", "color" ],
            [ "relation", "template", "relation", "template" ],
            [ "label", "label:color", "label-definition", "color" ],
            [ "label", "relation:author", "relation-definition", "author" ],
            // A bare prefix defines nothing, so it stays an ordinary label — name and all.
            [ "label", "label:", "label", "label:" ]
        ];

        for (const [ type, name, expectedKind, expectedName ] of cases) {
            const attrType = getAttributeKind({ type, name });
            expect(attrType, name).toBe(expectedKind);
            expect(getDisplayName({ type, name }, attrType), name).toBe(expectedName);
        }
    });
});

describe("AttributeList", () => {
    let container: HTMLElement;
    let put: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        options.set("rightPaneCollapsedItems", "[]");
        // A release build, unless the test at hand is about what only a development one shows.
        setDevBuild(false);
        put = vi.fn(async () => ({}));
        server.put = put as unknown as typeof server.put;
        // The detail popup looks up the notes sharing the attribute it opens on, against the tab the
        // note is being read in — neither of which a rendered widget brings with it.
        server.post = (async () => ({ results: [], count: 0 })) as unknown as typeof server.post;
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        for (const orphan of document.querySelectorAll(".attr-detail")) {
            orphan.remove();
        }
    });

    it("gives the note's own attributes, the inherited ones and the definitions of either a card each", () => {
        renderPanel(noteWithAttributes());

        // Three cards, each listing what its section holds.
        const cards = [ ...container.querySelectorAll(".card") ];
        expect(cards.map((card) => card.id)).toEqual([ "attributes", "attributes-inherited", "attributes-definitions" ]);
        expect(namesIn(cards[0])).toEqual([ "author", "cssClass", "template" ]);
        expect(namesIn(cards[1])).toEqual([ "inheritedLabel", "archived" ]);
        // The definitions of both notes share a card, the note's own first, and lose their prefix.
        expect(namesIn(cards[2])).toEqual([ "priority", "status" ]);

        // The kind is carried by the icon; a definition takes the icon of the field it sets up.
        expect(iconsIn(cards[0])).toEqual([ "bx bx-hash", "bx bx-hash", "bx bx-transfer" ]);
        // A definition that names no type sets up a text field, and takes that field's icon.
        expect(iconsIn(cards[2])).toEqual([ "bx bx-calendar", "bx bx-text" ]);

        // The names Trilium reads for itself come last, below a rule, and are marked as such.
        expect(cards[0].querySelectorAll("hr.attribute-rows-divider")).toHaveLength(1);
        expect([ ...cards[0].querySelectorAll(".attribute-kind") ].map((kind) => kind.className.includes("marker-system")))
            .toEqual([ false, true, true ]);

        // A row of the note's own is deletable and unattributed; an inherited one names its note instead.
        expect(cards[0].querySelectorAll(".attribute-delete-button")).toHaveLength(3);
        expect(cards[0].querySelectorAll(".attribute-owner")).toHaveLength(0);
        expect(cards[1].querySelectorAll(".attribute-delete-button")).toHaveLength(0);
        expect(cards[1].querySelectorAll(".attribute-owner")).toHaveLength(2);
        // Only what the note may edit is deletable, whichever card it is in.
        expect(cards[2].querySelectorAll(".attribute-delete-button")).toHaveLength(1);

        // An inheritable attribute is marked, and every definition previews what it sets up.
        expect(cards[1].querySelectorAll(".attribute-marker")).toHaveLength(2);
        expect(cards[2].querySelectorAll(".attribute-value.definition")).toHaveLength(2);
    });

    it("keeps to one card, collapsing and all, for a note with nothing but its own attributes", () => {
        renderPanel(buildNote({ id: "bare", title: "Bare", "#author": "Elian" }));

        expect(container.querySelectorAll(".card")).toHaveLength(1);
        // Down to a single card there is nothing to put away, so no chevron is offered.
        expect(container.querySelector(".card")?.className).toContain("not-collapsible");
    });

    it("says so, rather than showing an empty list, for a note carrying no attributes at all", () => {
        renderPanel(buildNote({ id: "empty", title: "Empty" }));

        expect(container.querySelectorAll(".attribute-row")).toHaveLength(0);
        expect(container.querySelector(".no-items")).not.toBeNull();
    });

    it("leaves what Trilium wrote for itself out of a release build, and gives it its own card in a development one", () => {
        buildNote({ id: "target", title: "Target" });
        const note = buildNote({ id: "linking", title: "Linking", "#author": "Elian", "~internalLink": "target" });

        renderPanel(note);
        expect(cardIds()).toEqual([ "attributes" ]);

        // Unmounted first, the panel collecting the attributes of the note it is handed as it mounts.
        setDevBuild(true);
        render(null, container);
        renderPanel(note);

        const cards = [ ...container.querySelectorAll(".card") ];
        expect(cardIds()).toEqual([ "attributes", "attributes-internal" ]);
        expect(namesIn(cards[1])).toEqual([ "internalLink" ]);
        // Nothing on such a row is the note's to change, and nothing marks it as Trilium's own: the
        // card it is in says as much of every row it holds.
        expect(cards[1].querySelectorAll(".attribute-delete-button")).toHaveLength(0);
        expect(cards[1].querySelectorAll(".attribute-owner")).toHaveLength(0);
        expect(cards[1].querySelector(".attribute-kind")?.className).not.toContain("marker-system");
        expect(cards[1].querySelectorAll("hr.attribute-rows-divider")).toHaveLength(0);
    });

    it("opens the detail popup on a row and closes it again on a press beside the rows", () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().click());
        expect(document.querySelector(".attr-detail")).not.toBeNull();
        expect(firstRow().className).toContain("active");

        act(() => container.querySelector<HTMLElement>(".attribute-list-panel")?.click());
        expect(document.querySelector(".attr-detail")).toBeNull();
        // Closing keeps what was typed, whether the press landed beside the rows or clear of the panel:
        // both are a press away from the form rather than a refusal of what is in it.
        expect(put).toHaveBeenCalledOnce();
        expect(put.mock.calls[0][0]).toBe("notes/subject/attributes");
    });

    it("edits a system attribute that is a closed set as a dropdown of the values it allows", () => {
        renderPanel(buildNote({ id: "subject", title: "Subject", "#sortDirection": "desc" }));

        act(() => firstRow().click());

        const field = document.querySelector<HTMLSelectElement>(".attr-detail .attr-input-value");
        expect(field?.tagName).toBe("SELECT");
        expect([ ...(field?.options ?? []) ].map((option) => option.value)).toEqual([ "", "asc", "desc" ]);
        expect(field?.value).toBe("desc");
        // Not framed by an input group: it has no buttons to be grouped with, and a group blanks the
        // background of the fields inside it — which is the background the themes draw the dropdown's
        // arrow on, leaving nothing to say the field is one.
        expect(field?.closest(".input-group")).toBeNull();
    });

    it("saves an attribute left open for editing to the note it belongs to, on reading another", () => {
        renderPanel(noteWithAttributes());
        act(() => firstRow().click());

        // Read another note without pressing away from the form first, as a keyboard shortcut does.
        showNote(buildNote({ id: "elsewhere", title: "Elsewhere", "#other": "x" }));

        expect(document.querySelector(".attr-detail")).toBeNull();
        expect(namesIn(container)).toEqual([ "other" ]);
        // Saved against the note it was typed on, not against the one now being read.
        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string }[] ];
        expect(url).toBe("notes/subject/attributes");
        expect(saved.map((attribute) => attribute.name)).toContain("author");
    });

    it("confirms a deletion before persisting what is left of the note's attributes", async () => {
        renderPanel(noteWithAttributes());

        confirm.mockResolvedValueOnce(false);
        await act(async () => container.querySelector<HTMLElement>(".attribute-delete-button")?.click());
        expect(confirm).toHaveBeenCalledOnce();
        expect(put).not.toHaveBeenCalled();
        expect(namesIn(container)).toContain("author");

        confirm.mockResolvedValueOnce(true);
        await act(async () => container.querySelector<HTMLElement>(".attribute-delete-button")?.click());

        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string }[] ];
        expect(url).toBe("notes/subject/attributes");
        expect(saved.map((attribute) => attribute.name)).toEqual([ "cssClass", "template", "label:priority" ]);
        expect(namesIn(container)).not.toContain("author");
    });

    it("adds an attribute of the kind picked from the card's menu, saving them once the popup is closed", async () => {
        renderPanel(noteWithAttributes());

        // The panel's own button offers every kind; the definitions card offers the two definitions.
        const [ ownedMenu, definitionsMenu ] = [ ...container.querySelectorAll<HTMLElement>(".card-header-buttons .bx-plus") ];
        act(() => ownedMenu.click());
        act(() => definitionsMenu.click());

        const offered = showContextMenu.mock.calls.map(([ { items } ]) => items.length);
        // Four kinds and the rule setting the definitions apart, against the two definitions on their own.
        expect(offered).toEqual([ 5, 2 ]);

        for (const item of showContextMenu.mock.calls[0][0].items) {
            act(() => item.handler?.());
        }

        // The popup opens on whatever was added; nothing is saved until it is closed.
        expect(document.querySelector(".attr-detail")).not.toBeNull();
        expect(put).not.toHaveBeenCalled();

        // A press beside the popup keeps the edits, which for a list of rows means saving them.
        await act(async () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });

        expect(document.querySelector(".attr-detail")).toBeNull();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.slice(-4)).toEqual([
            { type: "label", name: "myLabel", value: "", isInheritable: false },
            { type: "relation", name: "myRelation", value: "", isInheritable: false },
            { type: "label", name: "label:myLabel", value: "promoted,single,text", isInheritable: false },
            { type: "label", name: "relation:myRelation", value: "promoted,single", isInheritable: false }
        ]);
    });

    it("edits an owned label's value in place, saving it once the field is left", async () => {
        renderPanel(noteWithAttributes());

        // The values offered for editing in place are exactly the owned labels': not a relation's
        // (whose value is a link), not a definition's (whose value is a summary), not an inherited row's.
        expect([ ...container.querySelectorAll(".attribute-value.editable") ]).toHaveLength(2);

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        // The press edits in place rather than opening the popup, in the field the value calls for.
        expect(document.querySelector(".attr-detail")).toBeNull();
        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        expect(input?.value).toBe("Elian");

        act(() => {
            if (input) {
                input.value = "Someone else";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });

        // Leaving the field ends the edit and saves it; the row shows the value again, as typed.
        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(url).toBe("notes/subject/attributes");
        expect(saved.find((attribute) => attribute.name === "author")?.value).toBe("Someone else");
        expect(firstRow().querySelector(".attribute-value")?.textContent).toBe("Someone else");
    });

    it("puts the value back on escape, and saves nothing for an edit that changed nothing", async () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());
        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        act(() => {
            if (input) {
                input.value = "discarded";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(firstRow().querySelector(".attribute-value")?.textContent).toBe("Elian");

        // Entered and left alone: nothing changed, so nothing is put to the server either way.
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());
        await act(async () => {
            container.querySelector<HTMLInputElement>(".attribute-value-editor input")
                ?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });
        expect(put).not.toHaveBeenCalled();
    });

    it("types the in-place field by what the label is: a closed set as a dropdown, a defined number by its definition", () => {
        renderPanel(buildNote({ id: "sorted", title: "Sorted", "#sortDirection": "desc" }));
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const select = container.querySelector<HTMLSelectElement>(".attribute-value-editor select");
        expect(select?.value).toBe("desc");
        expect([ ...(select?.options ?? []) ].map((option) => option.value)).toEqual([ "", "asc", "desc" ]);

        render(null, container);
        renderPanel(buildNote({
            id: "scored", title: "Scored",
            "#score": "3",
            "#label:score": "promoted,single,number,precision=2"
        }));
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        expect(input?.type).toBe("number");
        expect(input?.step).toBe("0.01");
    });

    it("shows a colour label as the colour itself, and edits it through the picker", () => {
        renderPanel(buildNote({ id: "tinted", title: "Tinted", "#color": "#8000ff" }));

        // The preview is the colour, not its text — which is kept to the chip's tooltip.
        const chip = firstRow().querySelector<HTMLElement>(".attribute-value .label-color-chip");
        expect(chip?.title).toBe("#8000ff");
        expect(chip?.style.backgroundColor).toBeTruthy();

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const picker = container.querySelector<HTMLInputElement>(".attribute-value-editor input[type=color]");
        expect(picker?.value).toBe("#8000ff");
    });

    it("discards what the popup was told when it is closed rather than pressed away from", async () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().click());
        const popup = document.querySelector<HTMLElement>(".attr-detail");
        expect(popup).not.toBeNull();

        // Escape closes the popup, taking the pending edits with it — and saving nothing.
        await act(async () => {
            popup?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(document.querySelector(".attr-detail")).toBeNull();
        expect(put).not.toHaveBeenCalled();

        // Deleting from the popup is the same deletion as from the row, confirmation and all.
        act(() => firstRow().click());
        await act(async () => document.querySelector<HTMLElement>(".attr-detail .attr-delete-button")?.click());

        expect(confirm).toHaveBeenCalledOnce();
        expect(put).toHaveBeenCalledOnce();
        expect(namesIn(container)).not.toContain("author");
    });

    function renderPanel(note: FNote) {
        shownNote.current = note;
        act(() => render(<AttributeList />, container));
    }

    /** Reads another note in the panel already rendered, as navigating to one does. */
    function showNote(note: FNote) {
        act(() => {
            shownNote.current = note;
            for (const listener of shownNote.listeners) {
                listener();
            }
        });
    }

    function cardIds() {
        return [ ...container.querySelectorAll(".card") ].map((card) => card.id);
    }

    function firstRow() {
        const row = container.querySelector<HTMLElement>(".attribute-row");
        expect(row).not.toBeNull();
        return row as HTMLElement;
    }
});

/** Which build the panel believes it is running in, which is all that decides one of its cards. */
function setDevBuild(isDev: boolean) {
    (window as unknown as { glob: { isDev: boolean } }).glob.isDev = isDev;
}

function namesIn(root: Element) {
    return [ ...root.querySelectorAll(".attribute-name") ].map((name) => name.textContent);
}

function iconsIn(root: Element) {
    return [ ...root.querySelectorAll(".attribute-kind > span") ].map(
        (icon) => icon.className.replace(" tn-icon", ""));
}

/**
 * A note carrying one of everything the panel sorts into cards: its own attributes (a name of its own,
 * two Trilium reads for itself), a definition, and the same two kinds reaching it from a parent.
 */
function noteWithAttributes() {
    buildNote({ id: "tpl", title: "Template" });
    buildNote({ id: "parent", title: "Parent" });
    const note = buildNote({
        id: "subject",
        title: "Subject",
        "#author": "Elian",
        "#cssClass": "wide",
        "~template": "tpl",
        "#label:priority": "promoted,single,date"
    });

    // The effective attributes the inherited ones are read out of, the note's own mixed in.
    noteAttributeCache.attributes[note.noteId] = [
        ...note.getOwnedAttributes(),
        inherited({ name: "inheritedLabel", value: "x" }),
        inherited({ name: "archived", value: "" }),
        inherited({ name: "label:status", value: "promoted,multi" })
    ];

    return note;
}

function inherited(row: Partial<FAttributeRow>) {
    return attribute({ noteId: "parent", isInheritable: true, ...row });
}

function plain(name: string, noteId = "own"): Attribute {
    return { type: "label", name, noteId, value: "", isInheritable: false };
}

function attribute(row: Partial<FAttributeRow>) {
    return new FAttribute(froca, {
        attributeId: `attr-${row.noteId ?? "own"}-${row.name ?? "x"}`,
        noteId: "own",
        type: "label",
        name: "label",
        value: "",
        position: 10,
        isInheritable: false,
        ...row
    });
}
