import { describe, expect, it } from "vitest";

import { renderInto } from "../../test/render";
import { AttributeSnippetBadges, parseAttributeSnippetLine } from "./Badge";

describe("parseAttributeSnippetLine", () => {
    it("splits a label or a relation into its kind, name and value, highlights kept", () => {
        expect(parseAttributeSnippetLine("#<b>tag</b>")).toEqual({ type: "label", name: "<b>tag</b>" });
        expect(parseAttributeSnippetLine("#status=&quot;<b class=\"search-fuzzy-match\">open</b>&quot;"))
            .toEqual({ type: "label", name: "status", value: "<b class=\"search-fuzzy-match\">open</b>" });
        expect(parseAttributeSnippetLine("~author=&quot;J. R. R. &quot;Tolkien&quot;&quot;"))
            .toEqual({ type: "relation", name: "author", value: "J. R. R. &quot;Tolkien&quot;" });
    });

    it("gives up on a line it cannot read, such as one the server cut short", () => {
        expect(parseAttributeSnippetLine("#status=&quot;a long val...")).toBeNull();
        expect(parseAttributeSnippetLine("status")).toBeNull();
    });
});

describe("AttributeSnippetBadges", () => {
    it("draws each attribute as its kind's icon, its name and its value, or the line as it came", () => {
        const container = renderInto(<AttributeSnippetBadges
            className="attrs"
            snippet={"#<b>tag</b><br>~template=&quot;Book&quot;<br>#status=&quot;cut sho..."}
        />);
        const [ tag, template, cut ] = container.querySelectorAll<HTMLElement>(".attrs > .ext-badge.outline");

        expect(tag.classList.contains("attribute-badge")).toBe(true);
        expect(tag.querySelector(".tn-icon")?.className).toBe("bx bx-purchase-tag tn-icon");
        expect(tag.querySelector(".attribute-badge-name")?.innerHTML).toBe("<b>tag</b>");
        expect(tag.querySelector(".attribute-badge-value")).toBeNull();

        expect(template.querySelector(".tn-icon")?.className).toBe("bx bx-transfer tn-icon");
        expect(template.querySelector(".attribute-badge-name")?.textContent).toBe("template");
        expect(template.querySelector(".attribute-badge-value")?.textContent).toBe("Book");
        expect(template.classList.contains("has-value")).toBe(true);

        expect(cut.classList.contains("attribute-badge")).toBe(false);
        expect(cut.textContent).toBe("#status=\"cut sho...");
    });
});
