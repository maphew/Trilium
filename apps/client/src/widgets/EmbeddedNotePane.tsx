import "./EmbeddedNotePane.css";

import { ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";

import appContext from "../components/app_context";
import Component from "../components/component";
import NoteContext from "../components/note_context";
import FNote from "../entities/fnote";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

/*
 * A note embedded in a pane of its host view — the geo map's marker pane, the calendar's detail
 * dock: the note-context wiring such a pane needs to hold the real note widgets (TitleRow,
 * PromotedAttributes, NoteDetail), and, in EmbeddedNotePane.css, the layout that fits them into a
 * third of the width they are written for. The pane itself — where it stands, how it opens and
 * closes, what it offers around the note — stays with the view that owns it.
 */

/**
 * A note context of the pane's own, pointed at whichever note the pane stands for — the arrangement
 * the quick editor makes, so that the icon and title widgets work and a rename saves the usual way.
 *
 * One context for the pane rather than one per note: moving between notes is a note switch within a
 * standing pane, not a new pane.
 *
 * The returned component stands between the host view's component and the pane's contents. The
 * context was built here rather than by the tab manager, so it has no parent to raise events
 * through and is given one by hand — the pane's component, not the host's. Pointing a note context
 * at a note announces a note switch, and an unbound `useNoteContext` rebinds to whatever context it
 * hears named (see hooks.tsx). The quick editor gets away with announcing to its parent because it
 * is a dialog at the root; the pane is inside its view, so the collection view around it would
 * rebind to the pane's note and tear the view down. It still hangs off the host's component as a
 * child, so app-wide events travel down into the pane — a component hanging off nothing would never
 * hear that its note was edited elsewhere.
 */
export function useEmbeddedNoteContext(note: FNote | undefined, ntxId: string) {
    const parentComponent = useContext(ParentComponent);
    const [ noteContext ] = useState(() => new NoteContext(ntxId));
    const [ component ] = useState(() => new Component());

    useEffect(() => {
        if (!parentComponent) return;

        parentComponent.child(component);
        return () => parentComponent.removeChild(component);
    }, [ parentComponent, component ]);

    useEffect(() => {
        noteContext.triggerEvent = (name, data) => component.handleEventInChildren(name, data);
    }, [ noteContext, component ]);

    useEffect(() => {
        if (!note) return;

        const notePath = note.getBestNotePathString(appContext.tabManager.getActiveContext()?.hoistedNoteId);
        void noteContext.setNote(notePath, {
            // Selecting a note in the pane is not the kind of navigation that should dismiss an
            // open dialog.
            keepActiveDialog: true,
            viewScope: {
                // A note held read-only only because of its size is editable here, as it is in the
                // quick editor; one the reader has marked read-only stays that way.
                readOnlyTemporarilyDisabled: !note.hasLabel("readOnly"),
                // The pane has a third of a note's width, which is not a toolbar's worth: the
                // editor's own follows the selection instead of standing in a bar (see link.ts).
                floatingToolbar: true
            }
        });
    }, [ noteContext, note?.noteId ]);

    return { noteContext, component };
}

/**
 * Announces that the pane's note context is going, giving whatever is being edited in it the chance
 * to save. Closing a pane announces nothing on its own — the widgets are simply unmounted — so the
 * event a note context is removed under is raised here in its place, which is what the editors are
 * listening for (see the spaced updates in hooks.tsx). The contents must still be mounted when it
 * is raised, or there is nobody left to hear it.
 *
 * Best not waited on: the save is under way by the time the call returns, and a request already in
 * flight does not care that what started it has gone. Waiting would hold the pane open for a round
 * trip to the server every time it was closed with something unsaved in it.
 */
export function announceEmbeddedNoteClosing(component: Component, ntxId: string) {
    return component.handleEventInChildren("beforeNoteContextRemove", { ntxIds: [ ntxId ] });
}

/**
 * What the pane's contents live under: the pane's own component and note context, so that the
 * widgets inside read the embedded note rather than the host's, and answer to the pane's component
 * rather than the host's.
 */
export function EmbeddedNoteScope({ component, noteContext, children }: {
    component: Component;
    noteContext: NoteContext;
    children: ComponentChildren;
}) {
    return (
        <ParentComponent.Provider value={component}>
            <NoteContextContext.Provider value={noteContext}>
                {children}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}
