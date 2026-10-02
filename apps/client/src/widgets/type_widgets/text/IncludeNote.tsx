import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import linkContextMenu from "../../../menus/link_context_menu";
import content_renderer from "../../../services/content_renderer";
import { t } from "../../../services/i18n";
import type { ViewScope } from "../../../services/link";
import ActionButton from "../../react/ActionButton";
import Icon from "../../react/Icon";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

/** An action on the included note or attachment, offered as a button in the title row. */
export interface IncludeNoteAction {
    title: string;
    icon: string;
    run: () => void | Promise<void>;
}

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

export interface TinyIncludeNoteProps {
    icon: string;
    /** The link to the included note or attachment, shown as the title. */
    title: HTMLElement;
    /** A line under the title, such as the size of an attachment. */
    description?: string;
    /** The note the "More actions" menu acts on. */
    notePath: string;
    viewScope?: ViewScope;
    /** The buttons before the "More actions" menu. */
    actions: IncludeNoteAction[];
}

/** The title row and the content of an included note or embedded attachment. */
export default function IncludeNote({
    boxSize, title, content, contentType, notePath, viewScope, isFullscreenOffered
}: IncludeNoteProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [ isExpanded, setIsExpanded ] = useState(false);
    const isExpandable = boxSize === "expandable";
    const hasFullscreen = !!isFullscreenOffered && (boxSize === "medium" || boxSize === "full");

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
                <IncludeNoteTitle title={title} />
                <IncludeNoteActionButton
                    className="include-note-open"
                    action={getOpenInNewTabAction(notePath, viewScope)}
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
                <MoreActionsButton notePath={notePath} viewScope={viewScope} />
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

/** A tiny include: a single row with an icon, the title and the actions, and no content. */
export function TinyIncludeNote({
    icon, title, description, notePath, viewScope, actions
}: TinyIncludeNoteProps) {
    return (
        <div className="include-note-title-row">
            <Icon className="include-note-icon" icon={icon} />
            <div className="include-note-heading">
                <IncludeNoteTitle title={title} />
                {description && <small className="include-note-description">{description}</small>}
            </div>
            {actions.map((action) => (
                <IncludeNoteActionButton
                    key={action.title}
                    className="include-note-action"
                    action={action}
                />
            ))}
            <MoreActionsButton notePath={notePath} viewScope={viewScope} />
        </div>
    );
}

/** The buttons of a tiny include of a note: "Quick edit" and "Open in new tab". */
export function getNoteActions(notePath: string): IncludeNoteAction[] {
    return [
        {
            title: t("link_context_menu.open_note_in_popup"),
            icon: "bx bx-edit",
            run: () => {
                appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
            }
        },
        getOpenInNewTabAction(notePath)
    ];
}

function getOpenInNewTabAction(notePath: string, viewScope?: ViewScope): IncludeNoteAction {
    return {
        title: t("common.open_in_new_tab"),
        icon: "bx bx-link-external",
        run: async () => {
            await appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                viewScope,
                activate: true,
                placement: "afterCurrent"
            });
        }
    };
}

function IncludeNoteTitle({ title }: { title: HTMLElement }) {
    const titleRef = useRef<HTMLHeadingElement>(null);

    useLayoutEffect(() => {
        titleRef.current?.replaceChildren(title);
    }, [ title ]);

    return <h4 ref={titleRef} className="include-note-title" />;
}

function IncludeNoteActionButton({ className, action }: {
    className: string;
    action: IncludeNoteAction;
}) {
    return (
        <ActionButton
            className={className}
            icon={action.icon}
            text={action.title}
            onClick={(e) => {
                e.stopPropagation();
                void action.run();
            }}
        />
    );
}

function MoreActionsButton({ notePath, viewScope }: { notePath: string; viewScope?: ViewScope }) {
    return (
        <ActionButton
            className="include-note-menu"
            icon="bx bx-dots-vertical-rounded"
            text={t("common.more_actions")}
            onClick={(e) => {
                e.stopPropagation();
                void linkContextMenu.openContextMenu(notePath, e, viewScope);
            }}
        />
    );
}
