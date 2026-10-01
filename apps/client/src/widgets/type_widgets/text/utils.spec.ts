import type { VNode } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";

vi.mock("../../../services/froca", () => ({
    default: { getNote: vi.fn(), getAttachment: vi.fn() }
}));
vi.mock("../../../services/link", () => ({
    default: { createLink: vi.fn() }
}));
vi.mock("../../../services/content_renderer", async () => {
    const { render } = await import("preact");
    return {
        default: {
            getRenderedContent: vi.fn(),
            disposeInteractiveContent: vi.fn(),
            mountInteractiveWidget: vi.fn(async (vnode: VNode, container: HTMLElement) => {
                render(vnode, container);
            })
        }
    };
});
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link from "../../../services/link";
import { getAttachmentHref, loadIncludedAttachment, loadIncludedNote } from "./utils";

const note = { noteId: "noteY" } as unknown as FNote;

describe("loadIncludedNote", () => {
    beforeEach(() => {
        vi.mocked(froca.getNote).mockResolvedValue(note);
        vi.mocked(link.createLink).mockResolvedValue($('<span class="link"><a href="#">noteY</a></span>'));
        vi.mocked(content_renderer.getRenderedContent).mockResolvedValue({ $renderedContent: $("<p>body</p>"), type: "text" } as never);
        vi.mocked(content_renderer.disposeInteractiveContent).mockReset();
    });

    it("reuses the wrapper element without nesting a second one (editing-view path)", async () => {
        // The editing-view downcast hands us the `.include-note-wrapper` element itself.
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "small");

        const wrappers = $el.find(".include-note-wrapper");
        expect(wrappers.length).toBe(0);
        expect($el.children(".include-note-title").length).toBe(1);
        expect($el.children(".include-note-content").length).toBe(1);
    });

    it("builds a single wrapper inside the section (read-only / refresh path)", async () => {
        // The read-only and refresh paths hand us the outer `section.include-note`.
        const $el = $('<section class="include-note" data-note-id="noteY">');

        await loadIncludedNote("noteY", $el, "small");

        const wrappers = $el.find(".include-note-wrapper");
        expect(wrappers.length).toBe(1);
        expect(wrappers.children(".include-note-title").length).toBe(1);
        expect(wrappers.children(".include-note-content").length).toBe(1);
    });

    it("builds an expandable include (toggle) and degrades the note's own includes to reference links", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "expandable");

        // The expandable branch adds a title row with a toggle button.
        expect($el.children(".include-note-title-row").length).toBe(1);
        expect($el.find("button.include-note-toggle").length).toBe(1);
        // The included note is rendered with its own includes reduced to reference links.
        expect(content_renderer.getRenderedContent).toHaveBeenCalledWith(note, { interactive: true, includesAsReferenceLinks: true, mediaEnvironment: "embedded" });
    });

    it("offers no fullscreen button at any box size", async () => {
        for (const boxSize of [ "small", "medium", "full", "expandable" ]) {
            const $el = $('<div class="include-note-wrapper">');
            await loadIncludedNote("noteY", $el, boxSize);
            expect($el.find(".include-note-fullscreen, .include-note-fullscreen-controls"))
                .toHaveLength(0);
        }
    });

    it("disposes interactive content of a previous render before replacing it", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "small");

        expect(content_renderer.disposeInteractiveContent).toHaveBeenCalledWith($el);
    });
});

