import { render } from "preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import DonutChart, { type DonutRing } from "./DonutChart";

// Preact decides the event name by probing for the element's on* IDL property; happy-dom's SVG (and
// some HTML) prototypes lack the mouse ones, so without this the handlers register under a
// case-mangled name and dispatched events never connect. Real browsers have these properties.
beforeAll(() => {
    for (const prototype of [ SVGElement.prototype, HTMLElement.prototype ]) {
        for (const name of [ "onmouseenter", "onmouseleave", "onmousemove", "onclick" ]) {
            if (!(name in prototype)) {
                Object.defineProperty(prototype, name, { value: null, writable: true });
            }
        }
    }
});

let container: HTMLDivElement | undefined;

function renderChart(rings: DonutRing<string>[], center?: preact.ComponentChildren) {
    container = document.body.appendChild(document.createElement("div"));
    render(<DonutChart<string> rings={rings}>{center}</DonutChart>, container);
    return container;
}

/** happy-dom lays nothing out, so the chart box is stated explicitly for the flip math. */
function statChartBox(probe: HTMLElement) {
    const chart = probe.querySelector<HTMLElement>(".donut-chart");
    if (!chart) throw new Error("No chart rendered");
    chart.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0,
        toJSON: () => ({})
    } as DOMRect);
    return chart;
}

/** State set in an event handler renders on Preact's microtask, not synchronously. */
function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

function ring(overrides: Partial<DonutRing<string>> = {}): DonutRing<string> {
    return {
        id: "test-ring",
        radius: 100,
        thickness: 20,
        segments: [
            { id: "a", value: 75, tooltip: "A tip", hue: 10, data: "a" },
            { id: "b", value: 25, className: "seg-b", data: "b" },
            { id: "empty", value: 0, tooltip: "never shown" }
        ],
        ...overrides
    };
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

describe("DonutChart rendering", () => {
    it("draws one dash-arc circle per non-empty segment, proportional to its value", () => {
        const probe = renderChart([ ring() ]);
        const circles = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        expect(circles.length).toBe(2);

        const arcLength = (circle: SVGCircleElement) => parseFloat(circle.style.strokeDasharray);
        // 75 vs 25 — the shared gap shaving keeps it just off exactly 3.
        expect(arcLength(circles[0]) / arcLength(circles[1])).toBeGreaterThan(2.5);
        expect(circles[0].style.strokeWidth).toContain("20");
    });

    it("tints by hue variable, forwards classes, and renders the center content", () => {
        const probe = renderChart([ ring() ], <span className="center-probe">middle</span>);
        const [ a, b ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        expect(a.classList.contains("donut-colored")).toBe(true);
        expect(a.style.getPropertyValue("--donut-hue")).toBe("10");
        expect(b.classList.contains("donut-colored")).toBe(false);
        expect(b.classList.contains("seg-b")).toBe(true);

        expect(probe.querySelector(".donut-chart-center .center-probe")?.textContent).toBe("middle");
    });

    it("hands the clicked segment back and marks the ring clickable", () => {
        const onSegmentClick = vi.fn();
        const probe = renderChart([ ring({ onSegmentClick }) ]);
        const [ , b ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        expect(b.classList.contains("donut-clickable")).toBe(true);
        b.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onSegmentClick).toHaveBeenCalledTimes(1);
        expect(onSegmentClick.mock.calls[0][0]).toMatchObject({ id: "b", data: "b" });
    });

    it("shows the cursor-following tooltip on hover, moves it, flips it past midline and hides it", async () => {
        const probe = renderChart([ ring() ]);
        const chart = statChartBox(probe);
        const [ a ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        a.dispatchEvent(new MouseEvent("mouseenter", { clientX: 30, clientY: 40 }));
        await flushRender();
        const tooltip = probe.querySelector<HTMLElement>(".donut-chart-tooltip");
        expect(tooltip?.textContent).toBe("A tip");
        // The Trilium look depends on riding the real tooltip classes.
        expect(tooltip?.classList.contains("tooltip")).toBe(true);
        expect(tooltip?.classList.contains("show")).toBe(true);
        expect(tooltip?.style.left).toBe("30px");
        expect(tooltip?.classList.contains("donut-chart-tooltip-flipped")).toBe(false);

        chart.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 60 }));
        await flushRender();
        const moved = probe.querySelector<HTMLElement>(".donut-chart-tooltip");
        expect(moved?.style.left).toBe("150px");
        expect(moved?.style.top).toBe("60px");
        expect(moved?.classList.contains("donut-chart-tooltip-flipped")).toBe(true);

        a.dispatchEvent(new MouseEvent("mouseleave"));
        await flushRender();
        expect(probe.querySelector(".donut-chart-tooltip")).toBeNull();
    });

    it("shows no tooltip for a segment without one, and clears on leaving the chart", async () => {
        const probe = renderChart([ ring() ]);
        statChartBox(probe);
        const [ a, b ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        b.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
        await flushRender();
        expect(probe.querySelector(".donut-chart-tooltip")).toBeNull();

        a.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
        await flushRender();
        expect(probe.querySelector(".donut-chart-tooltip")).not.toBeNull();
        probe.querySelector(".donut-chart")?.dispatchEvent(new MouseEvent("mouseleave"));
        await flushRender();
        expect(probe.querySelector(".donut-chart-tooltip")).toBeNull();
    });
});
