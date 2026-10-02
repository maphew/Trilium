import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextMenuEvent } from "./context_menu";

const mocks = vi.hoisted(() => ({
    show: vi.fn(),
    triggerCommand: vi.fn(),
    openContextWithNote: vi.fn(),
    isMobile: vi.fn(() => false),
    isDesktop: vi.fn(() => true),
    getClosestNtxId: vi.fn((): string | null => null),
    /** The splits of the active tab, which decide the "new split" vs "other split" wording. */
    subContexts: [ { ntxId: "ntx-first" }, { ntxId: "ntx-last" } ] as { ntxId: string }[],
    activeNtxId: "ntx-active" as string | null,
    /** False when no tab is open at all, which leaves both the hoisting and the split unresolvable. */
    hasActiveContext: true,
    getAttachmentOfNote: vi.fn(),
    getAttachmentActionGroups: vi.fn(),
    getTextEditorContaining: vi.fn()
}));

vi.mock("./text_editor_context_menu", () => ({
    getTextEditorContaining: mocks.getTextEditorContaining
}));

vi.mock("../services/options", () => ({ default: { get: () => "expandable" } }));

vi.mock("./context_menu", () => ({ default: { show: mocks.show } }));

vi.mock("../services/froca", () => ({
    default: { getAttachmentOfNote: mocks.getAttachmentOfNote }
}));

vi.mock("../services/attachment_actions", () => ({
    getAttachmentActionGroups: mocks.getAttachmentActionGroups
}));

vi.mock("../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../services/utils", () => ({
    default: { isDesktop: mocks.isDesktop },
    isMobile: mocks.isMobile
}));

vi.mock("../widgets/widget_utils", () => ({ getClosestNtxId: mocks.getClosestNtxId }));

vi.mock("../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: {
            get activeNtxId() {
                return mocks.activeNtxId;
            },
            openContextWithNote: mocks.openContextWithNote,
            getActiveContext: () => mocks.hasActiveContext
                ? { hoistedNoteId: "hoistedNote", getSubContexts: () => mocks.subContexts }
                : undefined,
            getNoteContextById: () => ({
                getMainContext: () => ({ getSubContexts: () => mocks.subContexts })
            })
        }
    }
}));

import linkContextMenu from "./link_context_menu";

const VIEW_SCOPE = { viewMode: "attachments" as const, attachmentId: "att-1" };

function contextMenuEvent(target?: HTMLElement) {
    return { pageX: 12, pageY: 34, target } as unknown as ContextMenuEvent;
}

function handle(command: string | undefined, viewScope = {}, hoistedNoteId: string | null = null) {
    return linkContextMenu.handleLinkContextMenuItem(command, contextMenuEvent(), "root/n1", viewScope, hoistedNoteId);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMobile.mockReturnValue(false);
    mocks.isDesktop.mockReturnValue(true);
    mocks.getClosestNtxId.mockReturnValue(null);
    mocks.subContexts = [ { ntxId: "ntx-first" }, { ntxId: "ntx-last" } ];
    mocks.activeNtxId = "ntx-active";
    mocks.hasActiveContext = true;
    mocks.getAttachmentOfNote.mockResolvedValue(null);
});

describe("getItems", () => {
    it("offers the four ways of opening a link, the split one worded for the layout", () => {
        const items = linkContextMenu.getItems(contextMenuEvent());

        expect(items.map((item) => "command" in item && item.command)).toEqual([
            "openNoteInNewTab", "openNoteInNewSplit", "openNoteInNewWindow", "openNoteInPopup"
        ]);
        // On the desktop the split always opens beside the current one.
        expect(items[1]).toMatchObject({ title: "link_context_menu.open_note_in_new_split" });

        // On mobile a tab holds one split at a time, so with one already open the link goes to the
        // *other* split rather than to a new one.
        mocks.isMobile.mockReturnValue(true);
        expect(linkContextMenu.getItems(contextMenuEvent())[1])
            .toMatchObject({ title: "link_context_menu.open_note_in_other_split" });

        mocks.subContexts = [ { ntxId: "ntx-only" } ];
        expect(linkContextMenu.getItems(contextMenuEvent())[1])
            .toMatchObject({ title: "link_context_menu.open_note_in_new_split" });
    });

    /** For a menu with entries of its own, which lists quick edit and folds the rest away. */
    it("folds the three places into one submenu, quick edit standing on its own", () => {
        const open = linkContextMenu.getOpenNoteItem(contextMenuEvent());

        // The entry acts as well as folding: picking it opens the note where it is opened most.
        expect(open).toMatchObject({
            title: "link_context_menu.open_note",
            command: "openNoteInNewTab"
        });
        expect("items" in open && open.items?.map((item) => "command" in item && item.command))
            .toEqual([ "openNoteInNewTab", "openNoteInNewSplit", "openNoteInNewWindow" ]);
        expect(linkContextMenu.getQuickEditItem()).toMatchObject({
            title: "link_context_menu.open_note_in_popup",
            command: "openNoteInPopup"
        });
    });
});

