import {
    addListToDropdown,
    ButtonView,
    CKEditorError,
    clickOutsideHandler,
    Collection,
    ContextualBalloon,
    createDropdown,
    Plugin,
    SplitButtonView,
    ViewModel,
    type DropdownView,
    type ListDropdownButtonDefinition,
    type ListDropdownItemDefinition,
    type Locale,
    type ModelNode,
    type ModelRange
} from "ckeditor5";

import type { AiCompletionUsage, AiQuickAction, AiQuickActionGroup } from "./ai_assistant_config.js";
import AiAssistantEditing, { AI_TARGET_MARKER } from "./ai_assistant_editing.js";
import AiAssistantFormView from "./ai_assistant_form.js";
import { stripMarkdownFences } from "./ai_html.js";
import aiIcon from "./theme/icons/ai.svg?raw";
import "./theme/ai_assistant.css";

/**
 * SSE chunks can arrive per-token; re-rendering the whole preview for each one buys nothing
 * visually and burns CPU re-parsing the growing prefix. One render per interval is smooth enough.
 */
const RENDER_THROTTLE_MS = 80;

/**
 * The AI assistant's UI and orchestration: the toolbar entry (a split button whose menu holds the
 * host's quick actions), the balloon form, and the stream-preview-commit lifecycle.
 *
 * The core design decision is that **the stream never touches the document**. The response
 * streams into the form's detached preview; the note is modified exactly once, when the user
 * commits with Replace or Insert below — a single `model.change()`, so a single undo step.
 */
export default class AiAssistantUI extends Plugin {

    static get requires() {
        return [AiAssistantEditing, ContextualBalloon] as const;
    }

    static get pluginName() {
        return "AiAssistantUI" as const;
    }

    /**
     * Whether a run is in flight. Observable, because the toolbar entry closes itself off while
     * the assistant is busy — a second run would stream into the same preview.
     */
    declare public isStreaming: boolean;
    /**
     * Whether there is content for a quick action to work on: a non-collapsed selection, or, once
     * the assistant is open, whatever it captured — after a run, the response being chained on.
     * Gates the `requiresContent` actions in the toolbar menu.
     */
    declare public hasContext: boolean;

    private _formView: AiAssistantFormView | null = null;
    private _abortController: AbortController | null = null;

    /** The cumulative response of the current/last run, after fence-stripping. */
    private _cumulative = "";
    /** The HTML the next query will run against: the selection, then each committed-to response. */
    private _context = "";
    /** The context of the last run, restored by "Try again" so a retry does not chain on itself. */
    private _previousContext = "";
    private _lastQuery = "";

    public init(): void {
        const editor = this.editor;

        this.set("isStreaming", false);
        this.set("hasContext", false);

        editor.ui.componentFactory.add("aiAssistant", (locale) => this._createToolbarComponent(locale));

        // While the balloon is closed the quick actions are offered against the selection, so
        // their enablement has to follow it.
        this.listenTo(editor.model.document.selection, "change:range", () => this._updateHasContext());
    }

    /**
     * The toolbar entry. Its main action opens the assistant on the selection; its menu lists the
     * host's quick actions, grouped as configured, and picking one opens the assistant and runs
     * that instruction straight away — the free-form prompt is one way in, not the only one.
     *
     * With no quick actions configured there is nothing to hang off an arrow, so the component
     * degrades to a plain button.
     */
    private _createToolbarComponent(locale: Locale): ButtonView | DropdownView {
        const groups = this.editor.config.get("aiAssistant")?.quickActions ?? [];
        return groups.length
            ? this._createQuickActionsDropdown(locale, groups)
            : this._createAssistantButton(locale);
    }

    private _createAssistantButton(locale: Locale): ButtonView {
        const command = this.editor.commands.get("aiAssistant");
        const buttonView = new ButtonView(locale);

        buttonView.set({
            label: locale.t("AI assistant"),
            icon: aiIcon,
            tooltip: true
        });
        /* v8 ignore next -- AiAssistantEditing always registers the command (it is required by this plugin) */
        if (command) {
            buttonView.bind("isEnabled").to(command, "isEnabled", this, "isStreaming", isAvailable);
        }
        this.listenTo(buttonView, "execute", () => this.editor.execute("aiAssistant"));

        return buttonView;
    }

