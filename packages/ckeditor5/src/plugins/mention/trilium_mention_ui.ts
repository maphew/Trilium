import {
    ButtonView,
    clickOutsideHandler,
    Collection,
    ContextualBalloon,
    type DomOptimalPositionOptions,
    type Editor,
    keyCodes,
    type Marker,
    MentionDomWrapperView,
    type MentionFeedObjectItem,
    MentionListItemView,
    MentionsView,
    ModelLivePosition,
    type ModelPosition,
    Plugin,
    Rect,
    TextWatcher,
    type ViewDocumentKeyDownEvent
} from "ckeditor5";

import { createMarkerPattern, findMarkerMatch, type MarkerMatch } from "./marker_pattern.js";
import type { MentionListView, TriliumMentionFeed } from "./types.js";

const VERTICAL_SPACING = 3;
/** The least gap kept between the panel and an edge of the visible viewport, which `style.css` matches. */
const VIEWPORT_MARGIN = 8;
/** Below this the space under the caret is unusable, and the panel opens above it where there is more room. */
const MIN_LIST_HEIGHT = 150;
const MARKER_NAME = "mention";
const FEED_DEBOUNCE_MS = 100;
const DEFAULT_DROPDOWN_LIMIT = 10;

/** See {@link MentionListState.className}, which `slash_commands.css` styles the `/` rows under. */
const MENTION_LIST_CLASS = "ck-mention-list";

/** A configured feed with its compiled trigger pattern. */
type Pattern = TriliumMentionFeed & { pattern: RegExp };

/**
 * A drop-in replacement for CKEditor's `MentionUI` that fixes three behaviours we can neither
 * configure nor subclass around, since every interesting member of `MentionUI` is `private`:
 *
 * 1. **Escape actually dismisses.** Upstream's Escape handler only removes the model marker, but its
 *    `TextWatcher` re-evaluates the text on the very next keystroke, the pattern still matches, and
 *    the panel reopens. Trilium worked around that by *inserting a ` ` en-space* into the document
 *    so the (also patched) pattern could no longer match — which corrupts data: the attribute lexer
 *    treats only U+0020 as a separator, so `#foo<en-space> #bar` fails to parse and the attribute
 *    list becomes unsaveable. Here dismissal is state ({@link #_dismissedAt}), not a document edit.
 * 2. **The panel opens on typing only.** `TextWatcher` fires `matched:selection` on any direct caret
 *    move, and upstream listens to plain `matched`, so merely *clicking* into an existing `#myLabel`
 *    reopens the panel — and since it also pre-selects the first item, the Enter meant to save the
 *    attributes commits a suggestion instead.
 * 3. **A stale query closes the panel.** See {@link createMarkerPattern}.
 *
 * Everything else — the balloon, the list views, the `mention` model attribute and its post-fixers,
 * the `mention` command — is reused from upstream unchanged. This plugin replaces `MentionUI` only;
 * pair it with `MentionEditing` rather than the `Mention` façade, which pulls in `MentionUI` too.
 */
export default class TriliumMentionUI extends Plugin {

    private readonly _view: MentionsView;
    private readonly _items = new Collection<{ item: MentionFeedObjectItem; marker: string }>();
    private _patterns: Pattern[] = [];

    /** The host's drawing of the list, from `mention.listView`, which replaces the balloon. */
    private _listView?: MentionListView;
    /** Whether {@link _listView} is shown. */
    private _listShown = false;
    /** The entry {@link _listView} highlights, or `-1`. */
    private _selectedIndex = -1;

    private _balloon?: ContextualBalloon;
    private _feedTimer?: ReturnType<typeof setTimeout>;

    /** Monotonic id of the most recently *started* feed request; see {@link _requestFeed}. */
    private _requestId = 0;

    /**
     * Where the marker of the panel the user dismissed with Escape sits, or `null` when nothing is
     * dismissed. Live, so it follows edits and lands in the graveyard if the marker is deleted.
     */
    private _dismissedAt: ModelLivePosition | null = null;

    static get pluginName() {
        return "TriliumMentionUI" as const;
    }