describe("handleLinkContextMenuItem", () => {
    it("opens a new tab under the given hoisting, falling back to the active context's", () => {
        expect(handle("openNoteInNewTab", VIEW_SCOPE, "explicitHoist")).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: "explicitHoist",
            viewScope: VIEW_SCOPE,
            placement: "afterCurrent"
        });

        handle("openNoteInNewTab");
        expect(mocks.openContextWithNote).toHaveBeenLastCalledWith("root/n1", {
            hoistedNoteId: "hoistedNote",
            viewScope: {},
            placement: "afterCurrent"
        });
    });

    it("opens a split beside the last one, a window, and the popup — all carrying the view scope", () => {
        expect(handle("openNoteInNewSplit", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit", {
            ntxId: "ntx-last",
            notePath: "root/n1",
            hoistedNoteId: "hoistedNote",
            viewScope: VIEW_SCOPE
        });

        expect(handle("openNoteInNewWindow", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInWindow", {
            notePath: "root/n1",
            hoistedNoteId: "hoistedNote",
            viewScope: VIEW_SCOPE
        });

        // The view scope is what lets the popup show an attachment rather than its owning note.
        expect(handle("openNoteInPopup", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: VIEW_SCOPE
        });
    });

    it("does nothing for a command it does not own, or a split with no context to open into", () => {
        expect(handle("someOtherCommand")).toBe(false);
        expect(handle(undefined)).toBe(false);

        // Nothing to resolve a context from: no pane under the pointer and no active tab either.
        mocks.isDesktop.mockReturnValue(false);
        mocks.activeNtxId = null;
        expect(handle("openNoteInNewSplit")).toBe(false);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("opens with no hoisting, and no split at all, when there is no tab open", () => {
        mocks.hasActiveContext = false;

        expect(handle("openNoteInNewTab")).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: null,
            viewScope: {},
            placement: "afterCurrent"
        });

        // On the desktop the split is resolved from that same missing tab.
        expect(handle("openNoteInNewSplit")).toBe(false);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("resolves the split from the event's own pane on mobile, and from the active tab otherwise", () => {
        mocks.isDesktop.mockReturnValue(false);
        mocks.getClosestNtxId.mockReturnValue("ntx-from-dom");
        const event = contextMenuEvent(document.createElement("div"));

        linkContextMenu.handleLinkContextMenuItem("openNoteInNewSplit", event, "root/n1");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit",
            expect.objectContaining({ ntxId: "ntx-from-dom" }));

        // Outside any note-context DOM (e.g. the mobile sidebar) the active context stands in.
        mocks.getClosestNtxId.mockReturnValue(null);
        linkContextMenu.handleLinkContextMenuItem("openNoteInNewSplit", event, "root/n1");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit",
            expect.objectContaining({ ntxId: "ntx-active" }));
    });
});

