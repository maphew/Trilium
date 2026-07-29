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
    return getNoteUsageFromService(req.params.noteId);
}

export default {
    getOverview,
    getNoteUsage
};
