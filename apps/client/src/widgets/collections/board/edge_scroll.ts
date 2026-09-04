/**
 * Scrolls a container while something is carried near its edge.
 *
 * The board scrolls sideways and a column's cards scroll up and down, so a target names which of the
 * two axes it answers for. Several can be pulled at once: a card carried into the bottom corner of
 * the last column walks the board along and the column down together.
 */

/** How near an edge the pointer comes before the container starts to move, in pixels. */
const MARGIN = 60;

/** How fast it moves with the pointer at the very edge, in pixels a second. */
const SPEED = 1350;

export interface ScrollTarget {
    element: HTMLElement;
    axis: "x" | "y";
}

export interface EdgeScrollOptions {
    margin?: number;
    speed?: number;
    /** Called after each frame that moved something, the places on screen having changed. */
    onScroll?: () => void;
}

/**
 * How hard a point pulls a box towards one of its edges.
 *
 * Answers -1 at the near edge and +1 at the far one, easing off to 0 at the inner limit of the
 * margin, so the pull grows as the pointer closes on the edge rather than switching on at it. A
 * point outside the box pulls at full strength, which is what carries something held beyond the
 * board along.
 *
 * @param near the box's near edge, and @param far its far one, along the axis in question.
 * @param position the point, in the same terms.
 * @param margin how far in from each edge the pull reaches.
 */
export function edgePull(near: number, far: number, position: number, margin: number): number {
    if (far - near <= margin * 2) {
        return 0;
    }

    if (position < near + margin) {
        return -Math.min(1, (near + margin - position) / margin);
    }

    if (position > far - margin) {
        return Math.min(1, (position - (far - margin)) / margin);
    }

    return 0;
}

/** Whether a container has anywhere left to go in the given direction. */
export function canScroll(element: HTMLElement, axis: "x" | "y", pull: number): boolean {
    const [ offset, size, content ] = axis === "x"
        ? [ element.scrollLeft, element.clientWidth, element.scrollWidth ]
        : [ element.scrollTop, element.clientHeight, element.scrollHeight ];

    return pull < 0 ? offset > 0 : offset < content - size;
}

export function createEdgeScroller({
    margin = MARGIN, speed = SPEED, onScroll
}: EdgeScrollOptions = {}) {
    let targets: ScrollTarget[] = [];
    let point = { x: 0, y: 0 };
    let frame: number | undefined;
    let previous = 0;

    const step = (now: number) => {
        const elapsed = Math.min(now - previous, 50);
        previous = now;
        let moved = false;

        for (const { element, axis } of targets) {
            const box = element.getBoundingClientRect();
            const pull = axis === "x"
                ? edgePull(box.left, box.right, point.x, margin)
                : edgePull(box.top, box.bottom, point.y, margin);

            if (!pull || !canScroll(element, axis, pull)) continue;

            const distance = pull * speed * elapsed / 1000;
            if (axis === "x") {
                element.scrollLeft += distance;
            } else {
                element.scrollTop += distance;
            }
            moved = true;
        }

        if (moved) {
            onScroll?.();
        }

        frame = targets.length ? requestAnimationFrame(step) : undefined;
    };

    return {
        /** Points it at the containers to walk along, and at where the pointer stands. */
        update(next: ScrollTarget[], clientX: number, clientY: number) {
            targets = next;
            point = { x: clientX, y: clientY };

            if (targets.length && frame === undefined) {
                previous = performance.now();
                frame = requestAnimationFrame(step);
            }
        },

        stop() {
            targets = [];
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
                frame = undefined;
            }
        }
    };
}
