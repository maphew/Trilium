import "./FormList.css";

import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";
import { type CSSProperties, useContext, useEffect, useId, useMemo, useRef, useState } from "preact/compat";

import { CommandNames } from "../../components/app_context";
import { handleRightToLeftPlacement, isMobile, openInAppHelpFromUrl } from "../../services/utils";
import FormToggle from "./FormToggle";
import HelpTooltipButton from "./HelpTooltipButton";
import { useStaticTooltip, useSyncedRef } from "./hooks";
import Icon from "./Icon";
import { MenuContext, MenuLevelContext } from "./menu_context";

interface FormListOpts {
    children: ComponentChildren;
    onSelect?: (value: string) => void;
    style?: CSSProperties;
    wrapperClassName?: string;
    fullHeight?: boolean;
}

export default function FormList({ children, onSelect, style, fullHeight, wrapperClassName }: FormListOpts) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!triggerRef.current || !wrapperRef.current) {
            return;
        }

        const $wrapperRef = $(wrapperRef.current);
        const dropdown = BootstrapDropdown.getOrCreateInstance(triggerRef.current);
        $wrapperRef.on("hide.bs.dropdown", (e) => e.preventDefault());

        return () => {
            $wrapperRef.off("hide.bs.dropdown");
            dropdown.dispose();
        };
    }, [ triggerRef, wrapperRef ]);

    const builtinStyles = useMemo(() => {
        const style: CSSProperties = {};
        if (fullHeight) {
            style.height = "100%";
            style.overflow = "auto";
        }
        return style;
    }, [ fullHeight ]);

    return (
        <div className={clsx("dropdownWrapper", wrapperClassName)} ref={wrapperRef} style={builtinStyles}>
            <div className="dropdown" style={builtinStyles}>
                <button
                    ref={triggerRef}
                    type="button" style="display: none;"
                    data-bs-toggle="dropdown" data-bs-display="static" />

                <div class="dropdown-menu static show" style={{
                    ...style ?? {},
                    ...builtinStyles,
                    position: "relative",
                }} onClick={(e) => {
                    const dropdownItem = (e.target as HTMLElement).closest(".dropdown-item") as HTMLElement | null;
                    const value = dropdownItem?.dataset?.value;
                    if (value && onSelect) {
                        onSelect(value);
                    }
                }} onKeyDown={onDropdownMenuKeyDown}>
                    {children}
                </div>
            </div>
        </div>
    );
}

/**
 * Activates the currently focused list item on Enter/Space, so the list is keyboard-operable
 * and not mouse-only. The focused item is "clicked" to reuse the existing item- and list-level
 * click handlers (e.g. {@link FormList}'s `onSelect`, toggle items).
 */
function onDropdownMenuKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") {
        return;
    }

    const target = e.target as HTMLElement;

    const dropdownItem = target.closest(".dropdown-item") as HTMLElement | null;
    if (!dropdownItem || dropdownItem.classList.contains("disabled")) {
        return;
    }

    // Let interactive elements nested inside the item (inputs, buttons, links, anything
    // focusable) handle their own Enter/Space instead of hijacking it for the parent item.
    const interactive = target.closest("input, textarea, select, button, a, [tabindex]");
    if (interactive && interactive !== dropdownItem) {
        return;
    }

    e.preventDefault();
    dropdownItem.click();
}

export interface FormListBadge {
    className?: string;
    text: string;
}

export interface FormListItemOpts {
    children: ComponentChildren;
    icon?: string;
    /** Extra class for the icon itself, e.g. to hang a marker off its corner. */
    iconClassName?: string;
    value?: string;
    title?: string;
    active?: boolean;
    badges?: FormListBadge[];
    disabled?: boolean;
    /** Will indicate the reason why the item is disabled via an icon, when hovered over it. */
    disabledTooltip?: string;
    checked?: boolean | null;
    selected?: boolean;
    container?: boolean;
    onClick?: (e: MouseEvent) => void;
    triggerCommand?: CommandNames;
    description?: string;
    className?: string;
    rtl?: boolean;
    postContent?: ComponentChildren;
    itemRef?: RefObject<HTMLLIElement>;
}

const TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    placement: handleRightToLeftPlacement("right"),
    fallbackPlacements: [ handleRightToLeftPlacement("right") ],
    animation: false
};

export function FormListItem({ className, icon, iconClassName, value, title, active, disabled, checked, container, onClick, selected, rtl, triggerCommand, description, itemRef: externalItemRef, ...contentProps }: FormListItemOpts) {
    const itemRef = useSyncedRef<HTMLLIElement>(externalItemRef, null);

    if (checked) {
        icon = "bx bx-check";
    }

    useStaticTooltip(itemRef, TOOLTIP_CONFIG);

    return (
        <li
            ref={itemRef}
            class={`dropdown-item ${active ? "active" : ""} ${disabled ? "disabled" : ""} ${selected ? "selected" : ""} ${container ? "dropdown-container-item": ""} ${className ?? ""}`}
            data-value={value} title={title}
            tabIndex={container ? -1 : 0}
            onClick={onClick}
            data-trigger-command={triggerCommand}
            dir={rtl ? "rtl" : undefined}
        >
            <Icon icon={icon} className={iconClassName} />&nbsp;
            {description ? (
                <div>
                    <FormListContent description={description} disabled={disabled} {...contentProps} />
                </div>
            ) : (
                <FormListContent description={description} disabled={disabled} {...contentProps} />
            )}
        </li>
    );
}

