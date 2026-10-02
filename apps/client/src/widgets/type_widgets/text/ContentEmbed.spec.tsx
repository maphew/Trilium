import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    openTabWithNoteWithHoisting,
    triggerCommand,
    openContextMenu,
    getOriginBelow,
    disposeInteractiveContent
} = vi.hoisted(() => ({
    openTabWithNoteWithHoisting: vi.fn(),
    triggerCommand: vi.fn(),
    openContextMenu: vi.fn(),
    getOriginBelow: vi.fn((anchor: Element) => ({ below: anchor })),
    disposeInteractiveContent: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../../components/app_context", () => ({
    default: { tabManager: { openTabWithNoteWithHoisting }, triggerCommand }
}));
vi.mock("../../../menus/link_context_menu", () => ({
    default: { openContextMenu, getOriginBelow }
}));
vi.mock("../../../services/content_renderer", () => ({ default: { disposeInteractiveContent } }));

import ContentEmbed, {
    getNoteActions,
    type ContentEmbedProps,
    TinyContentEmbed,
    type TinyContentEmbedProps
} from "./ContentEmbed";

const ATTACHMENT_SCOPE = { viewMode: "attachments", attachmentId: "att1" } as const;

let container: HTMLElement;

beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    for (const tooltip of document.querySelectorAll(".tooltip")) {
        tooltip.remove();
    }
});

function element(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const first = template.content.firstElementChild;
    if (!(first instanceof HTMLElement)) {
        throw new Error(`Expected an element in: ${html}`);
    }
    return first;
}

function renderBox(props: Partial<ContentEmbedProps> = {}) {
    const boxProps: ContentEmbedProps = {
        title: element(`<span><a href="#root/noteA">Note A</a></span>`),
        content: element(`<div class="rendered-content"><p>body</p></div>`),
        contentType: "text",
        notePath: "noteA",
        ...props
    };
    act(() => render(<ContentEmbed {...boxProps} />, container));
    return boxProps;
}

function renderTinyBox(props: Partial<TinyContentEmbedProps> = {}) {
    const boxProps: TinyContentEmbedProps = {
        icon: "bx bx-note",
        title: element(`<span><a href="#root/noteA">Note A</a></span>`),
        notePath: "noteA",
        actions: [],
        ...props
    };
    act(() => render(<TinyContentEmbed {...boxProps} />, container));
    return boxProps;
}

/** The include-note-* class of each element in the title row, in order. */
function titleRow() {
    return [ ...container.querySelectorAll(".include-note-title-row > *") ]
        .map((child) => [ ...child.classList ].find((name) => name.startsWith("include-note-")));
}

function button(className: string) {
    const found = container.querySelector<HTMLButtonElement>(`button.${className}`);
    if (!found) {
        throw new Error(`Expected a button.${className}.`);
    }
    return found;
}

function contentBox() {
    const found = container.querySelector<HTMLElement>(".include-note-content");
    if (!found) {
        throw new Error("Expected the content box.");
    }
    return found;
}

function tooltipOf(target: HTMLElement) {
    const tooltip = Tooltip.getInstance(target);
    act(() => tooltip?.show());
    const text = document.querySelector(".tooltip-inner")?.textContent;
    act(() => tooltip?.hide());
    return text;
}

/**
 * Right-clicks `target`, and tells whether the box opened the embed's menu for it, taking the
 * click from the browser and what surrounds the box.
 */
function rightClick(target: Element | null) {
    if (!target) {
        throw new Error("Nothing to right-click.");
    }
    openContextMenu.mockClear();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    act(() => {
        target.dispatchEvent(event);
    });
    const opened = openContextMenu.mock.calls.length === 1
        && openContextMenu.mock.calls[0][1] === event;
    return { opened, isTaken: event.defaultPrevented && stopPropagation.mock.calls.length > 0 };
}

/** Clicks `target` and tells whether the click was kept from what surrounds the box. */
function click(target: HTMLElement) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    act(() => {
        target.dispatchEvent(event);
    });
    return { event, isStopped: stopPropagation.mock.calls.length > 0 };
}

