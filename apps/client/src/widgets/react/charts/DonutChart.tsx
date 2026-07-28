import "./DonutChart.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";

export interface DonutSegment<T = unknown> {
    /** Stable identity for reconciliation; unique within the ring. */
    id: string;
    value: number;
    /** Tooltip text, shown in the chart's own cursor-following tooltip while the segment is hovered. */
    tooltip?: string;
    /**
     * Categorical tint (0–359), mixed into the theme surface exactly like the treemap cells.
     * Absent = the plain surface color, unless a {@link className} paints its own.
     */
    hue?: number;
    /** Extra class on the segment, e.g. to give it a semantic color. */
    className?: string;
    /** The consumer's payload, handed back on click. */
    data?: T;
}

export interface DonutRing<T = unknown> {
    /** Stable identity for reconciliation; unique within the chart. */
    id: string;
    /** Distance from the center to the middle of the band, in viewBox units (see {@link DONUT_VIEW_SIZE}). */
    radius: number;
    thickness: number;
    segments: DonutSegment<T>[];
    onSegmentClick?: (segment: DonutSegment<T>) => void;
}

interface DonutChartProps<T> {
    rings: DonutRing<T>[];
    className?: string;
    /** Rendered centered in the hole, above the rings. */
    children?: ComponentChildren;
}

/** The square viewBox rings are laid out in; radii and thicknesses are expressed in these units. */
export const DONUT_VIEW_SIZE = 420;

const SEGMENT_GAP = 3;

interface HoverState {
    text: string;
    x: number;
    y: number;
    /** Near the right edge the tooltip sits to the cursor's left instead of running off the chart. */
    flipped: boolean;
}

/**
 * One or more concentric donut rings, drawn as circle strokes: each segment is a `stroke-dasharray`
 * arc, which is what makes navigation animate — dash geometry is plain CSS, so segments sweep in on
 * mount and transition on change, with no path morphing. The chart stretches to its container's
 * height and keeps a square aspect where the width allows; center content overlays the hole as
 * regular HTML.
 *
 * Segment tooltips are the chart's own cursor-following bubble (Trilium-styled via `tooltip-inner`)
 * rather than anything anchored to the element: a dashed circle's bounding box is the whole ring,
 * so an anchored tooltip would hover far from the segment it describes.
 */
export default function DonutChart<T>({ rings, className, children }: DonutChartProps<T>) {
    const half = DONUT_VIEW_SIZE / 2;
    const containerRef = useRef<HTMLDivElement>(null);
    const [ hover, setHover ] = useState<HoverState | null>(null);

    const positionOf = (event: { clientX: number, clientY: number }) => {
        const rect = containerRef.current?.getBoundingClientRect();

        if (!rect) {
            return { x: 0, y: 0, flipped: false };
        }

        const x = event.clientX - rect.left;
        return { x, y: event.clientY - rect.top, flipped: x > rect.width / 2 };
    };

    return (
        <div
            ref={containerRef}
            className={clsx("donut-chart", className)}
            onPointerMove={(event) => setHover((current) => current && { ...current, ...positionOf(event) })}
            onPointerLeave={() => setHover(null)}
        >
            <svg viewBox={`${-half} ${-half} ${DONUT_VIEW_SIZE} ${DONUT_VIEW_SIZE}`}>
                {/* Rotated so every ring starts at 12 o'clock. */}
                <g transform="rotate(-90)">
                    {rings.map((ring) => (
                        <Ring
                            key={ring.id}
                            ring={ring}
                            onSegmentHover={(segment, event) => setHover(segment?.tooltip && event
                                ? { text: segment.tooltip, ...positionOf(event) }
                                : null)}
                        />
                    ))}
                </g>
            </svg>
            {children && <div className="donut-chart-center">{children}</div>}
            {hover && (
                // The `tooltip show` classes matter: the themes set the tooltip colors on `.tooltip`
                // and scope the text color to `.tooltip .tooltip-inner` — a bare inner keeps the
                // theme's background but inherits the page's text color.
                <div
                    className={clsx("tooltip", "show", "donut-chart-tooltip", hover.flipped && "donut-chart-tooltip-flipped")}
                    style={{ left: hover.x, top: hover.y }}
                >
                    <div className="tooltip-inner">{hover.text}</div>
                </div>
            )}
        </div>
    );
}

function Ring<T>({ ring, onSegmentHover }: {
    ring: DonutRing<T>,
    onSegmentHover: (segment: DonutSegment<T> | null, event?: { clientX: number, clientY: number }) => void
}) {
    const circumference = 2 * Math.PI * ring.radius;
    const layout = computeDonutLayout(ring.segments.map((segment) => segment.value), circumference, SEGMENT_GAP);

    return (
        <g>
            {ring.segments.map((segment, index) => {
                const arc = layout[index];

                if (!arc) {
                    return null;
                }

                return (
                    <circle
                        key={segment.id}
                        className={clsx(
                            "donut-segment",
                            segment.hue !== undefined && "donut-colored",
                            ring.onSegmentClick && "donut-clickable",
                            segment.className
                        )}
                        r={ring.radius}
                        fill="none"
                        onClick={ring.onSegmentClick && (() => ring.onSegmentClick?.(segment))}
                        onPointerEnter={(event) => onSegmentHover(segment, event)}
                        onPointerLeave={() => onSegmentHover(null)}
                        // Arc geometry is data-driven; as inline *style* (not attributes) it stays
                        // animatable by the stylesheet's transition and sweep keyframes.
                        style={{
                            strokeWidth: ring.thickness,
                            strokeDasharray: `${arc.length} ${Math.max(circumference - arc.length, 0)}`,
                            strokeDashoffset: -arc.offset,
                            "--donut-circumference": `${circumference}px`,
                            ...(segment.hue !== undefined && { "--donut-hue": String(segment.hue) })
                        }}
                    />
                );
            })}
        </g>
    );
}

export interface DonutArc {
    /** Arc length along the circumference. */
    length: number;
    /** Distance from the ring's start to the arc's start. */
    offset: number;
}

/**
 * Distributes values proportionally along a ring's circumference, `null` where a value paints
 * nothing. The gap is shaved off a segment only where it fits: slivers keep their full span so
 * they don't vanish, and a lone segment stays a closed circle.
 */
export function computeDonutLayout(values: number[], circumference: number, gap: number): (DonutArc | null)[] {
    const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);

    if (total <= 0) {
        return values.map(() => null);
    }

    const visibleCount = values.filter((value) => value > 0).length;
    let position = 0;

    return values.map((value) => {
        if (value <= 0) {
            return null;
        }

        const span = (value / total) * circumference;
        const start = position;
        position += span;

        if (visibleCount > 1 && span > gap * 2) {
            return { length: span - gap, offset: start + gap / 2 };
        }

        return { length: span, offset: start };
    });
}
