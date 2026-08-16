# macOS DMG volume icon

`volume.icns` / `volume-dev.icns` (nightly) are the icon of the **mounted disk image** — Finder's
sidebar under Locations, the desktop mount, the DMG window's title bar, the eject menu. appdmg
copies the file in as `.VolumeIcon.icns`; wired up as `icon` in `electron-forge/forge.config.ts`.

Generated from `volume-icon.html`; don't edit the `.icns` by hand. Change the HTML and regenerate:

```bash
pnpm --filter desktop generate-dmg-icon
```

## Previews

`preview-large.png` and `preview-small.png` show the icon **without building or mounting a DMG**
(which needs macOS + appdmg) — the large one at Finder icon-view / desktop-mount size, the small one
at the two sizes Finder actually paints small: the DMG window's title bar and the sidebar, 1:1, with
the 16 and 32 slots magnified 6× so the pixels are inspectable. Both cover both channels.

```bash
pnpm --filter desktop generate-dmg-icon-preview
```

They are **extracted from the committed `.icns`**, not re-rendered from the HTML, so they show what
actually ships and double as a check that the packed file contains what we think it does. Reference
only — appdmg never reads them. Regenerate them whenever the `.icns` changes.

## What this is *not*

**Not the `.dmg` file icon in Downloads.** That one comes from the disk-image UTI. Overriding it
needs a resource-fork custom icon, which HTTP downloads don't carry (it's a `com.apple.ResourceFork`
xattr) and which would dirty the file after CI's `codesign`/`stapler` pass. Not worth chasing — the
mounted-volume icon is the whole win available.

**Not the app icon.** It used to be: `forge.config.ts` pointed `icon` straight at `app-icon/icon.icns`,
so the mounted volume was indistinguishable from the installed app.

## Design

**The form is Apple's own, measured rather than guessed.** The reference is the icon macOS itself
shows for a mounted DMG that carries no custom volume icon — obtained from `NSWorkspace.icon(forFile:)`
against a throwaway `hdiutil`-created image, not from an approximation of it. On a 1024 canvas that
reference measures:

| | |
|---|---|
| Body | 719 × 877 at (152, 74) — **portrait**, aspect 0.82 |
| Corner radius | ~60 (fitted against the corner's inset-per-row profile) |
| Base plinth | bottom ~12% of the body, full width, silver, with an LED right of centre |
| Glyph | centred in the area *above* the plinth |
| Body tone | ~243 at the top falling to ~235 near the base, with a bright rim / dark hairline / interior edge profile |

Matching it means the icon reads as a disk image in the system's own language instead of as a bespoke
box. The one deliberate departure is the glyph: Apple's grey download arrow becomes the brand mark in
full colour, which is the entire point of shipping our own.

An earlier attempt used a **landscape** body with a dark inset face plate and a wide media slot,
loosely after Firefox's. It's a defensible look — Firefox's is a variation on Apple's older *external
drive* icon — but it is not what a disk image looks like on this system, and the landscape silhouette
reads as a display. Don't go back to it without a reason.

The mark is **single-sourced** from `apps/client/src/assets/icon-color.svg` and `icon-nightly.svg`,
loaded as a `file://` image at render time. This folder deliberately keeps no copy of the leaf paths.

## Sizes

**One artwork, scaled to every slot** — the drive body stays intact down to 16pt. At that size the
*silhouette* is what identifies the volume; the mark only has to hold up as a legible colour blob.
Swapping in a bare mark at the small slots throws away the one cue that still reads.

**One exception, and it matters: the body outline can't live in design space.** Every other element
is an *area*, so it shrinks gracefully. A stroke is a *width* — a fixed 5 design units is 0.08 device
px at the 16pt slot, i.e. gone, taking the drive silhouette with it and leaving the mark floating on
a white blob. Apple sidesteps this by hand-tuning their small slots. `volume-icon.html` derives the
stroke width from the slot scale instead (`max(5, 1.1 / scale)`), which gets the same result from one
artwork: ~1.1 device px at the small slots, proportionate once the icon is big enough to carry it.
**If you add another stroked element, give it the same treatment.**

The design is authored in a 1024 box and scaled per slot via a CSS factor, so each slot rasterises
from vectors instead of downsampling one bitmap.

## Output contract

- Ten `.iconset` slots: 16, 16@2x, 32, 32@2x, 128, 128@2x, 256, 256@2x, 512, 512@2x.
- PNG slots render on **any OS** (headless Chromium via the repo's `@playwright/test`). Packing them
  into `.icns` uses `iconutil`, which is **macOS-only** — elsewhere the script leaves the `.iconset`
  on disk and the committed `.icns` untouched. No worse than the status quo: the DMG itself can only
  be *built* on macOS anyway (appdmg is darwin-only).
- Current `iconutil` emits `ic04`/`ic05` for the 1× 16/32 slots (older toolchains, including whatever
  built Firefox's, emit legacy `is32`/`s8mk` + `il32`/`l8mk` RLE instead). Both are fine on supported
  macOS versions; don't "fix" the difference.
