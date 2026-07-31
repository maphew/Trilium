import type ForceGraph from "force-graph";
import { NoteMapLinkObject, NoteMapNodeObject, NotesAndRelationsData } from "./data";
import { LinkObject, NodeObject } from "force-graph";
import { ICON_FONT_FAMILY } from "./icons";
import { generateColorFromString, getFitPadding, isLightColor, isRootedAtCurrentNote, MapType, NoteMapWidgetMode } from "./utils";
import { escapeHtml } from "../../services/utils";
import FNote from "../../entities/fnote";

/** Roughly a second of simulation at 60 fps — see {@link setupFraming}. */
const TICKS_UNTIL_DAMPED = 60;

/** What a map of a single note is shown at, there being no extent to fit — see {@link setupFraming}. */
const LONE_NOTE_ZOOM = 4;

/** How large a note's dot has to come out on screen, in pixels, before its icon is drawn inside it. */
const MIN_ICON_RADIUS = 7;

/** How much is left of what the pointer is not resting on, while it rests on a note of the map. */
const DIMMED_ALPHA = 0.15;

/** The same, for a colour that can only be dimmed by being asked for with it (see {@link getLinkColor}). */
const DIMMED_ALPHA_HEX = Math.round(DIMMED_ALPHA * 255).toString(16).padStart(2, "0");

/** How large a note's label is drawn on screen where the map is neither zoomed in nor out. */
const LABEL_FONT_PX = 11;

/** The same, for the name of a relation, which is read of a map already zoomed into. */
const LINK_LABEL_FONT_PX = 8;

/**
 * How much of the zoom a label takes on. None of it holds every label to the same size on screen; all
 * of it is the graph's own units, where a title grows without bound as the map is zoomed into. A
 * quarter of it carries a label from 11px to about 18px across the whole range of zooms the map
 * allows, so that zooming in brings the titles closer without letting them take the map over.
 */
const LABEL_ZOOM_SHARE = 0.25;

/** How wide a label may be, in multiples of its own font size, before what is left of the title is cut. */
const MAX_LABEL_WIDTH_EMS = 12;

export interface CssData {
    fontFamily: string;
    textColor: string;
    mutedTextColor: string;
}

interface RenderData {
    note: FNote;
    noteIdToSizeMap: Record<string, number>;
    cssData: CssData;
    noteId: string;
    themeStyle: "light" | "dark";
    widgetMode: NoteMapWidgetMode;
    notesAndRelations: NotesAndRelationsData;
    mapType: MapType;
    /** The element the graph's canvas lives in, watched for the user taking the view over. */
    container: HTMLElement;
    /** What each note's icon classes resolve to as a character of the icon font — see icons.ts. */
    iconGlyphs: Map<string, string>;
}

