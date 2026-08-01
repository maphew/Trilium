---
name: ckeditor5-testing
description: >-
  Testing CKEditor 5 plugins in the Trilium monorepo. Use when adding or
  reviewing unit tests for the packages/ckeditor5 aggregate (including its
  in-tree plugins under src/plugins/) or packages/ckeditor5-math, debugging a
  failing test, or setting up a package's test runner. Covers the WebdriverIO
  browser-mode Vitest setup, the vitest.config.ts, testing against a real ClassicEditor, the
  model/view helpers imported from 'ckeditor5' (_setModelData / _getModelData /
  _getViewData and their {}/[] selection syntax), vi spies/mocks, idiomatic
  patterns for schema/conversion/command/UI tests, the pnpm --filter runner, and
  Trilium-specific conventions and gotchas. Complements the
  ckeditor5-plugin-development and writing-unit-tests skills.
---

# CKEditor 5 testing (Trilium)

Testing CKEditor 5 plugins in the **Trilium (TriliumNext Notes) monorepo**. Nearly everything lives
in one package, `packages/ckeditor5`, with **tests co-located as `*.spec.ts` next to the source** —
including every plugin under `src/plugins/`. `packages/ckeditor5-math` is the last separate package
and still keeps a legacy `tests/` directory. Both gate `src/**` at **100% coverage** on all four
metrics, so every code change must ship with a test.

## Scope & sources

This skill covers testing CKEditor 5 plugins in the **Trilium (TriliumNext Notes) monorepo**
(`packages/ckeditor5` and `packages/ckeditor5-math`). The CKEditor 5 library is 48 or later.
For general (non-CKEditor) Trilium testing, see the `writing-unit-tests` skill.

**On versions:** these skills name **major versions only** ("48 or later"). Trilium tracks CKEditor
5 closely, so an exact pin written here would be stale within weeks — read the current one from
`packages/ckeditor5/package.json`.

## When to use this skill

Adding/reviewing unit tests for a plugin, debugging a failing test, or configuring a package's
runner. For writing the feature itself, use the `ckeditor5-plugin-development` skill. For general
Trilium testing (Preact components, jQuery widgets, server routes), use `writing-unit-tests`.

## The current setup at a glance

- **Runner:** Vitest 4 or later. **No shared factory** — each package has its own
  `vitest.config.ts` built with `defineConfig` directly.
- **One environment: WebdriverIO browser mode** (`@vitest/browser-webdriverio`, headless Chrome),
  used by both `ckeditor5` and `ckeditor5-math`. Real DOM and real layout, so
  `getBoundingClientRect()`, `elementFromPoint()` and pointer events behave as in a browser. Gates
  `src/**` coverage at 100% (lines/functions/branches/statements). This is **not Playwright**.
  - Trilium used to run some plugins on **happy-dom**; that is gone. If you are porting an old
    test, note the two differences that bite: happy-dom returned zeros from layout APIs (so
    measurement-dependent code silently "passed"), and it fired some DOM events synchronously
    where a real browser defers them — `<details>` fires `toggle` on a later task, for one.
    Synthetic events also need `cancelable: true` before `preventDefault()` means anything.
- **Real editor, no test-editor factories.** Tests create a real `ClassicEditor` against a real
  DOM element (see below). There is **no** `ModelTestEditor`/`VirtualTestEditor`/`ClassicTestEditor`
  in Trilium — those live only in the upstream ckeditor5 monorepo's `tests/_utils`.
- **Helpers from `'ckeditor5'`:** `_setModelData`, `_getModelData`, `_getViewData` are imported
  from the `ckeditor5` package.
- **Test-file location:** **co-located `*.spec.ts`** next to the source, including inside plugin
  folders (`src/plugins/<name>/<name>.spec.ts`), with vitest `include: ['src/**/*.spec.ts']`.
  `packages/ckeditor5-math` is the exception and still uses a `tests/` dir
  (`include: ['tests/**/*.[jt]s']`, no `.spec` suffix); fold new math tests in alongside those, but
  anything new elsewhere is co-located. `globals: true`. Coverage provider `v8`,
  `include: src/**` (test files themselves excluded from coverage). The aggregate keeps
  `allowExternal: false` so an imported sibling package cannot bleed into its report (see
  `references/running-and-config.md`).
- **Imports** from `'ckeditor5'`; in-package source imports use a file extension.
- **License key:** tests pass `licenseKey: 'GPL'` in the editor config.
- **Every plugin folded into the aggregate carries its own tests**, and the 100% gate keeps it
  that way. Unreachable code is the usual reason the gate cannot be met — see
  `references/test-conventions.md` for how Trilium handles it.

## Running tests

```bash
pnpm --filter @triliumnext/ckeditor5-math test     # one package (from anywhere)
# or, from the package dir:
vitest run
```

Debug a browser-mode package with a visible browser:

```bash
vitest --inspect-brk --no-file-parallelism --browser.headless=false
```

Root orchestration: `pnpm test:parallel` runs the light packages in parallel; `pnpm
test:sequential` runs `ckeditor5` and `ckeditor5-math` **sequentially** (browser resource
limits), alongside the server. `pnpm test:all` runs both. Each package exposes `"test": "vitest"` and
`"test:debug": "vitest --inspect-brk --no-file-parallelism --browser.headless=false"`.

## Anatomy of a test

In the aggregate (`packages/ckeditor5`), use the shared **editor kit** —
`createTestEditor()` from `test/editor-kit.ts` builds a real `ClassicEditor` (`licenseKey: 'GPL'`,
auto-tracked) and the global `afterEach` in `test/setup.ts` (wired via `setupFiles`) destroys every
tracked editor, so specs **don't** write their own editor-teardown `afterEach`:

