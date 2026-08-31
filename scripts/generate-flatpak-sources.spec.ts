import { describe, expect, it } from "vitest";

import { checkPnpm } from "./generate-flatpak-sources.mts";

describe("checkPnpm", () => {
    it("accepts the pinned pnpm major, with or without a corepack checksum", () => {
        expect(() => checkPnpm(`{ "packageManager": "pnpm@11.24.0" }`)).not.toThrow();
        expect(() => checkPnpm(`{ "packageManager": "pnpm@11.24.0+sha512.abc" }`)).not.toThrow();
    });

    it("rejects another pnpm major, another package manager, and a missing pin", () => {
        expect(() => checkPnpm(`{ "packageManager": "pnpm@12.0.0" }`)).toThrow(/pnpm 11/);
        expect(() => checkPnpm(`{ "packageManager": "yarn@4.9.1" }`)).toThrow(/yarn@4.9.1/);
        expect(() => checkPnpm(`{}`)).toThrow(/undefined/);
    });
});