    static get requires() {
        return [ ContextualBalloon ];
    }

    constructor(editor: Editor) {
        super(editor);

        this._view = this._createView();
        editor.config.define("mention", { feeds: [] });
    }

    init() {
        const editor = this.editor;
        this._balloon = editor.plugins.get(ContextualBalloon);

        /* v8 ignore next -- the constructor defines `mention.feeds` as `[]`, so `get()` never returns undefined; the fallback only satisfies the optional return type */
        const feeds = (editor.config.get("mention.feeds") ?? []) as TriliumMentionFeed[];
        this._patterns = feeds.map((feed) => ({ ...feed, pattern: createMarkerPattern(feed.marker, feed) }));
        this._listView = editor.config.get("mention.listView")?.(editor);

        editor.editing.view.document.on<ViewDocumentKeyDownEvent>("keydown", (evt, data) => {
            if (this._isVisible && this._handleKeyDown(data.keyCode)) {
                data.preventDefault();
                evt.stop(); // Required to override the Enter key.
            }
        }, { priority: "highest" });

        clickOutsideHandler({
            emitter: this._view,
            activator: () => this._isVisible,
            /* v8 ignore next -- `clickOutsideHandler` only calls `contextElements()` once the activator reported the panel visible, and a visible balloon is a rendered one, so its element is never null */
            contextElements: () => {
                const element = this._listView ? this._listView.element : this._balloon?.view.element;
                return element ? [ element ] : [];
            },
            callback: () => this._hide()
        });

        this._setupTextWatcher();
        this.listenTo(editor, "change:isReadOnly", () => this._hide());
    }

    override destroy() {
        super.destroy();

        clearTimeout(this._feedTimer);
        this._clearDismissal();
        // Balloon views are not destroyed automatically — see ckeditor5#1341.
        this._view.destroy();
        this._listView?.destroy?.();
    }

    private get _isVisible() {
        return this._listView ? this._listShown : this._balloon?.visibleView === this._view;
    }

    private _isCurrentRequest(requestId: number) {
        return this._requestId === requestId;
    }

    /**
     * Returns whether the key was consumed. Commit keys are deliberately *not* consumed when nothing
     * is selected, so that in the attribute editor — where `preselectFirstItem` is off — Enter still
     * saves instead of being swallowed by an open panel.
     */
    private _handleKeyDown(keyCode: number): boolean {
        if (keyCode === keyCodes.arrowdown || keyCode === keyCodes.arrowup) {
            if (this._listView) {
                this._moveSelection(keyCode === keyCodes.arrowdown ? 1 : -1);
            } else if (keyCode === keyCodes.arrowdown) {
                this._view.selectNext();
            } else {
                this._view.selectPrevious();
            }
            return true;
        }

        if (keyCode === keyCodes.esc) {
            this._dismiss();
            return true;
        }

        if (keyCode === keyCodes.enter || keyCode === keyCodes.tab) {
            if (this._listView) {
                const entry = this._items.get(this._selectedIndex);
                if (!entry) {
                    return false;
                }

                this._commit(entry);
                return true;
            }

            if (!this._view.selected) {
                return false;
            }

            this._view.executeSelected();
            return true;
        }

        return false;
    }

    /**
     * Hides the panel and remembers that the user rejected *this* marker, so it does not immediately
     * reopen on the next keystroke. No document mutation is involved.
     */
    private _dismiss() {
        const start = this.editor.model.markers.get(MARKER_NAME)?.getStart();

        this._hide();

        /* v8 ignore next -- Escape only reaches here while the panel is visible, and the panel and the marker always come and go together, so there is always a start */
        if (start) {
            this._clearDismissal();
            this._dismissedAt = ModelLivePosition.fromPosition(start, "toPrevious");
        }
    }

    private _clearDismissal() {
        this._dismissedAt?.detach();
        this._dismissedAt = null;
    }