describe("openContextMenu", () => {
    it("shows the menu at the pointer and routes the choice with the link's state", async () => {
        const event = contextMenuEvent();
        await linkContextMenu.openContextMenu("root/n1", event, VIEW_SCOPE, "explicitHoist");

        const shown = mocks.show.mock.calls[0][0];
        expect(shown).toMatchObject({ x: 12, y: 34 });
        expect(shown.items).toHaveLength(4);

        shown.selectMenuItemHandler({ command: "openNoteInPopup" });
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: VIEW_SCOPE
        });
    });

    it("appends the actions on a linked attachment, each group after a separator", async () => {
        const attachment = { attachmentId: "att-1" };
        const download = vi.fn();
        mocks.getAttachmentOfNote.mockResolvedValue(attachment);
        mocks.getAttachmentActionGroups.mockReturnValue([
            [ { title: "Download", icon: "bx bx-download", run: download } ],
            [ {
                title: "Open custom",
                icon: "bx bx-customize",
                disabledReason: "Desktop only",
                run: vi.fn()
            } ]
        ]);

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE);

        expect(mocks.getAttachmentOfNote).toHaveBeenCalledWith("n1", "att-1");
        expect(mocks.getAttachmentActionGroups).toHaveBeenCalledWith(attachment);
        const { items } = mocks.show.mock.calls[0][0];
        expect(items.slice(4)).toMatchObject([
            { kind: "separator" },
            { title: "Download", uiIcon: "bx bx-download", enabled: true },
            { kind: "separator" },
            { title: "Open custom", uiIcon: "bx bx-customize", enabled: false }
        ]);

        items[5].handler();
        expect(download).toHaveBeenCalledOnce();
    });

    it("ends with converting an attachment link to an embed, only in a note being edited", async () => {
        const execute = vi.fn();
        mocks.getAttachmentOfNote.mockResolvedValue({ attachmentId: "att-1" });
        mocks.getAttachmentActionGroups.mockReturnValue([
            [ { title: "Download", icon: "bx bx-download", run: vi.fn() } ]
        ]);
        mocks.getTextEditorContaining.mockResolvedValue({
            commands: { get: () => ({ isEnabled: true }) },
            execute
        });
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.setAttribute("contenteditable", "true");
        editable.innerHTML = `<a class="reference-link" href="#"><span>report.pdf</span></a>`;
        const link = editable.querySelector("a");

        const title = link?.querySelector("span") ?? undefined;
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(title), VIEW_SCOPE);

        const { items } = mocks.show.mock.calls[0][0];
        expect(items.slice(4)).toMatchObject([
            { kind: "separator" },
            { title: "Download" },
            { title: "link_context_menu.convert_link_to_embed" }
        ]);
        items.at(-1).handler();
        expect(execute).toHaveBeenCalledWith("embedAttachmentLink", {
            domElement: link,
            boxSize: "expandable"
        });

        editable.removeAttribute("contenteditable");
        const event = contextMenuEvent(link ?? undefined);
        await linkContextMenu.openContextMenu("root/n1", event, VIEW_SCOPE);
        expect(mocks.show.mock.calls[1][0].items).toHaveLength(6);
        expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(1);
    });

    describe("from the title row of an attachment embed", () => {
        const execute = vi.fn();
        const selectIncludeAt = vi.fn();
        let hasPlugin = true;
        let hasCommand = true;
        let editable: HTMLElement;

        beforeEach(() => {
            selectIncludeAt.mockReset().mockReturnValue(true);
            execute.mockClear();
            hasPlugin = true;
            hasCommand = true;
            mocks.getAttachmentOfNote.mockResolvedValue({ attachmentId: "att-1" });
            mocks.getAttachmentActionGroups.mockReturnValue([
                [ { title: "Download", icon: "bx bx-download", run: vi.fn() } ]
            ]);
            mocks.getTextEditorContaining.mockResolvedValue({
                plugins: { has: () => hasPlugin, get: () => ({ selectIncludeAt }) },
                commands: {
                    get: (name: string) => (hasCommand && name === "convertEmbedToLink"
                        ? { isEnabled: true }
                        : undefined)
                },
                execute
            });
            editable = document.createElement("div");
            editable.className = "ck-editor__editable";
            editable.setAttribute("contenteditable", "true");
            editable.innerHTML = `<section class="include-note" data-attachment-id="att-1">`
                + `<div class="include-note-title-row">`
                + `<h4 class="include-note-title"><span><a href="#">report.pdf</a></span></h4>`
                + `<button class="include-note-menu"></button></div></section>`;
        });

        /** Opens the menu as right-clicking `selector`, the title link by default, does. */
        async function openOnTitle(selector = "a") {
            const target = editable.querySelector<HTMLElement>(selector) ?? undefined;
            await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(target), VIEW_SCOPE);
            return mocks.show.mock.lastCall?.[0].items;
        }

        it("ends the menu with converting the embed, selected only once chosen", async () => {
            const titleRow = editable.querySelector(".include-note-title-row");

            // Right-clicking the title, then pressing the menu button beside it.
            for (const selector of [ "a", "button.include-note-menu" ]) {
                selectIncludeAt.mockClear();
                execute.mockClear();
                const items = await openOnTitle(selector);

                expect(items.slice(4)).toMatchObject([
                    { kind: "separator" },
                    { title: "Download" },
                    { title: "link_context_menu.convert_embed_to_link", uiIcon: "bx bx-link" }
                ]);
                expect(selectIncludeAt).not.toHaveBeenCalled();

                items.at(-1).handler();
                expect(selectIncludeAt).toHaveBeenCalledWith(titleRow);
                expect(execute).toHaveBeenCalledWith("convertEmbedToLink");
            }

            // An embed the editor cannot select is left as it is.
            selectIncludeAt.mockReturnValue(false);
            execute.mockClear();
            (await openOnTitle()).at(-1).handler();
            expect(execute).not.toHaveBeenCalled();
        });

        it("leaves it out in a read-only note, or outside an attachment embed", async () => {
            hasPlugin = false;
            expect(await openOnTitle()).toHaveLength(6);

            hasPlugin = true;
            hasCommand = false;
            expect(await openOnTitle()).toHaveLength(6);

            hasCommand = true;
            const section = editable.querySelector("section");
            section?.removeAttribute("data-attachment-id");
            expect(await openOnTitle()).toHaveLength(6);
            expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(3);

            // A read-only note is not looked up in the editor at all.
            section?.setAttribute("data-attachment-id", "att-1");
            editable.removeAttribute("contenteditable");
            expect(await openOnTitle()).toHaveLength(6);
            expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(3);
            expect(selectIncludeAt).not.toHaveBeenCalled();
        });
    });

    it("keeps the text editor it opens from focused while it is up", async () => {
        const focusTracker = { add: vi.fn(), remove: vi.fn() };
        mocks.getTextEditorContaining.mockResolvedValue({ ui: { focusTracker } });
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.setAttribute("contenteditable", "true");
        editable.innerHTML = `<div class="include-note-title-row"><button></button></div>`;
        const button = editable.querySelector("button") ?? undefined;

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(button));

        const shown = mocks.show.mock.calls[0][0];
        const container = document.createElement("div");
        shown.onShow(container);
        expect(focusTracker.add).toHaveBeenCalledWith(container);
        expect(focusTracker.remove).not.toHaveBeenCalled();
        shown.onHide();
        expect(focusTracker.remove).toHaveBeenCalledWith(container);

        // A note shown read-only has no editor to keep focused.
        editable.removeAttribute("contenteditable");
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(button));
        expect(mocks.show.mock.calls[1][0]).not.toHaveProperty("onShow");
        expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(1);
    });

    it("adds nothing for a link to a note, or to an attachment that no longer exists", async () => {
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent());
        expect(mocks.getAttachmentOfNote).not.toHaveBeenCalled();

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE);
        expect(mocks.getAttachmentOfNote).toHaveBeenCalledWith("n1", "att-1");

        expect(mocks.show.mock.calls.map(([ shown ]) => shown.items.length)).toEqual([ 4, 4 ]);
        expect(mocks.getAttachmentActionGroups).not.toHaveBeenCalled();
    });

    it("drops a menu whose attachment loads after a later menu opened", async () => {
        let resolveAttachment: (value: unknown) => void = () => {};
        mocks.getAttachmentOfNote.mockReturnValue(new Promise((resolve) => {
            resolveAttachment = resolve;
        }));
        mocks.getAttachmentActionGroups.mockReturnValue([]);

        const first = linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE);
        await linkContextMenu.openContextMenu("root/n2", contextMenuEvent());
        resolveAttachment({ attachmentId: "att-1" });
        await first;

        expect(mocks.show).toHaveBeenCalledOnce();
        mocks.show.mock.calls[0][0].selectMenuItemHandler({ command: "openNoteInPopup" });
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", {
            noteIdOrPath: "root/n2",
            viewScope: {}
        });
    });
});