/** @returns a teardown function to call when the graph is discarded. */
export function setupRendering(graph: ForceGraph<NoteMapNodeObject, NoteMapLinkObject>, { note, noteId, themeStyle, widgetMode, noteIdToSizeMap, notesAndRelations, cssData, mapType, container, iconGlyphs }: RenderData) {
    // What the map is showing of the note under the pointer: the note itself, the notes a relation
    // runs between it and, and those relations. Worked out once when the hover changes rather than
    // while painting, so that every note of a frame is painted knowing the same thing.
    let hoverNode: NoteMapNodeObject | null = null;
    const neighbours = new Set<NoteMapNodeObject>();
    const highlightLinks = new Set<NoteMapLinkObject>();
    let zoomLevel: number;
    /** Titles as they are drawn, cut to the width a label is allowed — see {@link getLabel}. */
    const labelsByNoteId = new Map<string, string>();
    // A relation cannot be faded back the way a note is (the graph is given its colour rather than
    // drawing it), so it is asked for in a colour that is already faint. Only a plain `#rrggbb` takes
    // the two digits that say by how much; a theme whose muted colour resolves to anything else keeps
    // what it has rather than being handed something a canvas cannot read.
    const dimmedLinkColor = /^#[0-9a-f]{6}$/i.test(cssData.mutedTextColor)
        ? `${cssData.mutedTextColor}${DIMMED_ALPHA_HEX}`
        : cssData.mutedTextColor;

    /**
     * Takes note of what is hovered and of what the map is to show of it: the notes a relation runs
     * between it and, and the relations themselves.
     */
    function setHoveredNode(node: NoteMapNodeObject | null) {
        hoverNode = node;
        neighbours.clear();
        highlightLinks.clear();

        if (!hoverNode) {
            return;
        }

        for (const link of notesAndRelations.links) {
            const { source, target } = link;
            // Both ends are notes of the map by the time it is drawn, the graph having looked up what
            // the data carries as ids.
            if (typeof source !== "object" || typeof target !== "object") {
                continue;
            }

            if (source.id === hoverNode.id) {
                neighbours.add(target);
                highlightLinks.add(link);
            } else if (target.id === hoverNode.id) {
                neighbours.add(source);
                highlightLinks.add(link);
            }
        }
    }

    /** Whether the note is the hovered one or one a relation runs between it and — all of them, while nothing is hovered. */
    function isInHoveredNeighbourhood(node: NoteMapNodeObject) {
        return !hoverNode || node === hoverNode || neighbours.has(node);
    }

    /**
     * What a relation is drawn in: the colour of the note being hovered where it is one of that
     * note's own, so that what leads to and from it is read as belonging to it — arrowheads included,
     * which take the colour of the line they end. The rest of the map's relations fade back with the
     * notes they run between.
     */
    function getLinkColor(link: NoteMapLinkObject) {
        if (highlightLinks.has(link)) {
            return hoverNode ? getColorForNode(hoverNode) : cssData.textColor;
        }

        return hoverNode ? dimmedLinkColor : cssData.mutedTextColor;
    }

    function getColorForNode(node: NoteMapNodeObject) {
        if (node.color) {
            return node.color;
        } else if (isRootedAtCurrentNote(widgetMode) && node.id === noteId) {
            return "red"; // subtree root mark as red
        } else {
            return generateColorFromString(node.type, themeStyle);
        }
    }

    /**
     * The size to draw text at in the graph's own units, for a size on screen.
     *
     * The canvas is scaled by the zoom, so text measured in the graph's units is drawn as large as
     * the map is zoomed in — which is how a title once came to stand taller than the note it belonged
     * to. Dividing the size on screen back out by the zoom holds it to a size of its own, and the
     * share of the zoom it is given back (see {@link LABEL_ZOOM_SHARE}) is what still lets it grow.
     */
    function getFontSize(screenPx: number) {
        return screenPx * zoomLevel ** LABEL_ZOOM_SHARE / zoomLevel;
    }

    /**
     * Whether a note of the given size has its label drawn under it as the map stands: the smaller the
     * note, the further in the map has to be zoomed before its name is worth the clutter.
     */
    function isLabelDrawn(size: number) {
        return zoomLevel > 2 || (zoomLevel > 1 && size > 6) || (zoomLevel > 0.3 && size > 10);
    }

    /**
     * The note's title, for the tooltip that stands over it while it is hovered — or nothing at all
     * where the map is already showing the title in full under the note, the tooltip then being a
     * second copy of what the pointer is resting on.
     *
     * A title cut down to the width a label is allowed still earns one, since the rest of it is what
     * the reader is missing. So does one whose label the map is not drawing at all — a note with no
     * entry in the map has never had its label drawn, and cannot have it in full.
     */
    function getTooltip(node: NoteMapNodeObject) {
        const shownInFull = isLabelDrawn(noteIdToSizeMap[node.id]) && labelsByNoteId.get(node.id) === node.name;

        return shownInFull ? "" : escapeHtml(node.name);
    }

    function paintNode(node: NoteMapNodeObject, color: string, ctx: CanvasRenderingContext2D) {
        const { x, y } = node;
        // A coordinate of exactly 0 is a position like any other, and a common one: d3 lays the
        // first node out at an angle of 0, so its y is 0 — and in a one-node map nothing ever moves
        // it off that axis, which used to leave the map permanently blank.
        if (x === undefined || y === undefined) {
            return;
        }
        const size = noteIdToSizeMap[node.id];

        ctx.fillStyle = color;
        // Read back rather than kept: a canvas resolves whatever colour it is given — a name, a
        // function, a shorthand — to one form, which is the one worth asking anything about.
        const dotColor = typeof ctx.fillStyle === "string" ? ctx.fillStyle : color;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.8, 0, 2 * Math.PI, false);
        ctx.fill();

        paintNodeIcon(node, size, dotColor, x, y, ctx);

        if (!isLabelDrawn(size)) {
            return;
        }

        const fontSize = getFontSize(LABEL_FONT_PX);

        ctx.fillStyle = cssData.textColor;
        ctx.font = `${fontSize}px ${cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(getLabel(node, ctx, fontSize), x, y + size * 0.8 + fontSize);
    }

    /**
     * The note's title, cut down to what a label is allowed to be wide.
     *
     * Measured rather than counted: a count of characters cuts a title of wide ones halfway across the
     * map and one of narrow ones long before it had to. The width allowed is in multiples of the font
     * size and the measuring is in the graph's units, so the zoom is on both sides of the comparison
     * and cancels out — what fits at one zoom fits at every other, and is worked out once per note.
     */
    function getLabel(node: NoteMapNodeObject, ctx: CanvasRenderingContext2D, fontSize: number) {
        const cached = labelsByNoteId.get(node.id);
        if (cached !== undefined) {
            return cached;
        }

        const maxWidth = MAX_LABEL_WIDTH_EMS * fontSize;
        let label = node.name;

        if (ctx.measureText(label).width > maxWidth) {
            while (label.length > 1 && ctx.measureText(`${label}…`).width > maxWidth) {
                label = label.slice(0, -1);
            }
            label = `${label}…`;
        }

        labelsByNoteId.set(node.id, label);
        return label;
    }


    /**
     * The note's own icon, over the dot standing for it — the same one the tree and the tabs draw it
     * with, so a note is recognised in the map by what it is recognised by everywhere else.
     *
     * Only where the dot is drawn large enough on screen to hold it: below that the glyph is a smudge
     * over the colour, and the colour alone says more.
     */
    function paintNodeIcon(node: NoteMapNodeObject, size: number, dotColor: string, x: number, y: number, ctx: CanvasRenderingContext2D) {
        const glyph = iconGlyphs.get(node.icon);

        if (!glyph || !(size * 0.8 * zoomLevel >= MIN_ICON_RADIUS)) {
            return;
        }

        ctx.fillStyle = isLightColor(dotColor) ? "#000" : "#fff";
        ctx.font = `${size}px ${ICON_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(glyph, x, y);
    }

    function paintLink(link: NoteMapLinkObject, ctx: CanvasRenderingContext2D) {
        if (zoomLevel < 5) {
            return;
        }

        // Held to a size the same way a note's label is, from a smaller one: the name of a relation
        // is there to be read of a map already zoomed into, not to stand alongside the names of the
        // notes it runs between.
        const fontSize = getFontSize(LINK_LABEL_FONT_PX);

        ctx.font = `${fontSize}px ${cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = cssData.mutedTextColor;

        const { source, target } = link;
        if (typeof source !== "object" || typeof target !== "object") {
            return;
        }

        if (source.x !== undefined && source.y !== undefined && target.x !== undefined && target.y !== undefined) {
            const x = (source.x + target.x) / 2;
            const y = (source.y + target.y) / 2;
            ctx.save();
            ctx.translate(x, y);

            const deltaY = source.y - target.y;
            const deltaX = source.x - target.x;

            let angle = Math.atan2(deltaY, deltaX);
            // Riding just off the line rather than sitting across it, by a distance of its own text's
            // making — a fixed one would ride further off it the smaller the text is drawn.
            let moveY = fontSize * 0.7;

            if (angle < -Math.PI / 2 || angle > Math.PI / 2) {
                angle += Math.PI;
                moveY = -moveY;
            }

            ctx.rotate(angle);
            ctx.fillText(link.name, 0, moveY);
        }

        ctx.restore();
    }

    graph
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.08)
        .maxZoom(7)
        .warmupTicks(30)
        .nodeCanvasObject((node, ctx) => {
            // Every note keeps its own colour while one of them is hovered; what tells the note's
            // own from the rest of the map is that the rest of it is faded back behind them.
            ctx.save();
            if (!isInHoveredNeighbourhood(node)) {
                ctx.globalAlpha = DIMMED_ALPHA;
            }

            paintNode(node, getColorForNode(node), ctx);
            ctx.restore();
        })
        .onNodeHover((node) => setHoveredNode(node ?? null))
        .nodePointerAreaPaint((node, color, ctx) => {
            if (!node.id) {
                return;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            if (node.x !== undefined && node.y !== undefined) {
                ctx.arc(node.x, node.y, noteIdToSizeMap[node.id], 0, 2 * Math.PI, false);
            }
            ctx.fill();
        })
        .nodeLabel((node) => getTooltip(node))
        .onZoom((zoom) => zoomLevel = zoom.k);

    graph
        .linkWidth((link) => (highlightLinks.has(link) ? 3 : 0.4))
        .linkColor((link) => getLinkColor(link))
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(0.95);

    // Link-specific config
    if (mapType) {
        graph
            .linkLabel((link) => {
                const { source, target } = link;
                if (typeof source !== "object" || typeof target !== "object") return escapeHtml(link.name);
                return `${escapeHtml(source.name)} - <strong>${escapeHtml(link.name)}</strong> - ${escapeHtml(target.name)}`;
            })
            .linkCanvasObject((link, ctx) => paintLink(link, ctx))
            .linkCanvasObjectMode(() => "after");
    }

    // Forces
    const nodeLinkRatio = notesAndRelations.nodes.length / notesAndRelations.links.length;
    const magnifiedRatio = Math.pow(nodeLinkRatio, 1.5);
    const charge = -20 / magnifiedRatio;
    const boundedCharge = Math.min(-3, charge);
    graph.d3Force("center")?.strength(0.2);
    graph.d3Force("charge")?.strength(boundedCharge);
    graph.d3Force("charge")?.distanceMax(1000);

    return setupFraming(graph, container, { note, noteId, widgetMode, notesAndRelations });
}

/**
 * Keeps the view framed on the interesting part of the graph — the subtree the current note belongs
 * to in the ribbon, the linked notes elsewhere — while the layout settles.
 *
 * The fit runs on every tick of the simulation rather than once after a fixed delay: the layout
 * keeps expanding for seconds after the data lands, so a single delayed fit leaves the map at
 * force-graph's default zoom meanwhile (a few nodes around the origin, the rest already spread out
 * of sight) and then jumps to the real framing when it finally fires.
 *
 * @returns a teardown function to call when the graph is discarded.
 */
function setupFraming(graph: ForceGraph<NoteMapNodeObject, NoteMapLinkObject>, container: HTMLElement, { note, noteId, widgetMode, notesAndRelations }: Pick<RenderData, "note" | "noteId" | "widgetMode" | "notesAndRelations">) {
    const framedNoteIds = (isRootedAtCurrentNote(widgetMode) && note?.type !== "search")
        ? getSubGraphConnectedToCurrentNote(noteId, notesAndRelations)
        : getNoteIdsWithLinks(notesAndRelations);

    // A lone note has no extent to fit and would just be blown up to the maximum zoom, hiding the
    // rest of the map; the whole graph is the more useful thing to look at then.
    const nodeFilter = framedNoteIds.size > 1
        ? (node: NoteMapNodeObject) => framedNoteIds.has(node.id)
        : undefined;
    const padding = getFitPadding(widgetMode, framedNoteIds.size);
    // What the fit is measured on: the framed notes, or the whole graph where those are no more than
    // the one note. A note whose map is only itself has no extent to fit at all — the fit then asks
    // for a zoom of hundreds and gets the highest allowed, which fills the card with a single circle
    // and the beginning of a title. It is shown at a size it can be read at instead.
    const fittedNoteCount = nodeFilter ? framedNoteIds.size : notesAndRelations.nodes.length;

    // Panning or zooming hands the view over to the user for good — re-fitting under their fingers
    // would make the map impossible to explore while it is still settling.
    //
    // Listened for while the event is still on its way down: d3-zoom, which force-graph binds to the
    // canvas within this element, calls stopImmediatePropagation() on the wheel events it acts on, so
    // a listener waiting for them to come back up is never told about a zoom at all. It would then
    // re-fit over every notch of the wheel until the simulation came to rest — the map answering the
    // wheel by snapping back for as long as a quarter of a minute.
    const listenerOptions = { capture: true, passive: true };
    let framing = true;
    const releaseFraming = () => framing = false;
    container.addEventListener("wheel", releaseFraming, listenerOptions);
    container.addEventListener("pointerdown", releaseFraming, listenerOptions);

    let ticks = 0;
    graph.onEngineTick(() => {
        if (framing) {
            // Fitting is what centres the view on the note, whether or not its zoom is kept.
            graph.zoomToFit(0, padding, nodeFilter);

            if (fittedNoteCount <= 1) {
                graph.zoom(LONE_NOTE_ZOOM, 0);
            }
        }

        // Damping, once the graph has had the room to spread out, so that a small map comes to rest
        // instead of drifting for the whole cooldown.
        if (++ticks === TICKS_UNTIL_DAMPED && framedNoteIds.size < 30) {
            graph.d3VelocityDecay(0.4);
        }
    });

    return () => {
        container.removeEventListener("wheel", releaseFraming, listenerOptions);
        container.removeEventListener("pointerdown", releaseFraming, listenerOptions);
    };
}

function getNoteIdsWithLinks(data: NotesAndRelationsData) {
    const noteIds = new Set<string | number>();

    for (const link of data.links) {
        if (typeof link.source === "object" && link.source.id) {
            noteIds.add(link.source.id);
        }
        if (typeof link.target === "object" && link.target.id) {
            noteIds.add(link.target.id);
        }
    }

    return noteIds;
}

function getSubGraphConnectedToCurrentNote(noteId: string, data: NotesAndRelationsData) {
    function getGroupedLinks(links: LinkObject<NodeObject>[], type: "source" | "target") {
        const map: Record<string | number, LinkObject<NodeObject>[]> = {};

        for (const link of links) {
            if (typeof link[type] !== "object") {
                continue;
            }

            const key = link[type].id;
            if (key) {
                map[key] = map[key] || [];
                map[key].push(link);
            }
        }

        return map;
    }

    const linksBySource = getGroupedLinks(data.links, "source");
    const linksByTarget = getGroupedLinks(data.links, "target");

    const subGraphNoteIds = new Set<string | number>();

    function traverseGraph(noteId?: string | number) {
        if (!noteId || subGraphNoteIds.has(noteId)) {
            return;
        }

        subGraphNoteIds.add(noteId);

        for (const link of linksBySource[noteId] || []) {
            if (typeof link.target === "object") {
                traverseGraph(link.target?.id);
            }
        }

        for (const link of linksByTarget[noteId] || []) {
            if (typeof link.source === "object") {
                traverseGraph(link.source?.id);
            }
        }
    }

    traverseGraph(noteId);
    return subGraphNoteIds;
}