    /**
     * Whether `markerStart` is the marker the user already dismissed. A dismissal whose text has
     * since been deleted (its live position landed in the graveyard) is discarded, so retyping the
     * same marker opens the panel again.
     */
    private _isDismissed(markerStart: ModelPosition): boolean {
        if (!this._dismissedAt) {
            return false;
        }

        if (this._dismissedAt.root.rootName === "$graveyard") {
            this._clearDismissal();
            return false;
        }

        return this._dismissedAt.toPosition().isEqual(markerStart);
    }

    private _setupTextWatcher() {
        const editor = this.editor;

        // Returning the match object makes `TextWatcher` merge it into the event data, so the
        // handler does not have to re-derive the block text and re-run the patterns.
        const watcher = new TextWatcher(editor.model, (text) => findMarkerMatch(this._patterns, text) ?? false);

        // Only typing opens the panel. `matched:selection` fires on any direct caret move — a click
        // or an arrow key — and reopening there is the "clicking always triggers an autocomplete"
        // bug; a caret move should close the panel, whose balloon is anchored to a marker the user
        // has just navigated away from.
        watcher.on<TriliumMatchedEvent>("matched:data", (evt, data) => this._onTyped(data));
        watcher.on("matched:selection", () => this._hide());
        watcher.on("unmatched", () => {
            this._clearDismissal();
            this._hide();
        });

        const command = editor.commands.get("mention");
        if (command) {
            watcher.bind("isEnabled").to(command);
        }
    }

    private _onTyped({ feed, query }: MarkerMatch<Pattern>) {
        const model = this.editor.model;
        const focus = model.document.selection.focus;

        /* v8 ignore next 3 -- the document selection of a live editor always has a focus; the guard only narrows the type for the `getShiftedBy()` calls below */
        if (!focus) {
            return;
        }

        const start = focus.getShiftedBy(-(feed.marker.length + query.length));
        const end = focus.getShiftedBy(-query.length);

        // Never re-trigger inside an existing mention — mirrors upstream's `isPositionInExistingMention`.
        if (isInExistingMention(focus) || isBeforeExistingMention(start)) {
            this._hide();
            return;
        }

        if (this._isDismissed(start)) {
            return;
        }

        const range = model.createRange(start, end);
        const existing = model.markers.get(MARKER_NAME);

        model.change((writer) => {
            if (existing) {
                writer.updateMarker(existing, { range });
            } else {
                writer.addMarker(MARKER_NAME, { range, usingOperation: false, affectsData: false });
            }
        });

        const requestId = ++this._requestId;
        clearTimeout(this._feedTimer);
        this._feedTimer = setTimeout(() => void this._requestFeed(feed, query, requestId), FEED_DEBOUNCE_MS);
    }

    private async _requestFeed(feed: TriliumMentionFeed, query: string, requestId: number) {
        let items: Array<MentionFeedObjectItem | string>;

        try {
            items = typeof feed.feed === "function"
                ? await feed.feed.call(this.editor, query)
                : feed.feed.filter((item) => String(typeof item === "object" ? item.id : item).toLowerCase().includes(query.toLowerCase()));
        } catch {
            // Only the request still in flight may act on a failure. Debouncing bounds how many
            // requests are *started*, not how many are outstanding, so an earlier one rejecting
            // must not tear down the panel a later one has since populated.
            if (this._isCurrentRequest(requestId)) {
                this._hide();
            }
            return;
        }

        // Drop out-of-order responses, and responses that arrived after the panel was dismissed or
        // the marker went away. Correlating on the request rather than the query text matters when
        // the same text is retyped, or typed under a different marker: `#al` and `~al` produce equal
        // queries but different feeds, and the stale one would otherwise fill the panel with the
        // wrong suggestions.
        if (!this._isCurrentRequest(requestId) || !this.editor.model.markers.has(MARKER_NAME)) {
            return;
        }

        const limit = feed.dropdownLimit ?? this.editor.config.get("mention.dropdownLimit") ?? DEFAULT_DROPDOWN_LIMIT;

        this._items.clear();
        for (const item of items.slice(0, limit as number)) {
            this._items.add({ item: typeof item === "object" ? item : { id: item, text: item }, marker: feed.marker });
        }

        if (!this._items.length) {
            this._hide();
            return;
        }

        this._show(feed);
    }

