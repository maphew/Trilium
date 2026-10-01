/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10859 ("Upload pic error").
 *
 * The warning handler used to read the listener arguments in the wrong order, so every CKEditor
 * warning threw inside `Notification#fire`. The watchdog reported that as an `unexpected-error`
 * crash and restarted the editor, which reverted the note to its last saved content — the images
 * being uploaded flickered and vanished instead of a "cannot upload" toast appearing.
 */
import type { FileUploadData } from "@triliumnext/ckeditor5";
import { describe, expect, it, vi } from "vitest";

const showError = vi.hoisted(() => vi.fn());
const showErrorTitleAndMessage = vi.hoisted(() => vi.fn());
const showMessage = vi.hoisted(() => vi.fn());
const showPersistent = vi.hoisted(() => vi.fn());
const closePersistent = vi.hoisted(() => vi.fn());
vi.mock("../../../services/toast", () => ({
    default: { showError, showErrorTitleAndMessage, showMessage, showPersistent, closePersistent }
}));
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/i18n")>(),
    t: (key: string) => key
}));

// Imported by EditableText for editor types and content styles; irrelevant (and heavy) here.
vi.mock("@triliumnext/ckeditor5", () => ({}));

const {
    onNotificationInfo,
    onNotificationWarning,
    showFileUploadProgress
} = await import("./EditableText");

describe("onNotificationWarning", () => {
    /** The payload `Notification#_showNotification` builds, with the `EventInfo` before it. */
    function warn(data: { message: string; title: string }) {
        const evt = { stop: vi.fn() };
        onNotificationWarning(evt, { type: "warning", ...data });
        return evt;
    }

    it("reports a titled warning as a titled toast and stops the event", () => {
        // What a failed upload produces: FileUploadEditing passes the rejection reason as the
        // message and "Upload failed" as the title.
        const message = "Cannot upload file: pic.png.";
        const evt = warn({ message, title: "Upload failed" });

        expect(showErrorTitleAndMessage).toHaveBeenCalledWith("Upload failed", message);
        expect(showError).not.toHaveBeenCalled();
        // Stopping the event is what keeps the notification plugin's `window.alert` fallback away.
        expect(evt.stop).toHaveBeenCalledOnce();
    });

    it("reports an untitled warning as a plain toast rather than dropping it", () => {
        vi.clearAllMocks();
        // `showWarning` leaves the title an empty string when the caller supplies none.
        const evt = warn({ message: "Something went wrong.", title: "" });

        expect(showError).toHaveBeenCalledWith("Something went wrong.");
        expect(showErrorTitleAndMessage).not.toHaveBeenCalled();
        expect(evt.stop).toHaveBeenCalledOnce();
    });

    it("stops the event even when there is nothing to report", () => {
        vi.clearAllMocks();
        const evt = warn({ message: "", title: "" });

        expect(showError).not.toHaveBeenCalled();
        expect(showErrorTitleAndMessage).not.toHaveBeenCalled();
        expect(evt.stop).toHaveBeenCalledOnce();
    });
});

describe("onNotificationInfo", () => {
    it("shows the message as a toast and leaves the event running", () => {
        vi.clearAllMocks();
        const evt = { stop: vi.fn() };
        onNotificationInfo(evt, { type: "info", message: "Rows sorted.", title: "" });

        expect(showMessage).toHaveBeenCalledWith("Rows sorted.");
        expect(evt.stop).not.toHaveBeenCalled();
    });
});

describe("showFileUploadProgress", () => {
    it("shows the progress of an upload in a toast until the upload ends", async () => {
        vi.clearAllMocks();
        let finish = () => {};
        const done = new Promise<void>((resolve) => {
            finish = () => resolve();
        });
        const listeners = new Map<string, () => void>();
        const loader = {
            id: "loader1",
            uploadedPercent: 0,
            on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
            off: vi.fn()
        };

        const upload = { fileName: "report.pdf", loader, done } as unknown as FileUploadData;

        showFileUploadProgress({}, upload);
        expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            id: "file-upload-loader1",
            title: "editable_text.uploading_attachment",
            message: "report.pdf",
            progress: 0,
            dismissible: false
        }));

        loader.uploadedPercent = 40;
        listeners.get("change:uploadedPercent")?.();
        expect(showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            id: "file-upload-loader1",
            progress: 0.4
        }));
        expect(closePersistent).not.toHaveBeenCalled();

        finish();
        await done;
        expect(closePersistent).toHaveBeenCalledWith("file-upload-loader1");
        expect(loader.off).toHaveBeenCalledWith(
            "change:uploadedPercent",
            listeners.get("change:uploadedPercent")
        );
    });
});
