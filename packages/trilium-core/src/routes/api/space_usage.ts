import type { EraseExcessRevisionsOptions } from "@triliumnext/commons";
import type { Request } from "express";

import {
    DEFAULT_OVERVIEW_LIMIT,
    getNoteUsage as getNoteUsageFromService,
    getOverview as getOverviewFromService,
    MAX_OVERVIEW_LIMIT
} from "../../services/space_usage.js";

function getOverview(req: Request) {
    const requested = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isNaN(requested)
        ? DEFAULT_OVERVIEW_LIMIT
        : Math.min(Math.max(requested, 1), MAX_OVERVIEW_LIMIT);

    return getOverviewFromService({
        includeRevisions: req.query.includeRevisions === "true",
        limit
    });
}

function getNoteUsage(req: Request<{ noteId: string }>) {
    const revisionOptions = parseRevisionOptions(req.query);

    if (typeof revisionOptions === "string") {
        return [ 400, revisionOptions ];
    }

    return getNoteUsageFromService(req.params.noteId, revisionOptions);
}

/**
 * How far the trimming being estimated would go, off the query string, or the message to answer 400
 * with. Omitted, the reported history is what erasing all of it would reclaim — so a value that
 * cannot be read has to fail rather than fall back to that, which would quote a far larger figure
 * than the caller asked about.
 */
function parseRevisionOptions(query: Request["query"]): EraseExcessRevisionsOptions | string {
    const { snapshotsToKeep, keepNamedSnapshots } = query;
    const options: EraseExcessRevisionsOptions = {
        keepNamedSnapshots: keepNamedSnapshots === "true"
    };

    if (keepNamedSnapshots !== undefined && keepNamedSnapshots !== "true" && keepNamedSnapshots !== "false") {
        return "keepNamedSnapshots must be 'true' or 'false'.";
    }

    if (snapshotsToKeep !== undefined) {
        // `Number("")` is 0, which would quietly turn a blank parameter into the harshest limit.
        const parsed = typeof snapshotsToKeep === "string" && snapshotsToKeep.trim() !== ""
            ? Number(snapshotsToKeep)
            : NaN;

        if (!Number.isInteger(parsed) || parsed < -1) {
            return "snapshotsToKeep must be an integer of -1 (keep every snapshot) or above.";
        }

        options.snapshotsToKeep = parsed;
    }

    return options;
}

export default {
    getOverview,
    getNoteUsage
};