    /**
     * The split button: the icon opens the assistant, the arrow opens the quick actions. Actions
     * marked `requiresContent` stay disabled until there is something to work on — a selection, or
     * a response to chain on.
     */
    private _createQuickActionsDropdown(locale: Locale, groups: AiQuickActionGroup[]): DropdownView {
        const command = this.editor.commands.get("aiAssistant");
        const dropdownView = createDropdown(locale, SplitButtonView);
        const splitButtonView = dropdownView.buttonView;

        splitButtonView.set({
            label: locale.t("AI assistant"),
            icon: aiIcon,
            tooltip: true
        });
        // A dropdown passes `isEnabled` down to its button, so this covers both halves of the
        // split button.
        /* v8 ignore next -- AiAssistantEditing always registers the command (it is required by this plugin) */
        if (command) {
            dropdownView.bind("isEnabled").to(command, "isEnabled", this, "isStreaming", isAvailable);
        }
        this.listenTo(splitButtonView, "execute", () => this.editor.execute("aiAssistant"));

        const items = new Collection<ListDropdownItemDefinition>();
        for (const group of groups) {
            const children = new Collection<ListDropdownButtonDefinition>();
            for (const action of group.actions) {
                const definition: ListDropdownButtonDefinition = {
                    type: "button",
                    model: new ViewModel({
                        _quickAction: action,
                        label: action.label,
                        withText: true
                    })
                };
                if (action.requiresContent !== false) {
                    definition.model.bind("isEnabled").to(this, "hasContext");
                }
                children.add(definition);
            }
            items.add({ type: "group", label: group.label, items: children });
        }
        addListToDropdown(dropdownView, items);
        dropdownView.class = "ck-ai-assistant-quick-actions";

        // Only the list items reach this: a split button delegates its own `execute` to itself,
        // and its arrow to the dropdown's `open`.
        dropdownView.on("execute", (evt) => {
            const { _quickAction } = evt.source as unknown as { _quickAction: AiQuickAction };
            this.show();
            void this._run(_quickAction.prompt);
        });

        return dropdownView;
    }

    public override destroy(): void {
        super.destroy();
        this._abortController?.abort();
        this._formView?.destroy();
    }

    /** Opens the balloon on the current selection. Invoked by the `aiAssistant` command. */
    public show(): void {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this._getForm();

        if (balloon.hasView(form)) {
            form.focus();
            return;
        }

        // Capture the context and pin the target before focus moves into the balloon and the
        // document selection stops being trustworthy.
        const model = editor.model;
        const selection = model.document.selection;
        this._context = selection.isCollapsed
            ? ""
            : editor.data.stringify(model.getSelectedContent(selection));
        this._previousContext = this._context;
        this._cumulative = "";
        this._updateHasContext();

        const range = selection.getFirstRange();
        /* v8 ignore next -- the document selection always has at least one range */
        if (range) {
            model.change((writer) => {
                writer.addMarker(AI_TARGET_MARKER, { range, usingOperation: false, affectsData: false });
            });
        }

        form.reset();
        balloon.add({ view: form, position: this._getBalloonPosition() });
        form.focus();
    }

    private _getForm(): AiAssistantFormView {
        if (this._formView) {
            return this._formView;
        }

        const editor = this.editor;
        const form = new AiAssistantFormView(editor.locale);
        this._formView = form;

        form.on("submit", () => {
            const query = form.query.trim();
            if (query) {
                form.query = "";
                void this._run(query);
            }
        });
        form.on("stop", () => this._abortController?.abort());
        form.on("replace", () => this._commit("replace"));
        form.on("insertBelow", () => this._commit("insertBelow"));
        form.on("tryAgain", () => {
            // Retry against what the last run saw, not against its own output.
            this._context = this._previousContext;
            void this._run(this._lastQuery);
        });

        // The Result and Changes views usually differ in height; keep the balloon anchored.
        this.listenTo(form, "change:viewMode", () => {
            const balloon = this.editor.plugins.get(ContextualBalloon);
            if (balloon.visibleView === form) {
                balloon.updatePosition();
            }
        });

        // Esc always dismisses. A click outside only dismisses an idle, empty form — mid-stream or
        // with a response on screen it would silently throw the result away.
        form.keystrokes.set("Esc", (_data, cancel) => {
            this._hide();
            cancel();
        });
        clickOutsideHandler({
            emitter: form,
            activator: () => this.editor.plugins.get(ContextualBalloon).hasView(form),
            contextElements: () => [this.editor.plugins.get(ContextualBalloon).view.element as HTMLElement],
            callback: () => {
                if (form.phase === "prompt" && !this._cumulative) {
                    this._hide();
                }
            }
        });

        return form;
    }

