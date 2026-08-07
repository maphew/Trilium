/**
 * The file a running instance leaves behind to ask the next start to come up in setup.
 *
 * Setup is normally where an instance goes because it has no database. This is the other way in: an
 * instance that has one, and wants to be somewhere in the wizard anyway, writes this file and
 * restarts. The start that follows reads it, deliberately leaves the database closed, and opens the
 * screen it names.
 *
 * Everything the wizard needs from the database has to be in here, because by then the database is
 * not open. That is what {@link SetupMarker.lang} is for: without it the wizard would come up in
 * English and ask a user who has already answered that question.
 *
 * @module
 */

/** Where the marker is kept: the data directory, beside the database it is asking to bypass. */
export const SETUP_MARKER_FILE_NAME = "setup.json";

/**
 * The screen the wizard should open on.
 *
 * Named for what the user asked for rather than for the wizard's own state, so the file format does
 * not follow the client's internals around. Screens are listed here as they gain a way in.
 */
export type SetupTargetScreen = "restore-backup";

/** A backup the setup screen took of the database it is about to replace. */
export interface SetupExistingBackup {
    fileName: string;
    /** The whole path, for downloading it and for anything that needs to name the file itself. */
    filePath: string;
    /**
     * The directory holding it, shown on its own.
     *
     * Shown because the user may lose sight of a custom backup location afterwards: the option
     * naming it lives in the database that is about to be replaced.
     */
    directoryPath: string;
    fileSize: number;
    /** Whether it is encrypted, which decides whether the user needs their backup password to use it. */
    encrypted: boolean;
}

/** What a start reads out of {@link SETUP_MARKER_FILE_NAME}. */
export interface SetupMarker {
    /** The language the instance was using, so the wizard is in it rather than asking again. */
    lang: string;
    /** Where to go. Absent leaves the wizard where a first run starts, at the language step. */
    targetScreen?: SetupTargetScreen;
}
