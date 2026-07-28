import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import debounce from "../../../../../services/debounce";
import server from "../../../../../services/server";
import { useTriliumEvent } from "../../../../react/hooks";

/** One reload per burst — a subtree delete floods entity changes. */
const REFRESH_DEBOUNCE_MS = 1000;

export interface SpaceUsageFetch<T> {
    data: T | null;
    /** The last attempt failed. Meaningful only while {@link data} is still null — see below. */
    failed: boolean;
}

/**
 * Fetches a space-usage endpoint and keeps it current: content changes anywhere — deletes, moves,
 * uploads — shift the sizes, so any note/branch/attachment change schedules one debounced reload.
 *
 * `null` until the first response; on a URL change (Browse navigation) the previous payload stays
 * up while the new one is in flight, so the charts transition instead of blanking.
 *
 * A failure is reported rather than swallowed, because there is nothing to fall back on before the
 * first success: the view would otherwise claim to be measuring for as long as it stayed open. The
 * server service toasts most failures, but not one the browser itself rejected (a dropped
 * connection, an unreachable server), which would leave no trace at all. Callers show the failure
 * only while `data` is null — once a payload exists, keeping it beats blanking the charts.
 */
export function useSpaceUsageFetch<T>(url: string): SpaceUsageFetch<T> {
    const [ data, setData ] = useState<T | null>(null);
    const [ failed, setFailed ] = useState(false);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;

        try {
            const response = await server.get<T>(url);

            // A stale response must not repaint over a newer one.
            if (requestId === latestRequest.current) {
                setData(response);
                setFailed(false);
            }
        } catch {
            // The callers fire-and-forget, so the rejection must not escape.
            if (requestId === latestRequest.current) {
                setFailed(true);
            }
        }
    }, [ url ]);

    useEffect(() => { void refresh(); }, [ refresh ]);

    const delayedRefresh = useMemo(() => debounce(() => void refresh(), REFRESH_DEBOUNCE_MS), [ refresh ]);
    useEffect(() => () => delayedRefresh.clear(), [ delayedRefresh ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getNoteIds().length || loadResults.getBranchRows().length || loadResults.getAttachmentRows().length) {
            delayedRefresh();
        }
    });

    return { data, failed };
}