describe("ContentEmbed", () => {
    it("lays out the title row for each box size", () => {
        const plain = [ "title", "open", "menu" ];
        const withFullscreen = [ "title", "open", "fullscreen", "menu" ];
        const layouts: [ string | undefined, string[] ][] = [
            [ undefined, plain ],
            [ "small", plain ],
            [ "medium", withFullscreen ],
            [ "full", withFullscreen ],
            [ "expandable", [ "toggle", "title", "open", "menu" ] ]
        ];

        for (const [ boxSize, expected ] of layouts) {
            act(() => render(null, container));
            renderBox({ boxSize });
            expect(titleRow(), boxSize).toEqual(expected.map((name) => `include-note-${name}`));
        }
    });

    it("shows its title and content, and swaps them on a new render", () => {
        const titleChildren = () => [
            ...container.querySelector("h4.include-note-title")?.childNodes ?? []
        ];
        const first = renderBox({ contentType: "pdf" });
        const box = contentBox();
        expect(titleChildren()).toEqual([ first.title ]);
        expect(box.className).toBe("include-note-content type-pdf");
        expect(first.content.parentElement).toBe(box);

        const second = renderBox({ contentType: "image" });
        expect(titleChildren()).toEqual([ second.title ]);
        expect(contentBox()).toBe(box);
        expect(box.className).toBe("include-note-content type-image");
        expect([ ...box.children ]).toEqual([ second.content ]);
        expect(first.content.isConnected).toBe(false);
        expect(disposeInteractiveContent).toHaveBeenCalledOnce();
        expect(disposeInteractiveContent.mock.calls[0][0][0]).toBe(first.content);
    });

    it("disposes its content when unmounted", () => {
        const { content } = renderBox();

        act(() => render(null, container));

        expect(content.isConnected).toBe(false);
        expect(disposeInteractiveContent.mock.calls.map(([ $content ]) => $content[0]))
            .toEqual([ content ]);
    });

    it("keeps the content of an expandable box hidden until its toggle opens it", () => {
        renderBox({ boxSize: "expandable" });
        const toggle = button("include-note-toggle");
        expect(contentBox().hidden).toBe(true);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(Tooltip.getInstance(toggle)).toBeNull();

        expect(click(toggle).isStopped).toBe(true);
        expect(contentBox().hidden).toBe(false);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(toggle.classList.contains("expanded")).toBe(true);

        click(toggle);
        expect(contentBox().hidden).toBe(true);
        expect(toggle.classList.contains("expanded")).toBe(false);

        act(() => render(null, container));
        renderBox({ boxSize: "full" });
        expect(contentBox().hidden).toBe(false);
    });

    it("opens the note in a new tab, and its context menu, from the title row", () => {
        renderBox({ notePath: "owner", viewScope: ATTACHMENT_SCOPE });
        const open = button("include-note-open");
        const menu = button("include-note-menu");
        expect(open.className).toContain("bx-link-external");
        expect(menu.className).toContain("bx-dots-vertical-rounded");
        expect(tooltipOf(open)).toBe("common.open_in_new_tab");
        expect(tooltipOf(menu)).toBe("common.more_actions");

        expect(click(open).isStopped).toBe(true);
        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("owner", {
            viewScope: ATTACHMENT_SCOPE,
            activate: true,
            placement: "afterCurrent"
        });

        expect(click(menu).isStopped).toBe(true);
        expect(openContextMenu)
            .toHaveBeenCalledWith("owner", { below: menu }, ATTACHMENT_SCOPE);
    });

    it("gives its content the screen, and takes it back from the overlay button", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const exitFullscreen = vi.fn<() => Promise<void>>(async () => {});
        Object.defineProperty(document, "exitFullscreen", {
            value: exitFullscreen,
            configurable: true
        });
        renderBox({ boxSize: "medium" });
        const box = contentBox();
        box.requestFullscreen = vi.fn(async () => {});

        const fullscreen = button("include-note-fullscreen");
        expect(fullscreen.className).toContain("bx-fullscreen");
        expect(tooltipOf(fullscreen)).toBe("common.fullscreen");
        expect(click(fullscreen).isStopped).toBe(true);
        expect(box.requestFullscreen).toHaveBeenCalledOnce();

        const group = box.querySelector<HTMLElement>(
            ":scope > .include-note-fullscreen-controls > .tn-overlay-control-group"
        );
        const exit = group?.querySelector("button");
        expect(group?.classList.contains("include-note-exit-fullscreen")).toBe(true);
        expect(group?.dataset.placement).toBe("top-end");
        expect(exit?.textContent).toBe("common.exit_fullscreen");
        expect(exit?.querySelector(".bx.bx-exit")).not.toBeNull();
        if (!exit) return;
        expect(click(exit).isStopped).toBe(true);
        expect(exitFullscreen).toHaveBeenCalledOnce();

        // Refused requests are logged rather than left unhandled.
        box.requestFullscreen = vi.fn(async () => {
            throw new Error("Denied");
        });
        exitFullscreen.mockRejectedValueOnce(new Error("Not in fullscreen"));
        click(fullscreen);
        click(exit);
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));

        warn.mockRestore();
        Reflect.deleteProperty(document, "exitFullscreen");
    });

    it("opens its menu on a right click on the title row, leaving the title link its own", () => {
        renderBox({ notePath: "owner", viewScope: ATTACHMENT_SCOPE });
        const row = container.querySelector(".include-note-title-row");

        for (const target of [ row, row?.querySelector("h4"), button("include-note-open") ]) {
            expect(rightClick(target ?? null)).toEqual({ opened: true, isTaken: true });
            expect(openContextMenu.mock.calls[0][2]).toEqual(ATTACHMENT_SCOPE);
        }

        // The title link opens the same menu, and a quick edit with Ctrl, through `link.ts`.
        expect(rightClick(row?.querySelector("a") ?? null))
            .toEqual({ opened: false, isTaken: false });
    });

    it("leaves the fullscreen controls out of a box that offers no fullscreen", () => {
        renderBox({ boxSize: "small" });
        expect(container.querySelector(".include-note-fullscreen-controls")).toBeNull();
    });
});

