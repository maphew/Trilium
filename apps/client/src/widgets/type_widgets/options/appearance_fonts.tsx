import "./appearance_fonts.css";

import { customFontFamily, customFontNoteId, customFontOption, FontFamily, OptionNames, SYSTEM_MONOSPACE_FONT_STACK, SYSTEM_SANS_SERIF_FONT_STACK, UserFont } from "@triliumnext/commons";
import clsx from "clsx";
import { Fragment } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { getCustomFonts, registerFontNote } from "../../../services/custom_fonts";
import { filterAvailableFamilies, listSystemFonts, quoteFamily, type SystemFont } from "../../../services/font";
import { t } from "../../../services/i18n";
import { isElectron } from "../../../services/utils";
import { Card, OptionCardSection } from "../../react/Card";
import { filterTokens, matchesFilter } from "../../react/filter";
import FormList, { FormListHeader, FormListItem } from "../../react/FormList";
import FormToggle from "../../react/FormToggle";
import { useNoteTitle, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Modal from "../../react/Modal";
import NoItems from "../../react/NoItems";
import Slider from "../../react/Slider";
import SettingsSearch from "./components/SettingsSearch";

interface FontFamilyEntry {
    value: FontFamily;
    label?: string;
}

interface FontGroup {
    title: string;
    items: FontFamilyEntry[];
}

/** Families the browser resolves for itself, so they hold wherever Trilium runs. */
const GENERIC_FONTS: FontGroup = {
    title: t("fonts.generic-fonts"),
    items: [
        { value: "theme", label: t("fonts.theme_defined") },
        { value: "system", label: t("fonts.system-default") },
        { value: "serif", label: t("fonts.serif") },
        { value: "sans-serif", label: t("fonts.sans-serif") },
        { value: "monospace", label: t("fonts.monospace") }
    ]
};

/** Named families, offered where the device's own fonts cannot be listed (see {@link useFontGroups}). */
const FONT_FAMILIES: FontGroup[] = [
    GENERIC_FONTS,
    {
        title: t("fonts.sans-serif-system-fonts"),
        items: [
            { value: "Arial" },
            { value: "Verdana" },
            { value: "Helvetica" },
            { value: "Tahoma" },
            { value: "Trebuchet MS" },
            { value: "Impact" },
            { value: "Microsoft YaHei" }
        ]
    },
    {
        title: t("fonts.serif-system-fonts"),
        items: [{ value: "Times New Roman" }, { value: "Georgia" }, { value: "Garamond" }, { value: "American Typewriter" }]
    },
    {
        title: t("fonts.monospace-system-fonts"),
        // "Andale Mono" carries no accent: the accented spelling matches no installed family, so CSS
        // falls through to the generic default.
        items: [{ value: "Courier New" }, { value: "Andale Mono" }, { value: "Lucida Console" }, { value: "Monaco" }]
    },
    {
        title: t("fonts.handwriting-system-fonts"),
        items: [{ value: "Bradley Hand" }, { value: "Brush Script MT" }, { value: "Comic Sans MS" }, { value: "Luminari" }]
    }
];

export default function Fonts() {
    const [ overrideThemeFonts, setOverrideThemeFonts ] = useTriliumOptionBool("overrideThemeFonts");
    const [ ligaturesEnabled, setLigaturesEnabled ] = useTriliumOptionBool("monospaceLigaturesEnabled");
    const isEnabled = overrideThemeFonts === true;
    const fontGroups = useFontGroups();

    return (
        <Card className="appearance-fonts" heading={t("fonts.fonts")}>
            <OptionCardSection
                name="override-theme-fonts"
                label={t("fonts.custom_fonts")}
                description={t("fonts.custom_fonts_description")}
                // The four fonts stay on show with the switch off, greyed rather than gone: what
                // is there to be set is the whole reason for turning it on, and a switch with
                // nothing under it says nothing about what it would bring.
                subSectionsVisible
                subSections={[
                    <Font key="main" label={t("fonts.main_font")} groups={fontGroups} fontFamilyOption="mainFontFamily" fontSizeOption="mainFontSize" disabled={!isEnabled} />,
                    <Font key="tree" label={t("fonts.note_tree_font")} groups={fontGroups} sizeDescription={t("fonts.size_relative_to_general")} fontFamilyOption="treeFontFamily" fontSizeOption="treeFontSize" disabled={!isEnabled} />,
                    <Font key="detail" label={t("fonts.note_detail_font")} groups={fontGroups} sizeDescription={t("fonts.size_relative_to_general")} fontFamilyOption="detailFontFamily" fontSizeOption="detailFontSize" disabled={!isEnabled} />,
                    <Font key="monospace" label={t("fonts.monospace_font")} groups={fontGroups} description={t("fonts.monospace_font_description")} fontFamilyOption="monospaceFontFamily" fontSizeOption="monospaceFontSize" disabled={!isEnabled} isMonospace />
                ]}
            >
                <FormToggle currentValue={overrideThemeFonts} onChange={setOverrideThemeFonts} />
            </OptionCardSection>

            {/*
              * Deliberately not nested under `overrideThemeFonts` like the fonts above: the
              * ligatures come from the *theme's* monospace font, so the setting is needed exactly
              * when custom fonts are off. Gating it would put it out of reach of everyone affected.
              */}
            <OptionCardSection
                name="monospace-ligatures-enabled"
                label={t("fonts.monospace_ligatures")}
                description={t("fonts.monospace_ligatures_description")}
            >
                <FormToggle currentValue={ligaturesEnabled} onChange={setLigaturesEnabled} />
            </OptionCardSection>
        </Card>
    );
}

/**
 * The picker's groups, with the fonts the user labelled `#customFont` appended. Those are also
 * registered with the document for as long as the page is open, so the picker draws each specimen
 * in the font it names.
 *
 * Where the device's own fonts can be listed, they stand in for the named families: the stock list
 * is a guess at what a device has, and half of it does not resolve on any given one.
 */
function useFontGroups(): FontGroup[] {
    const [ customFonts, setCustomFonts ] = useState<UserFont[]>([]);
    const systemFonts = useSystemFonts();

    useEffect(() => {
        let cancelled = false;
        const registered: FontFace[] = [];

        (async () => {
            const fonts = await getCustomFonts();
            if (cancelled) return;
            setCustomFonts(fonts);

            await Promise.all(fonts.map(async ({ noteId, blobId }) => {
                try {
                    const face = await registerFontNote(noteId, customFontFamily(noteId), blobId);
                    if (cancelled) {
                        document.fonts.delete(face);
                    } else {
                        registered.push(face);
                    }
                } catch {
                    // The entry stays on the list and draws in the fallback family: the option can
                    // still be set to a font this device happens not to be able to load.
                }
            }));
        })();

        return () => {
            cancelled = true;
            for (const face of registered) {
                document.fonts.delete(face);
            }
        };
    }, []);

    return useMemo(() => {
        const stockGroups = systemFonts.length ? installedFontGroups(systemFonts) : availableStockGroups();

        // Ahead of the rest: a font the user went and added is the one they are looking for.
        return customFonts.length
            ? [ {
                title: t("fonts.user-fonts"),
                items: customFonts.map(({ noteId, title }) => ({ value: customFontOption(noteId), label: title }))
            }, ...stockGroups ]
            : stockGroups;
    }, [ customFonts, systemFonts ]);
}

/**
 * The stock groups, with the families this device cannot render left out and any group they empty
 * left out with them. The generic families always stay: the browser resolves those itself.
 *
 * The list is a guess at what a device holds, which is why every runtime that cannot enumerate its
 * fonts has to be told which of the guesses landed.
 */
function availableStockGroups(): FontGroup[] {
    const named = FONT_FAMILIES.filter((group) => group !== GENERIC_FONTS);
    const available = new Set(filterAvailableFamilies(named.flatMap((group) => group.items.map(({ value }) => value))));

    const groups = [ GENERIC_FONTS ];
    for (const group of named) {
        const items = group.items.filter(({ value }) => available.has(value));
        if (items.length) {
            groups.push({ ...group, items });
        }
    }

    return groups;
}

/**
 * The generic families, then the installed ones split by advance width. Serif and sans-serif cannot
 * be told apart from a browser — nothing reports a face's style — so this is as far as the grouping
 * goes, and an empty half is left out rather than headed.
 */
function installedFontGroups(systemFonts: SystemFont[]): FontGroup[] {
    const groups = [ GENERIC_FONTS ];
    const named: [ string, SystemFont[] ][] = [
        [ t("fonts.proportional-system-fonts"), systemFonts.filter(({ monospace }) => !monospace) ],
        [ t("fonts.monospace-system-fonts"), systemFonts.filter(({ monospace }) => monospace) ]
    ];

    for (const [ title, fonts ] of named) {
        if (fonts.length) {
            groups.push({ title, items: fonts.map(({ family }) => ({ value: family })) });
        }
    }

    return groups;
}

/**
 * The fonts installed on this device, empty everywhere but the desktop app. The API behind
 * {@link listSystemFonts} also exists in a browser served over HTTPS, where reading it would cost
 * the user a permission prompt for a list the desktop app can have for free — so the ask is kept to
 * the one runtime that grants it itself (see the `local-fonts` entry in `web_contents_security.ts`).
 */
function useSystemFonts(): SystemFont[] {
    const [ fonts, setFonts ] = useState<SystemFont[]>([]);

    useEffect(() => {
        if (!isElectron()) return;

        let cancelled = false;
        void listSystemFonts().then((found) => {
            if (!cancelled) setFonts(found);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return fonts;
}

interface FontProps {
    label: string;
    description?: string;
    sizeDescription?: string;
    /** The picker's groups, the user's own fonts among them (see {@link useFontGroups}). */
    groups: FontGroup[];
    fontFamilyOption: OptionNames;
    fontSizeOption: OptionNames;
    disabled?: boolean;
    isMonospace?: boolean;
}

function Font({ label, description, sizeDescription, groups, fontFamilyOption, fontSizeOption, disabled, isMonospace }: FontProps) {
    const [ fontFamily, setFontFamily ] = useTriliumOption(fontFamilyOption);
    const [ fontSize, setFontSize ] = useTriliumOption(fontSizeOption);
    const [ showModal, setShowModal ] = useState(false);

    // One of the user's own fonts is named by the note holding it, so its own title says what is
    // set — read from the cache rather than waited for from the listing, and it follows a rename.
    const customFontTitle = useNoteTitle(customFontNoteId(fontFamily) ?? undefined, undefined);

    // Find the current font entry to display
    const currentFont = groups
        .flatMap(group => group.items)
        .find(item => item.value === fontFamily);
    const displayLabel = customFontTitle ?? currentFont?.label ?? currentFont?.value ?? fontFamily ?? "";

    // Map option name to CSS variable
    const themeCssVariable = {
        mainFontFamily: "var(--main-font-family)",
        treeFontFamily: "var(--tree-font-family)",
        detailFontFamily: "var(--detail-font-family)",
        monospaceFontFamily: "var(--monospace-font-family)"
    }[fontFamilyOption] ?? "inherit";

    // Get the CSS font-family value for preview
    const getFontFamily = (value: string) => {
        if (value === "theme") {
            // Use the theme's CSS variable for this font option
            return themeCssVariable;
        }
        if (value === "system") {
            // Use the appropriate system font stack
            return isMonospace ? SYSTEM_MONOSPACE_FONT_STACK : SYSTEM_SANS_SERIF_FONT_STACK;
        }
        // One of the user's own fonts names the note it is stored in, not a family the browser
        // could resolve; the family it was registered under is built from the same id.
        const noteId = customFontNoteId(value);
        return noteId ? customFontFamily(noteId) : quoteFamily(value);
    };

    return (
        <>
            <OptionCardSection
                className={clsx("font-option", disabled && "disabled")}
                label={label}
                description={description}
                onAction={disabled ? undefined : () => setShowModal(true)}
            >
                <span className="font-option-preview">
                    <span className="font-option-specimen" style={{ fontFamily: getFontFamily(fontFamily ?? ""), fontSize: `${fontSize}%` }}>{displayLabel}</span>
                    <span className="tn-card-chevron" />
                </span>
            </OptionCardSection>

            <FontPickerModal
                show={showModal}
                onHidden={() => setShowModal(false)}
                title={label}
                groups={groups}
                fontFamily={fontFamily ?? ""}
                fontSize={parseInt(fontSize ?? "100", 10)}
                onFontFamilyChange={setFontFamily}
                onFontSizeChange={(size) => setFontSize(String(size))}
                getFontFamily={getFontFamily}
                sizeDescription={sizeDescription}
            />
        </>
    );
}

const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. 0123456789";

interface FontPickerModalProps {
    show: boolean;
    onHidden: () => void;
    title: string;
    groups: FontGroup[];
    fontFamily: string;
    fontSize: number;
    onFontFamilyChange: (value: string) => void;
    onFontSizeChange: (value: number) => void;
    getFontFamily: (value: string) => string | undefined;
    sizeDescription?: string;
}

function FontPickerModal({ show, onHidden, title, groups, fontFamily, fontSize, onFontFamilyChange, onFontSizeChange, getFontFamily, sizeDescription }: FontPickerModalProps) {
    const [ query, setQuery ] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const matching = useMemo(() => filterFontGroups(groups, query), [ groups, query ]);

    return createPortal(
        <Modal
            className="font-picker-modal"
            title={title}
            size="lg"
            show={show}
            // The list runs to every family the device has, so the search is what the dialog opens on.
            onShown={() => searchRef.current?.focus()}
            onHidden={() => {
                setQuery("");
                onHidden();
            }}
            stackable
            sidebar={<>
                <SettingsSearch
                    inputRef={searchRef}
                    query={query}
                    onChange={setQuery}
                    placeholder={t("fonts.search_placeholder")}
                />

                {matching.length > 0 ? (
                    <FormList fullHeight wrapperClassName="font-picker-list">
                        {matching.map(group => (
                            <Fragment key={group.title}>
                                <FormListHeader text={group.title} />
                                {group.items.map(item => (
                                    <FormListItem
                                        key={item.value}
                                        onClick={() => onFontFamilyChange(item.value)}
                                        checked={fontFamily === item.value}
                                        selected={fontFamily === item.value}
                                    >
                                        <span style={{ fontFamily: getFontFamily(item.value) }}>
                                            {item.label ?? item.value}
                                        </span>
                                    </FormListItem>
                                ))}
                            </Fragment>
                        ))}
                    </FormList>
                ) : (
                    <NoItems className="font-picker-empty" icon="bx bx-search" text={t("fonts.no_fonts_found")} size="small" />
                )}
            </>}
        >
            <div className="font-picker-settings">
                <div className="font-size-control">
                    <label>{t("fonts.size")}</label>
                    <div className="font-size-slider">
                        <Slider
                            value={fontSize}
                            onChange={onFontSizeChange}
                            min={50}
                            max={200}
                            step={5}
                        />
                        <span className="font-size-value">{fontSize}%</span>
                    </div>
                    {sizeDescription && <small className="font-size-description">{sizeDescription}</small>}
                </div>

                <div className="font-preview">
                    <label>{t("fonts.preview")}</label>
                    <div
                        className="font-preview-text"
                        style={{
                            fontFamily: getFontFamily(fontFamily),
                            fontSize: `${fontSize}%`
                        }}
                    >
                        {PREVIEW_TEXT}
                    </div>
                </div>
            </div>
        </Modal>,
        document.body
    );
}

/**
 * The groups narrowed to the fonts matching `query`, those left with nothing dropped. A group whose
 * own title matches keeps all of its fonts, so a search for "monospace" offers every monospace
 * family rather than only the generic entry named after them.
 */
function filterFontGroups(groups: FontGroup[], query: string): FontGroup[] {
    const tokens = filterTokens(query);
    if (tokens.length === 0) {
        return groups;
    }

    const matching: FontGroup[] = [];
    for (const group of groups) {
        if (matchesFilter(tokens, group.title)) {
            matching.push(group);
            continue;
        }

        // A user font is named by the note holding it; the value is that note's id, which is no
        // name to search by.
        const items = group.items.filter((item) => matchesFilter(tokens, item.label ?? item.value));
        if (items.length > 0) {
            matching.push({ ...group, items });
        }
    }

    return matching;
}