export function FormListToggleableItem({
    title, currentValue, onChange, disabled, helpPage, helpTooltip, ...props
}: Omit<FormListItemOpts, "onClick" | "children"> & {
    title: string;
    currentValue: boolean;
    helpPage?: string;
    /** What the setting does, shown on hover. Unlike {@link helpPage}, it opens nothing. */
    helpTooltip?: string;
    onChange(newValue: boolean): void | Promise<void>;
}) {
    const isWaiting = useRef(false);

    return (
        <FormListItem
            {...props}
            disabled={disabled}
            onClick={async (e) => {
                if ((e.target as HTMLElement | null)?.classList.contains("contextual-help")) {
                    return;
                }

                e.stopPropagation();
                if (!disabled && !isWaiting.current) {
                    isWaiting.current = true;
                    await onChange(!currentValue);
                    isWaiting.current = false;
                }
            }}>
            <FormToggle
                switchOnName={title}
                switchOffName={title}
                currentValue={currentValue}
                onChange={() => {}}
                afterName={<>
                    {helpPage && (
                        <span
                            class="bx bx-help-circle contextual-help"
                            onClick={() => openInAppHelpFromUrl(helpPage)}
                        />
                    )}
                    {helpTooltip && <HelpTooltipButton description={helpTooltip} />}
                    <span class="switch-spacer" />
                </>}
            />
        </FormListItem>
    );
}

function FormListContent({ children, badges, description, disabled, disabledTooltip }: Pick<FormListItemOpts, "children" | "badges" | "description" | "disabled" | "disabledTooltip">) {
    return <>
        {children}
        {badges && badges.map(({ className, text }) => (
            <span className={`badge ${className ?? ""}`}>{text}</span>
        ))}
        {disabled && disabledTooltip && (
            <span class="bx bx-info-circle contextual-help" title={disabledTooltip} />
        )}
        {description && <div className="description">{description}</div>}
    </>;
}

interface FormListHeaderOpts {
    /** Usually a heading, but anything a group can be introduced by: a summary, a row of marks. */
    text: ComponentChildren;
    /** Optional element rendered right-aligned in the header (e.g. an edit action). */
    action?: ComponentChildren;
}

export function FormListHeader({ text, action }: FormListHeaderOpts) {
    // Its heading speaks for the row, which a menu does not count among its items.
    return (
        <li role="none">
            <h6 className={clsx("dropdown-header", action && "dropdown-header-with-action")}>
                <span>{text}</span>
                {action}
            </h6>
        </li>
    );
}

/** A line between groups of rows. A click on it closes no menu. */
export function FormDropdownDivider() {
    return <li className="dropdown-divider" role="separator" onClick={(e) => e.stopPropagation()} />;
}

export function FormDropdownSubmenu({ icon, title, children, dropStart, onDropdownToggleClicked }: {
    icon: string,
    title: ComponentChildren,
    children: ComponentChildren,
    onDropdownToggleClicked?: (e: MouseEvent) => void,
    dropStart?: boolean
}) {
    const [ openOnMobile, setOpenOnMobile ] = useState(false);

    return (
        <li className={clsx("dropdown-item dropdown-submenu", { "submenu-open": openOnMobile, "dropstart": dropStart })}>
            <span
                className="dropdown-toggle"
                onClick={(e) => {
                    e.stopPropagation();

                    if (isMobile()) {
                        setOpenOnMobile(!openOnMobile);
                    } else if (onDropdownToggleClicked) {
                        onDropdownToggleClicked(e);
                    }
                }}
            >
                <Icon icon={icon} />
                &nbsp;
                {title}
            </span>

            <ul className={`dropdown-menu ${openOnMobile ? "show" : ""}`}>
                {children}
            </ul>
        </li>
    );
}

/**
 * A row holding a control of its own, such as the color picker. The keys stand on it when its
 * content marks a way in with `tabindex="0"`, and a click on something in it that acts closes the
 * menu it stands in.
 */
export function FormListCustomItem({ children }: { children: ComponentChildren }) {
    // Outside a `Menu`, as in a dropdown's plain list, there is none to join.
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    const id = useId();

    return (
        <li
            className="dropdown-custom-item"
            // Its content carries the roles of what it acts with.
            role="none"
            ref={(element) => {
                menu?.registerRow(id, element
                    ? { level, element, custom: true, disabled: false, hasSubmenu: false, select: () => {} }
                    : undefined);
            }}
            // Only a click on what the row acts with closes the menu: one in the space around it,
            // such as between the color picker's cells, picks nothing.
            onClick={(e) => {
                if (menu && actsOnClick(e.target, e.currentTarget)) menu.close();
            }}
        >
            {children}
        </li>
    );
}

/** What a custom row's content acts with: the elements a click on does something. */
const ACTING_ELEMENTS = "button, a[href], input, select, textarea, [tabindex], "
    + "[role='button'], [role='option'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch']";

/** Whether a click on `target` inside `row` landed on an enabled element that acts. */
function actsOnClick(target: EventTarget | null, row: HTMLElement) {
    const acting = target instanceof Element ? target.closest(ACTING_ELEMENTS) : null;
    return !!acting && row.contains(acting) && acting !== row
        && acting.getAttribute("aria-disabled") !== "true" && !acting.matches(":disabled");
}
