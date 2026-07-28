import "./HelpDropdown.css";

import { ComponentChildren } from "preact";

import { t } from "../../services/i18n";
import { openInAppHelpFromUrl } from "../../services/utils";
import Dropdown from "./Dropdown";
import LinkButton from "./LinkButton";

interface HelpDropdownProps {
    /** The help content itself, rendered inside the popup. */
    children: ComponentChildren;
    /** In-app help note ID; when set, a link to the full help page is appended below the content. */
    helpPage?: string;
    className?: string;
    /** Called as the popup opens, for hosts that need to dismiss their own popups first. */
    onShown?: () => void;
}

/**
 * A `?` icon button revealing a popup with inline help, optionally linking to the full help page.
 *
 * Prefer this over {@link HelpButton} when there is a short explanation worth showing in place, and
 * over a Bootstrap tooltip whenever the help is more than a few words: the popup is dismissed
 * explicitly (click outside or <kbd>Escape</kbd>) instead of on blur, so its content stays readable
 * and selectable.
 */
export default function HelpDropdown({ children, helpPage, className, onShown }: HelpDropdownProps) {
    return (
        <Dropdown
            onShown={onShown}
            className={`help-dropdown ${className ?? ""}`}
            buttonClassName="bx bx-question-mark"
            dropdownContainerClassName="help-dropdown-content"
            title={t("show-help")}
            iconAction
            hideToggleArrow
            noSelectButtonStyle
            noDropdownListStyle
            // Hosts like the ribbon establish their own stacking context (`.ribbon-container` sits at
            // z-index 998), which would clamp the popup below the body-level widgets it overlaps —
            // e.g. the attribute detail at 1000. Rendering into the body lets its z-index actually apply.
            portalToBody
        >
            {children}

            {helpPage && (
                <LinkButton
                    text={t("open-help-page")}
                    onClick={() => void openInAppHelpFromUrl(helpPage)}
                />
            )}
        </Dropdown>
    );
}
