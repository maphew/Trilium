import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import debounce from "../../../../../services/debounce";
import server from "../../../../../services/server";
import { useTriliumEvent } from "../../../../react/hooks";

/** One reload per burst — a subtree delete floods entity changes. */
const REFRESH_DEBOUNCE_MS = 1000;

/**
 * Fetches a space-usage endpoint and keeps it current: content changes anywhere — deletes, moves,
 * uploads — shift the sizes, so any note/branch/attachment change schedules one debounced reload.
 *
 * `null` until the first response; on a URL change (Browse navigation) the previous payload stays
 * up while the new one is in flight, so the charts transition instead of blanking.
 */
export function useSpaceUsageFetch<T>(url: string) {
    const [ data, setData ] = useState<T | null>(null);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;
        const response = await server.get<T>(url);

        // A stale response must not repaint over a newer one.
        if (requestId === latestRequest.current) {
            setData(response);
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

    return data;
}
