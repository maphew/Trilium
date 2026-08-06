# Differences from upstream
*   Embeds [`~~isaul32/ckeditor5-math~~`](https://github.com/isaul32/ckeditor5-math)  <a class="reference-link" href="ckeditor5-math.md">ckeditor5-math</a>, which is a third-party plugin for adding math support. CKEditor itself also has a [math plugin](https://ckeditor.com/docs/ckeditor5/latest/features/math-equations.html) with MathType and ChemType but it's premium-only.
*   Zadam left a TODO in `findandreplaceUI`: `// FIXME: keyboard shortcut doesn't work:` [`https://github.com/ckeditor/ckeditor5/issues/10645`](https://github.com/ckeditor/ckeditor5/issues/10645)
*   `packages\ckeditor5-build-balloon-block\src\mention_customization.js` introduces note insertion via `@` character.

| Affected file | Affected method | Changed in | Reason for change |
| --- | --- | --- | --- |
| `packages/ckeditor5-mention/src/mentionui.ts` | `createRegExp()` | `6db05043be24bacf9bd51ea46408232b01a1b232` (added back) | Allows triggering the autocomplete for labels and attributes in the attribute editor. |
| `init()` | `55a63a1934efb9a520fcc2d69f3ce55ac22aca39` | Allows dismissing @-mention permanently after pressing ESC, otherwise it would automatically show up as soon as a space was entered. |  |

## Upstream behaviour overridden at runtime

The editor is used as published, so these are not patches to CKEditor's own files: a Trilium plugin listens on the same event at a higher priority and takes the decision away from upstream before it runs. They are recorded here because the code they pre-empt is still present and still looks perfectly correct on its own — each of these is easy to mistake for redundant and delete.

### `ClipboardBareImage` — preferring a clipboard image file over the pasted HTML

`packages/ckeditor5/src/plugins/clipboard_bare_image.ts`, on `clipboardInput` at `high`, ahead of `ImageUploadEditing`'s normal-priority listener.

Upstream deliberately ignores the clipboard's image files whenever any HTML is present ([ckeditor/ckeditor5-upload#68](https://github.com/ckeditor/ckeditor5-upload/issues/68)): a copy from Word carries a bitmap of the whole selection alongside the markup, and letting the file win would replace the text with a picture of it. That guard is correct and must stay.

It is wrong, however, for a picture copied out of Slack, Google Chat or a browser tab. There the HTML names the picture by a URL private to the app that served it, so the note ends up pointing at something neither the server nor the browser can fetch, while the decoded bytes sit unused on the clipboard.

The override therefore applies in exactly one shape — the HTML is a single `<img>` and nothing besides, and exactly one image file is on offer. **Do not widen it.** Anything that lets a file win while the HTML carries text reintroduces [ckeditor/ckeditor5#2830](https://github.com/ckeditor/ckeditor5/issues/2830), which the spec pins directly.

A mixed selection of text and pictures carries no file at all, so it is out of reach here and still depends on the server fetching the URL after the note is saved (`packages/trilium-core/src/services/image_download.ts`) — which cannot work on an instance without network access to the originating host.

### `ClipboardImageEmbed` — keeping an internal paste reference-based

`packages/ckeditor5/src/plugins/clipboard_image_embed.ts`, on `inputTransformation` at `high`, again ahead of `ImageUploadEditing`.

Copying note content out embeds each internal image as a `data:` URI so it survives into external applications, stashing the original reference in `data-trilium-src`. On the way back in, that reference has to be restored *before* upstream sees a `data:` image and uploads it as a brand-new attachment. Lose the priority and every internal copy/paste silently duplicates its images.

The `clipboardImageEmbedEnabled` option gates only the embedding side. Restoring is intentionally ungated: a copy taken while the feature was on must still restore afterwards, or it turns into exactly the duplicate upload the marker exists to prevent.

## Checking the old repo

Use the following command to identify commits from Zadam:

```
git log --oneline --author="adam" --all
```

It's best to run the command from zadam's fork of `trilium-ckeditor5` instead of the TriliumNext once since it might not contain all the unmerged branches.

To show a filtered diff of a commit:

```
git show d42e772783 -- ':!*yarn.lock' ':!*packages/ckeditor5-build-balloon-block/build/*' ':!*package.json'
```