import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import server from "../../../../../services/server";

export interface SpaceUsageFetch<T> {
    data: T | null;
    /** The last attempt failed. Meaningful only while {@link data} is still null — see below. */
    failed: boolean;
    /** A request is in flight. Measuring is expensive enough to be worth keeping to one at a time. */
    loading: boolean;
}

/**
 * Fetches a space-usage endpoint once, and again whenever the URL changes (Browse navigation) or
 * {@link refreshToken} does — which is how the page's refresh button asks for a fresh reading.
 *
 * Deliberately *not* refreshed when notes change: measuring the database is expensive enough that
 * re-running it after every edit would keep the server busy for as long as this page stayed open —
 * and the numbers are a snapshot to read, not a live readout. Re-measuring is the user's call.
 *
 * `null` until the first response; on a URL change the previous payload stays up while the new one
 * is in flight, so the charts transition instead of blanking.
 *
 * A failure is reported rather than swallowed, because there is nothing to fall back on before the
 * first success: the view would otherwise claim to be measuring for as long as it stayed open. The
 * server service toasts most failures, but not one the browser itself rejected (a dropped
 * connection, an unreachable server), which would leave no trace at all. Callers show the failure
 * only while `data` is null — once a payload exists, keeping it beats blanking the charts.
 */
export function useSpaceUsageFetch<T>(url: string, refreshToken = 0): SpaceUsageFetch<T> {
    const [ data, setData ] = useState<T | null>(null);
    const [ failed, setFailed ] = useState(false);
    const [ loading, setLoading ] = useState(true);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;
        setLoading(true);

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
        } finally {
            if (requestId === latestRequest.current) {
                setLoading(false);
            }
        }
        // A plain number rather than a callback the caller hands down: a function would carry a new
        // identity on every render of the page above, and re-measure the whole database each time
        // anything there changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ url, refreshToken ]);

    useEffect(() => { void refresh(); }, [ refresh ]);

    return { data, failed, loading };
}
