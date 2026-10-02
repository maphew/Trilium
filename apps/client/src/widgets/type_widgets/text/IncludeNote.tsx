import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import linkContextMenu from "../../../menus/link_context_menu";
import content_renderer from "../../../services/content_renderer";
import { t } from "../../../services/i18n";
import type { ViewScope } from "../../../services/link";
import ActionButton from "../../react/ActionButton";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

export interface IncludeNoteProps {
    boxSize?: string;
    /** The link to the included note or attachment, shown as the title. */
    title: HTMLElement;
    /** The rendered note or attachment. */
    content: HTMLElement;
    contentType: string;
    /** The note opened by the buttons in the title row. */
    notePath: string;
    viewScope?: ViewScope;
    /** Whether a medium or full box offers to show its content in fullscreen. */
    isFullscreenOffered?: boolean;
}

/** The title row and the content of an included note or embedded attachment. */
export default function IncludeNote({
    boxSize, title, content, contentType, notePath, viewScope, isFullscreenOffered
}: IncludeNoteProps) {
    const titleRef = useRef<HTMLHeadingElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [ isExpanded, setIsExpanded ] = useState(false);
    const isExpandable = boxSize === "expandable";
    const hasFullscreen = !!isFullscreenOffered && (boxSize === "medium" || boxSize === "full");

    useLayoutEffect(() => {
        titleRef.current?.replaceChildren(title);
    }, [ title ]);

    useLayoutEffect(() => {
        contentRef.current?.append(content);
        return () => {
            content_renderer.disposeInteractiveContent($(content));
            content.remove();
        };
    }, [ content ]);

    return (
        <>
            <div className="include-note-title-row">
                {isExpandable && (
                    <ActionButton
                        className={clsx("include-note-toggle", isExpanded && "expanded")}
                        icon="bx bx-chevron-right"
                        text=""
                        aria-expanded={isExpanded}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                    />
                )}
                <h4 ref={titleRef} className="include-note-title" />
                <ActionButton
                    className="include-note-open"
                    icon="bx bx-link-external"
                    text={t("common.open_in_new_tab")}
                    onClick={(e) => {
                        e.stopPropagation();
                        void appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                            viewScope,
                            activate: true,
                            placement: "afterCurrent"
                        });
                    }}
                />
                {hasFullscreen && (
                    <ActionButton
                        className="include-note-fullscreen"
                        icon="bx bx-fullscreen"
                        text={t("common.fullscreen")}
                        onClick={(e) => {
                            e.stopPropagation();
                            contentRef.current?.requestFullscreen().catch((error: unknown) => {
                                console.warn("Could not show the include in fullscreen:", error);
                            });
                        }}
                    />
                )}
                <ActionButton
                    className="include-note-menu"
                    icon="bx bx-dots-vertical-rounded"
                    text={t("common.more_actions")}
                    onClick={(e) => {
                        e.stopPropagation();
                        void linkContextMenu.openContextMenu(notePath, e, viewScope);
                    }}
                />
            </div>
            <div
                ref={contentRef}
                className={`include-note-content type-${contentType}`}
                hidden={isExpandable && !isExpanded}
            >
                {hasFullscreen && (
                    <div className="include-note-fullscreen-controls">
                        <OverlayControlGroup
                            placement="top-end"
                            className="include-note-exit-fullscreen"
                        >
                            <OverlayControlButton
                                icon="bx-exit"
                                text={t("common.exit_fullscreen")}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    document.exitFullscreen().catch((error: unknown) => {
                                        console.warn("Could not leave fullscreen:", error);
                                    });
                                }}
                            />
                        </OverlayControlGroup>
                    </div>
                )}
            </div>
        </>
    );
}
