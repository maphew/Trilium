import { Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import getCkLocale from "./i18n.js";
import Admonition from "./plugins/admonition/admonition.js";
import AdmonitionUI from "./plugins/admonition/admonition_ui.js";

/**
 * End-to-end check of the localization bridge against a real editor: `AdmonitionUI` localizes its
 * button with plain `editor.t("Admonition")`, and the only thing that makes it German is the
 * dictionary `getCkLocale()` appends to the editor config. The plugin itself knows nothing about
 * translation keys or the host.
 */
async function createAdmonitionEditor(localeConfig: Awaited<ReturnType<typeof getCkLocale>>) {
    const editor = await createTestEditor([ Essentials, Paragraph, Admonition, AdmonitionUI ], localeConfig);
    const button = editor.ui.componentFactory.create("admonition");
    if (!(button instanceof SplitButtonView) && !("buttonView" in button)) {
        throw new Error("expected the admonition dropdown");
    }
    return (button as unknown as { buttonView: SplitButtonView }).buttonView;
}

describe("editor.t() localization bridge", () => {
    it("translates a plugin's button through the host translator", async () => {
        const buttonView = await createAdmonitionEditor(await getCkLocale("de", () => "Ermahnung"));

        expect(buttonView.label).toBe("Ermahnung");
    });

    // The property that makes the bridge seamless: with no host attached the editor still renders
    // correct English, because the message id passed to `t()` *is* the English text.
    it("falls back to the English message id when no translator is configured", async () => {
        const buttonView = await createAdmonitionEditor(await getCkLocale("de"));

        expect(buttonView.label).toBe("Admonition");
    });

    it("renders English rather than a raw key when the translation is missing", async () => {
        const buttonView = await createAdmonitionEditor(await getCkLocale("de", (key) => key));

        expect(buttonView.label).toBe("Admonition");
    });
});
