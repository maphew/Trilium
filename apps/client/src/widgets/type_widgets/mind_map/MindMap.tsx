import "mind-elixir/style";
import "./MindMap.css";

import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import { t } from "i18next";
import { DARK_THEME, default as VanillaMindElixir, MindElixirData, MindElixirInstance, NodeObj, Operation, Theme, THEME as LIGHT_THEME } from "mind-elixir";
import type { LangPack } from "mind-elixir/i18n";
import { ComponentChildren, HTMLAttributes, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import { useColorScheme, useEditorSpacedUpdate, useEffectiveReadOnly, useSyncedRef, useTriliumEvent, useTriliumEvents, useTriliumOption } from "../../react/hooks";
import { refToJQuerySelector } from "../../react/react_utils";
import { TypeWidgetProps } from "../type_widget";
import { renderMindMapPreviewSvg } from "./export";
import { renderIconClasses } from "./icons";
import { renderNodeLinks } from "./links";
import NodePanel from "./NodePanel";

const NEW_TOPIC_NAME = "";

/**
 * Recursively sanitizes a parsed Mind Elixir data structure in place, neutralizing any
 * `dangerouslySetInnerHTML` payloads found anywhere in the tree.
 *
 * Mind Elixir nodes support an (undocumented in its README) `dangerouslySetInnerHTML`
 * property which replaces the node's content with raw HTML via `element.innerHTML`
 * (see mind-elixir `utils/dom.ts`). Trilium's UI never produces this property, but a
 * malicious note can embed it in the stored JSON. Because Safe Import only sanitizes
 * notes of `type === "text"` and skips `mindMap` notes, such a payload reaches the
 * client unsanitized and is injected into the DOM when the map is rendered, yielding
 * stored XSS (and historically RCE on the Electron desktop client) — GHSA-rj57-j38v-3577.
 *
 * Rather than dropping the field, we run every occurrence through the same DOMPurify
 * sanitizer used for text notes, so any legitimate markup is preserved while script
 * execution vectors are stripped.
 *
 * @param data the parsed Mind Elixir content (mutated in place).
 * @returns the same object, for convenience.
 */
export function sanitizeMindMapData<T>(data: T): T {
    sanitizeMindMapNode(data);
    return data;
}

function sanitizeMindMapNode(value: unknown): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            sanitizeMindMapNode(item);
        }
        return;
    }

    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;

        if (typeof record.dangerouslySetInnerHTML === "string") {
            record.dangerouslySetInnerHTML = sanitizeNoteContentHtml(record.dangerouslySetInnerHTML);
        }

        for (const key of Object.keys(record)) {
            sanitizeMindMapNode(record[key]);
        }
    }
}

interface MindElixirProps {
    apiRef?: RefObject<MindElixirInstance>;
    /** Rendered in an overlay on top of the map, outside of the DOM managed by Mind Elixir. */
    children?: ComponentChildren;
    containerProps?: Omit<HTMLAttributes<HTMLDivElement>, "ref">;
    containerRef?: RefObject<HTMLDivElement>;
    editable: boolean;
    onChange?: () => void;
    onSelectionChange?: (selectedNodes: NodeObj[]) => void;
}

function buildMindElixirLangPack(): LangPack {
    return {
        addChild: t("mind-map.addChild"),
        addParent: t("mind-map.addParent"),
        addSibling: t("mind-map.addSibling"),
        removeNode: t("mind-map.removeNode"),
        focus: t("mind-map.focus"),
        cancelFocus: t("mind-map.cancelFocus"),
        moveUp: t("mind-map.moveUp"),
        moveDown: t("mind-map.moveDown"),
        link: t("mind-map.link"),
        linkBidirectional: t("mind-map.linkBidirectional"),
        clickTips: t("mind-map.clickTips"),
        summary: t("mind-map.summary")
    };
}

