import { safeHostname } from "@triliumnext/commons";
import {
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    FindAndReplaceEditing,
    LinkEditing,
    Paragraph,
    type FindResultType
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import FindInLinkWidgets from "./find_in_link_widgets.js";
import LinkEmbedEditing from "./link_embed/link_embed_editing.js";
import ReferenceLink from "./referencelink.js";

describe("FindInLinkWidgets", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        installGlobMock({
            getComponentByEl: () => ({
                loadReferenceLinkTitle: vi.fn((element: unknown) => {
                    if (element instanceof HTMLElement) {
                        element.textContent = "Reference match";
                    }
                    return Promise.resolve();
                }),
                renderLinkEmbed: vi.fn((container: HTMLElement, metadata: LinkEmbedMetadata) => {
                    if (metadata.embedType === "youtube") {
                        return;
                    }
                    appendText(
                        container,
                        metadata.title,
                        metadata.description,
                        metadata.siteName || safeHostname(metadata.url)
                    );
                }),
                renderLinkMention: vi.fn((container: HTMLElement, metadata: LinkEmbedMetadata) => {
                    appendText(container, metadata.title || safeHostname(metadata.url));
                })
            }),
            getReferenceLinkTitle: vi.fn(async () => "Reference match"),
            getReferenceLinkTitleSync: vi.fn(() => "Reference match")
        });

        editor = await createTestEditor([
            Essentials,
            Paragraph,
            LinkEditing,
            ReferenceLink,
            LinkEmbedEditing,
            FindAndReplaceEditing,
            FindInLinkWidgets
        ]);
    });

    it("finds text and all rendered link widgets in document order", () => {
        setModelData(
            editor.model,
            '<paragraph>Plain match. <reference href="#root/ref"></reference> ' +
                '<linkMention url="https://mention.example/" title="Mention match">' +
                "</linkMention></paragraph>" +
                '<linkEmbed url="https://card.example/" embedType="opengraph" title="Card match" ' +
                'description="Card description" siteName="Card site"></linkEmbed>'
        );

        const editingRoot = editor.editing.view.getDomRoot();
        expect(editingRoot?.querySelector("a.reference-link")?.textContent).toBe("Reference match");
        editor.execute("find", "match");

        const state = editor.plugins.get(FindAndReplaceEditing).state;
        expect(resultElementNames(state?.results ?? [])).toEqual([
            "text", "reference", "linkMention", "linkEmbed"
        ]);
        expect(editingRoot?.querySelector("a.reference-link.ck-find-result")).not.toBeNull();
        expect(editingRoot?.querySelector("span.link-mention.ck-find-result")).not.toBeNull();
        expect(editingRoot?.querySelector("section.link-embed.ck-find-result")).not.toBeNull();

        editor.execute("findNext");
        const selectedReference = editingRoot?.querySelector(
            "a.reference-link.ck-find-result_selected"
        );
        expect(selectedReference).not.toBeNull();
    });

    it("matches only the text that each link widget displays", () => {
        setModelData(
            editor.model,
            '<paragraph><linkMention url="https://mention-host.example/path">' +
                "</linkMention></paragraph>" +
                '<linkEmbed url="https://card-host.example/path" ' +
                'embedType="opengraph"></linkEmbed>' +
                '<linkEmbed url="https://card.example/" embedType="opengraph" ' +
                'title="Exact Match Repeated" ' +
                'description="Description text Repeated" siteName="Site label"></linkEmbed>' +
                '<linkEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" ' +
                'embedType="youtube" ' +
                'title="Hidden metadata"></linkEmbed>'
        );

        expect(findCount(editor, "mention-host.example")).toBe(1);
        expect(findCount(editor, "card-host.example")).toBe(1);
        expect(findCount(editor, "Description text")).toBe(1);
        expect(findCount(editor, "Site label")).toBe(1);
        expect(findCount(editor, "Repeated")).toBe(1);
        expect(findCount(editor, "Match", { matchCase: true })).toBe(1);
        expect(findCount(editor, "match", { matchCase: true })).toBe(0);
        expect(findCount(editor, "act", { wholeWords: true })).toBe(0);
        expect(findCount(editor, "Hidden metadata")).toBe(0);
    });

    it("skips a widget during replacement and still replaces normal text", () => {
        setModelData(
            editor.model,
            '<paragraph><reference href="#root/ref"></reference> match</paragraph>'
        );
        expect(editor.editing.view.getDomRoot()?.querySelector("a.reference-link")?.textContent)
            .toBe("Reference match");
        editor.execute("find", "match");

        const state = editor.plugins.get(FindAndReplaceEditing).state;
        expect(resultElementNames(state?.results ?? [])).toEqual([ "reference", "text" ]);
        editor.execute("replace", "done", state?.highlightedResult);

        expect(editor.getData()).toContain("match");
        expect(resultElementNames(state?.highlightedResult ? [ state.highlightedResult ] : []))
            .toEqual([ "text" ]);
        editor.execute("replace", "done", state?.highlightedResult);
        expect(editor.getData()).toContain("done");
        expect(editor.getData()).toContain('class="reference-link"');

        setModelData(
            editor.model,
            '<paragraph>match <reference href="#root/ref"></reference></paragraph>'
        );
        expect(editor.editing.view.getDomRoot()?.querySelector("a.reference-link")?.textContent)
            .toBe("Reference match");
        editor.execute("find", "match");

        expect(state?.results.length).toBe(2);
        editor.execute("replaceAll", "done", state?.results);

        expect(editor.getData()).toContain("done");
        expect(editor.getData()).toContain('class="reference-link"');
        expect(state?.results.length).toBe(1);
        expect(state?.highlightedResult).not.toBeNull();

        editor.execute("replace", "broken", state?.highlightedResult);
        expect(editor.getData()).toContain('class="reference-link"');
        expect(editor.getData()).not.toContain("broken");
    });
});

function findCount(
    editor: ClassicEditor,
    text: string,
    options: { matchCase?: boolean; wholeWords?: boolean } = {}
): number {
    editor.execute("find", text, options);
    return editor.plugins.get(FindAndReplaceEditing).state?.results.length ?? 0;
}

function resultElementNames(results: Iterable<FindResultType>): string[] {
    const names: string[] = [];
    for (const result of results) {
        let name = "text";
        for (const item of result.marker?.getRange().getItems() ?? []) {
            if (item.is("element")) {
                name = item.name;
                break;
            }
        }
        names.push(name);
    }
    return names;
}

function appendText(container: HTMLElement, ...values: Array<string | undefined>): void {
    for (const value of values) {
        if (value) {
            container.append(document.createTextNode(value));
        }
    }
}
