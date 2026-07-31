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
 * The rows that configure an image compression run, each a `CardSection` of its own so a host picks
 * the ones that mean anything where it stands: the compression dialog drops the subtree row for an
 * attachment, which has no subtree, and the cleanup tool will drop it too, being database-wide.
 *
 * A figure is nested under a switch only where it qualifies that switch alone — the bound under
 * scaling, which is the only step that measures against it. The JPEG quality stands on its own,
 * being in force for every step that writes a JPEG, which is all of them.
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

/**
 * Scaling oversized images down, with the bound they are scaled to. The bound appears only while
 * the step is on: with it off nothing is measured against it, so a figure sitting there would read
 * as one still in force.
 */
export function ReduceResolutionSection(props: ImageCompressionSectionProps) {
    const { options, onChange, disabled } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.resize}
            subSections={[ <MaxImageDimensionsSection key="max-dimensions" {...props} /> ]}
        >
            <span className="image-compression-section-title">
                {t("space_usage.compress_reduce_resolution")}
                <ContextualHelp helpMessage={t("space_usage.compress_reduce_resolution_help")} />
            </span>
            <FormToggle
                disabled={disabled}
                currentValue={options.resize}
                onChange={(value) => onChange({ resize: value })}
            />
        </CardSection>
    );
}

/** The bound images are scaled down to fit. Labelled as the image settings label it. */
export function MaxImageDimensionsSection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section image-compression-section-nested">
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
 * Recompressing images that are already lossy, at whatever {@link JpegQualitySection} is set to.
 * Says nothing about lossless ones — that is {@link ConvertLosslessSection}'s to answer.
 */
export function ReencodeImagesSection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section">
            <span className="image-compression-section-title">
                {t("space_usage.compress_reencode")}
                <ContextualHelp helpMessage={t("space_usage.compress_reencode_help")} />
            </span>
            <FormToggle
                disabled={disabled}
                currentValue={options.reencode}
                onChange={(value) => onChange({ reencode: value })}
            />
        </CardSection>
    );
}

/**
 * Letting lossless images be re-encoded as lossy ones. A choice of its own rather than part of the
 * row above: squeezing the JPEGs harder is no reason to stop a PNG being a PNG, and this is the one
 * step that changes what kind of image a file is.
 */
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

/**
 * The quality any JPEG is written at. A row in its own right rather than a qualifier of the
 * re-encoding step, because it governs more than that step does: scaling a JPEG has to write one
 * back whether or not re-encoding was asked for, so the quality is in force there too.
 *
 * The figure sits between the title and the slider rather than inside the title: a slider says
 * which way it is going but never where it is, and the reading belongs beside the control it reads.
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
