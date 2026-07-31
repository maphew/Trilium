import "./NoteMap.css";

import ForceGraph from "force-graph";
import { RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import link_context_menu from "../../menus/link_context_menu";
import hoisted_note from "../../services/hoisted_note";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import { useColorScheme, useElementSize, useNoteLabel } from "../react/hooks";
import NoItems from "../react/NoItems";
import Slider from "../react/Slider";
import { loadNotesAndRelations, NoteMapLinkObject, NoteMapNodeObject, NotesAndRelationsData } from "./data";
import { loadIconFont, resolveIconGlyphs } from "./icons";
import MapTypeSwitcher from "./MapTypeSwitcher";
import { CssData, setupRendering } from "./rendering";
import { isRootedAtCurrentNote, NoteMapWidgetMode, rgb2hex, toMapType } from "./utils";

/** Maximum number of notes to render in the note map before showing a warning. */
const MAX_NOTES_THRESHOLD = 1_000;

interface NoteMapProps {
    note: FNote;
    widgetMode: NoteMapWidgetMode;
    parentRef: RefObject<HTMLElement>;
}

export default function NoteMap({ note, widgetMode, parentRef }: NoteMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const styleResolverRef = useRef<HTMLDivElement>(null);
    const [ mapTypeRaw, setMapType ] = useNoteLabel(note, "mapType");
    const [ mapRootIdLabel ] = useNoteLabel(note, "mapRootNoteId");
    const mapType = toMapType(mapTypeRaw);

    const graphRef = useRef<ForceGraph<NoteMapNodeObject, NoteMapLinkObject>>();
    // Everything the map is drawn in is settled when it is built — the colour of a note of each type,
    // the colour its title is written in, the shadow under it — so a change of theme calls for it to
    // be built again. The hook answers a theme being chosen and, for the themes that follow the
    // system, the system turning the lights off.
    const themeStyle = useColorScheme();
    const containerSize = useElementSize(parentRef);
    const [ fixNodes, setFixNodes ] = useState(false);
    const [ linkDistance, setLinkDistance ] = useState(40);
    const [ tooManyNotes, setTooManyNotes ] = useState<number | null>(null);
    const [ bypassLimit, setBypassLimit ] = useState(false);
    const notesAndRelationsRef = useRef<NotesAndRelationsData>();

    const mapRootId = useMemo(() => {
        if (note.noteId && isRootedAtCurrentNote(widgetMode)) {
            return note.noteId;
        } else if (mapRootIdLabel === "hoisted") {
            return hoisted_note.getHoistedNoteId();
        } else if (mapRootIdLabel) {
            return mapRootIdLabel;
        }
        return appContext.tabManager.getActiveContext()?.parentNoteId ?? null;

    }, [ note ]);

    // Build the note graph instance.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !mapRootId) return;
        const graph = new ForceGraph<NoteMapNodeObject, NoteMapLinkObject>(container);

        graphRef.current = graph;

        // A fresh graph sizes its canvas to the browser window, and the resize effect below only
        // fires when the container actually changes size — which navigating to another note isn't.
        // Left at the default, the graph centres its content far outside the (much smaller)
        // container's visible area and the map looks empty until something forces a resize.
        const size = parentRef.current?.getBoundingClientRect();
        if (size?.width && size.height) {
            graph.width(size.width).height(size.height);
        }

        // Navigating away mid-load must not let the outgoing note's data land on the new graph.
        let disposed = false;
        let teardownRendering: (() => void) | undefined;
        const labelValues = (name: string) => note.getLabels(name).map(l => l.value) ?? [];
        const excludeRelations = labelValues("mapExcludeRelation");
        const includeRelations = labelValues("mapIncludeRelation");
        Promise.all([
            loadNotesAndRelations(mapRootId, excludeRelations, includeRelations, mapType, widgetMode === "sidebar"),
            // Awaited alongside the notes rather than after them: a canvas asked to draw from a font
            // it does not have yet says nothing and draws tofu, and the map is painted the moment its
            // data lands.
            loadIconFont()
        ]).then(([ notesAndRelations ]) => {
            if (disposed || !containerRef.current || !styleResolverRef.current) return;

            // Guard against rendering too many notes which would freeze the browser.
            if (notesAndRelations.nodes.length > MAX_NOTES_THRESHOLD && !bypassLimit) {
                setTooManyNotes(notesAndRelations.nodes.length);
                return;
            }
            setTooManyNotes(null);

            const cssData = getCssData(containerRef.current, styleResolverRef.current);
            const iconGlyphs = resolveIconGlyphs(notesAndRelations.nodes.map((node) => node.icon), containerRef.current);

            // Configure rendering properties.
            teardownRendering = setupRendering(graph, {
                note,
                noteId: note.noteId,
                noteIdToSizeMap: notesAndRelations.noteIdToSizeMap,
                cssData,
                notesAndRelations,
                themeStyle,
                widgetMode,
                container,
                iconGlyphs
            });

            // Interaction
            graph
                .onNodeClick((node) => {
                    if (!node.id) return;
                    appContext.tabManager.getActiveContext()?.setNote(node.id);
                    // The map always sends the reader to the pane behind it, never to its own host — so a
                    // map shown in the quick-edit popup has to dismiss it, or it would be left covering the
                    // note it has just gone to. Raised whatever the host: a map anywhere else is behind the
                    // popup's backdrop while that is open, and so cannot be the one being pressed.
                    void appContext.triggerCommand("closePopupEditor");
                })
                .onNodeRightClick((node, e) => {
                    if (!node.id) return;
                    link_context_menu.openContextMenu(node.id, e);
                });

            // Set data
            graph.graphData(notesAndRelations);
            notesAndRelationsRef.current = notesAndRelations;
        });

        return () => {
            disposed = true;
            teardownRendering?.();
            // Stops the render loop; without it the discarded graph keeps animating against a
            // detached canvas for the rest of the session.
            graph._destructor();
            container.replaceChildren();
        };
    }, [ note, mapType, bypassLimit, themeStyle ]);

    useEffect(() => {
        if (!graphRef.current || !notesAndRelationsRef.current) return;
        graphRef.current.d3Force("link")?.distance(linkDistance);
        graphRef.current.graphData(notesAndRelationsRef.current);
    }, [ linkDistance, mapType ]);

    // React to container size
    useEffect(() => {
        if (!containerSize || !graphRef.current) return;
        graphRef.current.width(containerSize.width).height(containerSize.height);
    }, [ containerSize?.width, containerSize?.height, mapType ]);

    // Fixing nodes when dragged.
    useEffect(() => {
        graphRef.current?.onNodeDragEnd((node) => {
            if (fixNodes) {
                node.fx = node.x;
                node.fy = node.y;
            } else {
                node.fx = undefined;
                node.fy = undefined;
            }
        });
    }, [ fixNodes, mapType ]);

    useEffect(() => {
        setBypassLimit(false);
    }, [ note, mapType ]);

    if (tooManyNotes && !bypassLimit) {
        return (
            <NoItems
                icon="bx bxs-network-chart"
                text={t("note_map.too-many-notes", { count: tooManyNotes })}
            >
                <Button
                    text={t("note_map.show-anyway")}
                    kind="primary"
                    size="small"
                    onClick={() => setBypassLimit(true)}
                />
            </NoItems>
        );
    }

    return (
        <div className="note-map-widget">
            {/* The sidebar offers the choice in its card's header instead, where the pane keeps the
                controls of a widget — see sidebar/NoteMap.tsx. */}
            {widgetMode !== "sidebar" && (
                <MapTypeSwitcher
                    mapType={mapType} setMapType={setMapType}
                    className="btn-group-sm content-floating-buttons top-left" frame
                />
            )}

            {/* Not in the sidebar, where neither has anything to hold on to: a map that small is not
                one to arrange by hand, and it is rebuilt from scratch on every note it is read for,
                which is what a connections panel is for — so a pinned node and a chosen link distance
                are both gone by the next note. */}
            {widgetMode !== "sidebar" && (
                <div class="btn-group-sm fixnodes-type-switcher content-floating-buttons bottom-left" role="group">
                    <ActionButton
                        icon="bx bx-lock-alt"
                        text={t("note_map.fix-nodes")}
                        className={fixNodes ? "active" : ""}
                        onClick={() => setFixNodes(!fixNodes)}
                        frame
                    />

                    <Slider
                        min={1} max={100}
                        value={linkDistance} onChange={setLinkDistance}
                        title={t("note_map.link-distance")}
                    />
                </div>
            )}

            <div ref={styleResolverRef} class="style-resolver" />
            <div ref={containerRef} className="note-map-container" />
        </div>
    );
}

function getCssData(container: HTMLElement, styleResolver: HTMLElement): CssData {
    const containerStyle = window.getComputedStyle(container);
    const styleResolverStyle = window.getComputedStyle(styleResolver);

    return {
        fontFamily: containerStyle.fontFamily,
        textColor: rgb2hex(containerStyle.color),
        mutedTextColor: rgb2hex(styleResolverStyle.color)
    };
}
