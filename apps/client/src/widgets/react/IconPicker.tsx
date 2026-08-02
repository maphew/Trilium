import "./IconPicker.css";

import { IconRegistry } from "@triliumnext/commons";
import clsx from "clsx";
import { CSSProperties } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type React from "react";
import { CellComponentProps, Grid } from "react-window";

import { t } from "../../services/i18n";
import server from "../../services/server";
import { isDesktop, isMobile } from "../../services/utils";
import ActionButton from "./ActionButton";
import Dropdown from "./Dropdown";
import { FormDropdownDivider, FormListItem } from "./FormList";
import FormTextBox from "./FormTextBox";
import { useStaticTooltip } from "./hooks";

/** The room one icon takes in the grid, which also decides how many fit across a given width. */
export const ICON_SIZE = isMobile() ? 56 : 48;

interface IconPickerProps {
    /** Receives the class of the icon picked, e.g. `bx bx-star`. */
    onSelect(iconClass: string): void;
    /**
     * Offered as the way back to no icon of one's own. Left out, the picker only picks — there is
     * nothing to go back to.
     */
    onReset?: () => void;
    /** What going back means, in the host's own words. Left out, it resets "to the default icon". */
    resetText?: string;
    /** How many icons stand side by side; the host decides from the room it can give the grid. */
    columnCount: number;
}

/**
 * The picker an icon is chosen through: every icon of every installed pack, searchable by name and
 * narrowable to one pack, the ones already used across the note tree leading.
 *
 * It only reports what was picked — what that means is the host's own business, whether it is the
 * icon of a note or of something else entirely.
 */
export default function IconPicker({ onSelect, onReset, resetText, columnCount }: IconPickerProps) {
    const iconListRef = useRef<HTMLDivElement>(null);
    const [ search, setSearch ] = useState<string>();
    const [ filterByPrefix, setFilterByPrefix ] = useState<string | null>(null);
    useStaticTooltip(iconListRef, {
        selector: "span",
        customClass: "pre-wrap-text",
        animation: false,
        title() { return this.getAttribute("title") || ""; },
    });

    const allIcons = useAllIcons();
    const filteredIcons = useFilteredIcons(allIcons, search, filterByPrefix);

    return (
        // The legacy class is kept alongside the picker's own: the themes dress the icon grid
        // through it, having known the picker only as a part of the note icon widget.
        <div className="icon-picker note-icon-widget">
            <FilterRow
                filterByPrefix={filterByPrefix}
                search={search}
                setSearch={setSearch}
                setFilterByPrefix={setFilterByPrefix}
                filteredIcons={filteredIcons}
                onReset={onReset}
                resetText={resetText}
            />

            <div
                class="icon-list"
                ref={iconListRef}
                style={{
                    width: (columnCount * ICON_SIZE + 10),
                }}
                onClick={(e) => {
                    // Make sure we are not clicking on something else than a button.
                    const clickedTarget = e.target as HTMLElement;
                    if (!clickedTarget.classList.contains("tn-icon")) return;

                    onSelect(Array.from(clickedTarget.classList.values()).filter(c => c !== "tn-icon").join(" "));
                }}
            >
                {filteredIcons.length ? (
                    <Grid
                        columnCount={columnCount}
                        columnWidth={ICON_SIZE}
                        rowCount={Math.ceil(filteredIcons.length / columnCount)}
                        rowHeight={ICON_SIZE}
                        cellComponent={IconItemCell}
                        cellProps={{
                            filteredIcons,
                            columnCount
                        }}
                    />
                ) : (
                    <div class="no-results">{t("note_icon.no_results")}</div>
                )}
            </div>
        </div>
    );
}

type IconWithName = (IconRegistry["sources"][number]["icons"][number] & { iconPack: string });

interface IconToCountCache {
    iconClassToCountMap: Record<string, number>;
}

let iconToCountCache!: Promise<IconToCountCache> | null;

