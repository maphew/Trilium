import type { LlmModelInfo } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stored: [] as unknown[] }));

vi.mock("./options.js", () => ({ default: { getJson: () => mocks.stored } }));

import { readSelectedModels, readsAttachmentKind, unreadableAttachments } from "./llm_providers.js";

const textOnly: LlmModelInfo = { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", attachmentKinds: [] };
const imagesOnly: LlmModelInfo = { id: "codex", name: "Codex", attachmentKinds: [ "image" ] };
const everything: LlmModelInfo = { id: "claude", name: "Claude" };

const png = { type: "image", mime: "image/png" };
const svg = { type: "image", mime: "image/svg+xml" };
const pdf = { type: "file", mime: "application/pdf" };
const markdown = { type: "text_file", mime: "text/markdown" };

describe("attachment support", () => {
    it("finds the attachments a model cannot read, never text files or SVGs", () => {
        const all = [ png, svg, pdf, markdown ];
        expect(unreadableAttachments(textOnly, all)).toEqual([ png, pdf ]);
        expect(unreadableAttachments(imagesOnly, all)).toEqual([ pdf ]);
        // No `attachmentKinds`, or no model at all, restricts nothing.
        expect(unreadableAttachments(everything, all)).toEqual([]);
        expect(unreadableAttachments(undefined, all)).toEqual([]);
    });

    it("says whether a model reads a kind", () => {
        expect(readsAttachmentKind(textOnly, "image")).toBe(false);
        expect(readsAttachmentKind(imagesOnly, "image")).toBe(true);
        expect(readsAttachmentKind(imagesOnly, "file")).toBe(false);
        expect(readsAttachmentKind(everything, "file")).toBe(true);
    });
});

describe("readSelectedModels", () => {
    it("lists chat providers only, leaving search providers out", () => {
        mocks.stored = [
            { id: "o1", name: "OpenAI", provider: "openai", selectedModels: [ { id: "gpt", name: "GPT" } ] },
            { id: "s1", name: "Brave Search", provider: "brave", kind: "search" }
        ];
        const { groups, models, hasProvider } = readSelectedModels();
        expect(groups.map(group => group.id)).toEqual([ "o1" ]);
        expect(models.map(model => model.id)).toEqual([ "gpt" ]);
        expect(hasProvider).toBe(true);

        mocks.stored = [ { id: "s1", name: "Brave Search", provider: "brave", kind: "search" } ];
        expect(readSelectedModels().hasProvider).toBe(false);
    });
});
