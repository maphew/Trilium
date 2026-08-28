/**
 * Shared reader for UniversJS workbook JSON, used by the spreadsheet emitters
 * (`render_to_html`, `render_to_xlsx`, `render_to_csv`).
 *
 * Only the subset of UniversJS types needed for rendering is defined here, to avoid
 * depending on `@univerjs/core`. This is intentionally a superset of every emitter's
 * needs: HTML uses gridlines/number-format colors, XLSX uses formulas/wrap/rotation,
 * CSV uses just values and bounds — they all share one model.
 *
 * Parsing is deliberately lenient (`parseWorkbookData` returns `null` on failure)
 * because each emitter reports errors differently: HTML returns placeholder markup,
 * XLSX throws. The shared layer hands back the parsed data and lets the caller decide.
 */

// #region UniversJS type subset

export interface PersistedData {
    version: number;
    workbook: IWorkbookData;
}

export interface IWorkbookData {
    sheetOrder: string[];
    name?: string;
    styles?: Record<string, IStyleData | null>;
    sheets: Record<string, IWorksheetData>;
    /** Plugin payloads (e.g. floating drawings); each `data` is itself a JSON string. */
    resources?: IResource[];
}

export interface IResource {
    name: string;
    data: string;
}

export interface IWorksheetData {
    id: string;
    name: string;
    hidden?: number;
    rowCount?: number;
    columnCount?: number;
    defaultColumnWidth?: number;
    defaultRowHeight?: number;
    mergeData?: IRange[];
    cellData: CellMatrix;
    rowData?: Record<number, IRowData>;
    columnData?: Record<number, IColumnData>;
    showGridlines?: number;
    gridlinesColor?: string | null;
    rowHeader?: ISheetHeader;
    columnHeader?: ISheetHeader;
}

/** The row-number / column-letter gutters. Univer's drawing transforms are offset by their size. */
export interface ISheetHeader {
    width?: number;
    height?: number;
    hidden?: number;
}

export type CellMatrix = Record<number, Record<number, ICellData>>;

export interface ICellData {
    v?: string | number | boolean | null;
    t?: number | null;
    s?: IStyleData | string | null;
    f?: string | null;
    /** Rich-text document payload; carries images anchored inside the cell. */
    p?: ICellDocumentData | null;
}

export interface ICellDocumentData {
    drawings?: Record<string, ISheetDrawing>;
    drawingsOrder?: string[];
}

export interface ISheetDrawing {
    drawingId?: string;
    imageSourceType?: string;
    source?: string;
    transform?: IDrawingTransform | null;
    /** Cell-anchored extent (top-left/bottom-right), used by the XLSX emitter's two-cell anchor. */
    sheetTransform?: ISheetDrawingAnchor | null;
}

export interface ISheetDrawingAnchor {
    from?: IDrawingCellAnchor;
    to?: IDrawingCellAnchor;
}

/** A drawing corner anchored to a cell plus a px offset into it (`row`/`column` are 0-based). */
export interface IDrawingCellAnchor {
    row?: number;
    rowOffset?: number;
    column?: number;
    columnOffset?: number;
}

/** A drawing's absolute box. `left`/`top` are px from the sheet origin (A1); cell images omit them. */
export interface IDrawingTransform {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    /** Clockwise rotation in degrees, applied around the box centre. */
    angle?: number;
    flipX?: boolean;
    flipY?: boolean;
}

export interface IStyleData {
    bl?: number;
    it?: number;
    ul?: ITextDecoration;
    st?: ITextDecoration;
    fs?: number;
    ff?: string | null;
    bg?: IColorStyle | null;
    cl?: IColorStyle | null;
    ht?: number | null;
    vt?: number | null;
    tb?: number | null;
    tr?: ITextRotation | null;
    bd?: IBorderData | null;
    n?: INumberFormat | null;
}

export interface INumberFormat {
    pattern?: string | null;
}

export interface ITextDecoration {
    s?: number;
}

export interface IColorStyle {
    rgb?: string | null;
}

export interface ITextRotation {
    a?: number;
    v?: number;
}

export interface IBorderData {
    t?: IBorderStyleData | null;
    r?: IBorderStyleData | null;
    b?: IBorderStyleData | null;
    l?: IBorderStyleData | null;
}

export interface IBorderStyleData {
    s?: number;
    cl?: IColorStyle;
}

export interface IRange {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
}

export interface IRowData {
    h?: number;
    hd?: number;
}

export interface IColumnData {
    w?: number;
    hd?: number;
}

// Univer's cell value type (`ICellData.t`). Tells the editor how to render/sort a value
// independently of the JS type of `v` (e.g. FORCE_STRING keeps a numeric-looking string
// left-aligned and un-coerced).
export const enum CellValueType {
    STRING = 1,
    NUMBER = 2,
    BOOLEAN = 3,
    FORCE_STRING = 4
}

