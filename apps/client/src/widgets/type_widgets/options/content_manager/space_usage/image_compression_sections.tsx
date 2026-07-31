import "./image_compression_sections.css";

import { t } from "../../../../../services/i18n";
import { CardSection } from "../../../../react/Card";
import ContextualHelp from "../../../../react/ContextualHelp";
import { FormTextBoxWithUnit } from "../../../../react/FormTextBox";
import FormToggle from "../../../../react/FormToggle";
import Slider from "../../../../react/Slider";
import {
    type ImageCompressionToolOptions,
    MAX_QUALITY,
    MIN_MAX_WIDTH_HEIGHT,
    MIN_QUALITY,
    QUALITY_STEP
} from "./image_compression_options";

/**
 * The rows that configure an image compression run, each a `CardSection` of its own so they can be
 * dropped into any card — the compression dialog lists all four, and the cleanup tool will nest them
 * under an item of its own.
 *
 * Every row takes the whole settings object and reports a patch, rather than a value and a setter,
 * so a host wires the group once and adding a row later costs it nothing.
 */
export interface ImageCompressionSectionProps {
    options: ImageCompressionToolOptions;
    onChange(patch: Partial<ImageCompressionToolOptions>): void;
    /** Greys the controls out, for a host that hangs the whole group off a switch of its own. */
    disabled?: boolean;
}

/** All four rows in their reading order, for the common case of wanting the lot. */
export function ImageCompressionSections(props: ImageCompressionSectionProps) {
    return (
        <>
            <MaxImageDimensionsSection {...props} />
            <JpegQualitySection {...props} />
            <ConvertLosslessSection {...props} />
            <ProcessChildNotesSection {...props} />
        </>
    );
}

/** The bound images are scaled down to fit. Labelled as the image settings label it. */
export function MaxImageDimensionsSection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section">
            <span className="image-compression-section-title">{t("images.max_image_dimensions")}</span>
            <FormTextBoxWithUnit
                className="image-compression-section-number"
                type="number"
                min={MIN_MAX_WIDTH_HEIGHT}
                disabled={disabled}
                unit={t("images.max_image_dimensions_unit")}
                currentValue={String(options.maxWidthHeight)}
                onChange={(value) => onChange({
                    maxWidthHeight: Math.max(parseInt(value, 10) || MIN_MAX_WIDTH_HEIGHT, MIN_MAX_WIDTH_HEIGHT)
                })}
            />
        </CardSection>
    );
}

/**
 * The quality re-encoded images are written at. The figure sits between the title and the slider
 * rather than inside the title: a slider says which way it is going but never where it is, and the
 * reading belongs beside the control it reads.
 */
export function JpegQualitySection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section">
            <span className="image-compression-section-title">{t("images.jpeg_quality")}</span>
            <span className="image-compression-section-value">{t("space_usage.compress_quality_value", { quality: options.quality })}</span>
            <Slider
                min={MIN_QUALITY}
                max={MAX_QUALITY}
                step={QUALITY_STEP}
                disabled={disabled}
                value={options.quality}
                onChange={(value) => onChange({ quality: value })}
            />
        </CardSection>
    );
}

/** Whether PNGs may be re-encoded as JPEG — the choice that actually costs quality. */
export function ConvertLosslessSection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section">
            <span className="image-compression-section-title">
                {t("space_usage.compress_convert_lossless")}
                <ContextualHelp helpMessage={t("space_usage.compress_convert_lossless_help")} />
            </span>
            <FormToggle
                disabled={disabled}
                currentValue={options.convertLossless}
                onChange={(value) => onChange({ convertLossless: value })}
            />
        </CardSection>
    );
}

/** Whether the run reaches past the note it was invoked on, into its whole subtree. */
export function ProcessChildNotesSection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section">
            <span className="image-compression-section-title">
                {t("space_usage.compress_process_child_notes")}
                <ContextualHelp helpMessage={t("space_usage.compress_process_child_notes_help")} />
            </span>
            <FormToggle
                disabled={disabled}
                currentValue={options.processChildNotes}
                onChange={(value) => onChange({ processChildNotes: value })}
            />
        </CardSection>
    );
}