```ts
import { ClassicEditor, Essentials, Paragraph, _setModelData } from 'ckeditor5';
import { describe, it, expect, beforeEach } from 'vitest';

import { createTestEditor } from '../../test/editor-kit.js';
import MyPlugin from './myplugin.js';

describe( 'MyPlugin', () => {
	let editor: ClassicEditor;

	beforeEach( async () => {
		editor = await createTestEditor( [ Essentials, Paragraph, MyPlugin ] );
	} );

	it( 'loads the plugin', () => {
		expect( editor.plugins.get( MyPlugin ) ).toBeInstanceOf( MyPlugin );
	} );

	it( 'keeps the selection in a paragraph', () => {
		_setModelData( editor.model, '<paragraph>foo[]bar</paragraph>' );
		expect( editor.model.document.getRoot().getChild( 0 ).name ).toBe( 'paragraph' );
	} );
} );
```

Need the host element? It's `editor.sourceElement` (or `getEditorElement( editor )` from the kit).
Some legacy specs still hand-roll the create/destroy scaffold (`document.createElement('div')` +
`ClassicEditor.create(...)` + a teardown `afterEach`) — those are being migrated to `createTestEditor`.

Conventions visible here and across the suite:
- One top-level `describe` named after the unit, nested `describe`s for areas (`isEnabled`,
  `execute()`, …), small focused `it`s.
- Create the editor in `beforeEach` (return the Promise or use `async`/`await` — Vitest awaits it).
- Pass `licenseKey: 'GPL'` (the kit does this for you). List only the plugins the test needs
  (commands can also be instantiated directly, e.g. `new InsertMermaidCommand( editor )`).

## Model/view test data

`_setModelData()` / `_getModelData()` (and `_getViewData()`) stringify and parse the engine
structures, with a special selection syntax:

- `[]` — collapsed selection, **or** brackets around a range, anchored in an **element**.
- `{}` — selection anchored inside a **text node** (e.g. `foo{}bar` / `f{oo}bar`).
- Attributes render as `<$text bold="true">word</$text>`; elements as `<paragraph>…</paragraph>`.

```ts
_setModelData( model, '<paragraph>foo[]bar</paragraph>' );
expect( _getModelData( model ) ).toEqual( '<paragraph>foo[]bar</paragraph>' );
expect( _getViewData( editor.editing.view ) ).toEqual( '<p>foo{}bar</p>' );
```

These are dev/test utilities only — never ship them in production code.

## Assertions & spies (Vitest)

- Both **Jest-style** (`expect(x).toBe(y)`, `.toEqual()`, `.toBeInstanceOf()`,
  `.toHaveBeenCalledWith()`) and **Chai-style** (`expect(x).to.equal(y)`, `.to.be.false`,
  `.to.instanceOf()`) matchers work in Vitest. The existing Trilium tests mix both. There are
  **no** custom matchers — compare stringified model/view directly.
- Spies/mocks via `vi`: `vi.spyOn( editor, 'execute' )`, `vi.fn()`, `vi.useFakeTimers()`.

```ts
const spy = vi.spyOn( editor, 'execute' );
button.fire( 'execute' );
expect( spy ).toHaveBeenCalledWith( 'insertMermaid' );
```

## Stubbing the Trilium glue (`glob` / clipboard / jQuery `$`)

Many in-aggregate plugins reference a global `glob` (the Trilium bridge typed in
`src/augmentation.ts`), some hit `navigator.clipboard`, and some converters call jQuery `$(...)`.
Use the globals kit (`test/globals-test-kit.ts`): `installGlobMock({…})` and `mockClipboard({…})`
install the stub **and register their own teardown** (run by the global `afterEach` in
`test/setup.ts`), and `$` is a global passthrough from `setup.ts` — so specs **don't** hand-roll
`globalThis.glob` or delete anything. (Browser mode shares one page, so a leaked global would bleed
into later specs.) See `references/patterns.md` for the recipe.

## Reference map

| File | Use it for |
|------|-----------|
| `references/test-utilities.md` | Testing against a real `ClassicEditor` (lifecycle, `licenseKey: 'GPL'`), and the `_setModelData`/`_getModelData`/`_getViewData` helpers from `'ckeditor5'` + the `[]`/`{}` selection syntax. |
| `references/patterns.md` | Idiomatic recipes per concern (schema, conversion round-trips, commands, UI, keystrokes, events, async), all against a real editor; the `glob`/clipboard/jQuery-`$` stubbing recipe (via the globals kit's `installGlobMock`/`mockClipboard`); note on the 100% coverage gate for browser-mode packages. |
| `references/running-and-config.md` | The WebdriverIO `vitest.config.ts` shape, `pnpm --filter` commands, the debug command, `pnpm test:parallel`/`test:sequential` (ckeditor5 + math sequential), coverage thresholds. |
| `references/test-conventions.md` | Trilium test **conventions & gotchas**: real-browser event timing, real-editor teardown, the both-assertion-styles note, unreachable code vs. the 100% gate, and the pointer to `writing-unit-tests`. |

## Quick review checklist

When reviewing tests: editor created in `beforeEach` with `licenseKey: 'GPL'` and **destroyed**
in `afterEach` (plus `editorElement.remove()`); model/view asserted via
`_getModelData`/`_getViewData` with correct `[]`/`{}` selection syntax; spies via `vi`; behavior
covered for collapsed **and** ranged selections and schema-disallowed contexts; new `src/` lines
covered (100% gate), with any `/* v8 ignore */` carrying a comment that justifies why the code is
unreachable.
