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

/** How large a note's label is drawn on screen where the map is neither zoomed in nor out. */
const LABEL_FONT_PX = 11;

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
    // variables for the hover effect. We have to save the neighbours of a hovered node in a set. Also we need to save the links as well as the hovered node itself
    const neighbours = new Set();
    const highlightLinks = new Set();
    let hoverNode: NodeObject | null = null;
    let zoomLevel: number;
    /** Titles as they are drawn, cut to the width a label is allowed — see {@link getLabel}. */
    const labelsByNoteId = new Map<string, string>();

    function getColorForNode(node: NoteMapNodeObject) {
        if (node.color) {
            return node.color;
        } else if (isRootedAtCurrentNote(widgetMode) && node.id === noteId) {
            return "red"; // subtree root mark as red
        } else {
            return generateColorFromString(node.type, themeStyle);
        }
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

        const toRender = zoomLevel > 2 || (zoomLevel > 1 && size > 6) || (zoomLevel > 0.3 && size > 10);

        if (!toRender) {
            return;
        }

        // Drawn at a size mostly of its own rather than at the note's: the canvas is scaled by the
        // zoom, so a label measured in the graph's own units is drawn as large as the map is zoomed
        // in — which on a map of a couple of notes left the titles standing taller than the notes
        // themselves. Dividing the size on screen back out by the zoom is what holds it to its own.
        const fontSize = LABEL_FONT_PX * zoomLevel ** LABEL_ZOOM_SHARE / zoomLevel;

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

        ctx.font = `3px ${cssData.fontFamily}`;
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
            let moveY = 2;

            if (angle < -Math.PI / 2 || angle > Math.PI / 2) {
                angle += Math.PI;
                moveY = -2;
            }

            ctx.rotate(angle);
            ctx.fillText(link.name, 0, moveY);
        }

        ctx.restore();
    }

    // main code for highlighting hovered nodes and neighbours. here we "style" the nodes. the nodes are rendered several hundred times per second.
    graph
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.08)
        .maxZoom(7)
        .warmupTicks(30)
        .nodeCanvasObject((node, ctx) => {
            if (hoverNode == node) {
                //paint only hovered node
                paintNode(node, "#661822", ctx);
                neighbours.clear(); //clearing neighbours or the effect would be maintained after hovering is over
                for (const link of notesAndRelations.links) {
                    const { source, target } = link;
                    if (typeof source !== "object" || typeof target !== "object") continue;

                    //check if node is part of a link in the canvas, if so add it´s neighbours and related links to the previous defined variables to paint the nodes
                    if (source.id == node.id || target.id == node.id) {
                        neighbours.add(link.source);
                        neighbours.add(link.target);
                        highlightLinks.add(link);
                        neighbours.delete(node);
                    }
                }
            } else if (neighbours.has(node) && hoverNode != null) {
                //paint neighbours
                paintNode(node, "#9d6363", ctx);
            } else {
                paintNode(node, getColorForNode(node), ctx); //paint rest of nodes in canvas
            }
        })
        //check if hovered and set the hovernode variable, saving the hovered node object into it. Clear links variable everytime you hover. Without clearing links will stay highlighted
        .onNodeHover((node) => {
            hoverNode = node || null;
            highlightLinks.clear();
        })
        .nodePointerAreaPaint((node, _, ctx) => paintNode(node, getColorForNode(node), ctx))
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
        .nodeLabel((node) => escapeHtml(node.name))
        .onZoom((zoom) => zoomLevel = zoom.k);

    // set link width to immitate a highlight effect. Checking the condition if any links are saved in the previous defined set highlightlinks
    graph
        .linkWidth((link) => (highlightLinks.has(link) ? 3 : 0.4))
        .linkColor((link) => (highlightLinks.has(link) ? cssData.textColor : cssData.mutedTextColor))
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
