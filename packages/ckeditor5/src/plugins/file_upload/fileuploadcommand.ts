import { Command, FileRepository, type Editor, type Model, type ModelWriter } from "ckeditor5";

import { uploadAsLink } from "../uploadimage.js";

export interface FileUploadOptions {
    file: File[];
    /** Embeds each file in a block of its own instead of linking it. */
    asEmbed?: boolean;
}

/**
 * Uploads files as attachments of the note and inserts a reference link to each, separated by
 * spaces. Pictures are linked too, rather than shown. With `asEmbed`, each file is embedded
 * instead.
 */
export default class FileUploadCommand extends Command {
    override refresh() {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!position && model.schema.checkChild(position, "reference");
    }

    override execute({ file: files, asEmbed }: FileUploadOptions) {
        const model = this.editor.model;
        const fileRepository = this.editor.plugins.get(FileRepository);
        const boxSize = asEmbed ? getDefaultBoxSize(this.editor) : undefined;

        model.change((writer) => {
            for (const file of files) {
                // `createLoader()` logs an error and returns null when no upload adapter is set.
                const loader = fileRepository.createLoader(file);
                if (!loader) {
                    continue;
                }

                uploadAsLink(loader);
                if (boxSize) {
                    insertEmbedPlaceholder(writer, model, loader.id, file.name, boxSize);
                } else {
                    insertPlaceholder(writer, model, loader.id, file.name);
                }
            }
        });
    }
}

/** Inserts the link `FileUploadEditing` completes once the upload ends, and a space after it. */
function insertPlaceholder(writer: ModelWriter, model: Model, uploadId: string, fileName: string) {
    const placeholder = writer.createElement("reference", {
        href: "",
        uploadId,
        uploadFileName: fileName
    });
    model.insertContent(placeholder, model.document.selection);

    const afterPlaceholder = writer.createPositionAfter(placeholder);
    writer.insertText(" ", afterPlaceholder);
    writer.setSelection(afterPlaceholder.getShiftedBy(1));
}

/** Inserts the embed `FileUploadEditing` completes once the upload ends, as a block of its own. */
function insertEmbedPlaceholder(
    writer: ModelWriter,
    model: Model,
    uploadId: string,
    fileName: string,
    boxSize: string
) {
    const placeholder = writer.createElement("includeNote", {
        boxSize,
        uploadId,
        uploadFileName: fileName
    });
    model.insertObject(placeholder, model.document.selection, null, { setSelection: "after" });
}

/** The box size the user gives a new include, `medium` when the host does not say. */
function getDefaultBoxSize(editor: Editor) {
    const component = glob.getComponentByEl<EditorComponent>(editor.editing.view.getDomRoot());
    return component.getIncludeNoteDefaultBoxSize?.() ?? "medium";
}
