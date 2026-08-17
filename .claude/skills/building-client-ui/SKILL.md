---
name: building-client-ui
description: Use when building or changing any UI in the Trilium client (`apps/client`) — a dialog, a settings pane, a form, a toolbar, a badge, a dropdown menu, a type widget, a control floating over a note's content (map, mind map, image, diagram, presentation). Catalogues the reusable Preact components under `apps/client/src/widgets/react/` (which one to reach for instead of a hand-rolled `<input>`/`<button>`/pill), the `Dropdown` backdrop-blur rules (`noDropdownListStyle` / `portalToBody`), and the `OverlayControlGroup` / `OverlayToolbar` contract for controls over a canvas. The home for client UI guidance that outgrows CLAUDE.md.
---

# Building client UI

The client is a Preact app (legacy widgets are jQuery `BasicWidget`s; new UI is Preact). Shared components live in `apps/client/src/widgets/react/`. **Always reuse them instead of writing raw HTML elements or a custom implementation** — every hand-rolled `<input>`, `<select>`, `<button>`, pill or overlay button is a second copy of styling, focus handling and accessibility that drifts.

The general styling rules (no inline styles, one `.css` file per component imported at the top, scope by root class + native CSS nesting) are in the repo `CLAUDE.md`; this skill is about *which component* and *how to drive it*.

## Reusable component catalogue

Form controls:

- `FormTextBox` — text input with validation and controlled input handling; `FormTextBoxWithUnit` for a unit suffix (`mm`, `px`). `FormTextArea`, `PasswordField`, `FormPasswordWithConfirmation` for their cases.
- `FormSelect` — dropdown/combobox taking an object array as data. `FormDropdownList` for a list of items with icons; `FormAutocomplete` / `NoteAutocomplete` for typeahead (the latter searches notes).
- `FormCheckbox`, `FormToggle`, `FormRadioGroup` / `FormInlineRadioGroup` — boolean and exclusive choices. `SegmentedChoice` is a row of buttons acting as one exclusive choice (use where a dropdown would hide the alternatives).
- `Slider` — range slider with label.
- `ColorPicker` — preset swatches plus the browser's native `<input type="color">`; value is a CSS color string, `onChange(null)` clears. It is a controlled, flat swatch row: wrap it in a `Dropdown` for a popover or use it inline; don't hand-roll a palette. `NoteColorPicker` is the note-bound variant that reads/writes the note's `color` label.
- `IconPicker` — boxicons picker.
- `FormGroup` — label + control + hint row for settings panes; `PropertySheet` for a whole sheet of them.
- `FormFileUpload`, `FileDropZone` — file input and drag-and-drop target.

Buttons and links:

- `Button` — the general button (also carries the tooltip for a *disabled* control via a wrapper, since a disabled `<button>` emits no pointer events). `ActionButton` — icon button with consistent styling; `LinkButton` — a link that acts as a button.
- `HelpButton`, `HelpTooltipButton`, `HelpDropdown` — open in-app help pages; don't invent a new "?" affordance.
- `KeyboardShortcut` — renders a shortcut as keycaps.

Display and layout:

- `NoItems` — empty state placeholder with icon and message ("no results", "too many items", error states).
- `Badge` — colored pill/label with optional icon, tooltip and `onClick` (counts, status flags). Set its color through the `--color` CSS variable on a wrapper class, not inline styles; pass `outline` for a colored-border/transparent-fill variant. `BadgeWithDropdown` pairs a badge with a dropdown menu. Don't hand-roll pill/badge markup.
- `Chip` — one entry of a set, with a remove button.
- `Alert`, `InfoBar`, `Admonition`, `ContentErrorMessage`, `RenderErrorCard` — inline notices and error surfaces of increasing weight.
- `Card` — a titled group of sections (filter-aware under `FilterProvider`). `Collapsible` — animated, theme-styled expandable section with self-managed `initiallyExpanded`; `ExternallyControlledCollapsible` is the controlled variant (caller owns `expanded`/`setExpanded`).
- `TabStrip` — a row of icon-only tabs named by tooltips, heading a panel divided into groups.
- `Modal`, `WizardModal` — dialogs; `Popover` — a small surface anchored beside something (portaled to the body, so no scroll container clips it).
- `LoadingSpinner`, `LazyComponent`, `Icon`, `MaskedIcon`, `NoteLink`, `NoteList`, `SiblingNavigator`, `ImageViewer`, `CodeBlock`, `charts/DonutChart`, `charts/Treemap`.

Data grids and calendars (outside `widgets/react/`, but equally generic):

