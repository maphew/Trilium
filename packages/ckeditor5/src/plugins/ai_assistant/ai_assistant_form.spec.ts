import { Locale } from "ckeditor5";
import { afterEach, describe, expect, it } from "vitest";

import AiAssistantFormView from "./ai_assistant_form.js";

let form: AiAssistantFormView;

function makeForm(): AiAssistantFormView {
    form = new AiAssistantFormView(new Locale(), (_key, fallback) => fallback);
    form.render();
    return form;
}

function previewHtml(): string {
    return form.previewView.element?.innerHTML ?? "";
}

afterEach(() => {
    form?.destroy();
});

describe("AiAssistantFormView", () => {
    it("starts in the prompt phase with the view-mode toggle hidden", () => {
        const form = makeForm();
        expect(form.phase).toBe("prompt");
        expect(form.resultToggleView.isVisible).toBe(false);
        expect(form.changesToggleView.isVisible).toBe(false);
        // Without the reset exemption, the balloon's `.ck-reset_all` nowraps every paragraph.
        expect(form.previewView.element?.classList.contains("ck-reset_all-excluded")).toBe(true);
    });

    it("streams into the preview and always shows the raw result while streaming", () => {
        const form = makeForm();
        form.beginStreaming();
        expect(form.phase).toBe("streaming");
        expect(form.viewMode).toBe("result");

        form.setPreview("<p>partial</p>");
        expect(previewHtml()).toBe("<p>partial</p>");
    });

    it("defaults the review to the Changes view when a diff is available and toggles back", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview(true, "<p><del class=\"diffdel\">old</del><ins class=\"diffins\">new</ins></p>", "");

        expect(form.phase).toBe("review");
        expect(form.hasDiff).toBe(true);
        expect(form.viewMode).toBe("changes");
        expect(previewHtml()).toContain("diffins");
        expect(form.resultToggleView.isVisible).toBe(true);
        expect(form.changesToggleView.isOn).toBe(true);

        form.resultToggleView.fire("execute");
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("<p>new</p>");
        expect(form.resultToggleView.isOn).toBe(true);

        form.changesToggleView.fire("execute");
        expect(previewHtml()).toContain("diffdel");
    });

    it("reviews without a diff in the Result view with the toggle hidden", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>generated</p>");
        form.enterReview(true, null, "");

        expect(form.phase).toBe("review");
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("<p>generated</p>");
        expect(form.changesToggleView.isVisible).toBe(false);
    });

    it("falls back to the prompt phase with the error when a run produced nothing", () => {
        const form = makeForm();
        form.beginStreaming();
        form.enterReview(false, null, "provider unreachable");

        expect(form.phase).toBe("prompt");
        expect(form.errorMessage).toBe("provider unreachable");
    });

    it("reset clears the stored contents and view-mode state", () => {
        const form = makeForm();
        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview(true, "<p>diff</p>", "");

        form.reset();
        expect(form.phase).toBe("prompt");
        expect(form.hasDiff).toBe(false);
        expect(form.viewMode).toBe("result");
        expect(previewHtml()).toBe("");

        // A later streaming run must not resurrect the previous run's diff.
        form.beginStreaming();
        form.enterReview(true, null, "");
        expect(previewHtml()).toBe("");
    });
});
