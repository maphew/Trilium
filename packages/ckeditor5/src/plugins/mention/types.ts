import type { Editor, MentionFeedObjectItem } from "ckeditor5";
import type { MentionFeed } from "ckeditor5";

/**
 * The extra per-feed knobs {@link TriliumMentionUI} understands, merged into upstream's
 * `MentionFeed` so that `EditorConfig["mention"].feeds` accepts them directly at every call site.
 *
 * The augmentation targets `@ckeditor/ckeditor5-mention` rather than `ckeditor5`, because the
 * umbrella package is a pure re-export barrel and augmenting it would declare a new interface
 * instead of merging into the existing one. It lives in this module — reachable from the package
 * entry point via the `TriliumMentionFeed` re-export — rather than in `augmentation.ts`, whose
 * `declare global` block would then leak this package's narrower `glob` type into consumers.
 */
declare module "@ckeditor/ckeditor5-mention" {
    interface MentionFeed {
        /**
         * Whether the query may contain spaces. Note titles do (`@My meeting notes`), attribute
         * names never do — and allowing them there means `#foo bar baz` keeps matching forever, so
         * the panel can never close on its own. Defaults to `false`.
         */
        allowSpaces?: boolean;

        /**
         * Whether the first suggestion is highlighted as soon as the panel opens, so that Enter
         * commits it. Defaults to `true`, matching upstream. The attribute editor turns it off:
         * there Enter means "save the attributes", and a panel that pre-selects an item silently
         * hijacks it.
         */
        preselectFirstItem?: boolean;

        /**
         * What to do when the user picks an item, called with the trigger text (the marker and the
         * query) already removed and the selection collapsed in its place.
         *
         * Feeds that omit it fall back to `editor.execute( "mention", … )`, which is what upstream
         * always does and what the `@`/`#`/`~` feeds rely on. Feeds that insert something other than
         * a mention — an emoji, a heading — provide it instead of piggy-backing on the `mention`
         * command, so they neither depend on nor have to work around `CustomMentionCommand`.
         */
        commit?: ( editor: Editor, item: MentionFeedObjectItem ) => void;
    }
}

/**
 * A mention feed as {@link TriliumMentionUI} consumes it — an alias for the augmented `MentionFeed`
 * that exists to name the Trilium-flavoured shape at call sites.
 */
export type TriliumMentionFeed = MentionFeed;
