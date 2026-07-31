import "./image_compression_dialog.css";

import { render } from "preact";
import { useState } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import Button from "../../../../react/Button";
import { Card } from "../../../../react/Card";
import { useTriliumOptionJson } from "../../../../react/hooks";
import Modal from "../../../../react/Modal";
import {
    type ImageCompressionToolOptions,
    readImageCompressionOptions
} from "./image_compression_options";
import { ImageCompressionSections } from "./image_compression_sections";

/**
 * Opens the image compression dialog, and resolves once it has closed: the settings the user
 * confirmed, or `null` if they backed out. The run itself is the caller's to make — nothing here
 * touches the database.
 *
 * Mounted on demand into a host of its own, as the cleanup dialog is: a dialog reached from a
 * context menu has no place sitting in the page that merely *could* open it.
 */
export function showImageCompressionDialog(): Promise<ImageCompressionToolOptions | null> {
    return new Promise((resolve) => {
        const host = document.body.appendChild(document.createElement("div"));

        render(
            <ImageCompressionDialog onFinished={(options) => {
                resolve(options);
                render(null, host);
                host.remove();
            }} />,
            host
        );
    });
}

/**
 * How the images a note holds are to be recompressed. Every setting is written straight back to the
 * stored option as it changes, so the next run opens where this one left off whether or not it was
 * carried through — the same bargain the cleanup tool makes.
 */
function ImageCompressionDialog({ onFinished }: { onFinished: (options: ImageCompressionToolOptions | null) => void }) {
    const [ shown, setShown ] = useState(true);
    const [ stored, setStored ] = useTriliumOptionJson<Partial<ImageCompressionToolOptions>>("imageCompressionToolOptions");
    const [ options, setOptions ] = useState<ImageCompressionToolOptions>(() => readImageCompressionOptions(stored));
    const update = (patch: Partial<ImageCompressionToolOptions>) => {
        const next = { ...options, ...patch };
        setOptions(next);
        void setStored(next);
    };

    // What the dialog was closed *for*, held across the close: the answer is delivered once the
    // dialog is out of the way, by which time the state it was configured from is on its way out too.
    const [ confirmed, setConfirmed ] = useState<ImageCompressionToolOptions | null>(null);

    return (
        <Modal
            className="image-compression-dialog"
            title={t("space_usage.compress_title")}
            size="sm"
            minWidth={COMPRESSION_DIALOG_MIN_WIDTH}
            show={shown}
            onHidden={() => onFinished(confirmed)}
            footer={<>
                <Button text={t("space_usage.compress_cancel")} onClick={() => setShown(false)} />
                <Button
                    text={t("space_usage.compress_run")}
                    kind="primary"
                    onClick={() => {
                        setConfirmed(options);
                        setShown(false);
                    }}
                />
            </>}
            stackable
        >
            <Card className="image-compression-settings">
                <ImageCompressionSections options={options} onChange={update} />
            </Card>
        </Modal>
    );
}

/**
 * The width the dialog starts at, narrow on purpose: four settings read top to bottom rather than
 * scanned across. A floor rather than a size — row titles never wrap, so a long translation widens
 * the dialog instead of folding onto a second line (see the sections' stylesheet).
 */
const COMPRESSION_DIALOG_MIN_WIDTH = "420px";
