import { describe, expect, it } from "vitest";

import { CACHE_MAX_AGE_MS, isCacheFresh } from "./utils";

describe("isCacheFresh", () => {
    const now = new Date("2026-08-20T12:00:00Z").getTime();

    it("accepts a cache younger than the maximum age", () => {
        expect(isCacheFresh(now, now)).toBe(true);
        expect(isCacheFresh(now - 1000, now)).toBe(true);
        expect(isCacheFresh(now - CACHE_MAX_AGE_MS + 1, now)).toBe(true);
    });

    it("rejects a cache at or past the maximum age", () => {
        expect(isCacheFresh(now - CACHE_MAX_AGE_MS, now)).toBe(false);
        expect(isCacheFresh(now - 7 * CACHE_MAX_AGE_MS, now)).toBe(false);
    });

    it("rejects a cache stamped in the future", () => {
        expect(isCacheFresh(now + 1, now)).toBe(false);
        expect(isCacheFresh(now + CACHE_MAX_AGE_MS, now)).toBe(false);
    });
});
