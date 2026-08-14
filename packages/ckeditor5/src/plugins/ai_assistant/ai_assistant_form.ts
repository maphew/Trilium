import { IconArrowUp, IconRefresh } from "@ckeditor/ckeditor5-icons";
import {
    ButtonView,
    FocusCycler,
    FocusTracker,
    InputTextView,
    KeystrokeHandler,
    submitHandler,
    View,
    ViewCollection,
    type FocusableView,
    type Locale
} from "ckeditor5";

/**
 * Where the form is in its lifecycle: taking a prompt, streaming a response into the preview, or
 * showing a finished response for review (Replace / Insert below / Try again). The prompt row stays
 * usable in the review phase so a follow-up query can chain on the response.
 */
export type AiAssistantFormPhase = "prompt" | "streaming" | "review";

/** What the preview shows in the review phase: the response, or its diff against the context. */
export type AiAssistantViewMode = "result" | "changes";

/**
 * The AI assistant dialog's contents: a prompt row, a read-only streaming preview styled like note
 * content, and the review actions. In the review phase the preview can toggle between the plain result and
 * an inline diff ("Changes"), when the host provides a diff renderer. Purely presentational — the
 * orchestration (markers, streaming, diffing, committing to the model) lives in `AiAssistantUI`,
 * which listens to this view's `submit`, `stop`, `replace`, `insertBelow` and `tryAgain` events.
 */
export default class AiAssistantFormView extends View {

    declare public phase: AiAssistantFormPhase;
    /** The instruction typed by the user; two-way bound to the input field. */
    declare public query: string;
    /** A transport/provider failure to surface; empty string when there is none. */
    declare public errorMessage: string;
    /** Which of the stored contents the preview shows. Only meaningful in the review phase. */
    declare public viewMode: AiAssistantViewMode;
    /** Whether the current review has a diff to offer; controls the view-mode toggle. */
    declare public hasDiff: boolean;
    /** The run's cost line ("model · tokens · price"), shown in the review actions row. */
    declare public usageText: string;

    /** The (sanitized) response HTML, kept for re-rendering when the view mode flips. */
    private _resultHtml = "";
    /** The (sanitized) diff HTML of the review phase, when the host provided one. */
    private _diffHtml = "";

    public readonly promptInputView: InputTextView;
    public readonly sendButtonView: ButtonView;
    public readonly resultToggleView: ButtonView;
    public readonly changesToggleView: ButtonView;
    public readonly previewView: AiPreviewView;
    public readonly stopButtonView: ButtonView;
    public readonly replaceButtonView: ButtonView;
    public readonly insertBelowButtonView: ButtonView;
    public readonly tryAgainButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly _focusables = new ViewCollection<FocusableView>();
    private readonly _focusCycler: FocusCycler;

