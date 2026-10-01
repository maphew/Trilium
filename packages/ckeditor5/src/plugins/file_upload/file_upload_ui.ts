import {
    FileDialogButtonView,
    IconPaperClip,
    Plugin,
    type FileInputViewDoneEvent
} from "ckeditor5";

/** Registers the `fileUpload` toolbar button, which attaches the picked files and links them. */
export default class FileUploadUI extends Plugin {
    static get pluginName() {
        return "FileUploadUI" as const;
    }

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("fileUpload", (locale) => {
            const button = new FileDialogButtonView(locale);
            button.set({
                label: editor.t("Attach file"),
                icon: IconPaperClip,
                tooltip: true,
                allowMultipleFiles: true
            });

            const command = editor.commands.get("fileUpload");
            if (command) {
                button.bind("isEnabled").to(command);
            }

            button.on<FileInputViewDoneEvent>("done", (_evt, files) => {
                editor.execute("fileUpload", { file: Array.from(files) });
                editor.editing.view.focus();
            });

            return button;
        });
    }
}
