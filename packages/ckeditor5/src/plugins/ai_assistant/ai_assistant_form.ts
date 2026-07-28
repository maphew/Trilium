import {
    ButtonView,
    createLabeledInputText,
    FocusCycler,
    FocusTracker,
    KeystrokeHandler,
    LabeledFieldView,
    submitHandler,
    View,
    ViewCollection,
    type FocusableView,
    type InputTextView,
    type Locale
} from "ckeditor5";

/** Resolves a translation key, falling back to the given English text. See `translate.ts`. */
type Translate = (key: string, fallback: string) => string;

/**
 * Where the form is in its lifecycle: taking a prompt, streaming a response into the preview, or
 * showing a finished response for review (Replace / Insert below / Try again). The prompt row stays
 * usable in the review phase so a follow-up query can chain on the response.
 */
export type AiAssistantFormPhase = "prompt" | "streaming" | "review";

/**
 * The AI assistant balloon: a prompt row, a read-only streaming preview styled like note content,
 * and the review actions. Purely presentational — the orchestration (markers, streaming, committing
 * to the model) lives in `AiAssistantUI`, which listens to this view's `submit`, `stop`, `replace`,
 * `insertBelow` and `tryAgain` events.
 */
export default class AiAssistantFormView extends View {

    declare public phase: AiAssistantFormPhase;
    /** The instruction typed by the user; two-way bound to the input field. */
    declare public query: string;
    /** A transport/provider failure to surface; empty string when there is none. */
    declare public errorMessage: string;

    public readonly promptInputView: LabeledFieldView<InputTextView>;
    public readonly sendButtonView: ButtonView;
    public readonly previewView: AiPreviewView;
    public readonly stopButtonView: ButtonView;
    public readonly replaceButtonView: ButtonView;
    public readonly insertBelowButtonView: ButtonView;
    public readonly tryAgainButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly _focusables = new ViewCollection<FocusableView>();
    private readonly _focusCycler: FocusCycler;

    constructor(locale: Locale, translate: Translate) {
        super(locale);

        this.set("phase", "prompt");
        this.set("query", "");
        this.set("errorMessage", "");

        this.promptInputView = this._createPromptInput(locale, translate);
        this.sendButtonView = this._createSendButton(locale, translate);
        this.previewView = new AiPreviewView(locale);
        this.previewView.bind("isVisible").to(this, "phase", (phase) => phase !== "prompt");

        this.stopButtonView = this._createActionButton(locale, translate("ai_assistant.stop", "Stop"), "streaming", "stop");
        this.replaceButtonView = this._createActionButton(locale, translate("ai_assistant.replace", "Replace"), "review", "replace");
        this.replaceButtonView.class = "ck-button-action";
        this.insertBelowButtonView = this._createActionButton(locale, translate("ai_assistant.insert_below", "Insert below"), "review", "insertBelow");
        this.tryAgainButtonView = this._createActionButton(locale, translate("ai_assistant.try_again", "Try again"), "review", "tryAgain");

        const bind = this.bindTemplate;

        this.setTemplate({
            tag: "form",
            attributes: {
                class: ["ck", "ck-ai-assistant-form", "ck-responsive-form"],
                tabindex: "-1"
            },
            children: [
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-ai-assistant-form__heading"] },
                    children: [{ text: translate("ai_assistant.title", "AI assistant") }]
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
                        this.replaceButtonView,
                        this.insertBelowButtonView,
                        this.tryAgainButtonView
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

        const focusables = [
            this.promptInputView,
            this.sendButtonView,
            this.stopButtonView,
            this.replaceButtonView,
            this.insertBelowButtonView,
            this.tryAgainButtonView
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
        this.previewView.setContent("");
    }

    /** Enters the streaming phase with an empty preview. */
    public beginStreaming(): void {
        this.phase = "streaming";
        this.errorMessage = "";
        this.previewView.setContent("");
    }

    /** Renders the (sanitized, cumulative) response received so far. */
    public setPreview(html: string): void {
        this.previewView.setContent(html);
    }

    /**
     * Leaves the streaming phase. With content the form enters review; a run that produced
     * nothing falls back to the prompt phase, showing `errorMessage` when the run failed.
     */
    public endStreaming(hasContent: boolean, errorMessage: string): void {
        this.phase = hasContent ? "review" : "prompt";
        this.errorMessage = errorMessage;
    }

    public focus(): void {
        this._focusCycler.focusFirst();
    }

    private _createPromptInput(locale: Locale, translate: Translate) {
        const input = new LabeledFieldView(locale, createLabeledInputText);
        input.label = translate("ai_assistant.prompt_label", "Ask AI to…");

        // Two-way: the field drives `query`, and reset() drives the field.
        input.fieldView.bind("value").to(this, "query");
        input.fieldView.on("input", () => {
            /* v8 ignore next -- the input event can only come from a rendered element */
            this.query = input.fieldView.element?.value ?? "";
        });
        input.bind("isEnabled").to(this, "phase", (phase) => phase !== "streaming");

        return input;
    }

    private _createSendButton(locale: Locale, translate: Translate) {
        const button = new ButtonView(locale);
        button.set({
            label: translate("ai_assistant.send", "Send"),
            withText: true,
            type: "submit",
            class: "ck-button-action ck-button-bold"
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
