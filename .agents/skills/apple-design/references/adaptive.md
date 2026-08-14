# Adaptive — one design, two idioms

The goal is not "responsive" in the CSS sense (a layout that survives a narrow viewport). It is **one product with a consistent model, expressed twice**: once for a precise pointer with a keyboard, once for a finger. This file decides what is allowed to differ and what never may.

## 1. What must stay identical across desktop and mobile

Break any of these and the product stops feeling like one thing:

- **The conceptual model and vocabulary.** The same entity has the same name everywhere (Turkish domain terms: `miad`, `kurum`, `stok`, `sevkiyat`) — never "Expiry" on desktop and "Miad" on mobile.
- **Information architecture.** The same sections exist, in the same order, with the same grouping. Mobile may nest deeper, but must not invent a section desktop doesn't have.
- **Available actions.** Every action must exist on both surfaces. Its *placement* may differ (toolbar button vs. overflow sheet); its *existence* may not.
- **Data truth and validation rules.** Same rules, same messages, same permissions.
- **Visual language.** Palette, tokens, radii, elevation model, iconography, type scale ramp — one system (`src/app/globals.css`), scaled per platform, never a second theme.
- **Motion character.** Same spring family, same rule that motion is interruptible and velocity-aware. Only the numbers shift slightly (desktop faster over shorter distances).

## 2. What is *supposed* to differ

| Dimension | Desktop | Mobile |
| --- | --- | --- |
| Primary input | Precise pointer + keyboard | Finger |
| Target size | ≥28px control height | ≥44pt / 48dp |
| Density | High — many rows, multi-pane | Low — one primary thing per screen |
| Navigation | Persistent sidebar / start menu, list+detail side by side | Bottom dock, push navigation, sheets |
| Secondary actions | Hover-revealed row actions, right-click menu | Long-press menu, swipe actions, overflow button |
| Modality | Centered dialog, inspector panel, popover anchored to trigger | Bottom sheet with snap points, full-screen step |
| Data entry | Dense form, tab between fields, `⌘Enter` to submit | Wizard steps, one decision per screen, big commit button |
| Feedback | Hover, cursor, focus ring, toast | Haptic + visual, toast above the dock |
| Discovery | Tooltips, shortcut hints | Visible labels, no hover secrets |

## 3. Branch on capability, not on width

Screen width is a bad proxy for input: a 1024px tablet is touch, a 900px Electron window is pointer, and many laptops have both.

```css
/* Pointer craft — only where a real cursor exists */
@media (hover: hover) and (pointer: fine) {
  .row:hover .row-actions { opacity: 1; }
}

/* Touch sizing — the default, not the exception */
@media (pointer: coarse) {
  .control { min-height: 44px; }
}
```

```ts
const isPointerFine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
```

Rules:

- **Hover behavior is gated on `(hover: hover)`.** Never rely on `:hover` for anything a coarse pointer also needs.
- **Touch sizing is the baseline; density is the enhancement.** Start at comfortable, opt into compact when `(pointer: fine)` — a hybrid device then gets the safe version by default.
- **Width still governs *layout*** (one column vs. two panes). Use the repo's `use-mobile` hook for layout decisions and capability queries for interaction decisions; they are different questions.
- **Do not branch on user-agent.** For genuine platform features (Capacitor haptics, status bar, Electron window controls), feature-detect the plugin/API instead.
- **Never render a component in a mode the current input can't operate.** If a desktop-only interaction (hover-reveal, drag-to-resize) has no touch path, it isn't finished.

## 4. Building components that serve both

- **One component, two presentations — not two components.** Share state, data fetching, validation, and labels; branch only at the presentation layer. Two parallel implementations drift within a sprint.
- **Prefer a responsive primitive** for cross-cutting patterns: a `<Modal>` that renders as a centered dialog on pointer-fine and a bottom sheet on coarse; a `<Menu>` that renders as a popover or an action sheet. Build the primitive once, and every panel inherits correct behavior.
- **Keep the public API platform-neutral.** `onCommit`, `onDismiss` — not `onSheetDragEnd`. Pointer Events (SKILL.md §2) give you one gesture implementation for mouse, pen, and touch.
- **Spacing and type in `rem`,** so OS text scaling and Dynamic Type work on both platforms.
- **Test each surface at its extremes:** the Electron window at ~900px, a 1920px dashboard, a mid-range Android phone, and 200% text scaling.

## 5. Electron and Capacitor specifics

- Electron and the browser share the desktop idiom; the differences are window chrome, native menus, file dialogs, and offline behavior — not layout or interaction rules.
- Capacitor adds: safe-area insets, hardware back button (must map to "back one level," same as `Esc`), status-bar styling tied to the theme, haptics, and a WebView with less headroom than Chrome on a laptop.
- Anything platform-specific goes behind a small capability module, not scattered `if (isNative)` checks in panels.
- The terminal app shell follows the desktop rules with keyboard-first weighting: every action reachable without a pointer.

## 6. Adaptive review checklist

- [ ] Same actions, names, and validation exist on both surfaces
- [ ] Interaction branches on `(hover: hover)` / `(pointer: coarse)`, layout on width — not user-agent
- [ ] Touch sizing is the baseline; compact density is the pointer-fine enhancement
- [ ] Shared component with one presentation layer, not duplicated implementations
- [ ] Modal/menu primitives render correctly as dialog↔sheet, popover↔action sheet
- [ ] Hardware back / `Esc` both back out one level
- [ ] Verified at 900px window, 1920px, mid-range phone, and 200% text