export default function MindMap({ note, ntxId, noteContext }: TypeWidgetProps) {
    const apiRef = useRef<MindElixirInstance>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ selectedNodes, setSelectedNodes ] = useState<NodeObj[]>([]);


    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteType: "mindMap",
        noteContext,
        getData: async () => {
            if (!apiRef.current) return;

            return {
                content: apiRef.current.getDataString(),
                attachments: [
                    {
                        role: "image",
                        title: NOTE_TYPE_IMAGE_ATTACHMENTS.mindMap,
                        mime: "image/svg+xml",
                        content: await renderMindMapPreviewSvg(apiRef.current),
                        position: 0
                    }
                ]
            };
        },
        onContentChange: (content) => {
            let newContent: MindElixirData;

            if (content) {
                try {
                    newContent = sanitizeMindMapData(JSON.parse(content) as MindElixirData);
                    delete newContent.theme;    // The theme is managed internally by the widget, so we remove it from the loaded content to avoid inconsistencies.
                } catch (e) {
                    console.warn(e);
                    console.debug("Wrong JSON content: ", content);
                }
            } else {
                newContent = VanillaMindElixir.new(NEW_TOPIC_NAME);
            }
            apiRef.current?.init(newContent!);
        }
    });

    // Allow search.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        resolve(refToJQuerySelector(containerRef).find(".map-canvas"));
    });

    // Export as PNG or SVG.
    useTriliumEvents([ "exportSvg", "exportPng" ], async ({ ntxId: eventNtxId }, eventName) => {
        if (eventNtxId !== ntxId || !apiRef.current) return;
        try {
            const svg = await renderMindMapPreviewSvg(apiRef.current);
            if (eventName === "exportSvg") {
                utils.downloadSvg(note.title, svg);
            } else {
                await utils.downloadSvgAsPng(note.title, svg);
            }
        } catch (e) {
            console.warn(e);
            toast.showError(t(eventName === "exportSvg" ? "svg.export_to_svg" : "svg.export_to_png"));
        }
    });

    const onKeyDown = useCallback((e: KeyboardEvent) => {
        /*
        * Some global shortcuts interfere with the default shortcuts of the mind map,
        * as defined here: https://mind-elixir.com/docs/guides/shortcuts
        */
        if (e.key === "F1") {
            e.stopPropagation();
        }

        // Zoom controls
        const isCtrl = e.ctrlKey && !e.altKey && !e.metaKey;
        if (isCtrl && (e.key == "-" || e.key == "=" || e.key == "0")) {
            e.stopPropagation();
        }
    }, []);

    return (
        <MindElixir
            containerRef={containerRef}
            apiRef={apiRef}
            onChange={() => spacedUpdate.scheduleUpdate()}
            onSelectionChange={setSelectedNodes}
            editable={!isReadOnly}
            containerProps={{
                className: "mind-map-container",
                onKeyDown
            }}
        >
            {/* Offered on a read-only map as well: Mind Elixir still selects a node there, and the
                panel then holds the memo alone — the one thing a node carries that the map itself
                never draws, and which would otherwise be out of reach (see NodePanel). */}
            {selectedNodes.length > 0 && apiRef.current &&
                <NodePanel mind={apiRef.current} noteId={note.noteId} nodes={selectedNodes} readOnly={isReadOnly} />}
        </MindElixir>
    );
}

