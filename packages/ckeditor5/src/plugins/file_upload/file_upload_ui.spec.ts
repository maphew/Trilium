import {
    ClassicEditor,
    Command,
    Essentials,
    FileDialogButtonView,
    IconPaperClip,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import FileUploadUI from "./file_upload_ui.js";

describe("FileUploadUI", () => {
    let editor: ClassicEditor;
    let command: Command;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, FileUploadUI]);
        command = new Command(editor);
        command.refresh();
        editor.commands.add("fileUpload", command);
    });

    function createButton() {
        const button = editor.ui.componentFactory.create("fileUpload");
        if (!(button instanceof FileDialogButtonView)) {
            throw new Error("Expected a file dialog button.");
        }
        return button;
    }

    it("registers a paperclip button that picks any number of files of any type", () => {
        const button = createButton();

        expect(button.label).toBe("Attach file");
        expect(button.icon).toBe(IconPaperClip);
        expect(button.tooltip).toBe(true);
        expect(button.allowMultipleFiles).toBe(true);
        expect(button.acceptedType).toBeUndefined();
    });

    it("follows the enabled state of the `fileUpload` command", () => {
        const button = createButton();
        expect(button.isEnabled).toBe(true);

        command.forceDisabled("spec");
        expect(button.isEnabled).toBe(false);
    });

    it("attaches the picked files and returns the focus to the editor", () => {
        const button = createButton();
        const execute = vi.spyOn(editor, "execute").mockImplementation(() => undefined);
        const focus = vi.spyOn(editor.editing.view, "focus");
        const files = [
            new File(["a"], "a.pdf", { type: "application/pdf" }),
            new File(["b"], "b.png", { type: "image/png" })
        ];

        button.fire("done", files);

        expect(execute).toHaveBeenCalledWith("fileUpload", { file: files });
        expect(focus).toHaveBeenCalled();
    });
});
