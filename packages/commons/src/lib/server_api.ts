import type { Locale } from "./i18n.js";
import { AttachmentRow, AttributeRow, BranchRow, NoteRow, NoteType, OptionRow, RevisionSource } from "./rows.js";

type Response = {
    success: true,
    message?: string;
} | {
    success: false;
    message: string;
}

export interface AppInfo {
    appVersion: string;
    dbVersion: number;
    nodeVersion?: string;
    syncVersion: number;
    buildDate: string;
    buildRevision: string;
    dataDirectory?: string;
    clipperProtocolVersion: string;
    /** for timezone inference */
    utcDateTime: string;
}

export interface DeleteNotesPreview {
    noteIdsToBeDeleted: string[];
    brokenRelations: AttributeRow[];
}

export interface RevisionItem {
    noteId: string;
    revisionId?: string;
    dateCreated?: string;
    contentLength?: number;
    type: NoteType;
    title: string;
    description?: string;
    source?: RevisionSource;
    isProtected?: boolean;
    mime: string;
}

export interface RevisionPojo {
    revisionId?: string;
    noteId: string;
    type: NoteType;
    mime: string;
    isProtected?: boolean;
    title: string;
    description?: string;
    source?: RevisionSource;
    blobId?: string;
    dateLastEdited?: string;
    dateCreated?: string;
    utcDateLastEdited?: string;
    utcDateCreated?: string;
    utcDateModified?: string;
    content?: string | Uint8Array;
    contentLength?: number;
}

/**
 * How far "Erase excess revision snapshots" should go. Both fields are optional: left out, the
 * operation behaves exactly as the automatic trimming that runs after every saved revision.
 */
export interface EraseExcessRevisionsOptions {
    /**
     * How many snapshots to keep per note, standing in for the `revisionSnapshotNumberLimit` option
     * for this run. Negative keeps every snapshot (nothing is excess), zero keeps none; omitted
     * falls back to the option itself.
     *
     * A note carrying a valid `#versioningLimit` follows its own label instead: that is a policy set
     * on the note deliberately, and a one-off answer to the global setting does not overrule it.
     */
    snapshotsToKeep?: number;
    /**
     * Spares named snapshots — those the user gave a description — from erasure, and leaves them
     * out of the count as well, so the limit governs the automatic snapshots alone.
     */
    keepNamedSnapshots?: boolean;
}

export interface EraseExcessRevisionsResponse {
    /** Snapshots actually erased, across every note the operation visited. */
    erasedCount: number;
}

export interface RecentChangeRow {
    noteId: string;
    current_isDeleted: boolean;
    current_deleteId: string;
    current_title: string;
    current_isProtected: boolean;
    title: string;
    utcDate: string;
    date: string;
    canBeUndeleted?: boolean;
}

export interface BulkActionAffectedNotes {
    affectedNoteCount: number;
}

export interface DatabaseCheckIntegrityResponse {
    results: {
        integrity_check: string;
    }[];
}

export interface DatabaseAnonymizeResponse {
    success: boolean;
    anonymizedFilePath: string;
}

export interface AnonymizedDbResponse {
    filePath: string;
    fileName: string;
    mtime: Date;
    /** Size of the anonymized database file, in bytes. */
    fileSize: number;
}

export interface ExistingAnonymizedDatabasesResponse {
    /** The directory where the anonymized databases are stored. */
    anonymizedFolderPath: string;
    databases: AnonymizedDbResponse[];
}

export type SyncTestResponse = Response;

export interface EtapiToken {
    name: string;
    utcDateCreated: string;
    etapiTokenId?: string;
}

export interface PostTokensResponse {
    authToken: string;
}

export interface BackupDatabaseNowResponse {
    backupFile: string;
}

export interface DatabaseBackup {
    fileName: string;
    filePath: string;
    mtime: Date;
    /** Size of the backup file, in bytes. */
    fileSize: number;
}

export interface ExistingBackupsResponse {
    /** The directory where the backups are stored, or null if there is no user-accessible location (e.g. OPFS on standalone). */
    backupFolderPath: string | null;
    backups: DatabaseBackup[];
}

