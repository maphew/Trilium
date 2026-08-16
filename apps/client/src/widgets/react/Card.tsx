import "./Card.css";
import { cloneElement, ComponentChildren, createContext, isValidElement } from "preact";
import { JSX, HTMLAttributes } from "preact";
import { useContext } from "preact/hooks";
import clsx from "clsx";

import { FilterPassthrough, useFilterMatch, useIsFiltering } from "./filter";
import { useUniqueName } from "./hooks";

// #region Card Frame

export interface CardFrameProps extends HTMLAttributes<HTMLDivElement> {
    className?: string;
    highlightOnHover?: boolean;
    children: ComponentChildren;
}

export function CardFrame({className, highlightOnHover, children, ...rest}: CardFrameProps) {
    return <div {...rest}
                className={clsx("tn-card-frame", className, {
                    "tn-card-highlight-on-hover": highlightOnHover
                })}>

        {children}
    </div>;
}

// #endregion

// #region Card

export interface CardProps {
    className?: string;
    heading?: string;
    /** Sentence introducing the card, shown between the heading and the first section. */
    description?: ComponentChildren;
    /**
     * Controls for the card as a whole, kept at the far end of its heading — a help mark, or a
     * button that adds to what the card holds.
     *
     * Taken as children rather than named one by one, so that the card needs no import of its own
     * for them: `Card` is in the login and setup bundles, which have no business pulling in the app
     * a help mark would reach for.
     */
    actions?: ComponentChildren;
}

/**
 * A titled group of sections.
 *
 * Under a `FilterProvider`, a card matching by its heading or description shows everything it holds,
 * since asking for the group is asking for its contents. One that does not match keeps only the
 * sections that matched on their own, and disappears when none did (both through CSS, so nothing is
 * torn down and rebuilt as the query changes).
 */
export function Card(props: {children: ComponentChildren} & CardProps) {
    const matched = useFilterMatch(props.heading, props.description);
    const filtering = useIsFiltering();

    return <div className={clsx("tn-card", props.className, {
                    "tn-card-filter-unmatched": filtering && !matched
                })}>
        {(props.heading || props.actions) && <h5 class="tn-card-heading">
            {props.heading}
            {props.actions && <span className="tn-card-heading-actions">{props.actions}</span>}
        </h5>}
        {props.description && <p className="tn-card-description">{props.description}</p>}
        <div className="tn-card-body">
            <FilterPassthrough when={matched}>{props.children}</FilterPassthrough>
        </div>
    </div>;
}

// #endregion

// #region Card Section

export interface CardSectionProps {
    className?: string;
    subSections?: JSX.Element | JSX.Element[];
    subSectionsVisible?: boolean;
    highlightOnHover?: boolean;
    /** Called when the section is pressed. Handed the event, which a link's handler may need. */
    onAction?: (event: MouseEvent) => void;
    noPadding?: boolean;
    /**
     * Makes the section a segment that leads somewhere rather than one holding a control: it becomes
     * an `<a>` carrying this address, highlights on hover, and reads a chevron on its trailing edge.
     *
     * A card of these is a card of anchors — do not mix them with ordinary segments, whose rounded
     * first and last corners are matched by element type.
     */
    href?: string;
    /**
     * Opts the link out of the options dialog's contained navigation, which would otherwise swallow
     * the click before {@link CardSectionProps.onAction} ever saw it. Ignored without an `href`.
     */
    noContainedNavigation?: boolean;
}

interface CardSectionContextType {
    nestingLevel: number;
}

const CardSectionContext = createContext<CardSectionContextType | undefined>(undefined);

export function CardSection(props: {children: ComponentChildren} & CardSectionProps) {
    const parentContext = useContext(CardSectionContext);
    const nestingLevel = (parentContext && parentContext.nestingLevel + 1) ?? 0;

    const className = clsx("tn-card-section", props.className, {
        "tn-card-section-nested": nestingLevel > 0,
        "tn-card-highlight-on-hover": props.highlightOnHover || props.onAction || props.href,
        "tn-no-padding": props.noPadding
    });
    const style = {"--tn-card-section-nesting-level": (nestingLevel) ? nestingLevel : null};

    return <>
        {props.href
            ? <a className={clsx(className, "tn-card-section-link", "no-tooltip-preview")}
                 style={style}
                 href={props.href}
                 data-no-contained-navigation={props.noContainedNavigation ? "" : undefined}
                 onClick={props.onAction}>
                {props.children}
                <span className="tn-card-section-chevron bx bx-chevron-right" />
            </a>
            : <section className={className}
                       style={style}
                       onClick={props.onAction}>
                {props.children}
            </section>}

        {props.subSectionsVisible && props.subSections &&
            <CardSectionContext.Provider value={{nestingLevel}}>
                {props.subSections}
            </CardSectionContext.Provider>
        }
    </>;
}

// #endregion

// #region Option Card Section

export interface OptionCardSectionProps extends CardSectionProps {
    label: ComponentChildren;
    description?: ComponentChildren;
    /**
     * Binds the label to the control, so that clicking the text operates it. Only a single element
     * child can be bound, which covers the usual case of one toggle or one input per option.
     */
    name?: string;
    /**
     * Puts the control on the line below the label rather than beside it, for one that needs the
     * whole width — a URL, a path, anything read as well as typed.
     */
    stacked?: boolean;
    /** The controls the option is operated with, placed on the trailing edge. */
    children?: ComponentChildren;
}

/**
 * A card section built as one setting: what it is on the leading edge, what changes it on the
 * trailing one, with the sentence explaining it below the label.
 *
 * Under a `FilterProvider`, the setting shows itself only while its label or description matches
 * what is being looked for, and its sub-sections come with it: they are details of this setting
 * rather than settings of their own, so they are neither shown without it nor matched separately.
 */
export function OptionCardSection(props: OptionCardSectionProps) {
    const {label, description, name, stacked, children, className, subSections, ...rest} = props;
    const matched = useFilterMatch(label, description);
    const id = useUniqueName(name);
    const bound = !!name && isValidElement(children);

    if (!matched) return null;

    return <CardSection className={clsx("tn-card-option", className, {
                            "tn-card-option-stacked": stacked
                        })}
                        subSections={subSections && <FilterPassthrough>{subSections}</FilterPassthrough>}
                        {...rest}>
        <label className="tn-card-option-label" for={bound ? id : undefined}>
            {/* Held together as one thing, because the label stacks the sentence under the name and
                would otherwise stack whatever the name is made of too — a badge marking which
                platforms a setting applies to belongs after the words, not under them. */}
            <span className="tn-card-option-title">{label}</span>
            {description && <small className="tn-card-option-description">{description}</small>}
        </label>

        {bound ? cloneElement(children, { id }) : children}
    </CardSection>;
}

// #endregion