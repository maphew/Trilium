import {
    addMenuToDropdown,
    ButtonView,
    CKEditorError,
    createDropdown,
    Dialog,
    DialogViewPosition,
    ListSeparatorView,
    Plugin,
    SplitButtonView,
    View,
    type DropdownMenuDefinition,
    type DropdownMenuListItemButtonView,
    type DropdownView,
    type Locale,
    type ModelNode,
    type ModelRange
} from "ckeditor5";

import type { AiCompletionUsage, AiDiffResult, AiQuickAction, AiQuickActionGroup, AiReviewView } from "./ai_assistant_config.js";
import AiAssistantEditing, { AI_TARGET_MARKER } from "./ai_assistant_editing.js";
import AiAssistantFormView from "./ai_assistant_form.js";
import aiIcon from "./theme/icons/ai.svg?raw";
import "./theme/ai_assistant.css";

/**
 * SSE chunks can arrive per-token; re-rendering the whole preview for each one buys nothing
 * visually and burns CPU re-parsing the growing prefix. One render per interval is smooth enough.
 */
const RENDER_THROTTLE_MS = 80;

/** Identifies our dialog in the editor-wide `Dialog` plugin, which shows one dialog at a time. */
const DIALOG_ID = "aiAssistant";

/**
 * How much of a response has to be a replacement rather than an edit (see
 * `AiDiffResult.rewriteRatio`) before the review opens on the plain result instead of the diff.
 * Half is the point where the "Changes" view stops being a set of marks on a text one can still
 * read and becomes two texts stacked on each other.
 */
const REWRITE_RATIO_THRESHOLD = 0.5;

/**
 * The AI assistant's UI and orchestration: the toolbar entry (a split button whose menu holds the
 * host's quick actions), the dialog form, and the stream-preview-commit lifecycle.
 *
 * The core design decision is that **the stream never touches the document**. The response
 * streams into the form's detached preview; the note is modified exactly once, when the user
 * commits with Replace or Insert below — a single `model.change()`, so a single undo step.
 *
 * The form lives in a **non-modal dialog** rather than a balloon. A balloon anchors to the target
 * text, which means it has to be repositioned on every streamed chunk and still ends up covering
 * the very content being rewritten on a large selection; it also shares one stack with the balloon
 * toolbar that `PopupEditor` (floating-toolbar mode) shows on exactly the selections the assistant
 * opens on. The dialog is anchored to the editor instead, is draggable, and leaves the document
 * visible and editable — so the target highlight stays on screen while the response is reviewed.
 */
export default class AiAssistantUI extends Plugin {