    constructor(locale: Locale) {
        super(locale);

        const t = locale.t;

        this.set("phase", "prompt");
        this.set("query", "");
        this.set("errorMessage", "");
        this.set("viewMode", "result");
        this.set("hasDiff", false);
        this.set("usageText", "");

        // Re-render the preview from the stored contents whenever the toggle flips.
        this.on("change:viewMode", () => this._renderPreview());

        this.resultToggleView = this._createViewModeButton(locale, t("Result"), "result");
        this.changesToggleView = this._createViewModeButton(locale, t("Changes"), "changes");
        this.promptInputView = this._createPromptInput(locale);
        this.sendButtonView = this._createSendButton(locale);
        this.previewView = new AiPreviewView(locale);
        this.previewView.bind("isVisible").to(this, "phase", (phase) => phase !== "prompt");

        this.stopButtonView = this._createActionButton(locale, t("Stop"), "streaming", "stop");
        this.replaceButtonView = this._createActionButton(locale, t("Replace"), "review", "replace");
        this.replaceButtonView.class = "ck-button-action";
        this.insertBelowButtonView = this._createActionButton(locale, t("Insert below"), "review", "insertBelow");
        // Icon-only, and sitting over the preview rather than among the commit actions: re-running
        // is about the response on screen, not about what to do with it.
        this.tryAgainButtonView = this._createActionButton(locale, t("Try again"), "review", "tryAgain");
        this.tryAgainButtonView.set({ icon: IconRefresh, withText: false, tooltip: true });
        this.tryAgainButtonView.class = "ck-ai-assistant-form__icon-action";

        const bind = this.bindTemplate;

        this.setTemplate({
            tag: "form",
            attributes: {
                class: ["ck", "ck-ai-assistant-form", "ck-responsive-form"],
                tabindex: "-1"
            },
            children: [
                {
                    // The preview's own strip: the Result/Changes toggle on the left, "Try again"
                    // pushed to the right. The feature's title belongs to the dialog's header.
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__preview-toolbar"] },
                    children: [
                        {
                            // The two modes are one choice, so they share a container the host can
                            // draw as a group — Trilium renders it as its segmented track.
                            tag: "div",
                            attributes: { class: ["ck", "ck-ai-assistant-form__viewmodes"] },
                            children: [this.resultToggleView, this.changesToggleView]
                        },
                        {
                            // What the run cost and the way to ask for another are both about the
                            // response on show, so they end its strip together. A container of
                            // their own, rather than a margin on each, keeps them to the end
                            // whether or not the provider reported any usage.
                            tag: "div",
                            attributes: { class: ["ck", "ck-ai-assistant-form__preview-toolbar-end"] },
                            children: [
                                {
                                    tag: "span",
                                    attributes: {
                                        class: [
                                            "ck",
                                            "ck-ai-assistant-form__usage",
                                            bind.if("usageText", "ck-hidden", (text) => !text)
                                        ]
                                    },
                                    children: [{ text: bind.to("usageText") }]
                                },
                                this.tryAgainButtonView
                            ]
                        }
                    ]
                },
                this.previewView,
                {
                    tag: "div",
                    attributes: {
                        class: [
                            "ck",
                            "ck-ai-assistant-form__error",
                            bind.if("errorMessage", "ck-hidden", (message) => !message)
                        ]
                    },
                    children: [{ text: bind.to("errorMessage") }]
                },
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__prompt-row"] },
                    children: [this.promptInputView, this.sendButtonView]
                },
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__actions"] },
                    children: [
                        this.stopButtonView,
                        // The row is pushed to the end, so "Replace" comes last to land where the
                        // eye finishes and the primary action is expected.
                        this.insertBelowButtonView,
                        this.replaceButtonView
                    ]
                }
            ]
        });

        this._focusCycler = new FocusCycler({
            focusables: this._focusables,
            focusTracker: this.focusTracker,
            keystrokeHandler: this.keystrokes,
            actions: {
                focusPrevious: "shift + tab",
                focusNext: "tab"
            }
        });
    }

    public override render(): void {
        super.render();

        // Turns a native form submit (the Enter key included) into the view's own `submit` event.
        submitHandler({ view: this });

        // In DOM order, so Tab walks the form the way it reads.
        const focusables = [
            this.resultToggleView,
            this.changesToggleView,
            this.tryAgainButtonView,
            this.promptInputView,
            this.sendButtonView,
            this.stopButtonView,
            this.insertBelowButtonView,
            this.replaceButtonView
        ];
        for (const view of focusables) {
            this._focusables.add(view);
            /* v8 ignore next -- a child view rendered as part of this template always has an element */
            if (view.element) {
                this.focusTracker.add(view.element);
            }
        }

        /* v8 ignore next -- super.render() has just built this view's element */
        if (this.element) {
            this.keystrokes.listenTo(this.element);
        }
    }

    public override destroy(): void {
        super.destroy();
        this.focusTracker.destroy();
        this.keystrokes.destroy();
    }

    /** Puts the form back in its blank prompt state, ready for the next opening. */
    public reset(): void {
        this.phase = "prompt";
        this.query = "";
        this.errorMessage = "";
        this._resultHtml = "";
        this._diffHtml = "";
        this.hasDiff = false;
        this.viewMode = "result";
        this.usageText = "";
        this._renderPreview();
    }

    /** Enters the streaming phase with an empty preview. Streaming always shows the raw result. */
    public beginStreaming(): void {
        this.phase = "streaming";
        this.errorMessage = "";
        this._resultHtml = "";
        this._diffHtml = "";
        this.hasDiff = false;
        this.viewMode = "result";
        this.usageText = "";
        this._renderPreview();
    }

    /** Renders the (sanitized, cumulative) response received so far. */
    public setPreview(html: string): void {
        this._resultHtml = html;
        this._renderPreview();
    }

    /**
     * Leaves the streaming phase. With content the form enters review — defaulting to the
     * "Changes" view when a diff is available — while a run that produced nothing falls back to
     * the prompt phase, showing `errorMessage` when the run failed.
     */
    public enterReview(hasContent: boolean, diffHtml: string | null, errorMessage: string, usageText = ""): void {
        this.phase = hasContent ? "review" : "prompt";
        this.errorMessage = errorMessage;
        this._diffHtml = diffHtml ?? "";
        this.hasDiff = hasContent && !!this._diffHtml;
        this.viewMode = this.hasDiff ? "changes" : "result";
        this.usageText = hasContent ? usageText : "";
        this._renderPreview();
    }

    public focus(): void {
        this._focusCycler.focusFirst();
    }

    /** Shows whichever stored content the current view mode selects. */
    private _renderPreview(): void {
        this.previewView.setContent(this.viewMode === "changes" && this._diffHtml ? this._diffHtml : this._resultHtml);
    }

    /** One half of the Result/Changes toggle, visible only when a review has a diff to offer. */
    private _createViewModeButton(locale: Locale, label: string, mode: AiAssistantViewMode) {
        const button = new ButtonView(locale);
        button.set({ label, withText: true, isToggleable: true, class: "ck-ai-assistant-form__viewmode" });
        button.bind("isOn").to(this, "viewMode", (viewMode) => viewMode === mode);
        button.bind("isVisible").to(
            this, "phase",
            this, "hasDiff",
            (phase, hasDiff) => phase === "review" && hasDiff
        );
        button.on("execute", () => {
            this.viewMode = mode;
        });
        return button;
    }

    private _createPromptInput(locale: Locale) {
        const t = locale.t;
        const input = new InputTextView(locale);

        input.set({
            placeholder: t("Describe a change then press Enter"),
            // A placeholder is not a label, and the field no longer has a visible one, so the
            // accessible name has to be given outright.
            ariaLabel: t("Ask AI to…")
        });

        // Two-way: the field drives `query`, and reset() drives the field.
        input.bind("value").to(this, "query");
        input.on("input", () => {
            /* v8 ignore next -- the input event can only come from a rendered element */
            this.query = input.element?.value ?? "";
        });
        // An input has no `isEnabled`; read-only rather than disabled also leaves the prompt
        // selectable while the response it asked for streams in.
        input.bind("isReadOnly").to(this, "phase", (phase) => phase === "streaming");

        return input;
    }

    private _createSendButton(locale: Locale) {
        const button = new ButtonView(locale);
        button.set({
            label: locale.t("Send"),
            icon: IconArrowUp,
            tooltip: true,
            type: "submit",
            class: "ck-button-action ck-ai-assistant-form__icon-action"
        });
        button.bind("isEnabled").to(
            this, "query",
            this, "phase",
            (query, phase) => !!String(query).trim() && phase !== "streaming"
        );
        return button;
    }

    /** A text action button that is only visible in the given phase and re-emits `eventName`. */
    private _createActionButton(locale: Locale, label: string, phase: AiAssistantFormPhase, eventName: string) {
        const button = new ButtonView(locale);
        button.set({ label, withText: true });
        button.bind("isVisible").to(this, "phase", (currentPhase) => currentPhase === phase);
        button.on("execute", () => this.fire(eventName));
        return button;
    }
}

