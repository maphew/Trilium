# Running tests & configuration (Trilium)

Two packages carry CKEditor 5 tests: `packages/ckeditor5` (the aggregate, which holds every
in-tree plugin under `src/plugins/`) and `packages/ckeditor5-math`. Each has its own
`vitest.config.ts` built with `defineConfig` directly — there is no shared factory. Vitest is 4 or
later.

## Per-package scripts

Each package's `package.json` defines:

| Script | Command | Purpose |
|--------|---------|---------|
| `test` | `vitest` | Run the package's tests (configs set `watch: false`, so this is one-shot). |
| `test:debug` | `vitest --inspect-brk --no-file-parallelism --browser.headless=false` | Attach a debugger and watch a browser-mode run with a visible window. |

Run a single package from anywhere in the monorepo:

```bash
pnpm --filter @triliumnext/ckeditor5-math test
```

Or, from the package directory: `vitest run`. Add `-t "name"` to filter by test name, or a
filename substring to filter by file.

## The config shape

Both packages run **WebdriverIO browser mode**: real headless Chrome via
`@vitest/browser-webdriverio` (**not** Playwright), with real DOM and layout, gating `src/**`
coverage at 100%. Trilium previously ran some plugins on happy-dom; no CKEditor package does now.

```ts
import { defineConfig } from 'vitest/config';
import svg from 'vite-plugin-svgo';
import { webdriverio } from '@vitest/browser-webdriverio';

export default defineConfig( {
	plugins: [ svg() ],
	test: {
		browser: {
			enabled: true,
			provider: webdriverio(),
			headless: true,
			ui: false,
			instances: [ { browser: 'chrome' } ]
		},
		include: [ 'src/**/*.spec.ts' ],       // math instead uses [ 'tests/**/*.[jt]s' ]
		setupFiles: [ './test/setup.ts' ],     // aggregate only — wires the editor-kit teardown
		globals: true,
		watch: false,
		coverage: {
			thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
			provider: 'v8',
			include: [ 'src/**/*.{ts,tsx}' ],
			exclude: [ '**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts' ],
			reporter: [ 'text' ]
		}
	}
} );
```

Also standard: `globals: true`, the `vite-plugin-svgo` plugin so `import icon from './x.svg'`
resolves, and coverage via `v8` over `src/**` (test files themselves excluded).

**Test-file location.** `packages/ckeditor5` uses **co-located `*.spec.ts`** next to the source —
`include: ['src/**/*.spec.ts']` — including inside plugin folders, e.g.
`src/plugins/collapsible/collapsible_editing.spec.ts`. That is the repo-wide convention (see the
`writing-unit-tests` skill). `packages/ckeditor5-math` still uses a `tests/` directory
(`include: ['tests/**/*.[jt]s']`, no `.spec` suffix); add math tests there, and use co-located
`.spec.ts` everywhere else.

The aggregate also sets `setupFiles: ['./test/setup.ts']`, which wires the global `afterEach` that
destroys editors created through `test/editor-kit.ts`.

## Coverage scope for the aggregate (`packages/ckeditor5`)

The aggregate **imports** `@triliumnext/ckeditor5-math`, so a plain `--coverage` run instruments
its loaded `src/` too — and the `include: ['src/**']` glob matches those sibling sources, dragging
the report well below the aggregate's real number. Math carries its own 100% gate in its own
package, so scope the aggregate's report to its own sources only —
`packages/ckeditor5/vitest.config.ts` does this with:

```ts
coverage: {
	provider: 'v8',
	allowExternal: false,                    // don't reach outside the package root
	include: [ 'src/**/*.{ts,tsx}' ],
	exclude: [
		'**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts',
		'**/node_modules/**', '**/ckeditor5-*/**' // <- keeps imported siblings out
	],
	reporter: [ 'text', 'lcov' ],
	reportsDirectory: './test-output/vitest/coverage'
}
```

`reporter: ['text', 'lcov']` + that `reportsDirectory` are what the `analyzing-coverage`
analyzer (`lcov.info`) and Codecov consume — keep them when adding coverage to a package.

## Debugging

Browser-mode packages support an inspector + visible browser:

```bash
vitest --inspect-brk --no-file-parallelism --browser.headless=false
# i.e. the package's `test:debug` script
```

`--no-file-parallelism` keeps one file at a time so breakpoints are predictable;
`--browser.headless=false` shows the Chrome window.

## Root orchestration

The root `package.json` splits the run because the browser-mode packages compete for browser
resources:

```bash
pnpm test:parallel     # everything except server, ckeditor5 and ckeditor5-math, in parallel
pnpm test:sequential   # server, ckeditor5 and ckeditor5-math, sequentially
pnpm test:all          # test:parallel && test:sequential
```

`ckeditor5` and `ckeditor5-math` **must** run sequentially — running multiple headless Chrome
instances at once exhausts resources. `server` is in the same group for a different reason (shared
test DB, per `CLAUDE.md`), not browser limits. Everything else runs in parallel.

## Notes

- Both packages are at **100% coverage** and gated there, so a change that adds a line adds a test.
- There are **no** manual-test or memory-leak harnesses in the Trilium plugin packages (those
  exist only in the upstream ckeditor5 monorepo).
