# Admonition

Info boxes / warning boxes: an `<aside class="admonition <type>">` container holding block content,
with five types (`note`, `tip`, `important`, `caution`, `warning`).

The feature is split the usual CKEditor way:

| File | Role |
|---|---|
| `admonition.ts` | Glue plugin; also declares the `ckeditor5` module augmentation |
| `admonition_command.ts` | The `admonition` command — wraps/unwraps blocks, owns the type names |
| `admonition_editing.ts` | Schema, upcast/downcast, post-fixer, Enter/Backspace break-out |
| `admonition_ui.ts` | The split button + type dropdown, and the user-facing type titles |
| `admonition_autoformat.ts` | `!!! <type> ` at the start of a block |
| `admonition_toolbar.ts` | Balloon toolbar shown when the selection is inside an admonition |
| `admonition_type_dropdown.ts` | Toolbar dropdown for switching an existing admonition's type |

## Provenance

Adapted from CKEditor 5's **block-quote** feature (`@ckeditor/ckeditor5-block-quote`), copyright
CKSource Holding sp. z o.o., which Trilium forked to build admonitions on: the command, editing
plugin and UI plugin still carry the CKSource license header, and the command's internals still
speak in terms of "quotes". The autoformat, toolbar and type-dropdown parts are Trilium's own.

It lived at `packages/ckeditor5-admonition` until it was folded into this package — it had no
consumers outside `@triliumnext/ckeditor5`, was never published, and shipped a
`ckeditor5-package-generator` scaffold (sample pages, its own ESLint/Stylelint/vitest configs) that
nothing invoked. Half the feature already lived here: `admonition_toolbar.ts` and
`admonition_type_dropdown.ts` were in the aggregate while the plugin they drive was in the package.

Two things were straightened out during the move:

- The package exported **two different** `ADMONITION_TYPES` — a tuple of names from the command
  module and a `Record<type, {title}>` from the UI module — and the barrel re-exported the UI one,
  shadowing the other. The tuple is now `ADMONITION_TYPE_NAMES`; `ADMONITION_TYPES` remains the
  record consumers already used.
- `theme/blockquote.css` did not belong to this feature at all — it is CKEditor's baseline
  `blockquote` styling, inherited from the fork. It moved to `src/theme/blockquote.css` and is
  imported from `src/index.ts` with the other global stylesheets.
