import { resolve } from "node:path";

import { webdriverio } from "@vitest/browser-webdriverio";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        browser: {
            enabled: true,
            provider: webdriverio(),
            headless: true,
            ui: false,
            instances: [{ browser: "chrome" }]
        },
        include: ["src/**/*.spec.ts"],
        globals: true,
        watch: false,
        reporters: ["default", ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]],
        coverage: {
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100
            },
            provider: "v8",
            reportsDirectory: "./test-output/vitest/coverage",
            allowExternal: false,
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts", "**/node_modules/**"],
            // Codecov resolves an lcov `SF:` path by matching it against the repo's file list, so
            // the package-relative paths istanbul emits by default (`src/index.ts`, relative to
            // cwd) are ambiguous in this monorepo and get attributed to whichever package wins the
            // match. Emit repo-root-relative paths instead.
            reporter: ["text", ["lcov", { projectRoot: resolve(__dirname, "../..") }]]
        }
    }
});
