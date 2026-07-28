import "./Treemap.css";

import clsx from "clsx";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { useMemo, useRef } from "preact/hooks";

import { useElementSize } from "../hooks";

export interface TreemapItem<T = unknown> {
    /** Stable identity for reconciliation; unique across the whole tree. */
    id: string;
    /** Weight of a leaf. Branch items derive their weight from their children and leave this unset. */
    value?: number;
    children?: TreemapItem<T>[];
    /**
     * Categorical tint (0–359): cells belonging together share the hue. Absent = plain surface,
     * for cells that stand apart from every group.
     */
    hue?: number;
    /** Extra classes on the cell, for special entries the consumer styles itself. */
    className?: string;
    /**
     * Attributes sprinkled onto the cell element — the cells carry no text of their own, so this
     * is where identity comes from: `data-href` opts into the note tooltip, `title` gives plain
     * cells a native one.
     */
    attributes?: Record<string, string>;
    /** The consumer's payload, handed back on click. */
    data?: T;
}

interface TreemapProps<T> {
    root: TreemapItem<T>;
    onItemClick?: (item: TreemapItem<T>) => void;
    className?: string;
}

const CELL_GAP = 3;

/**
 * A treemap over an arbitrary {@link TreemapItem} hierarchy, sized to fill its container and
 * re-laid out whenever the container resizes.
 *
 * Only the leaves are drawn, and each cell is nothing but its color: branch items shape the layout
 * — their leaves stay clustered — and lend their group a shared {@link TreemapItem.hue}, but paint
 * no cell of their own, so nothing sits between the pointer and the leaf it is over. Identity is
 * explored by hovering, via the {@link TreemapItem.attributes} tooltips.
 *
 * d3 computes the geometry only; the cells are plain absolutely-positioned divs so hover and
 * tooltips behave like everywhere else in the app. The hue tint is mixed into the theme's own
 * surface color, which keeps the map coherent under any user theme.
 */
export default function Treemap<T>({ root, onItemClick, className }: TreemapProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const size = useElementSize(containerRef);
    const width = Math.floor(size?.width ?? 0);
    const height = Math.floor(size?.height ?? 0);

    const cells = useMemo(() => {
        if (width < 10 || height < 10) {
            return [];
        }

        const weighted = hierarchy(root)
            .sum((item) => item.children?.length ? 0 : Math.max(item.value ?? 0, 0))
            // Larger cells first within each group; the hierarchy itself keeps related notes together.
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

        const layout = treemap<TreemapItem<T>>()
            .tile(treemapSquarify)
            .size([ width, height ])
            .paddingInner(CELL_GAP);

        return layout(weighted).leaves().filter((leaf) => leaf.depth > 0);
    }, [ root, width, height ]);

    return (
        <div ref={containerRef} className={clsx("treemap", className)}>
            {cells.map((cell) => {
                const item = cell.data;
                const cellWidth = cell.x1 - cell.x0;
                const cellHeight = cell.y1 - cell.y0;

                if (cellWidth < 1 || cellHeight < 1) {
                    return null;
                }

                return (
                    <div
                        key={item.id}
                        className={clsx("treemap-cell", item.hue !== undefined && "treemap-colored", item.className)}
                        // Geometry and tint are computed per layout run, so they cannot live in a stylesheet.
                        style={{
                            left: cell.x0,
                            top: cell.y0,
                            width: cellWidth,
                            height: cellHeight,
                            ...(item.hue !== undefined && { "--treemap-hue": String(item.hue) })
                        }}
                        onClick={onItemClick && (() => onItemClick(item))}
                        {...item.attributes}
                    />
                );
            })}
        </div>
    );
}