/**
 * The streaming preview: a plain non-editable `div` carrying the `ck-content` class so the
 * response renders with the same styles it will have once inserted into the note.
 *
 * The content is assigned through `innerHTML` on purpose — the stream delivers a growing HTML
 * prefix, and the browser's parser auto-closes elements cut off mid-stream, so every tick renders
 * something sensible without any incremental DOM diffing. Callers sanitize before handing HTML in.
 */
class AiPreviewView extends View {

    declare public isVisible: boolean;

    constructor(locale: Locale) {
        super(locale);
        this.set("isVisible", false);

        const bind = this.bindTemplate;
        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-ai-assistant-form__preview",
                    "ck-content",
                    // Exempt the preview subtree from CKEditor's UI reset. Balloons and dialogs
                    // alike are mounted into `editor.ui.view.body`, whose wrapper carries
                    // `.ck-reset_all` — which otherwise forces `white-space: nowrap` (plus zeroed
                    // margins and the UI font) onto the content, making every paragraph one long
                    // unwrappable line.
                    "ck-reset_all-excluded",
                    bind.if("isVisible", "ck-hidden", (isVisible) => !isVisible)
                ]
            }
        });
    }

    public setContent(html: string): void {
        const element = this.element;
        /* v8 ignore next -- the preview is only written to after the form has rendered */
        if (!element) {
            return;
        }

        // Follow the stream unless the user has scrolled up to read something.
        const wasAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 24;
        element.innerHTML = html;
        if (wasAtBottom) {
            element.scrollTop = element.scrollHeight;
        }
    }
}
