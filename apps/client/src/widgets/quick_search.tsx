import "./quick_search.css";

import type { FieldEditor } from "@triliumnext/codemirror/src/field_editor";
import type { QuickSearchResponse, SearchResultDetails } from "@triliumnext/commons";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { calculateHash, type ViewScope } from "../services/link";
import server from "../services/server";
import ActionButton from "./react/ActionButton";
import { focusListItem } from "./react/FormList";
import { useTriliumEvent } from "./react/hooks";
import Icon from "./react/Icon";
import Popup from "./react/Popup";
import RawHtml, { RawHtmlBlock } from "./react/RawHtml";
import SearchStringEditor from "./ribbon/SearchStringEditor";

type SearchState =
    | { status: "searching" }
    | { status: "done", results: SearchResultDetails[], viewScope: ViewScope | undefined };

export default function QuickSearch() {
    // In a ref rather than state, so typing re-renders nothing; only its emptiness is state.
    const searchStringRef = useRef("");
    const [ hasQuery, setHasQuery ] = useState(false);
    const [ searchState, setSearchState ] = useState<SearchState>();
    const [ open, setOpen ] = useState(false);
    const editorRef = useRef<FieldEditor>();
    const boxRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    // Each search takes a number, so a slower earlier response cannot overwrite a later one.
    const requestIdRef = useRef(0);

    useTriliumEvent("quickSearch", () => editorRef.current?.focus());
    useResultNavigation(popupRef, open, () => editorRef.current?.focus());

    /** Opens the results with a search for the query, or refreshes the open results. */
    async function search() {
        const query = searchStringRef.current.trim();
        if (!query) {
            close();
            return;
        }

        setOpen(true);
        const requestId = ++requestIdRef.current;
        setSearchState({ status: "searching" });
        const { searchResults, highlightedTokens } = await server.get<QuickSearchResponse>(
            `quick-search/${encodeURIComponent(query)}`
        );
        if (requestId !== requestIdRef.current) return;

        setSearchState({
            status: "done",
            results: searchResults,
            // Opens the note at its first match; with nothing highlighted, at the plain path.
            viewScope: highlightedTokens.length ? { searchTerms: highlightedTokens } : undefined
        });
    }

    function close() {
        // Focus on a result goes back to the field, rather than to the page's body.
        if (popupRef.current?.contains(document.activeElement)) editorRef.current?.focus();
        setOpen(false);
    }

    return (
        <div className={clsx("quick-search", hasQuery && "has-query")}>
            <div ref={boxRef} className="quick-search-box">
                <ActionButton
                    className="search-button"
                    icon="bx bx-search"
                    text={t("quick-search.placeholder")}
                    noIconActionClass
                    active={open}
                    onClick={() => (open ? close() : void search())}
                />

                <SearchStringEditor
                    className="search-string"
                    placeholder={t("quick-search.placeholder")}
                    singleLine
                    editorRef={editorRef}
                    onChange={(value) => {
                        searchStringRef.current = value;
                        setHasQuery(value.length > 0);
                    }}
                    onEnter={() => void search()}
                    onArrowDown={() => {
                        const popup = popupRef.current;
                        if (!popup || !firstResult(popup)) return false;
                        focusListItem(popup, "first");
                        return true;
                    }}
                />
            </div>

            {open && boxRef.current && (
                <Popup
                    anchor={boxRef.current}
                    placement="bottom-start"
                    offset={2}
                    capHeight={false}
                    className="dropdown-menu show tn-dropdown-menu quick-search-menu"
                    elementRef={popupRef}
                    onDismiss={close}
                >
                    <div className="quick-search-results">
                        <QuickSearchResults searchState={searchState} onOpenResult={close} />
                    </div>
                </Popup>
            )}
        </div>
    );
}

/**
 * Moves focus between the results with Up and Down, and from the first result up to the field.
 * Captured at the window, as Bootstrap's handler for keys in a `.dropdown-menu` crashes on one with
 * no toggle beside it.
 */
function useResultNavigation(
    popupRef: RefObject<HTMLElement>,
    open: boolean,
    focusField: () => void
) {
    const focusFieldRef = useRef(focusField);
    focusFieldRef.current = focusField;

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            const popup = popupRef.current;
            const target = e.target as Element;
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (!popup?.contains(target)) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "ArrowUp" && target.closest(".dropdown-item") === firstResult(popup)) {
                focusFieldRef.current();
            } else {
                focusListItem(popup, e.key === "ArrowDown" ? "next" : "previous", target);
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ open ]);
}

/** The first result focus can move to; the searching and no-results rows are disabled. */
function firstResult(popup: HTMLElement) {
    return popup.querySelector(".dropdown-item:not(.disabled)");
}

function QuickSearchResults({ searchState, onOpenResult }: {
    searchState: SearchState | undefined;
    onOpenResult(): void;
}) {
    if (!searchState) return null;

    if (searchState.status === "searching") {
        return (
            <span className="dropdown-item disabled">
                <Icon icon="bx bx-loader bx-spin" />
                {t("quick-search.searching")}
            </span>
        );
    }

    if (!searchState.results.length) {
        return <span className="dropdown-item disabled">{t("quick-search.no-results")}</span>;
    }

    return searchState.results.map((result) => (
        <QuickSearchResult
            key={result.notePath}
            result={result}
            viewScope={searchState.viewScope}
            onOpen={onOpenResult}
        />
    ));
}

function QuickSearchResult({ result, viewScope, onOpen }: {
    result: SearchResultDetails;
    viewScope: ViewScope | undefined;
    onOpen(): void;
}) {
    return (
        <a
            className="dropdown-item no-tooltip-preview"
            tabIndex={0}
            href={calculateHash({ notePath: result.notePath, viewScope })}
            onClick={onOpen}
            onAuxClick={onOpen}
        >
            <div className="quick-search-item">
                <div className="quick-search-item-header">
                    <Icon icon={result.icon} className="quick-search-item-icon" />
                    <RawHtml
                        className="search-result-title"
                        html={result.highlightedNotePathTitle ?? result.notePathTitle}
                    />
                </div>

                {result.highlightedAttributeSnippet && (
                    // The attributes share one line, so the line breaks between them become spaces.
                    <RawHtmlBlock
                        className="search-result-attributes"
                        html={result.highlightedAttributeSnippet.replace(/<br\s?\/?>/g, " ")}
                    />
                )}

                {result.highlightedContentSnippet && (
                    <RawHtmlBlock
                        className="search-result-content"
                        html={result.highlightedContentSnippet}
                    />
                )}
            </div>
        </a>
    );
}
