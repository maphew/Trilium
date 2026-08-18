// PDF annotation type constants (from PDF spec / pdfjs-dist AnnotationType)
export const AnnotationType = {
    TEXT: 1,
    FREETEXT: 3,
    HIGHLIGHT: 9,
    INK: 15,
} as const;

/**
 * Annotation types we display in the sidebar — one per tool the viewer's editing toolbar offers,
 * plus the sticky notes other editors leave behind. The mapping from tool to type is not the
 * obvious one: a highlight drawn free-hand rather than over selected text is written as Ink, and
 * the text tool produces FreeText, so covering only Highlight hid most of what users draw.
 */
const COMMENT_TYPES = new Set<number>([
    AnnotationType.TEXT,
    AnnotationType.FREETEXT,
    AnnotationType.HIGHLIGHT,
    AnnotationType.INK,
]);

const TYPE_NAMES: Record<number, string> = {
    [AnnotationType.TEXT]: "text",
    [AnnotationType.FREETEXT]: "freetext",
    [AnnotationType.HIGHLIGHT]: "highlight",
    [AnnotationType.INK]: "ink",
};

/**
 * Process a raw PDF.js annotation object into a normalized PdfAnnotationInfo,
 * or return null if it should be skipped.
 */
export function processAnnotation(ann: Record<string, any>, pageNumber: number): PdfAnnotationInfo | null {
    if (!COMMENT_TYPES.has(ann.annotationType)) {
        return null;
    }

    // Both can be empty: a drawing carries no text at all, and pdf.js only fills overlaidText
    // for a highlight whose quadpoints cover extractable glyphs — never on a scanned page. The
    // sidebar labels such an entry by its type, so the annotation is still reachable.
    const contents = ann.contentsObj?.str || "";
    const highlightedText = ann.overlaidText || "";

    return {
        id: ann.id,
        type: resolveTypeName(ann),
        contents,
        highlightedText,
        author: ann.titleObj?.str || "",
        pageNumber,
        color: ann.color ? rgbToHex(ann.color) : null,
        creationDate: ann.creationDate || null,
        modificationDate: ann.modificationDate || null
    };
}

/**
 * The kind the sidebar names an annotation by. A highlight drawn free-hand is stored as an Ink
 * annotation tagged `/IT /InkHighlight` — a storage detail of pdf.js, not something the reader
 * chose, so it is reported as the highlight it is rather than as a drawing.
 */
function resolveTypeName(ann: Record<string, any>): string {
    if (ann.annotationType === AnnotationType.INK && ann.it === "InkHighlight") {
        return TYPE_NAMES[AnnotationType.HIGHLIGHT];
    }

    return TYPE_NAMES[ann.annotationType] ?? "unknown";
}

export async function setupPdfAnnotations() {
    await extractAndSendAnnotations();

    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-scroll-to-annotation") {
            scrollToAnnotation(event.data.annotationId, event.data.pageNumber);
        }
    });
}

/**
 * Must be called AFTER manageSave() so we can chain onto the
 * onSetModified callback it installs.
 */
export function setupAnnotationLiveUpdates() {
    const app = window.PDFViewerApplication!;
    const storage = app.pdfDocument.annotationStorage;

    let debounceTimer: number | null = null;
    const debouncedRefresh = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => extractAndSendAnnotations(), 500);
    };

    // Chain onto the existing onSetModified set by manageSave.
    // Fires when annotations are added/removed.
    const previousOnSetModified = (storage as any).onSetModified;
    (storage as any).onSetModified = () => {
        previousOnSetModified?.();
        debouncedRefresh();
    };

    // Fires when editor properties change (e.g. color, thickness).
    app.eventBus.on("annotationeditorparamschanged", debouncedRefresh);

    // Catches deletions, undo/redo, and comment deletion which
    // don't trigger onSetModified or annotationeditorparamschanged.
    app.eventBus.on("editingstateschanged", debouncedRefresh);
}

