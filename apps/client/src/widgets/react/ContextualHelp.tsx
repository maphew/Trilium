import "./ContextualHelp.css";

import { createPortal } from "preact/compat";
import { useMemo, useRef, useState } from "preact/hooks";

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

/** The pointer's: the explanation is a hover away, and the icon itself does nothing. */
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

    return <span ref={ref} className="bx bx-info-circle contextual-help" />;
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
            <span
                className="bx bx-info-circle contextual-help"
                onClick={() => setShown(true)}
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
