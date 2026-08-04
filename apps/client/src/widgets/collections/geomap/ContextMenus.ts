import { MapMouseEvent } from "maplibre-gl";
import { useCallback, useContext, useEffect } from "preact/hooks";

import appContext, { type CommandMappings } from "../../../components/app_context.js";
import FNote from "../../../entities/fnote.js";
import contextMenu, { type MenuItem } from "../../../menus/context_menu.js";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker.jsx";
import linkContextMenu from "../../../menus/link_context_menu.js";
import { copyTextWithToast } from "../../../services/clipboard_ext.js";
import { t } from "../../../services/i18n.js";
import link from "../../../services/link.js";
import { createNewNote } from "./api.js";
import { type GeoMouseEvent, ParentMap, toGeoMouseEvent } from "./map.js";
import { MARKER_LAYER } from "./Markers.js";

interface ContextMenusProps {
    note: FNote;
    isReadOnly: boolean;
    /**
     * Arms this map for the marker of the given note to be put somewhere else, the next click on the
     * map being where. Handed down rather than triggered as a command because a command is heard by
     * every map at once: embedded maps share no note context, so a broadcast would arm all of them
     * (see the same reasoning around note placement in `index.tsx`).
     */
    onRelocate: (noteId: string) => void;
}

export default function ContextMenus({ note, isReadOnly, onRelocate }: ContextMenusProps) {
    const map = useContext(ParentMap);

    const onContextMenu = useCallback((e: GeoMouseEvent) => {
        if (!map) return;
        const features = map.queryRenderedFeatures(e.point, {
            layers: [ MARKER_LAYER ]
        });

        if (features.length > 0) {
            // Marker context menu.
            openContextMenu(features[0].properties.id, e, !isReadOnly, onRelocate);
        } else {
            // Empty area context menu.
            openMapContextMenu(note, e, !isReadOnly);
        }
    }, [ map, note, isReadOnly, onRelocate ]);

    useEffect(() => {
        if (!onContextMenu || !map) return;

        const handler = (e: MapMouseEvent) => {
            e.preventDefault();
            onContextMenu(toGeoMouseEvent(e));
        };
        map.on("contextmenu", handler);
        return () => { map.off("contextmenu", handler); };
    }, [ map, onContextMenu ]);

    return null;
}

export function openContextMenu(noteId: string, e: GeoMouseEvent, isEditable: boolean, onRelocate: (noteId: string) => void) {
    let items: MenuItem<keyof CommandMappings>[] = [
        ...buildGeoLocationItem(e),
        { kind: "separator" },
        ...linkContextMenu.getItems(e),
    ];

    if (isEditable) {
        items = [
            ...items,
            { kind: "separator" },
            // The marker is put somewhere else by being placed again rather than dragged: the notes
            // are drawn into one symbol layer, not an element apiece, so there is nothing on the map
            // to take hold of.
            { title: t("geo-map-context.move-marker"), handler: () => onRelocate(noteId), uiIcon: "bx bx-move" },
            { title: t("geo-map-context.remove-from-map"), command: "deleteFromMap", uiIcon: "bx bx-trash" },
            { kind: "separator"},
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note: noteId})
            }
        ];
    }

    contextMenu.show({
        x: e.originalEvent.pageX,
        y: e.originalEvent.pageY,
        items,
        selectMenuItemHandler: ({ command }) => {
            if (command === "deleteFromMap") {
                appContext.triggerCommand(command, { noteId });
                return;
            }

            // Pass the events to the link context menu
            linkContextMenu.handleLinkContextMenuItem(command, e, noteId);
        }
    });
}

export function openMapContextMenu(note: FNote, e: GeoMouseEvent, isEditable: boolean) {
    let items: MenuItem<keyof CommandMappings>[] = [
        ...buildGeoLocationItem(e)
    ];

    if (isEditable) {
        items = [
            ...items,
            { kind: "separator" },
            {
                title: t("geo-map-context.add-note"),
                handler: () => createNewNote(note, e),
                uiIcon: "bx bx-plus"
            }
        ];
    }

    contextMenu.show({
        x: e.originalEvent.pageX,
        y: e.originalEvent.pageY,
        items,
        selectMenuItemHandler: () => {
            // Nothing to do, as the commands handle themselves.
        }
    });
}

function buildGeoLocationItem(e: GeoMouseEvent) {
    function formatGeoLocation(latlng: { lat: number; lng: number }, precision: number = 6) {
        return `${latlng.lat.toFixed(precision)}, ${latlng.lng.toFixed(precision)}`;
    }

    return [
        {
            title: formatGeoLocation(e.latlng),
            uiIcon: "bx bx-current-location",
            handler: () => copyTextWithToast(formatGeoLocation(e.latlng, 15))
        },
        {
            title: t("geo-map-context.open-location"),
            uiIcon: "bx bx-map-alt",
            handler: () => link.goToLinkExt(null, `geo:${e.latlng.lat},${e.latlng.lng}`)
        }
    ];
}