    private async _run(query: string): Promise<void> {
        const editor = this.editor;
        const stream = editor.config.get("aiAssistant")?.stream;
        const form = this._getForm();
        /* v8 ignore next -- the command is disabled without a stream, and the form blocks submits while streaming */
        if (!stream || this.isStreaming) {
            return;
        }

        this._previousContext = this._context;
        this._lastQuery = query;
        this.isStreaming = true;
        this._cumulative = "";
        form.beginStreaming();

        const abortController = new AbortController();
        this._abortController = abortController;

        const balloon = editor.plugins.get(ContextualBalloon);
        const render = (html: string) => {
            form.setPreview(this._sanitize(html));
            // The preview grows as it fills; keep the balloon anchored rather than overflowing.
            if (balloon.visibleView === form) {
                balloon.updatePosition();
            }
        };

        let renderTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingHtml: string | null = null;
        const onData = (cumulative: string) => {
            const cleaned = stripMarkdownFences(cumulative);
            this._cumulative = cleaned;
            if (renderTimer) {
                pendingHtml = cleaned;
                return;
            }
            render(cleaned);
            renderTimer = setTimeout(() => {
                renderTimer = null;
                if (pendingHtml !== null) {
                    const html = pendingHtml;
                    pendingHtml = null;
                    render(html);
                }
            }, RENDER_THROTTLE_MS);
        };

        let errorMessage = "";
        let usage: AiCompletionUsage | null = null;
        try {
            usage = (await stream({ query, context: this._context }, onData, abortController.signal)) ?? null;
        } catch (error) {
            // An abort is the user's Stop: whatever already streamed stays reviewable.
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                errorMessage = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (renderTimer) {
                clearTimeout(renderTimer);
                renderTimer = null;
            }
            if (pendingHtml !== null) {
                render(pendingHtml);
            }
            this.isStreaming = false;
            this._abortController = null;
        }

        if (this._cumulative) {
            // Follow-up queries chain on the response ("now make it shorter"), premium-style.
            this._context = this._cumulative;
        }
        // A response counts as content, so content-requiring quick actions unlock for chaining.
        this._updateHasContext();
        form.enterReview(!!this._cumulative, this._buildDiff(), errorMessage, this._formatUsage(usage));
    }

    /**
     * The review's cost line, e.g. `claude-sonnet-5 · 1,234 tokens · ~$0.0042`. Only the fields
     * the provider reported are shown; an aborted or failed run has none at all.
     */
    private _formatUsage(usage: AiCompletionUsage | null): string {
        if (!usage) {
            return "";
        }
        const parts: string[] = [];
        if (usage.model) {
            parts.push(usage.model);
        }
        if (usage.totalTokens != null) {
            parts.push(`${usage.totalTokens.toLocaleString()} ${this.editor.t("tokens")}`);
        }
        if (usage.cost != null) {
            // A single completion usually costs well under a cent; two decimals would show $0.00.
            parts.push(`~$${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}`);
        }
        return parts.join(" · ");
    }

    /**
     * Makes model-produced HTML safe to render, through the host's sanitizer — Trilium passes the
     * DOMPurify pass it already applies to note content.
     *
     * There is no fallback on purpose: CKEditor ships no sanitizer, and a strip list written here
     * would only look like one. A host that streams model output without configuring one is
     * misconfigured, so the assistant refuses to run rather than render it unsanitized.
     */
    private _sanitize(html: string): string {
        const sanitize = this.editor.config.get("aiAssistant")?.sanitizeHtml;
        if (!sanitize) {
            throw new CKEditorError("ai-assistant-sanitize-html-required", { pluginName: "AiAssistantUI" });
        }
        return sanitize(html);
    }

