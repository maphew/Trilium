import { useLayoutEffect } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import type TabManager from "../../components/tab_manager";
import LoadResults from "../../services/load_results";
import NoteWrapperWidget from "../note_wrapper";
import SplitNoteContainer from "./split_note_container";

describe("SplitNoteContainer", () => {
    let noteContexts: NoteContext[];

    beforeEach(() => {
        noteContexts = [];

        // Only the lookups the container makes while opening and closing splits.
        appContext.tabManager = {
            activeNtxId: null,
            getActiveMainContext: () => noteContexts[0],
            getNoteContextById: (ntxId: string) => noteContexts.find((c) => c.ntxId === ntxId),
            activateNoteContext: () => {}
        } as unknown as TabManager;
    });

    async function openSplits(ntxIds: string[], widgetFactory = () => new NoteWrapperWidget()) {
        const container = new SplitNoteContainer(widgetFactory);
        container.render();

        for (const ntxId of ntxIds) {
            const noteContext = new NoteContext(ntxId);
            noteContexts.push(noteContext);
            await container.newNoteContextCreatedEvent({ noteContext });
        }

        return container;
    }

    it("stops delivering events to a split once its tab is closed", async () => {
        const container = await openSplits([ "split-a", "split-b" ]);
        const [ staysOpen, getsClosed ] = container.children;

        // Stands in for what useTriliumEvent registers on a widget: the board's entitiesReloaded
        // subscription is one of these, and it is what redraws a board nobody can see.
        const openHandler = vi.fn();
        const closedHandler = vi.fn();
        staysOpen.registerHandler("entitiesReloaded", openHandler);
        getsClosed.registerHandler("entitiesReloaded", closedHandler);

        container.noteContextRemovedEvent({ ntxIds: [ "split-b" ] });
        await container.handleEvent("entitiesReloaded", { loadResults: new LoadResults([]) });

        expect(openHandler).toHaveBeenCalledOnce();
        expect(closedHandler).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(1);
    });

    it("unmounts the React widgets of a split once its tab is closed", async () => {
        let isMounted = false;

        function Probe() {
            // A layout effect rather than useEffect: it runs during the commit, so the probe is
            // mounted by the time render() returns, with no scheduled work to flush first.
            useLayoutEffect(() => {
                isMounted = true;
                return () => { isMounted = false; };
            }, []);

            return <div className="probe" />;
        }

        const container = await openSplits(
            [ "split-a" ],
            () => new NoteWrapperWidget().child(<Probe />));
        expect(isMounted).toBe(true);

        container.noteContextRemovedEvent({ ntxIds: [ "split-a" ] });

        // Detaching the widget stops the events; only unmounting releases the Preact tree and the
        // DOM it still points at.
        expect(isMounted).toBe(false);
    });
});