function FilterRow({ filterByPrefix, search, setSearch, setFilterByPrefix, filteredIcons, onReset, resetText }: {
    filterByPrefix: string | null;
    search: string | undefined;
    setSearch: (value: string | undefined) => void;
    setFilterByPrefix: (value: string | null) => void;
    filteredIcons: IconWithName[];
    onReset?: () => void;
    resetText?: string;
}) {
    const searchBoxRef = useRef<HTMLInputElement>(null);

    return (
        <div class="filter-row">
            <span>{t("note_icon.search")}</span>
            <FormTextBox
                inputRef={searchBoxRef}
                type="text"
                name="icon-search"
                placeholder={ filterByPrefix
                    ? t("note_icon.search_placeholder_filtered", {
                        number: filteredIcons.length ?? 0,
                        name: glob.iconRegistry.sources.find(s => s.prefix === filterByPrefix)?.name ?? ""
                    })
                    : t("note_icon.search_placeholder", { number: filteredIcons.length ?? 0, count: glob.iconRegistry.sources.length })}
                currentValue={search} onChange={setSearch}
                autoFocus
            />

            {isDesktop()
                ? <>
                    {onReset && (
                        <div style={{ textAlign: "center" }}>
                            <ActionButton
                                icon="bx bx-reset"
                                text={resetText ?? t("note_icon.reset-default")}
                                onClick={onReset}
                            />
                        </div>
                    )}

                    {<Dropdown
                        buttonClassName="bx bx-filter-alt"
                        hideToggleArrow
                        noSelectButtonStyle
                        noDropdownListStyle
                        iconAction
                        title={t("note_icon.filter")}
                    >
                        <IconFilterContent filterByPrefix={filterByPrefix} setFilterByPrefix={setFilterByPrefix} />
                    </Dropdown>}
                </> : (
                    <Dropdown
                        buttonClassName="bx bx-dots-vertical-rounded"
                        hideToggleArrow
                        noSelectButtonStyle
                        noDropdownListStyle
                        iconAction
                        dropdownContainerClassName="mobile-bottom-menu"
                    >
                        {onReset && <>
                            <FormListItem
                                icon="bx bx-reset"
                                onClick={onReset}
                            >{resetText ?? t("note_icon.reset-default")}</FormListItem>
                            <FormDropdownDivider />
                        </>}

                        <IconFilterContent filterByPrefix={filterByPrefix} setFilterByPrefix={setFilterByPrefix} />
                    </Dropdown>
                )}
        </div>
    );
}

function IconItemCell({ rowIndex, columnIndex, style, filteredIcons, columnCount }: CellComponentProps<{
    filteredIcons: IconWithName[];
    columnCount: number;
}>) {
    const iconIndex = rowIndex * columnCount + columnIndex;
    const iconData = filteredIcons[iconIndex] as IconWithName | undefined;
    if (!iconData) return <></> as React.ReactElement;

    const { id, terms, iconPack } = iconData;
    return (
        <span
            key={id}
            class={clsx(id, "tn-icon")}
            title={t("note_icon.icon_tooltip", { name: terms?.[0] ?? id, iconPack })}
            style={style as CSSProperties}
        />
    ) as React.ReactElement;
}

function IconFilterContent({ filterByPrefix, setFilterByPrefix }: {
    filterByPrefix: string | null;
    setFilterByPrefix: (value: string | null) => void;
}) {
    return (
        <>
            <FormListItem
                checked={filterByPrefix === null}
                onClick={() => setFilterByPrefix(null)}
            >{t("note_icon.filter-none")}</FormListItem>
            <FormListItem
                checked={filterByPrefix === "bx"}
                onClick={() => setFilterByPrefix("bx")}
            >{t("note_icon.filter-default")}</FormListItem>
            {glob.iconRegistry.sources.length > 1 && <FormDropdownDivider />}

            {glob.iconRegistry.sources.map(({ prefix, name, icon }) => (
                prefix !== "bx" && <FormListItem
                    key={prefix}
                    onClick={() => setFilterByPrefix(prefix)}
                    icon={icon}
                    checked={filterByPrefix === prefix}
                >{name}</FormListItem>
            ))}
        </>
    );
}

function useAllIcons() {
    const [ allIcons, setAllIcons ] = useState<IconWithName[]>();

    useEffect(() => {
        getIconToCountMap().then((iconsToCount) => {
            const allIcons = [
                ...glob.iconRegistry.sources.flatMap(s => s.icons.map((i) => ({
                    ...i,
                    iconPack: s.name,
                })))
            ];

            // Sort by count.
            if (iconsToCount) {
                allIcons.sort((a, b) => {
                    const countA = iconsToCount[a.id ?? ""] || 0;
                    const countB = iconsToCount[b.id ?? ""] || 0;

                    return countB - countA;
                });
            }

            setAllIcons(allIcons);
        });
    }, []);

    return allIcons;
}

function useFilteredIcons(allIcons: IconWithName[] | undefined, search: string | undefined, filterByPrefix: string | null) {
    // Filter by text and/or icon pack.
    const filteredIcons = useMemo(() => {
        let icons: IconWithName[] = allIcons ?? [];
        const processedSearch = search?.trim()?.toLowerCase();
        if (processedSearch || filterByPrefix !== null) {
            icons = icons.filter((icon) => {
                if (filterByPrefix) {
                    if (!icon.id?.startsWith(`${filterByPrefix} `)) {
                        return false;
                    }
                }

                if (processedSearch) {
                    if (!icon.terms?.some((t) => t.includes(processedSearch))) {
                        return false;
                    }
                }

                return true;
            });
        }
        return icons;
    }, [ allIcons, search, filterByPrefix ]);
    return filteredIcons;
}

async function getIconToCountMap() {
    if (!iconToCountCache) {
        iconToCountCache = server.get<IconToCountCache>("other/icon-usage");
        setTimeout(() => (iconToCountCache = null), 20000); // invalidate cache after 20 seconds
    }

    return (await iconToCountCache).iconClassToCountMap;
}
