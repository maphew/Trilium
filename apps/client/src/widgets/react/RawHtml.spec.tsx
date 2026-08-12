import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import RawHtml, { RawHtmlBlock } from "./RawHtml";

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
});

describe("RawHtml", () => {
    it("renders the HTML and every declared attribute onto the element", () => {
        render(
            <RawHtmlBlock
                className="ck-content"
                html="<p>שלום</p>"
                dir="rtl"
                tabindex={100}
                style={{ color: "red" }}
            />,
            container
        );

        const el = container.querySelector("div");
        expect(el?.innerHTML).toBe("<p>שלום</p>");
        expect(el?.className).toBe("ck-content");
        // `dir` and `tabindex` are declared on RawHtmlProps but were once dropped by the
        // props destructure, which silently disabled RTL layout for read-only text notes.
        expect(el?.getAttribute("dir")).toBe("rtl");
        expect(el?.getAttribute("tabindex")).toBe("100");
        expect(el?.style.color).toBe("red");
    });

    it("omits the optional attributes when they are not given", () => {
        render(<RawHtml html="<b>hi</b>" />, container);

        const el = container.querySelector("span");
        expect(el?.innerHTML).toBe("<b>hi</b>");
        expect(el?.hasAttribute("dir")).toBe(false);
        expect(el?.hasAttribute("tabindex")).toBe(false);
    });
});
