import "./ContextualHelp.css";

import { useMemo, useRef } from "preact/hooks";

import { useStaticTooltip } from "./hooks";

interface ContextualHelpProps {
    /** What the icon explains, shown on hover. */
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