describe("TinyContentEmbed", () => {
    it("lays out a single row: icon, title and description, actions, menu", () => {
        const run = vi.fn();
        const { title } = renderTinyBox({
            icon: "bx bx-file",
            description: "2 KiB",
            notePath: "owner",
            viewScope: ATTACHMENT_SCOPE,
            actions: [
                { title: "Download", icon: "bx bx-download", run },
                { title: "Other", icon: "bx bx-cog", run: vi.fn() }
            ]
        });

        expect(titleRow()).toEqual([
            "include-note-icon", "include-note-heading",
            "include-note-action", "include-note-action", "include-note-menu"
        ]);
        expect(container.querySelector(".include-note-content")).toBeNull();
        expect(container.querySelector(".include-note-icon")?.className).toContain("bx-file");
        expect([ ...container.querySelector("h4.include-note-title")?.childNodes ?? [] ])
            .toEqual([ title ]);
        expect(container.querySelector(".include-note-heading > small.include-note-description")
            ?.textContent).toBe("2 KiB");

        const download = container.querySelector<HTMLButtonElement>("button.include-note-action");
        expect(download?.className).toContain("bx-download");
        if (!download) return;
        expect(tooltipOf(download)).toBe("Download");
        expect(click(download).isStopped).toBe(true);
        expect(run).toHaveBeenCalledOnce();

        const menu = button("include-note-menu");
        expect(click(menu).isStopped).toBe(true);
        expect(openContextMenu)
            .toHaveBeenCalledWith("owner", { below: menu }, ATTACHMENT_SCOPE);
    });

    it("opens its menu on a right click on the row, leaving the title link its own", () => {
        renderTinyBox({ notePath: "owner", viewScope: ATTACHMENT_SCOPE });
        const row = container.querySelector(".include-note-title-row");

        expect(rightClick(row?.querySelector(".include-note-icon") ?? null))
            .toEqual({ opened: true, isTaken: true });
        expect(openContextMenu.mock.calls[0][0]).toBe("owner");
        expect(rightClick(row?.querySelector("a") ?? null))
            .toEqual({ opened: false, isTaken: false });
    });

    it("leaves out the description line when there is none", () => {
        renderTinyBox();
        expect(container.querySelector(".include-note-description")).toBeNull();
    });
});

describe("getNoteActions", () => {
    it("quick edits the note, or opens it in a new tab", async () => {
        const [ quickEdit, open ] = getNoteActions("noteA");
        expect([ quickEdit.title, quickEdit.icon ])
            .toEqual([ "link_context_menu.open_note_in_popup", "bx bx-edit" ]);
        expect([ open.title, open.icon ])
            .toEqual([ "common.open_in_new_tab", "bx bx-link-external" ]);

        await quickEdit.run();
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "noteA" });

        await open.run();
        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("noteA", {
            viewScope: undefined,
            activate: true,
            placement: "afterCurrent"
        });
    });
});