export type ChangePasswordResponse = Response;

export interface TOTPStatus {
    set: boolean;
}

export interface TOTPGenerate {
    success: boolean;
    /** The bare base32 secret, shown for manual entry. */
    message: string;
    /** The `otpauth://` URL for the secret, rendered as a scannable QR code. Absent on failure. */
    url?: string;
}

export interface TOTPVerifyResponse {
    /** Whether the submitted code was valid for the secret. Verification persists nothing on its own. */
    success: boolean;
    /** Freshly issued (not yet persisted) recovery codes, returned only on success for the user to save. */
    recoveryCodes?: string[];
}

export interface TOTPEnableResponse {
    /** Whether the secret and recovery codes were committed, activating TOTP. */
    success: boolean;
}

export interface TOTPRecoveryKeysResponse {
    success: boolean;
    recoveryCodes?: string[];
    keysExist?: boolean;
    usedRecoveryCodes?: string[];
}

export interface OAuthStatus {
    /** Whether OAuth is the active login method (configured *and* an account has been enrolled). */
    enabled: boolean;
    /** Whether the owner has bound their provider identity to this instance (enrollment complete). */
    enrolled?: boolean;
    name?: string;
    email?: string;
    missingVars?: string[];
    /** The configured provider's display name (`oauthIssuerName`); empty when unset. */
    issuerName?: string;
    /** The configured provider's issuer base URL (`oauthIssuerBaseUrl`). */
    issuerUrl?: string;
    /** The configured provider's icon URL (`oauthIssuerIcon`); empty when unset. */
    issuerIcon?: string;
}

// Interface for the Ollama model response
export interface OllamaModelResponse {
    success: boolean;
    models: Array<{
        name: string;
        model: string;
        details?: {
            family?: string;
            parameter_size?: string;
        }
    }>;
}


export interface OpenAiOrAnthropicModelResponse {
    success: boolean;
    chatModels: Array<{
        id: string;
        name: string;
        type: string;
    }>;
}

export type ToggleInParentResponse = {
    success: true;
} | {
    success: false;
    message: string;
}

export type EditedNotesResponse = {
    noteId: string;
    isDeleted: boolean;
    title?: string;
    notePath?: string[] | null;
}[];

export interface MetadataResponse {
    dateCreated: string | undefined;
    utcDateCreated: string;
    dateModified: string | undefined;
    utcDateModified: string | undefined;
}

export interface NoteSizeResponse {
    noteSize: number;
}

export interface SubtreeSizeResponse {
    subTreeNoteCount: number;
    subTreeSize: number;
}

/**
 * The size components of a single note. Revisions are always reported separately so a client can
 * include or exclude them without another request.
 */
export interface SpaceUsageSizes {
    /** Size of the note's own body. */
    ownSize: number;
    /** Combined size of the attachments owned by the note. */
    attachmentsSize: number;
    /** Combined size of the note's revisions, including attachments owned by those revisions. */
    revisionsSize: number;
}

export interface SpaceUsageOverviewNote extends SpaceUsageSizes {
    noteId: string;
    /**
     * Note IDs from a top-level note down to this note, following each note's canonical placement
     * (see the space usage service); the root itself is omitted.
     */
    notePath: string[];
}

/** An aggregate over notes that are not listed individually. */
export interface SpaceUsageBucket {
    /** Note bodies plus attachments; revisions are in {@link revisionsSize}. */
    size: number;
    revisionsSize: number;
    noteCount: number;
}

/**
 * Space still held by deleted entities whose blobs have not been erased yet.
 *
 * {@link size} covers all of them at once — deleted notes, deleted attachments (whose owning note
 * may well be alive) and the history of deleted notes — so it is reported alongside both counts:
 * either one on its own reads as the whole story, and neither is.
 */
export interface SpaceUsageDeletedNotes {
    size: number;
    /** Deleted notes whose body blob still exists; erased notes no longer count. */
    noteCount: number;
    /** Deleted attachments whose blob still exists, however their owning note is doing. */
    attachmentCount: number;
}