- `Table` — `apps/client/src/widgets/collections/table/tabulator.tsx`, a [Tabulator](https://tabulator.info/) wrapper (`columns`, `data`, `events`, `modules`, `tabulatorRef`; typed via `TableProps<T>`). Decoupled from the note/collection model — use it for any grid (SQL console results, the collection table view). Never instantiate `tabulator-tables` directly.
- `Calendar` — `apps/client/src/widgets/collections/calendar/calendar.tsx`, a [FullCalendar](https://fullcalendar.io/) wrapper (any `CalendarOptions` plus `calendarRef`; typed via `CalendarProps`). Use it for any calendar rather than `@fullcalendar/core` directly.

Overlays over a note's content — `OverlayControlGroup`, `OverlayToolbar`, `OverlayPanel` — see the dedicated section below.

Two rules that apply to all of them:

- **Do not use Bootstrap utility classes** (`form-control-sm`, `form-select-sm`, `input-group`, …) on these components — they manage their own styling. Adjust sizing or layout through the component's props or its CSS custom properties, not Bootstrap overrides.
- Before adding a prop or a variant, read the component's own doc comment; most already have the variant (outline badge, controlled collapsible, popover-wrapped picker).

## Dropdown menus and the backdrop blur

`Dropdown` is the Bootstrap dropdown wrapper (toggle button + menu, with `FormListItem` / `FormDropdownDivider` as items). The Next theme frosts every `.dropdown-menu` with `backdrop-filter`, along **two different paths**, and only one is reliable:

- **`::before` layer** (default for a menu *without* `tn-dropdown-list`) — the blur lives on a background-less pseudo-element at `z-index: -1`. Works everywhere.
- **Element-level filter** (what the `tn-dropdown-list` class switches to) — the blur sits on the menu element itself, which also paints a translucent background. It exists only because a **scrollable** menu can't use the pseudo (it would scroll away with the content). Opened inside the note's scrolling content area, this filter silently does nothing and the menu degrades to its bare ~85 %-alpha background — see-through over anything dark. `body.background-effects` already forces such menus to an opaque fallback for the same reason (see the comment in `theme-next/base.css`).

`Dropdown` adds `tn-dropdown-list` **by default**, so a new menu opts into the fragile path unless told otherwise:

- Pass **`noDropdownListStyle`** on any menu that doesn't scroll — nearly every action/`[…]` menu. `NoteActions`, the global menu, the note-icon picker and `HelpDropdown` all do.
- Pass **`portalToBody`** instead when the menu is fine but an *ancestor* establishes a containment/backdrop root (`container-type`, `transform`, `filter` — e.g. the peeked right pane), which flattens the blur into a flat tint.
- If a menu looks transparent rather than frosted, check these two before reaching for CSS overrides.

## Controls floating over a note's content

Any control laid **over** a note's own content — a geo map, a mind map, an image, a video, a diagram, a presentation, and whatever comes next — goes on one of two shared components. **Never hand-roll a `<button>` with `tn-overlay-*` classes**: those classes are the components' business, and a site that writes them itself also has to write the ref, the tooltip, the `aria-label` and the `type="button"` that the component already owns.

- **`OverlayControlGroup`** (`OverlayControlGroup.tsx`) — a run of buttons joined edge to edge into one segmented chip. **This is the default**, and specifically what zoom steps, a zoom/scale readout, next/previous navigation, fullscreen and "add a thing to this view" buttons are built from. Its buttons are `OverlayControlButton`; `OverlayFullscreenButton` is the ready-made fullscreen toggle (pass it `isFullscreen` + `onToggle` from `useFullscreen` in `hooks.tsx`).
- **`OverlayToolbar`** (`OverlayToolbar.tsx`) — separate buttons spaced out on their own pane of frosted glass. Use it only where the controls are *not* one run of related steps (e.g. the mind map's four layout-direction choices).
- **`OverlayPanel`** (`OverlayPanel.tsx`) — a panel over a dragged/zoomed canvas holding what can be done with the current selection (header row + dismiss button included).

Rules for `OverlayControlButton`, which cover every case seen so far:

- **`title` is the tooltip.** A button wearing no words is also named by it; one that wears words is named by them. Do not add an `aria-label` — the component decides, and a title that says more at length would otherwise speak over the visible words. The one exception is a face that is neither words nor a mark (a keycap, a glyph standing for itself), which passes a plain `aria-label` of its own.
- **`icon` is a boxicons name** (`bx-plus-circle`), **`text` is what stands inside**. Given both, the component renders the mark as a child span itself — never put a `bx` class on a button that also wears words, since the icon font would fall on the words too.
- **`active`/`disabled` are props**, not classes concatenated into `className`.
- **Pass `overCanvas`** when the group stands over something that is dragged (a map), so a press on a button is not taken for the start of a drag.
- **Where the group stands is the group's own**, via `placement` (`top`/`bottom` × `start`/`center`/`end`): it pins itself over the nearest positioned ancestor, and its tooltips open away from that edge. **Never write `position: absolute` plus insets at the call site.** What the caller does hand over, in that widget's CSS, is the room to keep from the edges (`--overlay-group-inset`, or the per-edge `--overlay-group-inset-top`/`-bottom`/`-start`/`-end` where one edge differs — a fullscreen map clearing a notch) and the `z-index`. `titlePosition` overrides the tooltip direction and is rarely right; only add a class to a *button* if a rule actually uses it.
- **Overlay controls exist in every layout.** Never gate a group on `isExperimentalFeatureEnabled("new-layout")`, and when an action moves onto a group, **delete its twin in `FloatingButtonsDefinitions.tsx`** rather than keeping both: that bar only renders in the old layout (`desktop_layout.tsx` mounts it with `!isNewLayout`), so a layout-gated group plus a floating fallback means two implementations of one button that drift. Keep the underlying app commands (e.g. `relationMapResetZoomIn`) even once the group is their only caller — note scripts can fire them via `api.triggerCommand`.
- Reuse shared labels from the `common` translation namespace (e.g. `common.fullscreen`) rather than adding a per-widget copy of a string the app already has.

Worked examples to read before adding a new one: `apps/client/src/widgets/type_widgets/mind_map/MapToolbar.tsx` (group + toolbar + fullscreen), `type_widgets/relation_map/MapToolbar.tsx`, `collections/geomap/MapToolbar.tsx`, `type_widgets/helpers/SvgSplitEditor.tsx`.
