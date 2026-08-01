import "./image_compression_sections.css";

import { IMAGE_PNG_HANDLINGS } from "@triliumnext/commons";
import clsx from "clsx";

import { t } from "../../../../../services/i18n";
import { CardSection } from "../../../../react/Card";
import ContextualHelp from "../../../../react/ContextualHelp";
import { FormTextBoxWithUnit } from "../../../../react/FormTextBox";
import FormToggle from "../../../../react/FormToggle";
import SegmentedChoice from "../../../../react/SegmentedChoice";
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
 * What becomes of a PNG — one exclusive choice rather than a set of switches, because only one of
 * the three can ever happen to a given image: it survives as it is, survives smaller, or stops
 * being a PNG. Two toggles would claim they combine, and they do not.
 *
 * Converting brings its own quality with it, nested underneath: it is the only setting that
 * qualifies this choice alone, and someone converting a pristine original may well want more
 * quality here than they would spend recompressing an image that is already lossy.
 */
export function PngHandlingSection(props: ImageCompressionSectionProps) {
    const { options, onChange, disabled } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.pngHandling === "jpeg"}
            subSections={[ <ConversionQualitySection key="conversion-quality" {...props} /> ]}
        >
            <span className="image-compression-section-title">
                {t("space_usage.compress_png_handling")}
                <ContextualHelp helpMessage={t("space_usage.compress_png_handling_help")} />
            </span>
            <SegmentedChoice
                className="image-compression-section-choice"
                currentValue={disabled ? "" : options.pngHandling}
                options={IMAGE_PNG_HANDLINGS.map((value) => ({
                    value,
                    label: t(`space_usage.compress_png_${value}`)
                }))}
                onChange={(value) => !disabled && onChange({ pngHandling: value })}
            />
        </CardSection>
    );
}

/** The quality a converted PNG is written at, kept apart from the recompression quality above. */
export function ConversionQualitySection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <QualitySlider
            label={t("space_usage.compress_quality")}
            value={options.conversionQuality}
            disabled={disabled}
            onChange={(value) => onChange({ conversionQuality: value })}
            nested
        />
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
        <QualitySlider
            label={t("images.jpeg_quality")}
            value={options.quality}
            disabled={disabled}
            onChange={(value) => onChange({ quality: value })}
        />
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

/**
 * The row shared by both qualities: a title, the current figure, and the slider it reads.
 *
 * The figure sits between the two rather than inside the title — a slider says which way it is
 * going but never where it is, and the reading belongs beside the control it reads.
 */
function QualitySlider({ label, value, onChange, disabled, nested }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
    nested?: boolean;
}) {
    return (
        <CardSection className={clsx("image-compression-section", nested && "image-compression-section-nested")}>
            <span className="image-compression-section-title">{label}</span>
            <span className="image-compression-section-value">
                {t("space_usage.compress_quality_value", { quality: value })}
            </span>
            <Slider
                min={MIN_QUALITY}
                max={MAX_QUALITY}
                step={QUALITY_STEP}
                disabled={disabled}
                value={value}
                onChange={onChange}
            />
        </CardSection>
    );
}
