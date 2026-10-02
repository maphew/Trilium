import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    openTabWithNoteWithHoisting,
    openContextMenu,
    disposeInteractiveContent
} = vi.hoisted(() => ({
    openTabWithNoteWithHoisting: vi.fn(),
    openContextMenu: vi.fn(),
    disposeInteractiveContent: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../../components/app_context", () => ({
    default: { tabManager: { openTabWithNoteWithHoisting } }
}));
vi.mock("../../../menus/link_context_menu", () => ({ default: { openContextMenu } }));
vi.mock("../../../services/content_renderer", () => ({ default: { disposeInteractiveContent } }));

import IncludeNote, { type IncludeNoteProps } from "./IncludeNote";

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

function renderBox(props: Partial<IncludeNoteProps> = {}) {
    const boxProps: IncludeNoteProps = {
        title: element(`<span><a href="#root/noteA">Note A</a></span>`),
        content: element(`<div class="rendered-content"><p>body</p></div>`),
        contentType: "text",
        notePath: "noteA",
        ...props
    };
    act(() => render(<IncludeNote {...boxProps} />, container));
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

/** Clicks `target` and tells whether the click was kept from what surrounds the box. */
function click(target: HTMLElement) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    act(() => {
        target.dispatchEvent(event);
    });
    return { event, isStopped: stopPropagation.mock.calls.length > 0 };
}

describe("IncludeNote", () => {
    it("lays out the title row for each box size", () => {
        const plain = [ "title", "open", "menu" ];
        const withFullscreen = [ "title", "open", "fullscreen", "menu" ];
        const layouts: [ string | undefined, boolean, string[] ][] = [
            [ undefined, false, plain ],
            [ "small", true, plain ],
            [ "medium", false, plain ],
            [ "medium", true, withFullscreen ],
            [ "full", true, withFullscreen ],
            [ "expandable", true, [ "toggle", "title", "open", "menu" ] ]
        ];

        for (const [ boxSize, isFullscreenOffered, expected ] of layouts) {
            act(() => render(null, container));
            renderBox({ boxSize, isFullscreenOffered });
            expect(titleRow(), `${boxSize} ${isFullscreenOffered}`)
                .toEqual(expected.map((name) => `include-note-${name}`));
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

        const { event, isStopped } = click(menu);
        expect(isStopped).toBe(true);
        expect(openContextMenu).toHaveBeenCalledWith("owner", event, ATTACHMENT_SCOPE);
    });

    it("gives its content the screen, and takes it back from the overlay button", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const exitFullscreen = vi.fn<() => Promise<void>>(async () => {});
        Object.defineProperty(document, "exitFullscreen", {
            value: exitFullscreen,
            configurable: true
        });
        renderBox({ boxSize: "medium", isFullscreenOffered: true });
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

    it("leaves the fullscreen controls out of a box that offers no fullscreen", () => {
        renderBox({ boxSize: "full" });
        expect(container.querySelector(".include-note-fullscreen-controls")).toBeNull();
    });
});