    private _show(feed: TriliumMentionFeed) {
        const marker = this.editor.model.markers.get(MARKER_NAME);

        /* v8 ignore next 3 -- `_requestFeed()` already returned unless the marker is still registered, and `_balloon` is assigned in `init()`; the guard only narrows both types */
        if (!marker || !this._balloon) {
            return;
        }

        if (this._listView) {
            // Pre-selecting the first item makes Enter always commit *something*; see below.
            this._selectedIndex = (feed.preselectFirstItem ?? true) ? 0 : -1;
            this._listShown = true;
            this._drawList(marker);
            return;
        }

        // The add/update decision keys off *membership*, not visibility: `ContextualBalloon.add()`
        // throws `contextualballoon-add-view-exist` for a view that is already registered in any
        // stack, visible or not. Upstream's `MentionUI` branches on visibility here and so crashes
        // as soon as another plugin's balloon (added with `singleViewMode`) buries the panel.
        // Rendered ahead of `ContextualBalloon.add()`, which would otherwise render it, so the height
        // is capped before the first placement measures the panel.
        if (!this._view.isRendered) {
            this._view.render();
        }
        const preferAbove = this._fitToVisibleViewport(marker);

        if (!this._balloon.hasView(this._view)) {
            this._balloon.add({
                view: this._view,
                position: this._positionData(marker, preferAbove),
                singleViewMode: true,
                balloonClassName: "ck-mention-balloon"
            });
        } else if (this._isVisible) {
            this._balloon.updatePosition(this._positionData(marker, preferAbove));
        }

        this._view.position = this._balloon.view.position;

        // Pre-selecting the first item makes Enter always commit *something*. That is right for the
        // note editor, but wrong in the attribute editor, where Enter means "save".
        if (feed.preselectFirstItem ?? true) {
            this._view.selectFirst();
        } else {
            this._view.selected?.removeHighlight();
            this._view.selected = undefined;
        }
    }

    private _hide() {
        clearTimeout(this._feedTimer);

        if (this._listShown) {
            this._listShown = false;
            this._selectedIndex = -1;
            this._listView?.hide();
        }

        if (this._balloon?.hasView(this._view)) {
            this._balloon.remove(this._view);
        }

        if (this.editor.model.markers.has(MARKER_NAME)) {
            this.editor.model.change((writer) => writer.removeMarker(MARKER_NAME));
        }

        this._view.position = undefined;
    }

    private _createView(): MentionsView {
        const locale = this.editor.locale;
        const view = new MentionsView(locale);

        view.items.bindTo(this._items).using(({ item, marker }) => {
            const listItem = new MentionListItemView(locale);
            const child = this._renderItem(item, marker);

            child.delegate("execute").to(listItem);
            listItem.children.add(child);
            listItem.item = item;
            listItem.marker = marker;
            listItem.on("execute", () => view.fire("execute", { item, marker }));

            return listItem;
        });

        view.on("execute", (evt, data) => this._commit(data));

        return view;
    }

    /** Replaces the trigger text with `item`, or hands it to its feed's `commit`. */
    private _commit(data: { item: MentionFeedObjectItem; marker: string }) {
        const editor = this.editor;
        const model = editor.model;
        const marker = model.markers.get(MARKER_NAME);
        const focus = model.document.selection.focus;

        /* v8 ignore next 3 -- an entry is only committed while the list is visible, which means the marker is registered, and a live selection always has a focus */
        if (!marker || !focus) {
            return;
        }

        // Replace everything from the marker up to the caret, not just the marker itself.
        const range = model.createRange(model.createPositionAt(marker.getStart()), model.createPositionAt(focus));
        const feed = this._patterns.find((pattern) => pattern.marker === data.marker);

        this._hide();
        this._clearDismissal();

        // Bail before deleting anything if the item went stale while it sat in the open panel —
        // a `/` command that lost `isEnabled` as the selection settled. Committing it would drop
        // the trigger text and then no-op, eating what the user typed.
        if (feed?.canCommit && !feed.canCommit(editor, data.item)) {
            return;
        }

        if (feed?.commit) {
            // Drop the trigger text first so the callback sees a collapsed selection where the
            // query used to be, and run it outside the change block — some callbacks open a
            // balloon (`/math`, `/anchor`) rather than touching the model, which needs a settled
            // view. Focus is restored *before* the callback for the same reason: one that opens
            // a UI takes focus itself, and must do so last.
            model.change((writer) => model.deleteContent(writer.createSelection(range)));
            editor.editing.view.focus();
            feed.commit(editor, data.item);
        } else {
            editor.execute("mention", { mention: data.item, text: data.item.text, marker: data.marker, range });
            editor.editing.view.focus();
        }
    }

