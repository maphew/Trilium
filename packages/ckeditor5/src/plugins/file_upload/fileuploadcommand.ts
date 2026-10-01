import { Command, FileRepository, type Model, type ModelWriter } from "ckeditor5";

import { uploadAsLink } from "../uploadimage.js";

export interface FileUploadOptions {
    file: File[];
}

/**
 * Uploads files as attachments of the note and inserts a reference link to each, separated by
 * spaces. Pictures are linked too, rather than shown.
 */
export default class FileUploadCommand extends Command {
    override refresh() {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!position && model.schema.checkChild(position, "reference");
    }

    override execute({ file: files }: FileUploadOptions) {
        const model = this.editor.model;
        const fileRepository = this.editor.plugins.get(FileRepository);

        model.change((writer) => {
            for (const file of files) {
                // `createLoader()` logs an error and returns null when no upload adapter is set.
                const loader = fileRepository.createLoader(file);
                if (!loader) {
                    continue;
                }

                uploadAsLink(loader);
                insertPlaceholder(writer, model, loader.id, file.name);
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
