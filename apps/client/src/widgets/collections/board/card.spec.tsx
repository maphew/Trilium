/**
 * A card renders state that no board redraw is triggered for, so each of those has to reach the card
 * through a subscription of its own. These check that the card actually receives them.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import Component from "../../../components/component";
import FAttribute from "../../../entities/fattribute";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import noteAttributeCache from "../../../services/note_attribute_cache";
import utils from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView from ".";

describe("Board card", () => {
    let container: HTMLElement | undefined;
    /** froca is module-level, so ids are kept distinct rather than reset between tests. */
    let idSeed = 0;

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("dims a card when its note is archived, without the board being redrawn", async () => {
        // Archiving reaches the board two ways, and only one of them fires here. With
        // #includeArchived off the note leaves the collection's id list, which re-runs the board's
        // refresh; with it on the list is unchanged, so nothing above the card reacts at all.
        const { component, first, second } = await renderBoard();

        expect(cardClasses(first)).not.toContain("archived");

        await addLabel(component, first, "archived");

        expect(cardClasses(first)).toContain("archived");
        expect(cardClasses(second)).not.toContain("archived");
    });

    it("follows its note's icon, which the quick edit popup sets as a label", async () => {
        const { component, first } = await renderBoard();

        expect(cardIcon(first)).not.toContain("bx-bug");

        await addLabel(component, first, "iconClass", "bx bx-bug");

        expect(cardIcon(first)).toContain("bx-bug");
    });

    /** Renders a board of two cards and hands back the component their subscriptions register on. */
    async function renderBoard() {
        const first = `card${idSeed++}`;
        const second = `card${idSeed++}`;
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: first, title: "First", "#status": "To Do" },
                { id: second, title: "Second", "#status": "To Do" }
            ]
        });

        const component = new Component();
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={component}>
                    <BoardView
                        note={note}
                        notePath={`root/${note.noteId}`}
                        noteIds={[ first, second ]}
                        highlightedTokens={null}
                        viewConfig={{ columns: [ { value: "To Do" } ] }}
                        saveConfig={() => {}}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();

        return { note, component, first, second };
    }

    /** Adds a label to a note already in froca and announces it the way a websocket message would. */
    async function addLabel(component: Component, noteId: string, name: string, value = "") {
        const attributeId = utils.randomString(12);
        const attribute = new FAttribute(froca, {
            noteId, attributeId, type: "label", name, value, position: 0, isInheritable: false
        });

        froca.attributes[attributeId] = attribute;
        froca.notes[noteId].attributes.push(attributeId);
        noteAttributeCache.attributes[noteId] = [ ...(noteAttributeCache.attributes[noteId] ?? []), attribute ];

        const entity = { attributeId, noteId, type: "label", name, value, isDeleted: false };
        const loadResults = new LoadResults([ {
            entityName: "attributes", entityId: attributeId, entity, hash: "", isSynced: true, isErased: false
        } ]);
        loadResults.addAttribute(attributeId, "someOtherComponent");

        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });
        await settle();
    }

    function card(noteId: string) {
        const title = froca.notes[noteId]?.title;
        const element = [ ...(container?.querySelectorAll(".board-note") ?? []) ]
            .find((el) => el.querySelector(".title")?.textContent?.includes(title));
        if (!element) throw new Error(`no card rendered for ${noteId} ("${title}")`);

        return element;
    }

    const cardClasses = (noteId: string) => card(noteId).className;
    const cardIcon = (noteId: string) => card(noteId).querySelector(".title .icon")?.className ?? "";
});

/** Drains the async chain inside the board's `refresh()` plus any re-render it queues. */
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}