    /** Hands the entries and the selection to {@link _listView}, which draws them at the caret. */
    private _drawList(marker: Marker) {
        const entries = this._items.map(({ item, marker: feedMarker }) => ({
            item,
            marker: feedMarker,
            render: () => this._patterns.find((feed) => feed.marker === feedMarker)?.itemRenderer?.(item)
        }));

        this._listView?.show({
            entries,
            className: MENTION_LIST_CLASS,
            selectedIndex: this._selectedIndex,
            caretRect: () => {
                const { left, top, width, height } = this._caretRect(marker);
                return new DOMRect(left, top, width, height);
            },
            editable: this.editor.editing.view.getDomRoot() ?? null,
            select: (index) => {
                this._selectedIndex = index;
                this._drawList(marker);
            },
            pick: (index) => {
                const entry = this._items.get(index);
                if (entry) {
                    this._commit(entry);
                }
            }
        });
    }

    /** Steps the selection of {@link _listView}, wrapping at either end, as `MentionsView` does. */
    private _moveSelection(delta: number) {
        const marker = this.editor.model.markers.get(MARKER_NAME);
        const count = this._items.length;

        /* v8 ignore next 3 -- the keys only reach here while the list is shown, which means it has entries and a marker */
        if (!marker || !count) {
            return;
        }

        this._selectedIndex = this._selectedIndex < 0
            ? (delta > 0 ? 0 : count - 1)
            : (this._selectedIndex + delta + count) % count;
        this._drawList(marker);
    }

    private _renderItem(item: MentionFeedObjectItem, marker: string): MentionDomWrapperView | ButtonView {
        const rendered = this._patterns.find((feed) => feed.marker === marker)?.itemRenderer?.(item);

        if (rendered && typeof rendered !== "string") {
            return new MentionDomWrapperView(this.editor.locale, rendered);
        }

        const button = new ButtonView(this.editor.locale);
        button.label = rendered ?? item.id;
        button.withText = true;

        return button;
    }

    /**
     * Caps the list's height to the larger of the spaces above and below the caret in the visible
     * viewport, which on a phone excludes the on-screen keyboard. Returns whether the panel opens above
     * the caret.
     */
    private _fitToVisibleViewport(marker: Marker): boolean {
        const caret = this._caretRect(marker);
        const viewport = window.visualViewport;
        const visibleTop = viewport?.offsetTop ?? 0;
        const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;

        const below = visibleBottom - caret.bottom - VERTICAL_SPACING - VIEWPORT_MARGIN;
        const above = caret.top - visibleTop - VERTICAL_SPACING - VIEWPORT_MARGIN;
        const preferAbove = below < MIN_LIST_HEIGHT && above > below;

        this._view.element?.style.setProperty("--tn-mention-visible-height", `${Math.max(preferAbove ? above : below, 0)}px`);
        return preferAbove;
    }

    /** The rect the panel is placed against: the end of the marker, or of the selection once it is gone. */
    private _caretRect(marker: Marker): Rect {
        const editing = this.editor.editing;
        let range = marker.getRange();

        // The marker may already be gone; fall back to the selection so ContextualBalloon
        // can still place a panel here.
        if (range.start.root.rootName === "$graveyard") {
            /* v8 ignore next -- the document selection always holds at least one range, so the `?? range` arm never runs */
            range = this.editor.model.document.selection.getFirstRange() ?? range;
        }

        const viewRange = editing.mapper.toViewRange(range);
        const rects = Rect.getDomRangeRects(editing.view.domConverter.viewRangeToDom(viewRange));

        return rects[rects.length - 1];
    }

