# reveal.js themes (vendored)

Theme sources for the presentation collection view, vendored from
[reveal.js](https://github.com/hakimel/reveal.js) **6.0.1** (`css/theme/`), MIT licensed — see
`LICENSE`.

Not yet wired up: `../themes.ts` still imports the prebuilt `reveal.js/theme/*.css?raw`.

## Why these are vendored

The prebuilt themes ship their fonts inline. Upstream builds them with Vite in library mode, where
`build.assetsInlineLimit` is ignored and every asset becomes a base64 `data:` URI, so `black.css`
and `white.css` are 564 KB each — 427 KB of that is four Source Sans Pro `.woff` faces. The themes
that use Google Fonts instead keep an `@import url('https://fonts.googleapis.com/…')` at the top of
the built CSS, which fetches at render time. Six of the ten themes the picker offers do that, and
Trilium runs offline.

Compiled from these sources, a theme is about 5 KB (1.4 KB gzipped).

## What changed from upstream

One deleted line per theme — the `@import url(…)` that pulls in a font — and nothing else. Twelve
of the fourteen themes lost one or two; `serif.scss` and `dracula.scss` were already on system font
stacks and are byte-identical to upstream.

Removing a font leaves the rest of the stack. `black`, `white` and `beige` fall back to Helvetica;
`solarized` and `moon` headings fall from League Gothic to Impact. The visible ones are `sky`
(Quicksand) and `simple` (News Cycle), whose display headings drop to a generic sans.

## Re-syncing after a reveal.js upgrade

Diff `node_modules/reveal.js/css/theme` against this directory. Every hunk should be one of the
`@import url(…)` lines below; anything else is a real upstream change to carry over.

```
@import url('./fonts/source-sans-pro/source-sans-pro.css');          black, black-contrast, white, white-contrast
@import url('./fonts/league-gothic/league-gothic.css');              beige, league, moon, solarized
@import url('https://fonts.googleapis.com/css?family=Lato:…');       beige, league, moon, solarized, simple
@import url('https://fonts.googleapis.com/css?family=Ubuntu:…');     blood
@import url('https://fonts.googleapis.com/css?family=Quicksand:…');  sky
@import url('https://fonts.googleapis.com/css?family=Open+Sans:…');  night, sky
@import url('https://fonts.googleapis.com/css?family=Montserrat:…'); night
@import url('https://fonts.googleapis.com/css?family=News+Cycle:…'); simple
```

## Layout

`template/settings.scss` declares the variables a theme overrides, `template/theme.scss` emits the
rules from them, and `template/mixins.scss` holds `light-bg-text-color`. A theme file is 40 to 90
lines: a `@use 'template/settings' with (…)` block of overrides, then `@use 'template/theme'`.

`black-contrast` and `white-contrast` are the higher-contrast variants of `black` and `white`;
`league` and `night` round out the upstream set. None of the four is in the picker today.