// Alignment enums (from UniversJS).
export const enum HorizontalAlign {
    LEFT = 1,
    CENTER = 2,
    RIGHT = 3
}

export const enum VerticalAlign {
    TOP = 1,
    MIDDLE = 2,
    BOTTOM = 3
}

export const enum WrapStrategy {
    WRAP = 3
}

// Border style enum — mirrors Univer's `BorderStyleTypes` (@univerjs/core).
export const enum BorderStyle {
    NONE = 0,
    THIN = 1,
    HAIR = 2,
    DOTTED = 3,
    DASHED = 4,
    DASH_DOT = 5,
    DASH_DOT_DOT = 6,
    DOUBLE = 7,
    MEDIUM = 8,
    MEDIUM_DASHED = 9,
    MEDIUM_DASH_DOT = 10,
    MEDIUM_DASH_DOT_DOT = 11,
    SLANT_DASH_DOT = 12,
    THICK = 13
}

// #endregion

export interface WorkbookParseResult {
    /** `false` only when the content is not valid JSON (vs. valid JSON that lacks a workbook). */
    ok: boolean;
    data: PersistedData | null;
}

/**
 * Parses the raw JSON content of a spreadsheet note. `ok` is `false` only when the content
 * is not valid JSON; valid-but-empty JSON (e.g. `null`, `{}`) returns `ok: true` with the
 * parsed value, so callers can distinguish an unparseable payload from a structurally empty
 * one. Callers should additionally check `data.workbook?.sheets` and report an empty/invalid
 * workbook in their own format.
 */
export function parseWorkbookData(jsonContent: string): WorkbookParseResult {
    try {
        return { ok: true, data: JSON.parse(jsonContent) };
    } catch {
        return { ok: false, data: null };
    }
}

/**
 * Returns the sheets to render, in `sheetOrder`, skipping hidden ones. Falls back to
 * `Object.keys` order when `sheetOrder` is absent.
 */
export function getVisibleSheets(workbook: IWorkbookData): IWorksheetData[] {
    const sheetIds = workbook.sheetOrder ?? Object.keys(workbook.sheets);
    return sheetIds
        .map((id) => workbook.sheets[id])
        .filter((s): s is IWorksheetData => Boolean(s) && !s.hidden);
}

/**
 * Resolves a cell's style reference to a concrete style object. Univer stores a cell's
 * style either inline (an object) or as a key into the workbook's shared `styles` table.
 */
export function resolveCellStyle(
    s: ICellData["s"],
    styles: Record<string, IStyleData | null>
): IStyleData | null {
    if (!s) return null;
    if (typeof s === "string") return styles[s] ?? null;
    return s;
}

export interface Bounds {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
}

/**
 * Excel's hard sheet limits. A merge reaching the last row or column is one made across an
 * entire row or column ("Merge & Center" over a whole row), not a merge sized to its content.
 */
const EXCEL_MAX_ROWS = 1048576;
const EXCEL_MAX_COLUMNS = 16384;

/**
 * Computes the inclusive bounding rectangle a renderer has to emit. Returns `null` when
 * there are no cells and no merges (empty sheet).
 *
 * Two kinds of cell are deliberately kept out of the rectangle, because both let a sheet
 * whose real content is small produce a grid of millions of cells:
 *
 * - Populated cells behind a merge. Excel writes the merge's fill onto every cell it covers,
 *   so "Merge & Center" across an entire row leaves 16,384 styled cells in `cellData`. Only
 *   the merge origin renders, so the rest must not stretch the rectangle.
 * - The far end of a merge made across an entire row or column, which reaches Excel's sheet
 *   limit. Such a merge is clamped back to the populated cells rather than stretching the
 *   rectangle to 16,384 columns. Its origin still counts, and callers clamp the resulting span
 *   to the rectangle, so the merge still reaches the far edge of what gets rendered.
 */
export function computeBounds(cellData: CellMatrix, mergeData: IRange[] = []): Bounds | null {
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;

    const covered = mergeCoverage(mergeData);

    for (const rowStr of Object.keys(cellData)) {
        const row = Number(rowStr);
        const cols = cellData[row];
        for (const colStr of Object.keys(cols)) {
            const col = Number(colStr);
            if (covered(row, col)) continue;
            if (minRow > row) minRow = row;
            if (maxRow < row) maxRow = row;
            if (minCol > col) minCol = col;
            if (maxCol < col) maxCol = col;
        }
    }

    for (const range of mergeData) {
        if (minRow > range.startRow) minRow = range.startRow;
        if (minCol > range.startColumn) minCol = range.startColumn;
        // The origin always renders, so it extends the rectangle even for a whole-row merge.
        if (maxRow < range.startRow) maxRow = range.startRow;
        if (maxCol < range.startColumn) maxCol = range.startColumn;

        if (maxRow < range.endRow && range.endRow < EXCEL_MAX_ROWS - 1) maxRow = range.endRow;
        if (maxCol < range.endColumn && range.endColumn < EXCEL_MAX_COLUMNS - 1) maxCol = range.endColumn;
    }

    if (minRow > maxRow) return null;
    return { minRow, maxRow, minCol, maxCol };
}