    private _positionData(marker: Marker, preferAbove: boolean): Partial<DomOptimalPositionOptions> {
        const editing = this.editor.editing;

        return {
            target: () => this._caretRect(marker),
            limiter: () => {
                const editable = editing.view.document.selection.editableElement;

                /* v8 ignore next -- the editing view selection is inside the root editable whenever the panel is positioned, so the `null` arm only satisfies the limiter's return type */
                return editable ? editing.view.domConverter.mapViewToDom(editable.root) as HTMLElement : null;
            },
            positions: balloonPositions(this._view.position, this.editor.locale.uiLanguageDirection, preferAbove)
        };
    }
}

type TriliumMatchedEvent = {
    name: "matched:data";
    args: [ MarkerMatch<Pattern> & { text: string } ];
};

function isInExistingMention(position: ModelPosition): boolean {
    // The text watcher runs before selection attributes are refreshed, so `selection.hasAttribute`
    // is not usable here — see ckeditor5-engine#1723.
    if (position.textNode?.hasAttribute("mention")) {
        return true;
    }

    const before = position.nodeBefore;
    return !!before && before.is("$text") && before.hasAttribute("mention");
}

function isBeforeExistingMention(markerPosition: ModelPosition): boolean {
    const after = markerPosition.nodeAfter;
    return !!after && after.is("$text") && after.hasAttribute("mention");
}

/**
 * Balloon placement callbacks, anchored to the caret. Lifted from upstream's
 * `getBalloonPanelPositions()`, which is module-private, with each corner slid sideways to stay
 * within the viewport.
 *
 * The position that matched last comes first, so the panel does not jump as the list grows, but the
 * others follow it, so a panel that no longer fits there can move. `preferAbove` puts the corners
 * above the caret first.
 *
 * Exported for its own tests.
 */
export function balloonPositions(preferred: string | undefined, uiLanguageDirection: string, preferAbove = false): DomOptimalPositionOptions["positions"] {
    const below = (target: Rect) => target.bottom + VERTICAL_SPACING;
    const above = (target: Rect, balloon: Rect) => target.top - balloon.height - VERTICAL_SPACING;
    const fromCaret = (target: Rect) => target.right;
    const toCaret = (target: Rect, balloon: Rect) => target.right - balloon.width;

    const positions: Record<string, DomOptimalPositionOptions["positions"][0]> = {
        caret_se: (target, balloon, viewport) => corner("caret_se", below(target), fromCaret(target), balloon, viewport),
        caret_ne: (target, balloon, viewport) => corner("caret_ne", above(target, balloon), fromCaret(target), balloon, viewport),
        caret_sw: (target, balloon, viewport) => corner("caret_sw", below(target), toCaret(target, balloon), balloon, viewport),
        caret_nw: (target, balloon, viewport) => corner("caret_nw", above(target, balloon), toCaret(target, balloon), balloon, viewport)
    };

    const south = uiLanguageDirection !== "rtl" ? [ "caret_se", "caret_sw" ] : [ "caret_sw", "caret_se" ];
    const north = uiLanguageDirection !== "rtl" ? [ "caret_ne", "caret_nw" ] : [ "caret_nw", "caret_ne" ];
    const order = preferAbove ? [ ...north, ...south ] : [ ...south, ...north ];
    if (preferred && order.includes(preferred)) {
        order.splice(order.indexOf(preferred), 1);
        order.unshift(preferred);
    }

    return order.map((name) => positions[name]);
}

function corner(name: string, top: number, left: number, balloon: Rect, viewport: Rect) {
    const fittedLeft = Math.max(viewport.left + VIEWPORT_MARGIN, Math.min(left, viewport.right - VIEWPORT_MARGIN - balloon.width));

    return { top, left: fittedLeft, name, config: { withArrow: false } };
}