    /**
     * The "Changes" view of the review: the finished response diffed against the context the run
     * saw (`_previousContext` — so a follow-up query diffs against the response it refined, not
     * the original selection). Only computed once the stream is complete; diffing a partial
     * response would render everything not yet streamed as deleted. Null when the host provides
     * no diff renderer or there is nothing to diff against (generate-from-scratch).
     */
    private _buildDiff(): string | null {
        const diff = this.editor.config.get("aiAssistant")?.diff;
        if (!diff || !this._cumulative || !this._previousContext) {
            return null;
        }
        try {
            return this._sanitize(diff(this._previousContext, this._cumulative));
        } catch (error) {
            // A host diff failure only costs the Changes view, never the response itself.
            console.warn("AI assistant: diff renderer failed", error);
            return null;
        }
    }

    /**
     * The single write to the document: parses the final response through the data pipeline (the
     * schema drops anything the editor cannot represent) and inserts it at the pinned target.
     */
    private _commit(mode: "replace" | "insertBelow"): void {
        const editor = this.editor;
        const html = this._cumulative;
        /* v8 ignore next -- the commit buttons are only visible in the review phase, which requires content */
        if (!html) {
            return;
        }

        const modelFragment = editor.data.toModel(editor.data.processor.toView(this._sanitize(html)));
        const model = editor.model;

        model.change((writer) => {
            const target = this._getTargetRange();
            if (!target) {
                return;
            }
            if (mode === "replace") {
                model.insertContent(modelFragment, target);
            } else {
                // After the outermost block containing the target's end, so "Insert below" lands
                // below the whole selection rather than inside it.
                let block: ModelNode | null = target.end.parent as ModelNode;
                while (block && block.parent && !block.parent.is("rootElement")) {
                    block = block.parent as ModelNode;
                }
                if (block && !block.is("rootElement")) {
                    model.insertContent(modelFragment, writer.createPositionAfter(block));
                } else {
                    model.insertContent(modelFragment, target.end);
                }
            }
        });

        this._hide();
    }

    private _getTargetRange(): ModelRange | null {
        const model = this.editor.model;
        const marker = model.markers.has(AI_TARGET_MARKER) ? model.markers.get(AI_TARGET_MARKER) : null;
        return marker?.getRange() ?? model.document.selection.getFirstRange() ?? null;
    }

    private _hide(): void {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this._formView;

        this._abortController?.abort();
        this._cumulative = "";
        // Dropping the captured context hands the quick actions back to the selection; keeping it
        // would leave them enabled over a closed assistant that has nothing to work on.
        this._context = "";
        this._previousContext = "";
        this._updateHasContext();

        if (editor.model.markers.has(AI_TARGET_MARKER)) {
            editor.model.change((writer) => writer.removeMarker(AI_TARGET_MARKER));
        }
        if (form && balloon.hasView(form)) {
            balloon.remove(form);
        }
        form?.reset();
        editor.editing.view.focus();
    }

    /**
     * What the quick actions are offered against: whatever the assistant captured while open, or
     * the selection once it is closed.
     */
    private _updateHasContext(): void {
        this.hasContext = !!this._context || !this.editor.model.document.selection.isCollapsed;
    }

    private _getBalloonPosition() {
        const editor = this.editor;
        return {
            target: () => {
                const modelRange = this._getTargetRange();
                if (modelRange) {
                    const viewRange = editor.editing.mapper.toViewRange(modelRange);
                    return editor.editing.view.domConverter.viewRangeToDom(viewRange);
                }
                /* v8 ignore next -- there is always either a marker or a document selection range */
                return editor.ui.getEditableElement() as HTMLElement;
            }
        };
    }
}

/**
 * Whether the toolbar entry can be used: the command is enabled (an LLM provider is configured)
 * and no run is in flight.
 */
function isAvailable(isEnabled: boolean, isStreaming: boolean): boolean {
    return isEnabled && !isStreaming;
}