/**
 * Space held by attachments a live note still owns but no longer references from its content —
 * an image or file inserted and then removed. Saving the note schedules those for erasure, and the
 * scheduled cleanup erases them once `eraseUnusedAttachmentsAfterSeconds` has passed.
 *
 * Every scheduled attachment counts, not only those already past that delay, so the figure is what
 * erasing unused attachments *now* would remove.
 */
export interface SpaceUsageUnusedAttachments {
    /**
     * What erasing them would actually reclaim: their blobs, counted once, minus any still held by
     * a live note body, a still-referenced attachment or a revision.
     */
    size: number;
    /** Attachments scheduled for erasure, whether or not something else shares their content. */
    attachmentCount: number;
}

/**
 * What the live content actually occupies — every blob referenced by a live note, attachment or
 * revision, hidden subtree included, counted once however many entities share it through
 * deduplication. The breakdown attributes each blob to exactly one tier — bodies first, then
 * attachments, then revisions — so the parts sum to {@link size} and each reads as "the space only
 * this category holds". The per-note numbers elsewhere intentionally count per entity instead, so
 * a note's reported size never depends on duplicates elsewhere.
 */
export interface SpaceUsageContent {
    /** The whole live content; the "database size" figure. */
    size: number;
    /** Live notes, hidden ones included. */
    noteCount: number;
    /** Space only note-owned attachments hold: their blobs minus those shared with note bodies. */
    attachmentsSize: number;
    /** Space only revisions hold (snapshot attachments included): their blobs minus those shared
     *  with live bodies or live attachments. */
    revisionsSize: number;
}

export interface SpaceUsageOverviewResponse {
    content: SpaceUsageContent;
    /** The largest notes first, ranked by body + attachments (+ revisions when requested). */
    notes: SpaceUsageOverviewNote[];
    /** The remaining notes of the visible tree, below the ranking cutoff. */
    otherNotes: SpaceUsageBucket;
    /** Notes reachable only through the hidden subtree, plus any note not reachable at all. */
    hiddenNotes: SpaceUsageBucket;
    deletedNotes: SpaceUsageDeletedNotes;
    unusedAttachments: SpaceUsageUnusedAttachments;
    /** Every note of the visible tree: {@link notes} and {@link otherNotes} combined. */
    total: SpaceUsageBucket;
}

export interface SpaceUsageChild {
    noteId: string;
    /** Bodies plus attachments of the child's whole canonical subtree; revisions are left out. */
    subtreeSize: number;
    subtreeNoteCount: number;
}

export interface SpaceUsageAttachment {
    attachmentId: string;
    title: string;
    role: string;
    size: number;
}

export interface SpaceUsageNoteResponse extends SpaceUsageSizes {
    noteId: string;
    /**
     * What the note alone actually occupies — body, attachments and revisions, each shared blob
     * counted once. Smaller than the per-entity components sum whenever revisions still share the
     * note's blob or attachments repeat content.
     */
    noteContentSize: number;
    /** Like {@link noteContentSize}, over the note's whole canonical subtree. */
    subtreeContentSize: number;
    /**
     * An estimate of what trimming the subtree's history would reclaim: blobs held only by the
     * snapshots that would go, each counted once, and none that a live body, a note attachment or a
     * surviving snapshot still shares. Tiered like the database-wide figure, so the two are
     * comparable — unlike the per-entity {@link revisionsSize}, which counts a shared snapshot at
     * every entity holding it.
     *
     * How far that trimming goes is the request's own {@link EraseExcessRevisionsOptions}: by
     * default every snapshot goes, which is the whole history. The limit asked for stands for every
     * note at once, so a note whose `#versioningLimit` keeps more than that frees less than this
     * figure allows for — an estimate reading high, not a promise.
     */
    subtreeRevisionsContentSize: number;
    attachments: SpaceUsageAttachment[];
    /** Canonical children only: a cloned child is listed under its canonical parent alone. */
    children: SpaceUsageChild[];
    /** Only present on the root, deleted notes having no place in the tree. */
    deletedNotes?: SpaceUsageDeletedNotes;
    /** Only present on the root: a database-wide figure, like the deleted one beside it. */
    unusedAttachments?: SpaceUsageUnusedAttachments;
}

