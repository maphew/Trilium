import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tesseract.js so no real OCR model is ever loaded.
const mockWorker = {
    recognize: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined)
};

const mockTesseract = {
    createWorker: vi.fn()
};

vi.mock('tesseract.js', () => ({
    default: mockTesseract
}));

// Avoid touching the real filesystem for the worker cache directory.
vi.mock('fs', () => ({
    default: {
        mkdirSync: vi.fn()
    }
}));

vi.mock('../../data_dir.js', () => ({
    default: {
        OCR_CACHE_DIR: '/tmp/trilium-ocr-test-cache'
    }
}));

const mockOptions = {
    getOption: vi.fn()
};

const mockLog = {
    info: vi.fn(),
    error: vi.fn()
};

vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        options: mockOptions,
        getLog: () => mockLog
    };
});

let ImageProcessor: typeof import('./image_processor.js').ImageProcessor;

beforeEach(async () => {
    vi.clearAllMocks();
    mockOptions.getOption.mockReturnValue('0');
    mockTesseract.createWorker.mockResolvedValue(mockWorker);
    ({ ImageProcessor } = await import('./image_processor.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const buffer = Buffer.from('fake-image');

/**
 * A recognition result in the shape tesseract.js actually answers with when the `blocks` output
 * format is requested: the words are nested under blocks → paragraphs → lines, and there is no
 * top-level `words` array to read them from.
 */
function pageWithLines(confidence: number, lines: [ text: string, confidence: number ][][]) {
    return {
        text: lines.map(line => line.map(([ text ]) => text).join(' ')).join('\n'),
        confidence,
        blocks: [ {
            paragraphs: [ {
                lines: lines.map(line => ({
                    text: line.map(([ text ]) => text).join(' '),
                    words: line.map(([ text, wordConfidence ]) => ({ text, confidence: wordConfidence }))
                }))
            } ]
        } ]
    };
}

/** What a recognition with no readable text answers with: text, a score, and `blocks: null`. */
function pageWithoutBlocks(text: string, confidence: number) {
    return { text, confidence, blocks: null };
}

describe('ImageProcessor', () => {
    it('reports the MIME types it can process', () => {
        const processor = new ImageProcessor();

        expect(processor.canProcess('image/PNG')).toBe(true);
        expect(processor.canProcess('image/jpeg')).toBe(true);
        expect(processor.canProcess('application/pdf')).toBe(false);
        // tesseract.js cannot decode TIFF (Leptonica built without libtiff)
        expect(processor.canProcess('image/tiff')).toBe(false);
        expect(processor.getSupportedMimeTypes()).toContain('image/png');
        expect(processor.getProcessingType()).toBe('image');
    });

    it('extracts text and returns it untrimmed-confidence when no threshold is set', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: { text: '  hello world  ', confidence: 88, blocks: null }
        });

        const result = await processor.extractText(buffer, { language: 'eng' });

        expect(result.text).toBe('hello world');
        expect(result.confidence).toBeCloseTo(0.88);
        expect(result.language).toBe('eng');
        expect(result.pageCount).toBe(1);
        expect(mockTesseract.createWorker).toHaveBeenCalledWith(
            'eng',
            1,
            expect.objectContaining({ cachePath: '/tmp/trilium-ocr-test-cache' })
        );
    });

    it('asks tesseract for the per-word breakdown the confidence filter needs', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({ data: pageWithLines(80, [ [ [ 'x', 80 ] ] ]) });

        await processor.extractText(buffer, { language: 'eng' });

        // Without this output format the result carries the plain text alone, and every image is
        // judged by its mean confidence instead of word by word.
        expect(mockWorker.recognize).toHaveBeenCalledWith(buffer, {}, { blocks: true });
    });

    it('defaults the language to eng when none is supplied', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: pageWithLines(50, [ [ [ 'x', 50 ] ] ])
        });

        await processor.extractText(buffer);

        expect(mockTesseract.createWorker).toHaveBeenCalledWith('eng', 1, expect.anything());
    });

    it('reuses the worker for the same language and recreates it when the language changes', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: pageWithLines(50, [ [ [ 'a', 50 ] ] ])
        });

        await processor.extractText(buffer, { language: 'eng' });
        await processor.extractText(buffer, { language: 'eng' });
        expect(mockTesseract.createWorker).toHaveBeenCalledTimes(1);
        expect(mockWorker.terminate).not.toHaveBeenCalled();

        await processor.extractText(buffer, { language: 'deu' });
        expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
        expect(mockTesseract.createWorker).toHaveBeenCalledTimes(2);
    });

    it('invokes the recognizing-text logger callback', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: pageWithLines(50, [ [ [ 'a', 50 ] ] ])
        });

        await processor.extractText(buffer, { language: 'eng' });

        const config = mockTesseract.createWorker.mock.calls[0][2];
        config.logger({ status: 'recognizing text', progress: 0.5 });
        config.logger({ status: 'loading', progress: 0.1 });

        expect(mockLog.info).toHaveBeenCalledWith(
            expect.stringContaining('Image OCR progress')
        );
    });

    it('passes an errorHandler that logs worker errors instead of rethrowing them', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockResolvedValue({
            data: pageWithLines(50, [ [ [ 'a', 50 ] ] ])
        });

        await processor.extractText(buffer, { language: 'eng' });

        // Without an errorHandler, tesseract.js turns job failures into uncaught
        // exceptions, which surface as Electron's "JavaScript error" dialog (#9754).
        const config = mockTesseract.createWorker.mock.calls[0][2];
        expect(() => config.errorHandler('Error attempting to read image.')).not.toThrow();
        expect(mockLog.error).toHaveBeenCalledWith(
            'Tesseract worker error: Error attempting to read image.'
        );
    });

    it('propagates and logs recognition errors', async () => {
        const processor = new ImageProcessor();
        mockWorker.recognize.mockRejectedValue(new Error('recognize failed'));

        await expect(processor.extractText(buffer, { language: 'eng' })).rejects.toThrow(
            'recognize failed'
        );
        expect(mockLog.error).toHaveBeenCalledWith(
            expect.stringContaining('Image OCR text extraction failed')
        );
    });

    describe('confidence filtering', () => {
        it('keeps the words above the threshold on the lines they were read on', async () => {
            mockOptions.getOption.mockReturnValue('0.8');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithLines(70, [
                    [ [ 'good', 90 ], [ 'bad', 50 ] ],
                    [ [ 'also', 95 ], [ 'good', 85 ] ]
                ])
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('good\nalso good');
            expect(result.confidence).toBeCloseTo((0.9 + 0.95 + 0.85) / 3);
        });

        it('keeps well-read words on an image whose mean confidence is below the threshold', async () => {
            // The mean is dragged under the line by the marks Tesseract misread as text, which is
            // exactly what the per-word filter is for — judging the image by that mean instead
            // would throw away every word on it.
            mockOptions.getOption.mockReturnValue('0.75');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithLines(60, [ [ [ 'Invoice', 96 ], [ '®', 0 ], [ 'total', 94 ] ] ])
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('Invoice total');
        });

        it('leaves no blank line where every word of one was dropped', async () => {
            mockOptions.getOption.mockReturnValue('0.8');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithLines(70, [
                    [ [ 'kept', 90 ] ],
                    [ [ 'noise', 10 ] ],
                    [ [ 'also-kept', 90 ] ]
                ])
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('kept\nalso-kept');
        });

        it('returns empty text and no confidence when no word passes the threshold', async () => {
            mockOptions.getOption.mockReturnValue('0.99');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithLines(10, [ [ [ 'low', 10 ] ] ])
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('');
            expect(result.confidence).toBe(0);
        });

        it('falls back to overall confidence when nothing was broken down into words', async () => {
            mockOptions.getOption.mockReturnValue('0.5');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithoutBlocks('  whole text  ', 80)
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('whole text');
            expect(result.confidence).toBeCloseTo(0.8);
        });

        it('drops all text via the fallback when overall confidence is too low', async () => {
            mockOptions.getOption.mockReturnValue('0.9');
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithoutBlocks('whole text', 40)
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('');
            expect(result.confidence).toBeCloseTo(0.4);
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining('Entire text filtered out')
            );
        });

        it('defaults the threshold to 0 when the option is null', async () => {
            mockOptions.getOption.mockReturnValue(null);
            const processor = new ImageProcessor();
            mockWorker.recognize.mockResolvedValue({
                data: pageWithLines(30, [ [ [ 'kept', 30 ] ] ])
            });

            const result = await processor.extractText(buffer, { language: 'eng' });

            expect(result.text).toBe('kept');
        });
    });
});
