import { Plugin, WidgetToolbarRepository, isWidget, type ViewElement } from "ckeditor5";
import IncludeNote, {
    CONVERT_EMBED_TO_LINK_COMMAND,
    INCLUDE_NOTE_MENU,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./includenote.js";
import IncludeNoteBoxSizeDropdown from "./include_note_box_size_dropdown.js";

export default class IncludeNoteToolbar extends Plugin {

    static get requires() {
        return [WidgetToolbarRepository, IncludeNote, IncludeNoteBoxSizeDropdown] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("includeNote", {
            items: [
                "includeNoteBoxSizeDropdown",
                TOGGLE_TITLE_COMMAND_NAME,
                TOGGLE_CAPTION_COMMAND_NAME,
                CONVERT_EMBED_TO_LINK_COMMAND,
                INCLUDE_NOTE_MENU
            ],
            balloonClassName: "ck-toolbar-container include-note-toolbar",
            getRelatedElement(selection) {
                const selectedElement = selection.getSelectedElement();

                if (selectedElement && isIncludeNoteWidget(selectedElement)) {
                    return selectedElement;
                }

                // The toolbar stays on the include while its caption is edited.
                for (const ancestor of selection.getFirstPosition()?.getAncestors() ?? []) {
                    if (ancestor.is("element") && isIncludeNoteWidget(ancestor)) {
                        return ancestor;
                    }
                }

                return null;
            }
        });
    }

}

function isIncludeNoteWidget(element: ViewElement): boolean {
    return isWidget(element) && element.hasClass("include-note");
}
