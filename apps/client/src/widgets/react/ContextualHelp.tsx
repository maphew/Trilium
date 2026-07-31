import "./ContextualHelp.css";

import { Tooltip } from "bootstrap";
import type { RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";
import { useStaticTooltip } from "./hooks";
import Modal from "./Modal";

interface ContextualHelpProps {
    /** What the icon explains, shown on hover or — on a phone — on tap. */
    helpMessage: string;
}

/**
 * The small info affordance that sits beside a label or a figure and explains it on hover — for a
 * remark too slight to be spelled out in the interface itself, and which nothing is lost by missing.
 *
 * The explanation goes on the app's tooltip rather than the browser's: a native one would appear
 * somewhere else, after its own delay and in its own styling, while whatever this icon sits beside
 * already carries the app's. Where a subject warrants a paragraph, markup or a help page of its own,
 * reach for `HelpTooltipButton` instead — this one is the passing remark.
 */
export default function ContextualHelp({ helpMessage }: ContextualHelpProps) {
    return IS_MOBILE
        ? <TappedHelp helpMessage={helpMessage} />
        : <HoveredHelp helpMessage={helpMessage} />;
}

/** Which affordance the icon carries, read once: the layout it answers to holds for the session. */
const IS_MOBILE = isMobile();

/** The pointer's: the explanation is a hover — or a focus, or a key press — away. */
function HoveredHelp({ helpMessage }: ContextualHelpProps) {
    const ref = useRef<HTMLSpanElement>(null);

    useStaticTooltip(ref, useMemo(() => ({
        title: helpMessage,
        placement: "bottom" as const,
        // Bootstrap appends tooltips to `<body>`, where the base `.tooltip` z-index sits below a
        // modal — and these icons are often shown inside the settings dialog, so without this the
        // hint would open behind the dialog that triggered it.
        customClass: "tooltip-top"
    }), [ helpMessage ]));

    return (
        <HelpIcon
            iconRef={ref}
            helpMessage={helpMessage}
            // Reaching the icon reveals the explanation by itself — Bootstrap's default trigger is
            // "hover focus" — so what the key press adds is the other half: dismissing it again
            // without tabbing away, and answering a screen reader's activation of the control.
            onActivate={() => withTooltip(ref, (tooltip) => tooltip.toggle())}
            onDismiss={() => withTooltip(ref, (tooltip) => tooltip.hide())}
        />
    );
}

/**
 * The thumb's: nothing hovers on a phone, so the explanation is a tap away — in the sheet that
 * rises from the bottom of the screen, which is where this app already puts what a thumb opens.
 *
 * Portalled to the body, since the icon sits wherever it explains something — inside a chart, a
 * table cell, a scroll container — and a sheet left there is laid out and clipped by that, rather
 * than by the screen it is supposed to rise from. Stackable for the same reason of place: the icon
 * is usually inside a dialog of its own (the settings pages, above all), and opening the sheet must
 * not take that dialog down with it.
 */
function TappedHelp({ helpMessage }: ContextualHelpProps) {
    const [ shown, setShown ] = useState(false);

    return (
        <>
            <HelpIcon
                helpMessage={helpMessage}
                popup="dialog"
                onActivate={() => setShown(true)}
            />

            {createPortal((
                <Modal
                    className="contextual-help-sheet"
                    size="md"
                    show={shown}
                    onHidden={() => setShown(false)}
                    stackable
                >
                    {helpMessage}
                </Modal>
            ), document.body)}
        </>
    );
}

interface HelpIconProps {
    iconRef?: RefObject<HTMLSpanElement>;
    helpMessage: string;
    /** What activating the icon opens, for anything that is not simply revealed in place. */
    popup?: "dialog";
    onActivate: () => void;
    onDismiss?: () => void;
}

/**
 * The icon both affordances are drawn as: a control rather than a decoration, so it is reachable by
 * keyboard, announced as something that can be activated, and answers `Enter`/`Space` with whatever
 * a pointer would have done.
 *
 * Its accessible name carries the explanation itself. Bootstrap points `aria-describedby` at the
 * tooltip while one is shown and takes the attribute away again on hide, so leaning on that would
 * leave the message reachable only during the moments it happens to be on screen — and on a phone
 * there is no tooltip at all.
 */
function HelpIcon({ iconRef, helpMessage, popup, onActivate, onDismiss }: HelpIconProps) {
    return (
        <span
            ref={iconRef}
            className="bx bx-info-circle contextual-help"
            role="button"
            tabIndex={0}
            aria-label={t("contextual_help.label", { message: helpMessage })}
            aria-haspopup={popup}
            onClick={onActivate}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    // Space scrolls the page under the icon otherwise, which is exactly the thing
                    // the explanation was meant to be read against.
                    e.preventDefault();
                    onActivate();
                } else if (e.key === "Escape") {
                    onDismiss?.();
                }
            }}
        />
    );
}

/** Runs something on the icon's tooltip, if one has been built for it yet. */
function withTooltip(iconRef: RefObject<HTMLSpanElement>, action: (tooltip: Tooltip) => void) {
    const element = iconRef.current;

    if (element) {
        const tooltip = Tooltip.getInstance(element);

        if (tooltip) {
            action(tooltip);
        }
    }
}
