import "./ChatToolsDropdown.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";

import appContext from "../../../components/app_context.js";
import { t } from "../../../services/i18n.js";
import type { SearchProviderOption, WebSearchState } from "../../../services/llm_providers.js";
import Dropdown from "../../react/Dropdown.js";
import { FormDropdownDivider, FormListHeader, FormListItem, FormListToggleableItem } from "../../react/FormList.js";
import Icon from "../../react/Icon.js";
import MaskedIcon from "../../react/MaskedIcon.js";
import { providerIconUrl, SEARCH_PROVIDER_ICON } from "../options/llm/provider_icons.js";

/**
 * The Tools menu of the chat input bar: what the model can reach this turn, one section per group
 * of tools. Its rows leave the menu open, so several can be changed in one visit. Its toggle
 * shares the compact combo box styling of the model picker beside it.
 */
export default function ChatToolsDropdown({ enableNoteTools, onNoteToolsChange, modelProvider, webSearch, searchProviders, onWebSearchChoose, disabled }: {
    enableNoteTools: boolean;
    /** The provider type of the current model, whose mark stands for its built-in search. */
    modelProvider: string | undefined;
    onNoteToolsChange: (newValue: boolean) => void;
    webSearch: WebSearchState;
    searchProviders: SearchProviderOption[];
    /** Called with `"disabled"`, `"builtin"` or the config id of a search provider. */
    onWebSearchChoose: (choice: string) => void;
    disabled?: boolean;
}) {
    const anyActive = enableNoteTools || webSearch.enableWebSearch;
    const searchProviderUnavailable = webSearch.searchProviderUnavailableKey && t(webSearch.searchProviderUnavailableKey);

    return (
        <Dropdown
            text={<Icon icon="bx bx-shield-quarter" className={clsx("llm-chat-tools-icon", anyActive && "llm-chat-tools-on")} />}
            buttonClassName="llm-chat-model-select llm-chat-tools-button"
            className="llm-chat-tools"
            title={t("llm_chat.tools")}
            titlePosition="top"
            placement="top-start"
            disabled={disabled}
        >
            <FormListToggleableItem
                icon="bx bx-note"
                title={t("llm_chat.note_tools")}
                description={t("llm_chat.note_tools_description")}
                currentValue={enableNoteTools}
                onChange={onNoteToolsChange}
            />

            <FormDropdownDivider />
            <FormListHeader text={t("llm_chat.web_search")} />
            <WebSearchChoice choice="disabled" webSearch={webSearch} onChoose={onWebSearchChoose}>
                <Icon icon="bx bx-block" className="llm-chat-tools-choice-icon" />
                {t("llm_chat.web_search_disabled")}
            </WebSearchChoice>
            <WebSearchChoice
                choice="builtin"
                webSearch={webSearch}
                onChoose={onWebSearchChoose}
                unavailableReason={webSearch.builtInUnavailableKey && t(webSearch.builtInUnavailableKey)}
            >
                {modelProvider
                    ? <MaskedIcon url={providerIconUrl(modelProvider)} className="llm-chat-tools-choice-icon" />
                    : <Icon icon="bx bx-globe" className="llm-chat-tools-choice-icon" />}
                {t("llm_chat.web_search_builtin")}
            </WebSearchChoice>
            {searchProviders.map(provider => (
                <WebSearchChoice
                    key={provider.id}
                    choice={provider.id}
                    webSearch={webSearch}
                    onChoose={onWebSearchChoose}
                    unavailableReason={searchProviderUnavailable}
                >
                    <MaskedIcon url={SEARCH_PROVIDER_ICON} className="llm-chat-tools-choice-icon" />
                    {provider.name}
                </WebSearchChoice>
            ))}
            <FormListItem
                icon="bx bx-cog"
                onClick={() => appContext.triggerCommand("showOptions", { section: "_optionsLlm" })}
            >
                {t("llm_chat.manage_search_providers")}
            </FormListItem>
        </Dropdown>
    );
}

/**
 * One choice of the web search section. A choice the current model can't use stays listed,
 * disabled, with the reason on an info icon beside it; the marked one is shown as such either way.
 */
function WebSearchChoice({ choice, webSearch, onChoose, unavailableReason, children }: {
    choice: string;
    webSearch: WebSearchState;
    onChoose: (choice: string) => void;
    unavailableReason?: string;
    children: ComponentChildren;
}) {
    return (
        <FormListItem
            checkable
            checked={webSearch.choice === choice}
            disabled={!!unavailableReason}
            disabledTooltip={unavailableReason}
            closeOnSelect={false}
            onClick={() => onChoose(choice)}
        >
            {children}
        </FormListItem>
    );
}
