# Footnotes

An inline `[n]` reference in the text, paired with a numbered item in a footnote section at the end
of the document. Typing `[^1]` autoformats into a reference.

| File | Role |
|---|---|
| `footnotes.ts` | Glue plugin; also declares the `ckeditor5` module augmentation |
| `footnote_editing.ts` | Command registration, delete handling, and the renumbering/reordering bookkeeping |
| `schema.ts` | The five model elements (section, item, content, reference, back link) |
| `converters.ts` | Upcast/downcast for each element, in both data and editing views |
| `insert_footnote_command.ts` | The `InsertFootnote` command |
| `footnote_ui.ts` | The split button and its list of existing footnotes |
| `auto_formatting.ts` | The `[^n]` markdown-style shorthand |
| `utils.ts` | Small model/view tree query helpers |
| `constants.ts` | Element, class, attribute and command name tables |

## Provenance

Forked from [ThomasAitken/ckeditor5-footnotes](https://github.com/ThomasAitken/ckeditor5-footnotes)
(as the *Technologies used* page in the User Guide records), which is itself highly derivative of
the [Forum Magnum footnote
plugin](https://github.com/ForumMagnum/ForumMagnum/tree/master/public/lesswrong-editor/src/ckeditor5-footnote/src),
copyright (c) 2020 Bohan Niu, **ISC** licensed — see [`LICENSE.md`](./LICENSE.md) next to this file,
which reproduces the original license in full. ISC is permissive and combines with this
repository's AGPL-3.0-only license.

Trilium ported the source to TypeScript and to current CKEditor 5 APIs (the `Element` →
`ModelElement`, `Writer` → `ModelWriter` rename wave, among others); it is not tracked against
upstream, which targets a much older CKEditor 5.

It lived at `packages/ckeditor5-footnotes` until it was folded into this package — it had no
consumers outside `@triliumnext/ckeditor5`, was never published, and shipped a
`ckeditor5-package-generator` scaffold (sample pages, its own ESLint/Stylelint/vitest configs) that
nothing invoked. Its vitest config declared a 100% coverage gate but the package contained no tests
at all, and CI never ran it with `--coverage`, so ~1300 lines went unexercised.

Straightened out during the move:

- **Renumbering bug.** `_removeFootnote()` renumbered trailing footnotes with
  `` `${ index ?? 0 + i + 1 }` ``, which parses as `index ?? (0 + i + 1)`. Since `index` is
  non-null by that point, *every* trailing footnote was assigned the same number. Now
  `` `${index + i + 1}` ``.
- `utils.ts` exported four near-identical query helpers; `modelQueryText` and `modelQueryTextAll`
  had no callers and are gone.
- The unused `DATA_FOOTNOTE_ID` constant is gone.
- Several unreachable guards were dropped rather than papered over with tests: an
  `editor.plugins.has("Autoformat")` check in a plugin that `requires` Autoformat, a
  `!index` check on a value built by a template literal, a `this.editor` null check inside a plugin
  method, and a duplicated "index is nullish" throw.
