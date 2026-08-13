import { options } from '@triliumnext/core';
import fs from 'fs';
import Tesseract from 'tesseract.js';

import dataDirs from '../../data_dir.js';
import { getLog } from "@triliumnext/core";
import { OCRProcessingOptions,OCRResult } from '../ocr_service.js';
import { FileProcessor } from './file_processor.js';

/**
 * Image processor for extracting text from image files using Tesseract
 */
export class ImageProcessor extends FileProcessor {
    private worker: Tesseract.Worker | null = null;
    private currentLanguage: string | null = null;
    // Formats that tesseract.js can actually decode (see its docs/image-format.md);
    // TIFF is deliberately absent — Leptonica in tesseract.js-core is built without libtiff,
    // so TIFF buffers always fail with "Error attempting to read image".
    private readonly supportedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/bmp',
        'image/webp'
    ];

    canProcess(mimeType: string): boolean {
        return this.supportedTypes.includes(mimeType.toLowerCase());
    }

    getSupportedMimeTypes(): string[] {
        return [...this.supportedTypes];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        const language = options.language || "eng";
        const worker = await this.ensureWorker(language);

        try {
            getLog().info(`Starting image OCR text extraction (language: ${language})...`);

            // The per-word breakdown the confidence filter runs on is an opt-in output format:
            // by default `recognize` answers with the plain text and nothing else, leaving the
            // filter with only the whole image's mean confidence to judge by.
            const result = await worker.recognize(buffer, {}, { blocks: true });

            // Filter text based on minimum confidence threshold
            const { filteredText, overallConfidence } = this.filterTextByConfidence(result.data);

            const ocrResult: OCRResult = {
                text: filteredText,
                confidence: overallConfidence,
                extractedAt: new Date().toISOString(),
                language,
                pageCount: 1
            };

            return ocrResult;

        } catch (error) {
            getLog().error(`Image OCR text extraction failed: ${error}`);
            throw error;
        }
    }

    getProcessingType(): string {
        return 'image';
    }

    /**
     * Ensures a Tesseract worker is ready for the given language, and hands it back.
     * Creates a new worker if none exists or if the language has changed.
     */
    private async ensureWorker(language: string): Promise<Tesseract.Worker> {
        if (this.worker && this.currentLanguage === language) {
            return this.worker;
        }

        if (this.worker) {
            await this.worker.terminate();
        }

        fs.mkdirSync(dataDirs.OCR_CACHE_DIR, { recursive: true });

        getLog().info(`Initializing Tesseract worker for language(s): ${language}`);
        this.worker = await Tesseract.createWorker(language, 1, {
            cachePath: dataDirs.OCR_CACHE_DIR,
            // Without an errorHandler, tesseract.js rethrows job failures (e.g. undecodable
            // images) from its worker message handler as uncaught exceptions — in the desktop
            // app that surfaces as Electron's blocking "JavaScript error" dialog (#9754).
            // The job promise still rejects, so callers handle the failure normally.
            errorHandler: (error: unknown) => {
                getLog().error(`Tesseract worker error: ${error}`);
            },
            logger: (m: { status: string; progress: number }) => {
                if (m.status === 'recognizing text') {
                    getLog().info(`Image OCR progress (${language}): ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        this.currentLanguage = language;
        return this.worker;
    }


    /**
     * Filter text based on minimum confidence threshold.
     *
     * Word by word, because the words Tesseract is least sure of are usually not words at all —
     * a border read as punctuation, a speck read as a comma — and it is those that drag the mean
     * for the image down. Judging the image by that mean throws away every well-read word on it
     * along with them, so what is kept is decided per word and reassembled line by line, leaving
     * the text laid out as it is on the picture.
     */
    private filterTextByConfidence(data: Tesseract.Page): { filteredText: string; overallConfidence: number } {
        const minConfidence = this.getMinConfidenceThreshold();

        // If no minimum confidence set, return original text
        if (minConfidence <= 0) {
            return {
                filteredText: data.text.trim(),
                overallConfidence: data.confidence / 100
            };
        }

        const lines = getRecognizedLines(data);

        // Nothing was broken down into words — an image nothing could be read from. There is only
        // the one score to go by, so the text stands or falls as a whole.
        if (lines.length === 0) {
            const overallConfidence = data.confidence / 100;
            if (overallConfidence >= minConfidence) {
                return {
                    filteredText: data.text.trim(),
                    overallConfidence
                };
            }
            getLog().info(`Entire text filtered out due to low confidence ${overallConfidence} (below threshold ${minConfidence})`);
            return {
                filteredText: '',
                overallConfidence
            };
        }

        const keptLines: string[] = [];
        const keptConfidences: number[] = [];
        let totalWords = 0;

        for (const line of lines) {
            const keptWords: string[] = [];

            for (const word of line.words ?? []) {
                totalWords++;
                const wordConfidence = word.confidence / 100; // Convert to decimal

                if (wordConfidence >= minConfidence) {
                    keptWords.push(word.text);
                    keptConfidences.push(wordConfidence);
                }
            }

            // A line every word of which was dropped leaves no blank behind: the gap would read as
            // spacing on the picture that isn't there.
            if (keptWords.length > 0) {
                keptLines.push(keptWords.join(' '));
            }
        }

        // Calculate average confidence of accepted words
        const averageConfidence = keptConfidences.length > 0
            ? keptConfidences.reduce((sum, conf) => sum + conf, 0) / keptConfidences.length
            : 0;

        const filteredText = keptLines.join('\n').trim();

        getLog().info(`Filtered OCR text: ${keptConfidences.length} words kept out of ${totalWords} total words (min confidence: ${minConfidence})`);

        return {
            filteredText,
            overallConfidence: averageConfidence
        };
    }

    /**
     * Get minimum confidence threshold from options
     */
    private getMinConfidenceThreshold(): number {
        const minConfidence = options.getOption('ocrMinConfidence') ?? 0;
        return parseFloat(minConfidence);
    }

}

/**
 * The words Tesseract read, in the lines it read them on.
 *
 * They sit three levels down the page it describes, and that description is only present when the
 * `blocks` output format was asked for — see {@link ImageProcessor.extractText}. Without it, and
 * for an image nothing was read from, this is empty.
 */
function getRecognizedLines(data: Tesseract.Page): Tesseract.Line[] {
    return (data.blocks ?? []).flatMap(
        block => (block.paragraphs ?? []).flatMap(paragraph => paragraph.lines ?? [])
    );
}
