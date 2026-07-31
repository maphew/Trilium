import "./image_compression_dialog.css";

import type { ImageCompressionResponse } from "@triliumnext/commons";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import toast from "../../../../../services/toast";
import Button from "../../../../react/Button";
import { Card } from "../../../../react/Card";
import { useTriliumOptionJson } from "../../../../react/hooks";
import Modal from "../../../../react/Modal";
import {
    compressionResultMessage,
    IMAGE_COMPRESSION_TOAST_ID,
    type ImageCompressionTarget,
    runImageCompression
} from "./image_compression_operation";
import {
    hasWorkToDo,
    type ImageCompressionToolOptions,
    readImageCompressionOptions
} from "./image_compression_options";
import {
    ConvertLosslessSection,
    JpegQualitySection,
    ProcessChildNotesSection,
    ReduceResolutionSection,
    ReencodeImagesSection
} from "./image_compression_sections";

/**
 * Opens the image compression dialog for one note or one attachment, and resolves once the run it
 * asked for has finished: the report of what was compressed, or `null` if the user backed out.
 * Callers await it to know when their own figures are stale.
 *
 * Mounted on demand into a host of its own, as the cleanup dialog is: a dialog reached from a
 * context menu has no place sitting in the page that merely *could* open it.
 */
export function showImageCompressionDialog(target: ImageCompressionTarget): Promise<ImageCompressionResponse | null> {
    return new Promise((resolve) => {
        const host = document.body.appendChild(document.createElement("div"));

        render(
            <ImageCompressionDialog target={target} onFinished={(result) => {
                resolve(result);
                render(null, host);
                host.remove();
            }} />,
            host
        );
    });
}

/**
 * How the target's images are to be recompressed. Every setting is written straight back to the
 * stored option as it changes, so the next run opens where this one left off whether or not it was
 * carried through — the same bargain the cleanup tool makes.
 */
function ImageCompressionDialog({ target, onFinished }: {
    target: ImageCompressionTarget,
    onFinished: (result: ImageCompressionResponse | null) => void
}) {
    const [ shown, setShown ] = useState(true);
    const [ stored, setStored ] = useTriliumOptionJson<Partial<ImageCompressionToolOptions>>("imageCompressionToolOptions");
    const [ options, setOptions ] = useState<ImageCompressionToolOptions>(() => readImageCompressionOptions(stored));
    const update = (patch: Partial<ImageCompressionToolOptions>) => {
        const next = { ...options, ...patch };
        setOptions(next);
        void setStored(next);
    };

    // What the run was asked to do, held across the close: the operation starts once the dialog is
    // out of the way, by which time the state it was configured from is on its way out too.
    const pending = useRef<ImageCompressionToolOptions | null>(null);
    const sectionProps = { options, onChange: update };

    async function runPendingCompression() {
        const settings = pending.current;

        if (!settings) {
            onFinished(null);
            return;
        }

        // Nothing here can say how far along it is — the images are compressed server-side and the
        // run reports only once — so a spinner rather than a bar, and nothing to cancel: the server
        // carries on whatever the client does.
        toast.showPersistent({
            id: IMAGE_COMPRESSION_TOAST_ID,
            icon: "bx bx-loader-circle bx-spin",
            message: t("space_usage.compress_running"),
            dismissible: false
        });

        let result: ImageCompressionResponse | null = null;

        try {
            result = await runImageCompression(target, settings);
            toast.showMessage(compressionResultMessage(result), COMPRESSION_DONE_TIMEOUT_MS);
        } catch {
            // Already reported by the request layer, and nothing here can say what the run managed
            // to change before it failed — so it is answered as no run rather than as an empty one.
        } finally {
            toast.closePersistent(IMAGE_COMPRESSION_TOAST_ID);
            onFinished(result);
        }
    }

    return (
        <Modal
            className="image-compression-dialog"
            title={t("space_usage.compress_title")}
            size="sm"
            minWidth={COMPRESSION_DIALOG_MIN_WIDTH}
            show={shown}
            onHidden={() => void runPendingCompression()}
            footer={<>
                <Button text={t("space_usage.compress_cancel")} onClick={() => setShown(false)} />
                <Button
                    text={t("space_usage.compress_run")}
                    kind="primary"
                    // Neither step switched on would visit every image and change none of them:
                    // a run that provably does nothing is not one to offer.
                    disabled={!hasWorkToDo(options)}
                    onClick={() => {
                        pending.current = options;
                        setShown(false);
                    }}
                />
            </>}
            stackable
        >
            <Card className="image-compression-settings">
                <ReduceResolutionSection {...sectionProps} />
                <ReencodeImagesSection {...sectionProps} />
                <ConvertLosslessSection {...sectionProps} />
                {/* Not nested under either: every step above writes a JPEG on some image or other,
                    so the quality is in force whichever of them is on. */}
                <JpegQualitySection {...sectionProps} />
                {/* An attachment is one image; there is no subtree under it to reach into. */}
                {target.type === "note" && <ProcessChildNotesSection {...sectionProps} />}
            </Card>
        </Modal>
    );
}

/**
 * The width the dialog starts at, narrow on purpose: a few settings read top to bottom rather than
 * scanned across. A floor rather than a size — row titles never wrap, so a long translation widens
 * the dialog instead of folding onto a second line (see the sections' stylesheet).
 */
const COMPRESSION_DIALOG_MIN_WIDTH = "420px";

/**
 * Longer than the default couple of seconds: this reports on something that ran unattended and has
 * three figures worth reading, and it is the only account of a run the user will get.
 */
const COMPRESSION_DONE_TIMEOUT_MS = 15000;
