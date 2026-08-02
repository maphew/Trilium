import "./MindMapNodeMemo.css";

import { AttributeEditor, CHAT_INPUT_PLUGINS, type CKTextEditor, type EditorConfig } from "@triliumnext/ckeditor5";
import type { NodeObj } from "mind-elixir";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import { escapeHtml } from "../../services/utils";
import CKEditor, { type CKEditorApi } from "../react/CKEditor";

/**
 * The memo a node carries: text kept about it, which the map itself never shows.
 *
 * Written as the field is left rather than as it is typed, which is what the textarea it replaces
 * did: a memo is written a paragraph at a time, and taking every keystroke would mean a copy of the
 * whole map in the undo stack for each of them.
 */
export default function MindMapNodeMemo({ selectionKey, memo, readOnly, onCommit }: {
    /**
     * What the panel currently stands for. The field is one editor for however many nodes are
     * selected over its lifetime, so it is told when that changes: the memo shown is the memo of
     * whatever is selected now, and what was typed for what came before belongs to those nodes.
     */
    selectionKey: string;
    memo: string | null;
    readOnly: boolean;
    onCommit(html: string): void;
}) {
    const apiRef = useRef<CKEditorApi>();
    const editorRef = useRef<CKTextEditor>(null);
    const html = toMemoHtml(memo);
    // Both are stamped with the selection they belong to: what the field was handed, and what it
    // holds now. The editor reports a change for a memo handed to it as readily as for one typed,
    // so without the stamp the memo of a node just selected passes for something typed for the one
    // just left — and is written over it.
    const shown = useRef({ key: selectionKey, html });
    const typed = useRef(shown.current);
    // The selection as it stands while the editor is reporting, which is a render behind the refs.
    const currentKey = useRef(selectionKey);
    currentKey.current = selectionKey;

    function commit(key: string) {
        if (readOnly || typed.current.key !== key || typed.current.html === shown.current.html) return;
        shown.current = typed.current;
        onCommit(typed.current.html);
    }

    /*
     * Taken up as the selection changes, and written back before it does.
     *
     * A layout effect rather than a plain one: its cleanup then runs within the same commit, ahead
     * of the editor being handed the new memo — which is a plain effect of the field below, and
     * would otherwise land first and take what was typed with it.
     */
    useLayoutEffect(() => {
        shown.current = { key: selectionKey, html };
        typed.current = shown.current;
        // Said outright rather than left to the field to notice: it sets what it is given only when
        // that differs from what it was given last, and two nodes carrying the same memo — no memo
        // at all, most of the time — are the same value. Whatever was typed for the node just left
        // would then simply stay on the page as the memo of the one just selected.
        apiRef.current?.setText(html);

        return () => commit(selectionKey);
    }, [ selectionKey ]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        if (readOnly) {
            editor.enableReadOnlyMode(MEMO_READ_ONLY_LOCK);
        } else {
            editor.disableReadOnlyMode(MEMO_READ_ONLY_LOCK);
        }
    }, [ readOnly ]);

    return (
        <CKEditor
            apiRef={apiRef}
            className="mind-map-node-memo"
            editor={AttributeEditor}
            config={MEMO_EDITOR_CONFIG}
            currentValue={html}
            onChange={(html) => (typed.current = { key: currentKey.current, html: html ?? "" })}
            onInitialized={(editor) => {
                editorRef.current = editor;
                if (readOnly) {
                    editor.enableReadOnlyMode(MEMO_READ_ONLY_LOCK);
                }

                // The editor's own account of being left: a `blur` of the box it writes into does
                // not reach the element around it, so there is nothing there to listen for.
                editor.ui.focusTracker.on("change:isFocused", (_event, _name, isFocused) => {
                    if (!isFocused) commit(currentKey.current);
                });
            }}
        />
    );
}

/** Kept still, so that the editor is not configured anew every time the panel renders. */
const MEMO_EDITOR_CONFIG: EditorConfig = {
    // The markdown autoformatting the chat box has — quotes, code, lists, links — and no toolbar.
    extraPlugins: CHAT_INPUT_PLUGINS,
    toolbar: { items: [] },
    licenseKey: "GPL",
    language: "en"
};

/** Held while the selection disagrees, there being no one memo to write over the others. */
const MEMO_READ_ONLY_LOCK = "mind-map-node-memo";

/**
 * A node's memo: what the node menu Trilium used to carry wrote into `nodeObj.memo`, from a plain
 * textarea, and what maps made since then hold.
 *
 * Mind Elixir neither declares the field nor renders it — it survives only because everything but a
 * node's parent is serialized — and the `note` it does declare is a different field the menu never
 * wrote. Keeping to `memo` is what keeps those memos the ones being read and written here.
 */
export function getNodeMemo(node: NodeObj) {
    return (node as NodeObj & { memo?: string }).memo;
}

/**
 * The memo as the editor takes it.
 *
 * A memo written through the old textarea is plain text, so one carrying no markup at all is
 * escaped into paragraphs rather than read as HTML — otherwise a `<` someone typed would swallow
 * what follows it, and the memo would come back shorter than it was written.
 */
export function toMemoHtml(memo: string | null | undefined) {
    if (!memo) return "";
    if (/<[a-z][\s\S]*>/i.test(memo)) return memo;

    return memo.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}
