# Desktop idiom — pointer, keyboard, windows

Applies to: the web app on a laptop/desktop browser, the Electron shell in `desktop/`, wide dashboards, dense tables, and any surface where the primary input is a precise pointer plus a physical keyboard.

Desktop's advantages are **precision, hover, keyboard, and screen area**. Its costs are **no haptics, a cursor that must communicate affordance visually, and users who expect speed through shortcuts, not taps**. Design to the advantages; don't just stretch the phone layout.

## 1. Pointer craft

- **Hover is a first-class state, not decoration.** Every interactive element needs a hover state that appears instantly (`~100ms`) and reads as "this responds." Non-interactive elements must *not* have one — a hover on dead content is a lie.
- **Hover reveals, it never hides.** Row actions may fade in on hover, but the row must not reflow, resize, or shift text when they appear — reserve the space. Layout shift on hover is the most common desktop craft failure.
- **Cursor shape carries meaning.** `pointer` for actionable, `text` for selectable, `grab`/`grabbing` for draggable, `col-resize` on a column divider, `not-allowed` only when you also explain why. Never put `cursor: pointer` on plain text.
- **Hover intent needs a delay, hover exit does not.** Open a hover menu after ~100–150ms of sustained hover so a cursor passing through doesn't spawn popups; close on a short grace period (~200ms) so a diagonal path to the submenu doesn't dismiss it.
- **Tooltips: ~500ms delay on first appearance, near-zero within a group.** Once one tooltip in a toolbar is shown, adjacent ones appear immediately.
- **Precision buys density.** Desktop controls may be smaller than touch minimums (≥28px control height, ≥16px icon hit box with padding), *provided* hover and focus are clearly visible. Don't ship 48px-tall phone rows on a 27" display.

## 2. Keyboard is the desktop power path

- **Everything reachable by mouse must be reachable by keyboard,** in a tab order that matches visual order. Test the whole flow without touching the mouse.
- **Focus ring is never removed.** Use `:focus-visible` so it appears for keyboard users without decorating mouse clicks. It must be visible over every surface, including translucent chrome and clay/neumorphic panels.
- **Shortcuts for the daily verbs**, published in a `?` / Shortcuts sheet: search/command palette (`⌘K` / `Ctrl+K`), save (`⌘S`), new (`⌘N`), close/dismiss (`Esc`), submit-in-form (`⌘Enter`), row navigation (`↑ ↓`), select (`Space`), open (`Enter`).
- **`Esc` always backs out one level** — closes the topmost sheet/menu/dialog, then clears a search field, then leaves nothing to close. Never trap the user.
- **Dialogs and sheets trap focus while open** and restore focus to the trigger element on close. shadcn/Radix does this by default — do not defeat it with custom portals.
- **Type-ahead in lists.** In a long select or table, typing letters should jump to matching rows.
- **Barcode/HID scanner input is keyboard input.** This project's global scanner listens at the capture phase — any new desktop surface with a focused text field must not swallow scans, and any modal must declare whether it accepts scans while open.

## 3. Windows, layout and density

- **Design for a resizable window, not a screenshot.** The Electron shell can be dragged to ~900px wide; every desktop layout must survive it. Test at 1280, 1440, 1920 and at a half-screen snap.
- **Content grows, chrome doesn't.** A wider window should show more rows/columns, not a wider button. Cap text measures at ~70–80 characters; use the extra width for a secondary pane or detail inspector.
- **Multi-pane over navigation.** Desktop's real power is showing list + detail simultaneously. Prefer a persistent sidebar and an inspector panel to a stack of full-screen pushes.
- **Sticky headers and toolbars are translucent layers** (`backdrop-filter`) with content scrolling underneath, plus a scroll-edge fade instead of a hard 1px divider (SKILL.md §12).
- **Tables are a desktop specialty.** Sticky header row, sticky first column when scrolling horizontally, right-aligned numerics with tabular figures (`font-variant-numeric: tabular-nums`), zebra or hover-row highlight (not both), sortable columns with a visible sort indicator, and virtualization past ~100 rows.
- **Respect the OS chrome.** In Electron, keep window controls where the platform puts them, support standard window shortcuts, and never draw a fake title bar that behaves differently from a real one.

## 4. Motion on desktop

All of SKILL.md §§1–11 applies unchanged — springs, interruptibility, velocity handoff. The differences:

- **Distances are shorter, so responses are faster.** Desktop transitions read best at `response 0.25–0.35`; the same 0.4s that feels right on a phone-height sheet feels sluggish on a 320px popover.
- **Pointer drags carry velocity too.** Drag-to-reorder, column resize, kanban drag, and map pan all get the same momentum projection and rubber-banding as touch. `setPointerCapture` makes one implementation serve both.
- **Wheel/trackpad scroll must not be hijacked.** No scroll-jacking, no custom smooth-scroll that fights the OS. If you build a horizontal carousel, allow shift+wheel and trackpad horizontal gestures natively.
- **Bounce is rarer on desktop.** A mouse-driven interaction usually has no thrown momentum, so critically damped (`bounce: 0`) is the default; keep overshoot for genuinely flicked things.
- **Hover-triggered motion stays small.** ≤4px translate, ≤1.02 scale, ≤150ms. Big movement on hover reads as noise when the cursor sweeps across a grid.

## 5. Right-click, selection, and drag

- **Context menus where the platform expects them.** Right-click on a data row should offer the same actions as the row's overflow menu — same labels, same order.
- **Text selection is a feature.** Don't set `user-select: none` on content; restrict it to chrome (toolbars, drag handles, buttons) where accidental selection during a drag is the actual problem.
- **Multi-select** with `Shift`-range and `⌘/Ctrl`-toggle in tables and lists, and show a persistent count + bulk action bar once more than one item is selected.
- **Drag-and-drop needs three visible states:** the lifted item (raised shadow, slight scale, cursor `grabbing`), a live drop indicator at the insertion point, and a clear rejection state for invalid targets. Animate the settle with a spring; never teleport the item into place.
- **Every drag must have a keyboard equivalent** (move up/down via menu or shortcut) — drag-only functionality is inaccessible.

## 6. Desktop-specific accessibility

- Respect OS zoom and browser text scaling — layout in `rem`, no fixed-height text containers.
- Test with the keyboard only, then with a screen reader on at least the primary flow.
- `prefers-reduced-motion` on desktop also means: no parallax on scroll, no auto-playing background video in the app shell, no animated sidebar width changes.
- Windows high-contrast / `prefers-contrast: more`: translucent chrome becomes solid with a defined border.

## Desktop review checklist

- [ ] Hover state on every interactive element, none on dead content, no layout shift on hover
- [ ] `:focus-visible` ring visible on every control, over every surface
- [ ] Full flow completable with keyboard only; `Esc` backs out; focus restored on dialog close
- [ ] Window works at ~900px, 1280px and 1920px; content scales, chrome doesn't
- [ ] Tables: sticky header, tabular numerics, sort indicator, virtualized past ~100 rows
- [ ] Drags use pointer capture + momentum + spring settle; keyboard alternative exists
- [ ] No scroll-jacking; native wheel/trackpad behavior preserved
- [ ] Right-click menu matches the row's action menu
- [ ] Springs at `response 0.25–0.35`, `bounce: 0` unless momentum preceded them