export interface SimilarNote {
    score: number;
    notePath: string[];
    noteId: string;
}

export type SimilarNoteResponse = (SimilarNote[] | undefined);

export type SaveSearchNoteResponse = CloneResponse;

export interface CloneResponse {
    success: boolean;
    message?: string;
    branchId?: string;
    notePath?: string;
}

export interface ConvertToAttachmentResponse {
    attachment: AttachmentRow;
}

export interface ConvertAttachmentToNoteResponse {
    note: NoteRow;
    branch: BranchRow;
}

export type SaveSqlConsoleResponse = CloneResponse;

export type SaveLlmChatResponse = CloneResponse;

export interface BacklinkCountResponse {
    count: number;
}

export type BacklinksResponse = ({
    noteId: string;
    relationName: string;
} | {
    noteId: string;
    excerpts: string[]
})[];


export type SqlExecuteResults = (object[] | object)[];

export interface SqlExecuteResponse {
    success: boolean;
    error?: string;
    results: SqlExecuteResults;
}

export interface CreateChildrenResponse {
    note: NoteRow;
    branch: BranchRow;
}

export interface SchemaResponse {
    name: string;
    columns: {
        name: string;
        type: string;
    }[];
}

export interface RelationMapRelation {
    name: string;
    attributeId: string;
    sourceNoteId: string;
    targetNoteId: string;
}

export interface RelationMapPostResponse {
    noteTitles: Record<string, string>;
    relations: RelationMapRelation[];
    inverseRelations: Record<string, string>;
}

export interface NoteMapLink {
    key: string;
    sourceNoteId: string;
    targetNoteId: string;
    name: string;
}

export interface NoteMapPostResponse {
    notes: string[];
    links: NoteMapLink[];
    noteIdToDescendantCountMap: Record<string, number>;
}

export interface UpdateAttributeResponse {
    attributeId: string;
}

export interface RenderMarkdownResponse {
    htmlContent: string;
}

export interface ToMarkdownResponse {
    markdownContent: string;
}

export interface TextRepresentationResponse {
    success: boolean;
    text: string;
    hasOcr: boolean;
    message?: string;
}

export interface OCRProcessResponse {
    success: boolean;
    message?: string;
    result?: {
        text: string;
        confidence: number;
        extractedAt: string;
        language?: string;
        pageCount?: number;
        processingType?: string;
    };
    /** The minimum confidence threshold that was applied (0-1 scale). */
    minConfidence?: number;
}

export interface IconRegistry {
    sources: {
        prefix: string;
        name: string;
        /** An icon class to identify this icon pack. */
        icon: string;
        icons: {
            id: string;
            terms: string[];
        }[]
    }[];
}

/**
 * Bootstrap items that the client needs to start up. These are sent by the server in the HTML and made available as `window.glob`.
 */
