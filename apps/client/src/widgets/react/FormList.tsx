import "./FormList.css";

import type { KeyboardActionNames } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";
import { type CSSProperties, useContext, useEffect, useId, useMemo, useRef, useState } from "preact/compat";

import { CommandNames } from "../../components/app_context";
import { getActionSync } from "../../services/keyboard_actions";
import { handleRightToLeftPlacement, isMobile, openInAppHelpFromUrl } from "../../services/utils";
import FormToggle from "./FormToggle";
import HelpTooltipButton from "./HelpTooltipButton";
import { useStaticTooltip, useSyncedRef } from "./hooks";
import Icon from "./Icon";
import { MenuContext, MenuLevelContext, pointerMoved } from "./menu_context";
import { joinElements } from "./react_utils";
import { renderShortcutKbds } from "./shortcut_kbd";

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
    /** Without one the row keeps a blank slot, lining it up with the rows that have one; `null` leaves no slot. */
    icon?: string | null;
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
    /**
     * Makes the row one that is checked or not, which a menu tells assistive technology;
     * {@link checked} says which.
     */
    checkable?: boolean;
    /**
     * Inside a menu, whether running the row closes the menu before its {@link onClick} runs. It
     * does unless this is `false`, for a caller that decides for itself, as `contextMenu` does.
     */
    closeOnSelect?: boolean;
    /** The action whose shortcuts, as the user configured them, show at the end of the row. */
    keyboardShortcut?: KeyboardActionNames;
    /** A shortcut shown as it is written, for a row with no action of its own. */
    shortcut?: string;
    /**
     * An icon at the end of the row, where a shortcut would go. Unlike {@link checked}, which takes
     * the place of {@link icon}, this leaves the row's own icon standing, for a list where that icon
     * is what tells one row from another.
     */
    trailingIcon?: string;
}

/** What in a row takes focus from a press: the controls that are typed into. */
const TEXT_ENTRY = "input:not([type='checkbox'], [type='radio']), textarea, select, [contenteditable='true']";

const TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    placement: handleRightToLeftPlacement("right"),
    fallbackPlacements: [ handleRightToLeftPlacement("right") ],
    animation: false
};

export function FormListItem({ className, icon, iconClassName, value, title, active, disabled, checked, checkable, container, onClick, selected, rtl, triggerCommand, description, itemRef: externalItemRef, keyboardShortcut, shortcut, trailingIcon, closeOnSelect, ...contentProps }: FormListItemOpts) {
    const itemRef = useSyncedRef<HTMLLIElement>(externalItemRef, null);
    // Inside a `Menu` the row is one of its items; elsewhere, as in a dropdown, it stands alone.
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    const id = useId();
    const isActive = menu?.active?.id === id;

    /**
     * Runs the row for the keys, as a click would, with the modifiers of the key that ran it, so
     * Ctrl+Enter does what a Ctrl+click does.
     */
    function select(e: MouseEvent | KeyboardEvent) {
        if (closeOnSelect !== false) menu?.close();
        onClick?.(new MouseEvent("click", { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }));
    }

    function onPointed(e: { currentTarget: HTMLLIElement }) {
        if (!menu || isMobile()) return;
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) menu.setActive(level, id);
        menu.openSubmenu(level, undefined, e.currentTarget);
    }

    if (checked) {
        icon = "bx bx-check";
    }

    useStaticTooltip(itemRef, TOOLTIP_CONFIG);

    return (
        <li
            ref={(element) => {
                itemRef.current = element;
                menu?.registerRow(id, element
                    ? { level, element, custom: false, disabled: !!disabled, hasSubmenu: false, select }
                    : undefined);
            }}
            id={menu ? id : undefined}
            class={clsx("dropdown-item", active && "active", disabled && "disabled", selected && "selected",
                container && "dropdown-container-item", isActive && "tn-menu-active", className)}
            data-value={value} title={title}
            role={menu ? (checkable ? "menuitemcheckbox" : "menuitem") : undefined}
            aria-checked={menu && checkable ? !!checked : undefined}
            aria-disabled={(menu && disabled) || undefined}
            // A menu keeps focus itself and marks the row its keys act on instead.
            tabIndex={menu ? undefined : container ? -1 : 0}
            // While the keys drive the menu, a row entered by a pointer at rest, as when the menu
            // appears under it, keeps the keys' row. See `pointerMoved`.
            onPointerEnter={menu ? (e) => {
                if (!menu.keyboardDriven) onPointed(e);
            } : undefined}
            // The keys can move the active row from under a pointer at rest, whose `:hover` would
            // then mark a second row. The next move of the pointer makes its row the active one.
            onPointerMove={menu ? (e) => {
                if (!isActive && pointerMoved(e)) onPointed(e);
            } : undefined}
            // A press keeps focus where it was, as in a native menu: a text editor keeps the
            // selection a command such as a spelling fix acts on, and a field beside a dropdown
            // stays in focus. A field inside the row takes focus as it would anywhere.
            onMouseDown={(e) => {
                if (e.button === 0 && !(e.target instanceof Element && e.target.closest(TEXT_ENTRY))) e.preventDefault();
            }}
            // The row runs on the release, so a press can still be taken back by moving off.
            onClick={(e) => {
                if (disabled) return;
                if (closeOnSelect !== false) menu?.close();
                onClick?.(e);
            }}
            data-trigger-command={triggerCommand}
            dir={rtl ? "rtl" : undefined}
        >
            {/* One classless span holds the row, as the rows of a menu are laid out. */}
            <span>
                {icon === null ? <span /> : <Icon icon={icon} className={iconClassName} />}
                {/* An element, not spaces: in a flex row, text merges with a plain title but is
                    trimmed before one boxed by `menuName()`, indenting the two kinds of row apart. */}
                <span className="tn-menu-gap" />
                {description ? (
                    <div>
                        <FormListContent description={description} disabled={disabled} {...contentProps} />
                    </div>
                ) : (
                    <FormListContent description={description} disabled={disabled} {...contentProps} />
                )}
                <FormListShortcut keyboardShortcut={keyboardShortcut} shortcut={shortcut} />
                {trailingIcon && <span className={clsx(trailingIcon, "tn-icon", "menu-trailing-icon")} />}
            </span>
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
            <span className={clsx("badge", className)}>{text}</span>
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

/**
 * The shortcuts of the row's `keyboardShortcut` action as the user configured them, or else its
 * literal `shortcut`. Read synchronously, so the menu is placed at its final width.
 */
function FormListShortcut({ keyboardShortcut, shortcut }: Pick<FormListItemOpts, "keyboardShortcut" | "shortcut">) {
    if (keyboardShortcut) {
        const shortcuts = getActionSync(keyboardShortcut)?.effectiveShortcuts;
        if (!shortcuts?.length) return null;
        return (
            <span className="keyboard-shortcut">
                {joinElements(shortcuts.map(shortcut => renderShortcutKbds(shortcut)), ",")}
            </span>
        );
    }

    return shortcut ? <kbd>{shortcut}</kbd> : null;
}