describe("loadIncludedAttachment", () => {
    const attachment = {
        attachmentId: "att1",
        ownerId: "owner",
        title: "report.pdf"
    } as unknown as FAttachment;

    beforeEach(() => {
        vi.mocked(froca.getAttachment).mockResolvedValue(attachment);
        vi.mocked(link.createLink).mockResolvedValue($('<span><a href="#">report.pdf</a></span>'));
        vi.mocked(content_renderer.getRenderedContent)
            .mockResolvedValue({ $renderedContent: $("<p>body</p>"), type: "pdf" } as never);
    });

    it("fills the box with the attachment, under a title linking to it", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedAttachment("att1", $el, "expandable");

        expect(froca.getAttachment).toHaveBeenCalledWith("att1", true);
        expect(link.createLink).toHaveBeenCalledWith("owner", {
            showTooltip: false,
            showNoteIcon: true,
            viewScope: { viewMode: "attachments", attachmentId: "att1" }
        });
        expect(content_renderer.getRenderedContent)
            .toHaveBeenCalledWith(attachment, { interactive: true, mediaEnvironment: "embedded" });
        expect($el.find("button.include-note-toggle").length).toBe(1);
        expect($el.find(".include-note-content.type-pdf").text()).toBe("body");
    });

    it("offers fullscreen from the end of a medium or full box's title row", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        // The read-only path reads the box size from the section rather than taking it.
        const boxes: [ JQuery<HTMLElement>, string | undefined ][] = [
            [ $('<div class="include-note-wrapper">'), "medium" ],
            [ $('<section class="include-note" data-box-size="full">'), undefined ]
        ];

        for (const [ $el, boxSize ] of boxes) {
            await loadIncludedAttachment("att1", $el, boxSize);

            const $row = $el.find(".include-note-title-row");
            const button = $row.children("button.include-note-fullscreen.bx-fullscreen")[0];
            expect($row.children().map((_, child) => child.className).get())
                .toEqual([ "include-note-title", "include-note-fullscreen bx bx-fullscreen" ]);
            expect(button.title).toBe("common.fullscreen");

            const content = $el.find(".include-note-content")[0];
            content.requestFullscreen = vi.fn(async () => {});
            const click = new MouseEvent("click", { bubbles: true });
            const stopPropagation = vi.spyOn(click, "stopPropagation");
            button.dispatchEvent(click);
            expect(content.requestFullscreen).toHaveBeenCalledOnce();
            expect(stopPropagation).toHaveBeenCalled();
        }

        // A refused request is logged rather than left unhandled.
        const content = boxes[1][0].find(".include-note-content")[0];
        content.requestFullscreen = vi.fn(async () => {
            throw new Error("Denied");
        });
        boxes[1][0].find("button.include-note-fullscreen")[0].click();
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        warn.mockRestore();

        for (const boxSize of [ "small", "expandable" ]) {
            const $el = $('<div class="include-note-wrapper">');
            await loadIncludedAttachment("att1", $el, boxSize);
            expect($el.find(".include-note-fullscreen, .include-note-fullscreen-controls"))
                .toHaveLength(0);
        }
    });

    it("puts a labeled button leaving fullscreen over the top end of the content", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const exitFullscreen = vi.fn<() => Promise<void>>(async () => {});
        Object.defineProperty(document, "exitFullscreen", {
            value: exitFullscreen,
            configurable: true
        });
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedAttachment("att1", $el, "full");

        const controls = $el.children(".include-note-content")[0].firstElementChild;
        const group = controls?.querySelector<HTMLElement>(".tn-overlay-control-group");
        const button = group?.querySelector("button");
        expect(controls?.className).toBe("include-note-fullscreen-controls");
        expect(group?.className).toContain("include-note-exit-fullscreen");
        expect(group?.dataset.placement).toBe("top-end");
        expect(button?.textContent).toBe("common.exit_fullscreen");
        expect(button?.querySelector(".bx.bx-exit")).not.toBeNull();

        const click = new MouseEvent("click", { bubbles: true });
        const stopPropagation = vi.spyOn(click, "stopPropagation");
        button?.dispatchEvent(click);
        expect(exitFullscreen).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalled();

        // A refused request is logged rather than left unhandled.
        exitFullscreen.mockRejectedValueOnce(new Error("Not in fullscreen"));
        button?.click();
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());

        warn.mockRestore();
        Reflect.deleteProperty(document, "exitFullscreen");
    });

    it("leaves the box alone for a deleted attachment", async () => {
        vi.mocked(froca.getAttachment).mockResolvedValue(null);
        vi.mocked(link.createLink).mockClear();
        const $el = $('<div class="include-note-wrapper"><span>kept</span></div>');

        await loadIncludedAttachment("att1", $el, "small");

        expect(link.createLink).not.toHaveBeenCalled();
        expect($el.text()).toBe("kept");
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
