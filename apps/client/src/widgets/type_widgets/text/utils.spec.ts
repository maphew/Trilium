import { attachmentIcon } from "@triliumnext/commons";
import type { VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";

vi.mock("../../../services/froca", () => ({
    default: { getNote: vi.fn(), getAttachment: vi.fn() }
}));
vi.mock("../../../services/link", () => ({
    default: { createLink: vi.fn() }
}));
vi.mock("../../../services/content_renderer", () => ({
    default: {
        getRenderedContent: vi.fn(),
        disposeInteractiveContent: vi.fn(),
        mountInteractiveWidget: vi.fn()
    }
}));
vi.mock("./IncludeNote", () => ({
    default: () => null,
    TinyIncludeNote: () => null,
    getNoteActions: vi.fn()
}));
vi.mock("../../../services/attachment_actions", () => ({
    getOpenExternallyAction: vi.fn(),
    getDownloadAction: vi.fn()
}));

import { getDownloadAction, getOpenExternallyAction } from "../../../services/attachment_actions";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link from "../../../services/link";
import IncludeNote, {
    getNoteActions,
    type IncludeNoteAction,
    type IncludeNoteProps,
    TinyIncludeNote,
    type TinyIncludeNoteProps
} from "./IncludeNote";
import {
    getAttachmentHref,
    loadIncludedAttachment,
    loadIncludedNote,
    refreshIncludedNote,
    watchIncludedNotes
} from "./utils";

const note = { noteId: "noteY", getIcon: () => "bx bx-note" } as unknown as FNote;
const attachment = {
    attachmentId: "att1",
    ownerId: "owner",
    role: "file",
    mime: "application/pdf",
    contentLength: 2048
} as unknown as FAttachment;
const ATTACHMENT_SCOPE = { viewMode: "attachments", attachmentId: "att1" };

let title: HTMLElement;
let content: HTMLElement;

beforeEach(() => {
    vi.clearAllMocks();
    title = document.createElement("span");
    content = document.createElement("div");
    vi.mocked(froca.getNote).mockResolvedValue(note);
    vi.mocked(froca.getAttachment).mockResolvedValue(attachment);
    vi.mocked(link.createLink).mockResolvedValue($(title));
    vi.mocked(content_renderer.getRenderedContent)
        .mockResolvedValue({ $renderedContent: $(content), type: "pdf" } as never);
});

function action(title: string): IncludeNoteAction {
    return { title, icon: `bx bx-${title}`, run: vi.fn() };
}

/** The include box mounted last, and the element it was mounted in. */
function lastMount() {
    const call = vi.mocked(content_renderer.mountInteractiveWidget).mock.lastCall;
    if (!call) {
        throw new Error("Expected a mounted include box.");
    }
    const vnode = call[0] as VNode<IncludeNoteProps & TinyIncludeNoteProps>;
    return { type: vnode.type, props: vnode.props, container: call[1] };
}

function createWrapper() {
    const wrapper = document.createElement("div");
    wrapper.className = "include-note-wrapper";
    return wrapper;
}

describe("loadIncludedNote", () => {
    it("mounts a box with the note, its own includes reduced to reference links", async () => {
        const wrapper = createWrapper();

        await loadIncludedNote("noteY", $(wrapper), "medium");

        expect(link.createLink).toHaveBeenCalledWith("noteY", {
            showTooltip: false,
            showNoteIcon: true
        });
        expect(content_renderer.getRenderedContent).toHaveBeenCalledWith(note, {
            interactive: true,
            includesAsReferenceLinks: true,
            mediaEnvironment: "embedded"
        });
        const mount = lastMount();
        expect(mount.type).toBe(IncludeNote);
        expect(mount.container).toBe(wrapper);
        expect(mount.props).toEqual({
            boxSize: "medium",
            title,
            content,
            contentType: "pdf",
            notePath: "noteY"
        });
    });

    it("leaves the box alone for a note that no longer exists", async () => {
        vi.mocked(froca.getNote).mockResolvedValue(null);

        await loadIncludedNote("noteY", $(createWrapper()), "small");

        expect(link.createLink).not.toHaveBeenCalled();
        expect(content_renderer.mountInteractiveWidget).not.toHaveBeenCalled();
    });

    it("mounts a tiny box with the note's path, without the note or a caption", async () => {
        const actions = [ action("edit"), action("open") ];
        vi.mocked(getNoteActions).mockReturnValue(actions);
        const figure = document.createElement("figure");
        figure.className = "include-note";
        figure.dataset.boxSize = "tiny";
        figure.innerHTML = "<figcaption>Caption</figcaption>";

        await loadIncludedNote("noteY", $(figure));

        expect(link.createLink).toHaveBeenCalledWith("noteY", {
            showTooltip: false,
            showNotePath: true
        });
        expect(content_renderer.getRenderedContent).not.toHaveBeenCalled();
        expect(getNoteActions).toHaveBeenCalledWith("noteY");
        const mount = lastMount();
        expect(mount.type).toBe(TinyIncludeNote);
        expect([ ...figure.childNodes ]).toEqual([ mount.container ]);
        expect(mount.props).toEqual({
            icon: "bx bx-note",
            title,
            notePath: "noteY",
            actions
        });
    });
});

describe("loadIncludedAttachment", () => {
    it("mounts a box with the attachment, opened in its note", async () => {
        const wrapper = createWrapper();

        await loadIncludedAttachment("att1", $(wrapper), "full");

        expect(froca.getAttachment).toHaveBeenCalledWith("att1", true);
        expect(link.createLink).toHaveBeenCalledWith("owner", {
            showTooltip: false,
            showNoteIcon: true,
            viewScope: ATTACHMENT_SCOPE
        });
        expect(content_renderer.getRenderedContent)
            .toHaveBeenCalledWith(attachment, { interactive: true, mediaEnvironment: "embedded" });
        const mount = lastMount();
        expect(mount.type).toBe(IncludeNote);
        expect(mount.container).toBe(wrapper);
        expect(mount.props).toEqual({
            boxSize: "full",
            title,
            content,
            contentType: "pdf",
            notePath: "owner",
            viewScope: ATTACHMENT_SCOPE
        });
    });

    it("leaves the box alone for a deleted attachment", async () => {
        vi.mocked(froca.getAttachment).mockResolvedValue(null);

        await loadIncludedAttachment("att1", $(createWrapper()), "small");

        expect(link.createLink).not.toHaveBeenCalled();
        expect(content_renderer.mountInteractiveWidget).not.toHaveBeenCalled();
    });

    it("mounts a tiny box with the size of the attachment, and its file actions", async () => {
        const [ openExternally, download ] = [ action("open-externally"), action("download") ];
        vi.mocked(getOpenExternallyAction).mockReturnValue(openExternally);
        vi.mocked(getDownloadAction).mockReturnValue(download);
        const wrapper = createWrapper();

        await loadIncludedAttachment("att1", $(wrapper), "tiny");

        expect(link.createLink).toHaveBeenCalledWith("owner", {
            showTooltip: false,
            viewScope: ATTACHMENT_SCOPE
        });
        expect(content_renderer.getRenderedContent).not.toHaveBeenCalled();
        expect(getOpenExternallyAction).toHaveBeenCalledWith(attachment);
        expect(getDownloadAction).toHaveBeenCalledWith(attachment);
        const mount = lastMount();
        expect(mount.type).toBe(TinyIncludeNote);
        expect(mount.container).toBe(wrapper);
        expect(mount.props).toEqual({
            icon: attachmentIcon("file", "application/pdf"),
            title,
            description: "2 KiB",
            notePath: "owner",
            viewScope: ATTACHMENT_SCOPE,
            actions: [ openExternally, download ]
        });
    });
});

describe("the element an include box is mounted in", () => {
    it("is a wrapper created in a read-only include ahead of its caption", async () => {
        const figure = document.createElement("figure");
        figure.className = "include-note";
        figure.dataset.boxSize = "expandable";
        figure.innerHTML = "&nbsp;<figcaption>Caption</figcaption>";
        const caption = figure.querySelector("figcaption");

        await loadIncludedNote("noteY", $(figure));

        const { container, props } = lastMount();
        expect(caption).not.toBeNull();
        expect([ ...figure.childNodes ]).toEqual([ container, caption ]);
        expect(container.className).toBe("include-note-wrapper");
        expect(props.boxSize).toBe("expandable");

        // Loading again, as a refresh does, reuses the wrapper.
        await loadIncludedNote("noteY", $(figure), "small");
        expect(lastMount().container).toBe(container);
        expect(lastMount().props.boxSize).toBe("small");
    });

    it("is a wrapper created in a legacy <section> include", async () => {
        const section = document.createElement("section");
        section.className = "include-note";
        section.dataset.boxSize = "medium";

        await loadIncludedNote("noteY", $(section));

        expect([ ...section.childNodes ]).toEqual([ lastMount().container ]);
        expect(lastMount().props.boxSize).toBe("medium");
    });

    it("is the wrapper an editor include holds, leaving the editor's own elements", async () => {
        const figure = document.createElement("figure");
        figure.className = "include-note ck-widget";
        figure.dataset.boxSize = "full";
        const wrapper = createWrapper();
        const caption = document.createElement("figcaption");
        const typeAround = document.createElement("div");
        figure.append(wrapper, caption, typeAround);

        await loadIncludedAttachment("att1", $(figure));

        expect(lastMount().container).toBe(wrapper);
        expect(lastMount().props.boxSize).toBe("full");
        expect([ ...figure.children ]).toEqual([ wrapper, caption, typeAround ]);
    });
});

describe("refreshIncludedNote", () => {
    it("reloads every include of the note, of either element", async () => {
        const container = document.createElement("div");
        container.innerHTML = `<figure class="include-note" data-note-id="noteY"></figure>`
            + `<section class="include-note" data-note-id="noteY"></section>`
            + `<figure class="include-note" data-note-id="other"></figure>`;
        const [ figure, section ] = [ ...container.children ];

        refreshIncludedNote(container, "noteY");

        await vi.waitFor(() => {
            expect(content_renderer.mountInteractiveWidget).toHaveBeenCalledTimes(2);
        });
        const mountedIn = vi.mocked(content_renderer.mountInteractiveWidget).mock.calls
            .map(([ , wrapper ]) => wrapper.parentElement);
        expect(mountedIn).toEqual([ figure, section ]);
    });
});

describe("watchIncludedNotes", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        container.innerHTML = `<p>text</p><figure class="include-note"></figure>`
            + `<blockquote><figure class="include-note"></figure></blockquote>`;
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function disposed() {
        return vi.mocked(content_renderer.disposeInteractiveContent).mock.calls
            .map(([ $element ]) => $element[0]);
    }

    function flush() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    it("unmounts what is removed from the container, but not what is moved within it", async () => {
        const stop = watchIncludedNotes(container);
        const [ paragraph, include, quote ] = [ ...container.children ];

        include.remove();
        quote.remove();
        container.append(quote);
        paragraph.firstChild?.remove();
        await flush();

        expect(disposed()).toEqual([ include ]);
        stop();
    });

    it("unmounts what is left on stop, and stops watching", async () => {
        const stop = watchIncludedNotes(container);
        const include = container.querySelector("figure");
        include?.remove();

        stop();
        expect(disposed()).toEqual([ include, container ]);

        container.querySelector("blockquote")?.remove();
        await flush();
        expect(disposed()).toHaveLength(2);
    });
});

describe("getAttachmentHref", () => {
    it("links to the attachment in its note, or to nothing once it is deleted", async () => {
        vi.mocked(froca.getAttachment)
            .mockResolvedValueOnce({ ownerId: "owner" } as unknown as FAttachment)
            .mockResolvedValueOnce(null);

        expect(await getAttachmentHref("att1"))
            .toBe("#root/owner?viewMode=attachments&attachmentId=att1");
        expect(await getAttachmentHref("att1")).toBeNull();
    });
});
