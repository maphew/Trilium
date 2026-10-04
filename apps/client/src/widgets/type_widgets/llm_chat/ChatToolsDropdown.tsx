import "./ChatToolsDropdown.css";

import clsx from "clsx";

import { t } from "../../../services/i18n.js";
import Dropdown from "../../react/Dropdown.js";
import { FormListToggleableItem } from "../../react/FormList.js";

/**
 * The Tools menu of the chat input bar: one switch per group of tools the model can reach this
 * turn. Each row stops its click, so the menu stays open while several are flipped.
 */
export default function ChatToolsDropdown({ enableNoteTools, enableWebSearch, onNoteToolsChange, onWebSearchChange, webSearchUnavailableReason, disabled }: {
    enableNoteTools: boolean;
    enableWebSearch: boolean;
    onNoteToolsChange: (newValue: boolean) => void;
    onWebSearchChange: (newValue: boolean) => void;
    /** Why web search can't be used with the current model and settings, if it can't. */
    webSearchUnavailableReason?: string;
    disabled?: boolean;
}) {
    const webSearchActive = enableWebSearch && !webSearchUnavailableReason;
    const anyActive = enableNoteTools || webSearchActive;

    return (
        <Dropdown
            buttonClassName={clsx("bx bx-shield-quarter llm-chat-capability llm-chat-tools-button", anyActive && "active")}
            className="llm-chat-tools"
            title={t("llm_chat.tools")}
            titlePosition="top"
            placement="top-start"
            iconAction
            hideToggleArrow
            noSelectButtonStyle
            disabled={disabled}
        >
            <FormListToggleableItem
                icon="bx bx-note"
                title={t("llm_chat.note_tools")}
                description={t("llm_chat.note_tools_description")}
                currentValue={enableNoteTools}
                onChange={onNoteToolsChange}
            />
            <FormListToggleableItem
                icon="bx bx-globe"
                title={t("llm_chat.web_search")}
                description={webSearchUnavailableReason ?? t("llm_chat.web_search_description")}
                currentValue={webSearchActive}
                onChange={onWebSearchChange}
                disabled={!!webSearchUnavailableReason}
            />
        </Dropdown>
    );
}