/**
 * Builds a predicate telling whether a cell is covered by a merge without being its origin.
 * Merges are usually few, so each cell is tested against the ranges directly; the bounding box
 * of all merges short-circuits the common case of a cell nowhere near one.
 */
function mergeCoverage(mergeData: IRange[]): (row: number, col: number) => boolean {
    if (mergeData.length === 0) return () => false;

    let top = Infinity;
    let bottom = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const range of mergeData) {
        if (top > range.startRow) top = range.startRow;
        if (bottom < range.endRow) bottom = range.endRow;
        if (left > range.startColumn) left = range.startColumn;
        if (right < range.endColumn) right = range.endColumn;
    }

    return (row, col) => {
        if (row < top || row > bottom || col < left || col > right) return false;

        for (const range of mergeData) {
            if (row === range.startRow && col === range.startColumn) continue;
            if (row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn) {
                return true;
            }
        }
        return false;
    };
}

/** Checks that a value is a finite number (guards against stringified payloads from JSON). */
export function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

/** Univer stores floating sheet images (drawings) under this workbook resource. */
export const SHEET_DRAWING_RESOURCE = "SHEET_DRAWING_PLUGIN";

/** Univer stores per-sheet data-validation rules (dropdowns, numeric/date constraints) here. */
export const SHEET_DATA_VALIDATION_RESOURCE = "SHEET_DATA_VALIDATION_PLUGIN";

/**
 * A Univer data-validation rule. Matches `IDataValidationRule` from `@univerjs/core` (the subset the
 * XLSX importer emits). For a `list` dropdown, `formula1` is the JSON-encoded option array that
 * Univer's list validator parses via `deserializeListOptions`; for numeric/date constraints,
 * `formula1`/`formula2` are the bound values and `operator` selects the comparison.
 */
export interface DataValidationRule {
    uid: string;
    /** Univer's `DataValidationType` string (e.g. "list", "whole", "decimal", "date", "custom"). */
    type: string;
    /** Univer's `DataValidationOperator` string, for numeric/date/text-length constraints. */
    operator?: string;
    formula1?: string;
    formula2?: string;
    ranges: IRange[];
}

/**
 * Extracts the floating drawings for one sheet from the `SHEET_DRAWING_PLUGIN` resource, in
 * their stored z-order. The resource `data` is itself a JSON string keyed by sheet id:
 * `{ [sheetId]: { data: { [drawingId]: drawing }, order: string[] } }`. Returns an empty array
 * when the resource is absent, unparseable, or carries no drawings for the sheet.
 */
export function getFloatingDrawings(workbook: IWorkbookData, sheetId: string): ISheetDrawing[] {
    const resource = workbook.resources?.find((r) => r.name === SHEET_DRAWING_RESOURCE);
    if (!resource?.data) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(resource.data);
    } catch {
        return [];
    }

    const sheetEntry = (parsed as Record<string, { data?: Record<string, ISheetDrawing>; order?: string[] }> | null)?.[sheetId];
    const data = sheetEntry?.data;
    if (!data) return [];

    const order = Array.isArray(sheetEntry?.order) ? sheetEntry.order : Object.keys(data);
    return order.map((id) => data[id]).filter((d): d is ISheetDrawing => Boolean(d));
}

/**
 * Extracts the data-validation rules for one sheet from the `SHEET_DATA_VALIDATION_PLUGIN` resource.
 * The resource `data` is a JSON string keyed by sheet id: `{ [sheetId]: DataValidationRule[] }`.
 * Returns an empty array when the resource is absent, unparseable, or carries none for the sheet.
 */
export function getDataValidations(workbook: IWorkbookData, sheetId: string): DataValidationRule[] {
    const resource = workbook.resources?.find((r) => r.name === SHEET_DATA_VALIDATION_RESOURCE);
    if (!resource?.data) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(resource.data);
    } catch {
        return [];
    }

    const rules = (parsed as Record<string, DataValidationRule[]> | null)?.[sheetId];
    return Array.isArray(rules) ? rules.filter((r): r is DataValidationRule => Boolean(r)) : [];
}
