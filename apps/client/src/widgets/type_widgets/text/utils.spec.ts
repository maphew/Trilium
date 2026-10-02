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
vi.mock("./IncludeNote", () => ({ default: () => null }));

import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link from "../../../services/link";
import IncludeNote, { type IncludeNoteProps } from "./IncludeNote";
import {
    getAttachmentHref,
    loadIncludedAttachment,
    loadIncludedNote,
    watchIncludedNotes
} from "./utils";

const note = { noteId: "noteY" } as unknown as FNote;
const attachment = { attachmentId: "att1", ownerId: "owner" } as unknown as FAttachment;
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

/** The include box mounted last, and the element it was mounted in. */
function lastMount() {
    const call = vi.mocked(content_renderer.mountInteractiveWidget).mock.lastCall;
    if (!call) {
        throw new Error("Expected a mounted include box.");
    }
    const vnode = call[0] as VNode<IncludeNoteProps>;
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
});

describe("loadIncludedAttachment", () => {
    it("mounts a box with the attachment, opened in its note and offered fullscreen", async () => {
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
            viewScope: ATTACHMENT_SCOPE,
            isFullscreenOffered: true
        });
    });

    it("leaves the box alone for a deleted attachment", async () => {
        vi.mocked(froca.getAttachment).mockResolvedValue(null);

        await loadIncludedAttachment("att1", $(createWrapper()), "small");

        expect(link.createLink).not.toHaveBeenCalled();
        expect(content_renderer.mountInteractiveWidget).not.toHaveBeenCalled();
    });
});

describe("the element an include box is mounted in", () => {
    it("is a wrapper created in a read-only section, which gives the box size", async () => {
        const section = document.createElement("section");
        section.className = "include-note";
        section.dataset.boxSize = "expandable";
        section.innerHTML = "&nbsp;";

        await loadIncludedNote("noteY", $(section));

        const { container, props } = lastMount();
        expect([ ...section.childNodes ]).toEqual([ container ]);
        expect(container.className).toBe("include-note-wrapper");
        expect(props.boxSize).toBe("expandable");

        // Loading again, as a refresh does, reuses the wrapper.
        await loadIncludedNote("noteY", $(section), "small");
        expect(lastMount().container).toBe(container);
        expect(lastMount().props.boxSize).toBe("small");
    });

    it("is the wrapper an editor section holds, leaving the editor's own elements", async () => {
        const section = document.createElement("section");
        section.className = "include-note ck-widget";
        section.dataset.boxSize = "full";
        const wrapper = createWrapper();
        const typeAround = document.createElement("div");
        section.append(wrapper, typeAround);

        await loadIncludedAttachment("att1", $(section));

        expect(lastMount().container).toBe(wrapper);
        expect(lastMount().props.boxSize).toBe("full");
        expect([ ...section.children ]).toEqual([ wrapper, typeAround ]);
    });
});

describe("watchIncludedNotes", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        container.innerHTML = `<p>text</p><section class="include-note"></section>`
            + `<blockquote><section class="include-note"></section></blockquote>`;
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
        const [ paragraph, section, quote ] = [ ...container.children ];

        section.remove();
        quote.remove();
        container.append(quote);
        paragraph.firstChild?.remove();
        await flush();

        expect(disposed()).toEqual([ section ]);
        stop();
    });

    it("unmounts what is left on stop, and stops watching", async () => {
        const stop = watchIncludedNotes(container);
        const section = container.querySelector("section");
        section?.remove();

        stop();
        expect(disposed()).toEqual([ section, container ]);

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