function MindElixir({ children, containerRef: externalContainerRef, containerProps, apiRef: externalApiRef, onChange, onSelectionChange, editable }: MindElixirProps) {
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const apiRef = useRef<MindElixirInstance>(null);
    const [ locale ] = useTriliumOption("locale");
    const colorScheme = useColorScheme();
    const defaultColorScheme = useRef(colorScheme);
    const [ overlayEl ] = useState(createOverlayElement);
    // Incremented every time a new instance is built, so that listeners get rebound onto its event bus.
    const [ instanceVersion, setInstanceVersion ] = useState(0);

    function reinitialize() {
        if (!containerRef.current) return;

        const mind = new VanillaMindElixir({
            el: containerRef.current,
            editable,
            contextMenu: { locale: buildMindElixirLangPack() },
            theme: buildTheme(defaultColorScheme.current, containerRef.current)
        });

        apiRef.current = mind;
        if (externalApiRef) {
            externalApiRef.current = mind;
        }

        // Mind Elixir wipes the element it is given, so the overlay has to be reattached
        // after every initialization. It goes outside `mind.container` on purpose, since
        // that one scrolls along with the map.
        containerRef.current.appendChild(overlayEl);
        setInstanceVersion((version) => version + 1);
    }

    useEffect(() => {
        reinitialize();
        return () => {
            apiRef.current?.destroy();
            apiRef.current = null;
        };
    }, []);

    // React to theme changes.
    useEffect(() => {
        if (!apiRef.current || !containerRef.current) return;
        const newTheme = buildTheme(colorScheme, containerRef.current);
        // Avoid unnecessary theme changes, which can be expensive to render. Compared by name, since
        // buildTheme hands out a fresh object every time.
        if (apiRef.current.theme.name === newTheme.name) return;
        try {
            apiRef.current.changeTheme(newTheme);
        } catch (e) {
            console.warn("Failed to change mind map theme:", e);
        }
    }, [ colorScheme ]);

    useEffect(() => {
        const data = apiRef.current?.getData();
        reinitialize();
        if (data) {
            apiRef.current?.init(data);
        }
    }, [ editable, locale ]);

    // On change listener.
    useEffect(() => {
        const bus = apiRef.current?.bus;
        if (!onChange || !bus) return;

        const operationListener = (operation: Operation) => {
            if (operation.name !== "beginEdit") {
                onChange();
            }
        };

        bus.addListener("operation", operationListener);
        bus.addListener("changeDirection", onChange);

        return () => {
            bus.removeListener("operation", operationListener);
            bus.removeListener("changeDirection", onChange);
        };
    }, [ onChange ]);

    // Node icons are rendered as text by Mind Elixir, while ours are icon classes, so they are
    // dressed again after every layout — which is what follows any change to a node. The links a
    // node carries are hardened in the same pass and for the same reason: Mind Elixir builds their
    // anchors anew from the node's own data (see renderNodeLinks).
    useEffect(() => {
        const mind = apiRef.current;
        if (!mind) return;

        const dressNodes = () => {
            renderNodeLinks(mind.nodes);

            // An icon takes far less room than the class it arrived as, so the node it sits on
            // narrows the moment it is dressed — after the branches have been measured against the
            // wider one, leaving them reaching past it. Measure again, but only where something
            // was dressed: the second pass finds nothing to do and the redrawing stops there.
            if (renderIconClasses(mind.nodes)) {
                mind.linkDiv();
            }
        };

        dressNodes();
        mind.bus.addListener("linkDiv", dressNodes);

        return () => mind.bus.removeListener("linkDiv", dressNodes);
    }, [ instanceVersion ]);

    // Selection listener. The events only carry the nodes that were added to or removed from the
    // selection, so the full selection is read back from the instance instead.
    useEffect(() => {
        const mind = apiRef.current;
        if (!onSelectionChange || !mind) return;

        const reportSelection = () => onSelectionChange(mind.currentNodes.map(({ nodeObj }) => nodeObj));

        reportSelection();
        mind.bus.addListener("selectNodes", reportSelection);
        mind.bus.addListener("unselectNodes", reportSelection);
        // Operations edit the node objects in place, leaving the selection pointing at the same
        // ones. Report it again so that what is shown of a selected node follows its edits.
        mind.bus.addListener("operation", reportSelection);

        return () => {
            mind.bus.removeListener("selectNodes", reportSelection);
            mind.bus.removeListener("unselectNodes", reportSelection);
            mind.bus.removeListener("operation", reportSelection);
        };
    }, [ onSelectionChange, instanceVersion ]);

    return (
        <>
            <div ref={containerRef} {...containerProps} />
            {createPortal(<>{children}</>, overlayEl)}
        </>
    );
}

/**
 * The Mind Elixir theme to draw the map with, on a canvas of Trilium's own.
 *
 * The map would otherwise sit on a background the library picked for itself — a grey of its own in
 * either color scheme — which reads as a panel laid over the note rather than as the note. The
 * canvas is the only surface taken over: the nodes and the branches keep the library's palette.
 *
 * The color is resolved against the container rather than handed over as `var(--main-background-color)`,
 * because the theme is not only written to the container as custom properties: it is also read
 * straight out of the instance to fill the backdrop of the exported SVG (see export.ts), which is
 * carried far from any document that could resolve a variable.
 *
 * @param colorScheme the color scheme in effect.
 * @param container the element the map is drawn in, to resolve Trilium's background against.
 * @returns the library's theme for that scheme, with the canvas replaced; unchanged if Trilium's
 *          background cannot be resolved.
 */
export function buildTheme(colorScheme: "light" | "dark", container: HTMLElement): Theme {
    const baseTheme = (colorScheme === "dark" ? DARK_THEME : LIGHT_THEME);
    const background = getComputedStyle(container).getPropertyValue("--main-background-color").trim();
    if (!background) return baseTheme;

    return {
        ...baseTheme,
        cssVar: { ...baseTheme.cssVar, "--bgcolor": background }
    };
}

function createOverlayElement() {
    const overlayEl = document.createElement("div");
    overlayEl.className = "mind-map-overlay";
    return overlayEl;
}
