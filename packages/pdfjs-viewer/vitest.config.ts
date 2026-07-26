import { defineConfig } from 'vite';

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/packages/pdfjs-viewer',
    plugins: [],
    test: {
        'watch': false,
        'globals': true,
        'environment': "node",
        'include': ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
        'reporters': [
            "default",
            ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]
        ],
        'coverage': {
            'reportsDirectory': './test-output/vitest/coverage',
            'provider': 'v8' as const,
            'include': ["src/**/*.{ts,tsx}"],
            // custom.ts is the bundle entry point and does nothing but call into bootstrap.ts;
            // importing it would run the viewer boot sequence, so the e2e suite covers it.
            'exclude': ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts", "src/test/**", "src/custom.ts"],
            'reporter': ["text", "lcov"],
        }
    },
}));
