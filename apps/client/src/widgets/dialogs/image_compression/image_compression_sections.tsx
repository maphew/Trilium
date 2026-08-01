import "./image_compression_sections.css";

import { IMAGE_JPEG_HANDLINGS, IMAGE_PNG_HANDLINGS } from "@triliumnext/commons";
import clsx from "clsx";

import { t } from "../../../services/i18n";
import { CardSection } from "../../react/Card";
import ContextualHelp from "../../react/ContextualHelp";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import SegmentedChoice from "../../react/SegmentedChoice";
import Slider from "../../react/Slider";
import {
    type ImageCompressionToolOptions,
    MAX_QUALITY,
    MIN_MAX_WIDTH_HEIGHT,
    MIN_QUALITY,
    QUALITY_STEP
} from "./image_compression_options";

/**
 * The rows that configure an image compression run, each a `CardSection` of its own so a host shows
 * only the ones that mean anything where it stands — the dialog drops the subtree row for a single
 * image, and drops a format's row entirely when the image being compressed is not of that format.
 *
 * Each format is one exclusive choice rather than a set of switches, because only one thing can
 * ever become of a given image. What qualifies a choice is nested beneath it and appears only while
 * that choice is the one taken, so nothing on screen is a figure no longer in force.
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
 * Scaling an oversized image down, with the bound it is scaled to. The bound appears only while the
 * step is on: with it off nothing is measured against it, so a figure sitting there would read as
 * one still in force.
 */
export function ResizeImageSection(props: ImageCompressionSectionProps) {
    const { options, onChange, disabled } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.resize}
            subSections={[ <MaxImageDimensionsSection key="max-dimensions" {...props} /> ]}
        >
            <span className="image-compression-section-title">
                {t("space_usage.compress_resize")}
                <ContextualHelp helpMessage={t("space_usage.compress_resize_help")} />
            </span>
            <FormToggle
                disabled={disabled}
                currentValue={options.resize}
                onChange={(value) => onChange({ resize: value })}
            />
        </CardSection>
    );
}

/** The bound an image is scaled down to fit. */
export function MaxImageDimensionsSection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section image-compression-section-nested">
            <span className="image-compression-section-title">{t("space_usage.compress_max_dimensions")}</span>
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
 * What becomes of an already-lossy image. Recompressing brings its own quality with it, nested
 * underneath — it governs that choice and nothing else, an image merely being scaled going out at a
 * near-lossless quality of the server's own.
 */
export function JpegHandlingSection(props: ImageCompressionSectionProps) {
    const { options, onChange } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.jpegHandling === "compress"}
            subSections={[ <JpegQualitySection key="quality" {...props} /> ]}
        >
            <HandlingChoice
                {...props}
                title={t("space_usage.compress_jpeg_handling")}
                help={t("space_usage.compress_jpeg_handling_help")}
                values={IMAGE_JPEG_HANDLINGS}
                currentValue={options.jpegHandling}
                labelKey="compress_jpeg"
                onChoose={(jpegHandling) => onChange({ jpegHandling })}
            />
        </CardSection>
    );
}

/**
 * What becomes of a lossless image — one exclusive choice, because only one of the three can ever
 * happen to it: it survives as it is, survives smaller, or stops being a PNG. Converting brings its
 * own quality with it, nested underneath, since someone converting a pristine original may well
 * want more quality there than they would spend recompressing something already lossy.
 */
export function PngHandlingSection(props: ImageCompressionSectionProps) {
    const { options, onChange } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.pngHandling === "jpeg"}
            subSections={[ <ConversionQualitySection key="conversion-quality" {...props} /> ]}
        >
            <HandlingChoice
                {...props}
                title={t("space_usage.compress_png_handling")}
                help={t("space_usage.compress_png_handling_help")}
                values={IMAGE_PNG_HANDLINGS}
                currentValue={options.pngHandling}
                labelKey="compress_png"
                onChoose={(pngHandling) => onChange({ pngHandling })}
            />
        </CardSection>
    );
}

/** The quality an already-lossy image is recompressed at. */
export function JpegQualitySection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <QualitySlider
            value={options.quality}
            disabled={disabled}
            onChange={(quality) => onChange({ quality })}
        />
    );
}

/** The quality a converted lossless image is written at, kept apart from the one above. */
export function ConversionQualitySection({ options, onChange, disabled }: ImageCompressionSectionProps) {
    return (
        <QualitySlider
            value={options.conversionQuality}
            disabled={disabled}
            onChange={(conversionQuality) => onChange({ conversionQuality })}
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
 * Said in place of a format's choice when the image being compressed is of neither kind the run can
 * act on. Better than an empty card: the dialog opened, and the reason nothing is on offer is the
 * one thing it can usefully say.
 */
export function UnsupportedFormatNotice() {
    return (
        <CardSection className="image-compression-notice">
            {t("space_usage.compress_unsupported_format")}
        </CardSection>
    );
}

/** The title, help and buttons every format choice is made of. */
function HandlingChoice<T extends string>({ title, help, values, currentValue, labelKey, onChoose, disabled }: {
    title: string;
    help: string;
    values: readonly T[];
    currentValue: T;
    /** Prefix of the translation key naming each choice, completed with the value itself. */
    labelKey: string;
    onChoose: (value: T) => void;
} & ImageCompressionSectionProps) {
    return (
        <>
            <span className="image-compression-section-title">
                {title}
                <ContextualHelp helpMessage={help} />
            </span>
            <SegmentedChoice
                className="image-compression-section-choice"
                // A disabled group highlights nothing rather than showing a choice it will not take.
                currentValue={disabled ? "" : currentValue}
                options={values.map((value) => ({ value, label: t(`space_usage.${labelKey}_${value}`) }))}
                onChange={(value) => !disabled && onChoose(value)}
            />
        </>
    );
}

/**
 * The row both qualities are made of: a title, the current figure, and the slider it reads.
 *
 * The figure sits between the two rather than inside the title — a slider says which way it is
 * going but never where it is, and the reading belongs beside the control it reads. Always nested,
 * each quality qualifying exactly one choice above it.
 */
function QualitySlider({ value, onChange, disabled }: {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    return (
        <CardSection className={clsx("image-compression-section", "image-compression-section-nested")}>
            <span className="image-compression-section-title">{t("space_usage.compress_quality")}</span>
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
