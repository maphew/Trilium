import "./quick_search.css";

import type { FieldEditor } from "@triliumnext/codemirror/src/field_editor";
import { useRef, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { useTriliumEvent } from "./react/hooks";
import SearchStringEditor from "./ribbon/SearchStringEditor";

export default function QuickSearch() {
    const [ searchString, setSearchString ] = useState("");
    const editorRef = useRef<FieldEditor>();

    useTriliumEvent("quickSearch", () => editorRef.current?.focus());

    return (
        <div className="quick-search">
            <SearchStringEditor
                className="search-string"
                currentValue={searchString}
                placeholder={t("quick-search.placeholder")}
                singleLine
                editorRef={editorRef}
                onChange={setSearchString}
                onEnter={() => {}}
            />
        </div>
    );
}
