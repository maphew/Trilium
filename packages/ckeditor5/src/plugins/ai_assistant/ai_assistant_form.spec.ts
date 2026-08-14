import { Locale } from "ckeditor5";
import { afterEach, describe, expect, it } from "vitest";

import AiAssistantFormView from "./ai_assistant_form.js";

let form: AiAssistantFormView;

function makeForm(): AiAssistantFormView {
    form = new AiAssistantFormView(new Locale());
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
    it("starts in the prompt phase with the strip on show but inert", () => {
        const form = makeForm();
        expect(form.phase).toBe("prompt");

        // The strip holds its place from the start — appearing with the response would shift
        // every row beneath it — so nothing in it is hidden, only disabled.
        for (const view of [form.resultToggleView, form.changesToggleView, form.tryAgainButtonView]) {
            expect(view.isVisible).toBe(true);
            expect(view.isEnabled).toBe(false);
        }
        // Without the reset exemption, the body wrapper's `.ck-reset_all` nowraps every paragraph.
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
        expect(form.resultToggleView.isEnabled).toBe(true);
        expect(form.changesToggleView.isOn).toBe(true);

        // The two modes are one choice, and share a container so the host can draw them as a group.
        expect(form.resultToggleView.element?.parentElement)
            .toBe(form.changesToggleView.element?.parentElement);
        expect(form.resultToggleView.element?.closest(".ck-ai-assistant-form__viewmodes")).not.toBeNull();

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
        // Nothing to diff against, so the choice stays inert while re-running does not.
        expect(form.changesToggleView.isEnabled).toBe(false);
        expect(form.tryAgainButtonView.isEnabled).toBe(true);
    });

    it("takes the prompt through a placeholder rather than a label, and sends with an icon", () => {
        const form = makeForm();

        expect(form.promptInputView.placeholder).toBe("Describe a change then press Enter");
        // A placeholder is not an accessible name, so the field carries one of its own.
        expect(form.promptInputView.ariaLabel).toBe("Ask AI to…");
        expect(form.element?.querySelector("label")).toBeNull();

        expect(form.sendButtonView.icon).toContain("<svg");
        expect(form.sendButtonView.withText).toBeFalsy();
        expect(form.sendButtonView.label).toBe("Send");
        expect(form.sendButtonView.tooltip).toBe(true);

        // Nothing to send until something is typed, and nothing to send while a run is in flight —
        // where the field goes read-only rather than disabled, so the prompt stays selectable.
        expect(form.sendButtonView.isEnabled).toBe(false);
        form.query = "make it shorter";
        expect(form.sendButtonView.isEnabled).toBe(true);

        form.beginStreaming();
        expect(form.sendButtonView.isEnabled).toBe(false);
        expect(form.promptInputView.isReadOnly).toBe(true);
    });

    it("offers 'Try again' as an icon in the preview's strip rather than among the commit actions", () => {
        const form = makeForm();
        const button = form.tryAgainButtonView;

        expect(button.isEnabled).toBe(false);
        expect(button.withText).toBe(false);
        expect(button.icon).toContain("<svg");
        // Icon-only: the label has to survive as the tooltip and the accessible name.
        expect(button.label).toBe("Try again");
        expect(button.tooltip).toBe(true);

        expect(button.element?.closest(".ck-ai-assistant-form__preview-toolbar")).not.toBeNull();
        expect(button.element?.closest(".ck-ai-assistant-form__actions")).toBeNull();

        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview(true, null, "");
        expect(button.isEnabled).toBe(true);
    });

    it("shows the usage line only for a review that has one, and clears it on the next run", () => {
        const form = makeForm();
        const usageEl = form.element?.querySelector(".ck-ai-assistant-form__usage");

        form.beginStreaming();
        form.setPreview("<p>new</p>");
        form.enterReview(true, null, "", "some-model · 1,234 tokens · ~$0.0042");
        expect(form.usageText).toBe("some-model · 1,234 tokens · ~$0.0042");
        expect(usageEl?.textContent).toBe("some-model · 1,234 tokens · ~$0.0042");
        expect(usageEl?.classList.contains("ck-hidden")).toBe(false);

        // A failed follow-up run must not keep advertising the previous run's cost.
        form.beginStreaming();
        expect(form.usageText).toBe("");
        expect(usageEl?.classList.contains("ck-hidden")).toBe(true);
        form.enterReview(false, null, "boom", "ignored — no content to review");
        expect(form.usageText).toBe("");
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