export type BootstrapDefinition = {
    dbInitialized: boolean;
    /**
     * Whether a sync that has already created the database schema was interrupted
     * before finishing (schema exists but the `initialized` flag is not yet set).
     * Only meaningful while `dbInitialized` is `false`; the setup screen uses it to
     * jump straight back to the sync-in-progress step and resume the sync on restart.
     */
    syncInProgress?: boolean;
    /**
     * Whether a password has been set yet. `false` only in the pre-auth window
     * after the database is initialized but before the user has set a password,
     * which the client uses to render the set-password screen. Omitted (treated
     * as set) for the regular authenticated payload.
     */
    passwordSet?: boolean;
    /**
     * Whether the current session is authenticated. `false` only in the pre-auth
     * window when a password is set but the user hasn't logged in (web/server only),
     * which the client uses to render the login screen. Omitted (treated as logged
     * in) for the regular authenticated payload.
     */
    loggedIn?: boolean;
    /** Login-screen configuration, present only alongside `loggedIn: false`. */
    login?: {
        /** Whether single sign-on (OpenID) is enabled — shows the SSO button instead of the password form. */
        ssoEnabled: boolean;
        ssoIssuerName?: string;
        ssoIssuerIcon?: string;
        /** Whether a TOTP second factor is required. */
        totpEnabled: boolean;
        /** One-shot SSO error from a failed OIDC round-trip ("wrong_account" / "not_enrolled"). */
        ssoError?: string | false;
        /**
         * One-shot flag set when the OIDC provider couldn't be reached at all during an
         * unauthenticated round-trip, so the login screen can explain the bounce back. Deliberately
         * a boolean: the technical detail stays in the server log rather than being exposed pre-auth.
         */
        ssoConnectionFailed?: boolean;
    };
    baseApiUrl: string;
    assetPath: string;
    theme: string;
    themeBase?: "next" | "next-light" | "next-dark";
    customThemeCssUrl?: string;
    iconPackCss: string;
    iconRegistry: IconRegistry;
    device: "mobile" | "desktop" | "print" | false;
    csrfToken?: string;
    headingStyle: "plain" | "underline" | "markdown";
    layoutOrientation: "vertical" | "horizontal";
    platform?: "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd" | "web";
    isElectron: boolean;
    isStandalone: boolean;
    /**
     * Absolute URL prefix for the WebSocket (e.g. `ws://127.0.0.1:8080/`),
     * sent by the desktop app because the renderer page lives on the
     * `trilium-app://` custom protocol where `window.location` no longer
     * encodes a reachable WS host. Undefined for the regular web build,
     * where the WS URL can still be derived from `window.location`.
     */
    wsBaseUrl?: string;
    /**
     * Absolute base URL of the local HTTP server (e.g. `http://127.0.0.1:37840`),
     * sent by the desktop app because the renderer page lives on the
     * `trilium-app://` custom protocol where `window.location` does not point
     * at a reachable HTTP origin. Used to display copy-pasteable endpoints
     * (such as the MCP URL) that external clients connect to over loopback.
     * Undefined for the regular web build, where `window.location` already
     * encodes the reachable HTTP origin.
     */
    httpBaseUrl?: string;
    hasNativeTitleBar: boolean;
    hasBackgroundEffects: boolean;
    maxEntityChangeIdAtLoad?: number;
    maxEntityChangeSyncIdAtLoad?: number;
    instanceName: string | null;
    appCssNoteIds: string[];
    isDev: boolean;
    isMainWindow: boolean;
    isProtectedSessionAvailable: boolean;
    triliumVersion: string;
    appPath: string;
    currentLocale: Locale;
    isRtl: boolean;
    TRILIUM_SAFE_MODE: boolean;
    componentId?: string;
    /**
     * True for exactly one bootstrap after the owner binds their OAuth account, letting the client show a
     * one-shot "account connected" toast once the post-enrollment redirect lands on the app root.
     */
    oauthJustEnrolled?: boolean;
    /**
     * Set for exactly one bootstrap after an OAuth round-trip failed to reach the provider at all,
     * letting the client explain the bounce back to the app root with a one-shot error toast. Carries
     * the technical reason (e.g. `fetch failed ← caused by: self-signed certificate
     * [DEPTH_ZERO_SELF_SIGNED_CERT]`), shown verbatim in monospace; non-empty whenever present.
     */
    oauthConnectionFailed?: string;
};

/**
 * Response for /api/setup/status.
 */
export interface SetupStatusResponse {
    syncVersion: number;
    schemaExists: boolean;
}

/**
 * Response for /api/setup/sync-seed.
 */
export interface SetupSyncSeedResponse {
    syncVersion: number;
    options: OptionRow[];
}

export type SetupSyncFromServerResponse = {
    result: "success";
} | {
    result: "failure";
    error: string;
}

export interface NetworkAddressesResponse {
    /** Reachable URLs (protocol + host + port) other devices can sync with. */
    addresses: string[];
    /**
     * Whether this host is bound to a network-reachable interface. `false` when
     * it only listens on loopback, in which case the advertised addresses can't
     * actually be reached by another device.
     */
    reachableOnNetwork: boolean;
}

export type ScriptParams = any[];
