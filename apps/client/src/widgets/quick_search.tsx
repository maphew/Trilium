import "./quick_search.css";

import type { FieldEditor } from "@triliumnext/codemirror/src/field_editor";
import type { QuickSearchResponse, SearchResultDetails } from "@triliumnext/commons";
import clsx from "clsx";
import { useRef, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { calculateHash, type ViewScope } from "../services/link";
import server from "../services/server";
import { DropdownPanel, type DropdownHandle } from "./react/Dropdown";
import { useTriliumEvent } from "./react/hooks";
import Icon from "./react/Icon";
import RawHtml, { RawHtmlBlock } from "./react/RawHtml";
import SearchStringEditor from "./ribbon/SearchStringEditor";

const INITIAL_DISPLAYED_NOTES = 15;

type SearchState =
    | { status: "searching" }
    | { status: "done", results: SearchResultDetails[], viewScope: ViewScope | undefined };

export default function QuickSearch() {
    const [ searchString, setSearchString ] = useState("");
    const [ searchState, setSearchState ] = useState<SearchState>();
    const editorRef = useRef<FieldEditor>();
    const dropdownRef = useRef<DropdownHandle | null>(null);
    const isOpenRef = useRef(false);
    // Each search takes a number, so a slower earlier response cannot overwrite a later one.
    const requestIdRef = useRef(0);

    useTriliumEvent("quickSearch", () => editorRef.current?.focus());

    async function search() {
        const query = searchString.trim();
        if (!query) {
            dropdownRef.current?.hide();
            return;
        }

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

    return (
        <div className={clsx("quick-search", searchString && "has-query")}>
            <DropdownPanel
                className="quick-search-toggle"
                buttonClassName="search-button"
                dropdownContainerClassName="quick-search-menu"
                text={<Icon icon="bx bx-search" />}
                hideToggleArrow
                noSelectButtonStyle
                placement="bottom-start"
                dropdownRef={dropdownRef}
                onShown={() => {
                    isOpenRef.current = true;
                    void search();
                }}
                onHidden={() => {
                    isOpenRef.current = false;
                }}
            >
                <div className="quick-search-results">
                    <QuickSearchResults
                        searchState={searchState}
                        onOpenResult={() => dropdownRef.current?.hide()}
                    />
                </div>
            </DropdownPanel>

            <SearchStringEditor
                className="search-string"
                currentValue={searchString}
                placeholder={t("quick-search.placeholder")}
                singleLine
                editorRef={editorRef}
                onChange={setSearchString}
                onEnter={() => {
                    // Opening the results runs the search; open results are refreshed.
                    if (isOpenRef.current) {
                        void search();
                    } else {
                        dropdownRef.current?.show();
                    }
                    editorRef.current?.focus();
                }}
                onEscape={() => {
                    if (!isOpenRef.current) return false;
                    dropdownRef.current?.hide();
                    return true;
                }}
            />
        </div>
    );
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

    return searchState.results.slice(0, INITIAL_DISPLAYED_NOTES).map((result) => (
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
            className="dropdown-item"
            tabIndex={0}
            href={calculateHash({ notePath: result.notePath, viewScope })}
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