    static get requires() {
        return [AiAssistantEditing, Dialog] as const;
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

    /** The cumulative response HTML of the current/last run, as the host delivered it. */
    private _cumulative = "";
    /** The HTML the next query will run against: the selection, then each committed-to response. */
    private _context = "";
    /** The context of the last run, restored by "Try again" so a retry does not chain on itself. */
    private _previousContext = "";
    private _lastQuery = "";
    /**
     * The view the running quick action asked its review to open on, when it named one. Null for a
     * typed prompt, which leaves the choice to the diff.
     */
    private _reviewView: AiReviewView | null = null;

    public init(): void {
        const editor = this.editor;

        this.set("isStreaming", false);
        this.set("hasContext", false);

        editor.ui.componentFactory.add("aiAssistant", (locale) => this._createToolbarComponent(locale));

        // While the assistant is closed the quick actions are offered against the selection, so
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

        // The menu carries only ids and labels, so the action each button stands for is looked up
        // on execute rather than carried by the view.
        const actionsById = new Map<string, AiQuickAction>();
        const groupsById = new Map<string, AiQuickActionGroup>();
        const definition: DropdownMenuDefinition = [];
        // Where the menu wants a rule drawn, as indices into the finished item list. An inlined
        // group lost its heading to the menu definition, so a separator is what is left to say
        // where one set of actions ends and the next begins. Consecutive submenus need none: they
        // read as one block of "openers" already.
        const separatorAt: number[] = [];
        for (const [index, group] of groups.entries()) {
            groupsById.set(group.id, group);
            const children = group.actions.map((action) => {
                actionsById.set(action.id, action);
                return { id: action.id, label: action.label };
            });
            if (group.submenu) {
                definition.push({ id: group.id, menu: group.label, children });
            } else {
                definition.push(...children);
            }

            const next = groups[index + 1];
            if (next && !(group.submenu && next.submenu)) {
                separatorAt.push(definition.length);
            }
        }
        addMenuToDropdown(dropdownView, this.editor.ui.view.body, definition, {
            ariaLabel: locale.t("AI assistant")
        });
        dropdownView.class = "ck-ai-assistant-quick-actions";

        // The menu builds its views in `render()`, which `addMenuToDropdown` defers to the first
        // open (through its own `change:isOpen` listener, registered at `highest` priority — so it
        // has already run by the time this one does). There are no buttons to bind before that,
        // and they are built exactly once, so this unsubscribes itself.
        const decorateMenu = () => {
            for (const button of dropdownView.menuView?.buttons ?? []) {
                const action = actionsById.get(button.id);
                if (action?.requiresContent !== false) {
                    button.bind("isEnabled").to(this, "hasContext");
                }
                addIcon(button, action?.iconClass);
            }
            for (const menu of dropdownView.menuView?.menus ?? []) {
                const group = groupsById.get(menu.id);
                addIcon(menu.buttonView, group?.iconClass);
                // A submenu with nothing runnable in it should not invite the pointer: gate the
                // opener on the same context its actions are gated on, unless one of them can run
                // without any. The nested menu binds its own button to this.
                if (group?.actions.every((action) => action.requiresContent !== false)) {
                    menu.bind("isEnabled").to(this, "hasContext");
                }
            }
            // Back to front: each insertion shifts everything after it, and the recorded indices
            // are into the list as the definition built it.
            for (const index of [...separatorAt].reverse()) {
                dropdownView.menuView?.items.add(new ListSeparatorView(locale), index);
            }
            this.stopListening(dropdownView, "change:isOpen", decorateMenu);
        };
        this.listenTo(dropdownView, "change:isOpen", decorateMenu);

        // Only the menu items reach this: a split button delegates its own `execute` to itself,
        // and its arrow to the dropdown's `open`. An item inside a submenu arrives here too — it
        // delegates up through its menu to the root — and delegation preserves the original
        // source, so the button (and its id) is the same either way.
        dropdownView.on("execute", (evt) => {
            const action = actionsById.get((evt.source as DropdownMenuListItemButtonView).id);
            /* v8 ignore next -- every button in the menu was built from an action in this map */
            if (action) {
                this.runQuickAction(action);
            }
        });

        return dropdownView;
    }

    public override destroy(): void {
        super.destroy();
        this._abortController?.abort();
        this._formView?.destroy();
    }

    /** Opens the assistant on the current selection. Invoked by the `aiAssistant` command. */
    public show(): void {
        this._open(false);
    }

    /**
     * Opens the assistant and runs a preset instruction against the caret's surroundings. Both
     * entry points to the quick actions — the toolbar menu and the `/` palette — come in this way.
     */
    public runQuickAction(action: AiQuickAction): void {
        // Titled the way the `/` palette names the action: a bare label can be a fragment
        // ("Romanian") that only reads as an instruction beside its group heading.
        this._open(true, action.commandLabel ?? action.label);
        this._reviewView = action.reviewView ?? null;
        void this._run(action.prompt);
    }

    /**
     * @param fallbackToBlock widens a collapsed caret to the block it sits in. A quick action is an
     *                        instruction *about* content ("Fix typos"), so it needs something to
     *                        work on, while a free-form prompt typed at a collapsed caret
     *                        legitimately means "generate here" and must keep an empty context.
     * @param title names the run in the dialog's header, for a quick action. Defaults to the
     *              feature's own name, which is all a free-form prompt can be called.
     */
    private _open(fallbackToBlock: boolean, title?: string): void {
        const editor = this.editor;
        const dialog = editor.plugins.get(Dialog);
        const form = this._getForm();
        const heading = title ?? editor.t("AI assistant");

        if (dialog.id === DIALOG_ID) {
            this._setTitle(heading);
            form.focus();
            return;
        }

        // Capture the context and pin the target before focus moves into the dialog and the
        // document selection stops being trustworthy.
        const model = editor.model;
        const range = this._resolveTargetRange(fallbackToBlock);
        this._context = !range || range.isCollapsed
            ? ""
            : editor.data.stringify(model.getSelectedContent(model.createSelection(range)));
        this._previousContext = this._context;
        this._cumulative = "";
        this._updateHasContext();

        /* v8 ignore next -- the document selection always has at least one range */
        if (range) {
            model.change((writer) => {
                writer.addMarker(AI_TARGET_MARKER, { range, usingOperation: false, affectsData: false });
            });
        }

        form.reset();
        dialog.show({
            id: DIALOG_ID,
            // A header is what makes the dialog draggable, so the user can move it off the text
            // being rewritten.
            title: heading,
            icon: aiIcon,
            isModal: false,
            position: DialogViewPosition.EDITOR_CENTER,
            content: form,
            // Covers every way out — Esc, the close button, another dialog taking over — not just
            // the paths that go through `_hide()`.
            onHide: () => this._reset()
        });
        form.focus();
    }

    /**
     * Retitles the dialog while it stands. `show()` takes the title only once, so a quick action
     * picked over an already-open assistant has to write to the header itself — and to the aria
     * label, which the dialog otherwise derives from the same string.
     */
    private _setTitle(title: string): void {
        const view = this.editor.plugins.get(Dialog).view;
        /* v8 ignore next -- every call site has just established that the dialog is open */
        if (!view?.headerView) {
            return;
        }
        view.headerView.label = title;
        view.ariaLabel = title;
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
                // A typed follow-up is no longer the quick action that opened the assistant, so
                // the header stops claiming to be one — and its review view goes with it.
                this._setTitle(editor.t("AI assistant"));
                this._reviewView = null;
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

        // Esc and the close button are the dialog's own; it also stays put as the preview grows
        // and when the Result/Changes toggle changes its height, so there is nothing to reposition
        // and no click-outside dismissal that could throw a streamed response away.
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

        const render = (html: string) => form.setPreview(this._sanitize(html));

        let renderTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingHtml: string | null = null;
        const onData = (cumulative: string) => {
            this._cumulative = cumulative;
            if (renderTimer) {
                pendingHtml = cumulative;
                return;
            }
            render(cumulative);
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

        const diff = this._buildDiff();
        form.enterReview({
            hasContent: !!this._cumulative,
            diffHtml: diff?.html,
            errorMessage,
            usageText: this._formatUsage(usage),
            viewMode: this._resolveReviewView(diff)
        });
    }

    /**
     * Which view the finished run opens on: whatever the quick action asked for, and otherwise
     * what the diff makes of the response — a rewrite the differ could barely align is shown as
     * the result, since the marks would outnumber the text they are on.
     */
    private _resolveReviewView(diff: AiDiffResult | null): AiReviewView {
        if (this._reviewView) {
            return this._reviewView;
        }
        return (diff?.rewriteRatio ?? 0) > REWRITE_RATIO_THRESHOLD ? "result" : "changes";
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
    private _buildDiff(): AiDiffResult | null {
        const diff = this.editor.config.get("aiAssistant")?.diff;
        if (!diff || !this._cumulative || !this._previousContext) {
            return null;
        }
        try {
            // A renderer may answer with the diff alone or with the diff and what it made of it.
            const result = diff(this._previousContext, this._cumulative);
            const { html, rewriteRatio }: AiDiffResult = typeof result === "string" ? { html: result } : result;
            return { html: this._sanitize(html), rewriteRatio };
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

    /** Closes the assistant. The teardown itself rides on the dialog's `onHide`. */
    private _hide(): void {
        const dialog = this.editor.plugins.get(Dialog);
        // Only our own: `hide()` closes whatever dialog is open, and another feature's must not be
        // collateral damage.
        if (dialog.id === DIALOG_ID) {
            dialog.hide();
        }
    }

    /**
     * Returns the plugin to its closed state. Invoked from the dialog's `onHide`, so it runs
     * however the assistant was dismissed. The dialog handles removing the form and restoring
     * focus to the editing view.
     */
    private _reset(): void {
        const editor = this.editor;

        this._abortController?.abort();
        this._cumulative = "";
        // Dropping the captured context hands the quick actions back to the selection; keeping it
        // would leave them enabled over a closed assistant that has nothing to work on.
        this._context = "";
        this._previousContext = "";
        this._reviewView = null;
        this._updateHasContext();

        if (editor.model.markers.has(AI_TARGET_MARKER)) {
            editor.model.change((writer) => writer.removeMarker(AI_TARGET_MARKER));
        }
        this._formView?.reset();
    }

    /**
     * What the quick actions are offered against: whatever the assistant captured while open, or
     * once it is closed, whatever a run started now would work on.
     */
    private _updateHasContext(): void {
        const range = this._resolveTargetRange(true);
        this.hasContext = !!this._context || (!!range && !range.isCollapsed);
    }

    /**
     * The range a run works on: the selection, or — for a quick action at a collapsed caret — the
     * block it sits in, so "Fix typos" typed into a paragraph rewrites that paragraph. It is both
     * the context handed to the model and what the target marker pins for "Replace".
     */
    private _resolveTargetRange(fallbackToBlock: boolean): ModelRange | null {
        const model = this.editor.model;
        const selection = model.document.selection;
        const range = selection.getFirstRange();

        if (!fallbackToBlock || !selection.isCollapsed) {
            return range;
        }

        const block = selection.getFirstPosition()?.parent;
        /* v8 ignore next -- a collapsed selection always sits inside an element */
        return block?.is("element") ? model.createRangeIn(block) : range;
    }
}

/**
 * Puts a font icon in front of a menu button's label. The menu definition has no icon field and
 * CKEditor builds these views itself, so the glyph is added to the button's children afterwards —
 * the same after-render mutation the snippet list does, and safe because a `ViewCollection` bound
 * to a rendered element renders whatever is added to it.
 */
function addIcon(button: ButtonView, iconClass: string | undefined): void {
    if (iconClass) {
        button.children.add(new FontIconView(button.locale, iconClass), 0);
    }
}

/**
 * An icon-pack glyph as a plain `<span>`. CKEditor's `IconView` takes SVG source, which a font
 * icon has none of; Trilium owns this plugin, so the class list can be rendered directly.
 */
class FontIconView extends View {

    constructor(locale: Locale | undefined, iconClass: string) {
        super(locale);

        this.setTemplate({
            tag: "span",
            attributes: { class: ["ck-ai-action-icon", ...iconClass.split(" ")] }
        });
    }
}

/**
 * Whether the toolbar entry can be used: the command is enabled (an LLM provider is configured)
 * and no run is in flight.
 */
function isAvailable(isEnabled: boolean, isStreaming: boolean): boolean {
    return isEnabled && !isStreaming;
}
