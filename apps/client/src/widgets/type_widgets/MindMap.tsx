import "mind-elixir/style";
import "./MindMap.css";

import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import { t } from "i18next";
import { DARK_THEME, default as VanillaMindElixir, MindElixirData, MindElixirInstance, NodeObj, Operation, THEME as LIGHT_THEME } from "mind-elixir";
import type { LangPack } from "mind-elixir/i18n";
import { ComponentChildren, HTMLAttributes, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { sanitizeNoteContentHtml } from "../../services/sanitize_content";
import toast from "../../services/toast";
import utils from "../../services/utils";
import { useColorScheme, useEditorSpacedUpdate, useEffectiveReadOnly, useSyncedRef, useTriliumEvent, useTriliumEvents, useTriliumOption } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";
import { renderMindMapPreviewSvg } from "./helpers/mind_map_export";
import MindMapNodePanel from "./MindMapNodePanel";
import { TypeWidgetProps } from "./type_widget";

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
            {!isReadOnly && selectedNodes.length > 0 && apiRef.current &&
                <MindMapNodePanel mind={apiRef.current} nodes={selectedNodes} />}
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
            theme: defaultColorScheme.current === "dark" ? DARK_THEME : LIGHT_THEME
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
        if (!apiRef.current) return;
        const newTheme = colorScheme === "dark" ? DARK_THEME : LIGHT_THEME;
        if (apiRef.current.theme === newTheme) return; // Avoid unnecessary theme changes, which can be expensive to render.
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

function createOverlayElement() {
    const overlayEl = document.createElement("div");
    overlayEl.className = "mind-map-overlay";
    return overlayEl;
}