async function extractAndSendAnnotations() {
    const app = window.PDFViewerApplication;
    try {
        const annotations = await extractFromDocument(app.pdfDocument);
        sendAnnotations(applyEditorOverrides(annotations, app.pdfDocument.annotationStorage));
    } catch (error) {
        console.error("Error extracting annotations:", error);
        sendAnnotations([]);
    }
}

/**
 * Re-extract annotations from freshly saved PDF bytes.
 * Opens a temporary document to read the latest data (including
 * newly created highlights with their overlaidText), then closes it.
 */
export async function extractFromSavedData(data: ArrayBuffer | Uint8Array) {
    let loadingTask: any;
    try {
        loadingTask = (globalThis as any).pdfjsLib.getDocument({ data });
        const tempDoc = await loadingTask.promise;
        const annotations = await extractFromDocument(tempDoc);
        sendAnnotations(annotations);
    } catch (error) {
        console.error("Error extracting annotations from saved data:", error);
    } finally {
        // PDFDocumentProxy.destroy() was removed in pdf.js v6; tear the temporary
        // document (and its worker) down via the loading task instead.
        await loadingTask?.destroy();
    }
}

async function extractFromDocument(pdfDocument: any): Promise<PdfAnnotationInfo[]> {
    const numPages = pdfDocument.numPages;
    const annotations: PdfAnnotationInfo[] = [];

    for (let i = 1; i <= numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const pageAnnotations = await page.getAnnotations({ intent: "display" });

        for (const ann of pageAnnotations) {
            const processed = processAnnotation(ann, i);
            if (processed) {
                annotations.push(processed);
            }
        }
    }

    return annotations;
}

/**
 * Layers the in-session editing state over the annotations read from the document: until a
 * save is written back, deletions and edits live only in the editor, not in the file.
 *
 * Returns a new array rather than removing entries from the one being iterated — splicing
 * shifted the following annotation into the index the loop had just consumed, skipping it, so
 * deleting adjacent annotations left every second one in the sidebar until the next save.
 */
function applyEditorOverrides(annotations: PdfAnnotationInfo[], storage: any): PdfAnnotationInfo[] {
    const remaining: PdfAnnotationInfo[] = [];

    for (const ann of annotations) {
        const editor = storage.getEditor?.(ann.id);
        if (editor?.deleted) {
            continue;
        }
        if (editor?.color && ann.type !== "freetext") {
            ann.color = editor.color;
        }
        if (editor?.comment?.text) {
            ann.contents = editor.comment.text;
        }
        remaining.push(ann);
    }

    return remaining;
}

function sendAnnotations(annotations: PdfAnnotationInfo[]) {
    window.parent.postMessage({
        type: "pdfjs-viewer-annotations",
        annotations,
        ntxId: window.TRILIUM_NTX_ID,
        noteId: window.TRILIUM_NOTE_ID
    } satisfies PdfViewerAnnotationsMessage, window.location.origin);
}

function scrollToAnnotation(annotationId: string, pageNumber: number) {
    const app = window.PDFViewerApplication;
    const container = app.pdfViewer.container as HTMLElement;

    function scrollToEl(el: Element) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offsetTop = elRect.top - containerRect.top + container.scrollTop;
        container.scrollTo({
            top: offsetTop - container.clientHeight / 2 + elRect.height / 2,
            behavior: "smooth"
        });
    }

    // Try to find the element directly (nearby pages are pre-rendered)
    const el = document.querySelector(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
    if (el) {
        scrollToEl(el);
        return;
    }

    // Element not in DOM yet — jump to the page and wait for it to render
    app.pdfViewer.currentPageNumber = pageNumber;
    const observer = new MutationObserver(() => {
        const el = document.querySelector(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
        if (el) {
            observer.disconnect();
            scrollToEl(el);
        }
    });
    observer.observe(document.getElementById("viewer")!, { childList: true, subtree: true });
    // Clean up if annotation never appears
    setTimeout(() => observer.disconnect(), 3000);
}

export function rgbToHex(rgb: Uint8ClampedArray | Record<number, number> | number[]): string {
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
