# Mobile idiom — touch, reach, safe areas, haptics

Applies to: the Capacitor/Android build, phone-width web, and any surface whose primary input is a finger.

Mobile's advantages are **directness (you touch the thing itself), haptics, and full attention on one task**. Its costs are **no hover, an imprecise ~9mm pointer that hides the target under itself, limited reach, interruptions, and much less GPU/CPU headroom**. In this product the phone is also used in a warehouse or hospital corridor: one hand, sometimes gloves, bad light, and a barcode scan in the middle of the flow.

## 1. Targets and reach

- **Minimum touch target 44×44pt (~48dp)**, even when the visible control is smaller — expand the hit area with padding or a pseudo-element, not by making the icon huge.
- **≥8px of dead space between adjacent targets.** Two 48dp buttons flush against each other still mis-fire.
- **Primary actions live in the bottom third**, within thumb reach. Destructive or rarely-used actions go top or behind an overflow — far from the resting thumb.
- **Never put the only path to an action in a top corner.** The top of a large phone is the hardest place to reach one-handed.
- **The finger occludes the target.** Feedback for a press must appear *outside* the contact point (row highlight, edge glow, a toast above the dock) — not a tiny checkmark under the thumb.
- **No hover-dependent affordance, ever.** Anything discoverable only on hover does not exist on mobile: show it, or put it in a long-press/overflow menu with a visible entry point.

## 2. Safe areas, chrome, and the keyboard

- **Always use `env(safe-area-inset-*)`** for top status bar, bottom gesture bar, and notch/cutout sides. This repo already exposes `--safe-top/--safe-bottom/--safe-left/--safe-right` (see `src/components/responsive/MobileResponsiveFix.tsx`) — use those variables rather than re-deriving them.
- **The bottom dock owns the bottom inset.** Scrollable content must end with `padding-bottom: calc(var(--dock-height) + env(safe-area-inset-bottom) + 1rem)` so the last row is never trapped under the dock. This is already the pattern in the repo — follow it in every new scroll container.
- **The software keyboard is a viewport change, not a resize you can ignore.** Keep the focused field visible, keep the primary action reachable above the keyboard, and use `100dvh` (never `100vh`) for full-height surfaces. Scroll the field into view on focus.
- **Set the right keyboard**: `inputMode="numeric"` for quantities and counts, `type="search"`, `enterKeyHint="done|search|next"`, `autoCapitalize="off"` for codes and serials.
- **Font-size ≥16px on inputs** or mobile browsers zoom on focus and break the layout.
- **Status bar and dark mode must agree.** With Capacitor `@capacitor/status-bar`, update the style whenever the theme changes; a light status bar over a dark header is an immediately visible defect.

## 3. Gestures

- **Swipe, drag, and pull get 1:1 tracking and momentum** exactly as in SKILL.md §§2–6. A swipe-to-delete row must follow the finger continuously and reveal the action progressively — not jump open at a threshold.
- **Respect the system's gestures first.** Android back-swipe on the screen edges, pull-down notification shade at the top, and the home/gesture bar at the bottom are not yours. Keep custom edge gestures out of the ~20px system regions, and never make an edge swipe the only way to perform an action.
- **Sheets are the mobile modal.** Drag handle at top, drag-to-dismiss with velocity projection, snap points (e.g. peek / half / full) chosen from the *projected* endpoint, rubber-band above the top snap, scrim that darkens proportionally to sheet position, and the parent view pushed back/dimmed for stacked sheets. Springs: `bounce ~0.2`, `duration ~0.3`.
- **Scroll and sheet-drag must cooperate.** A sheet only starts dragging when its inner scroll is at the top; once dragging, the inner scroll locks. Getting this wrong is the classic "sheet fights the list" bug.
- **Long-press ≈ right-click.** Use it for secondary actions, always with a haptic tick at recognition and a visible affordance elsewhere too (long-press is undiscoverable on its own).
- **Pull-to-refresh** only where a manual refresh is genuinely meaningful, with continuous progress during the pull, not a spinner that appears at the threshold.

## 4. Haptics (Capacitor)

Follow SKILL.md §13 — causality, harmony, utility — and keep the vocabulary small and consistent across the whole app:

| Moment | Haptic |
| --- | --- |
| Selection change, snap into place, long-press recognized | selection / light impact |
| Commit an action, toggle, successful barcode scan | medium impact |
| Success notification (goods receipt saved, transfer done) | success notification |
| Warning (quantity over stock, near-expiry) | warning notification |
| Error / rejected scan / failed write | error notification |

Rules: fire the haptic on the **same frame** as the visual, never on every scroll tick or keystroke, never as the only signal (it must be paired with something visible), and gate it behind a user setting plus `prefers-reduced-motion` where the haptic accompanies motion. On the web build the Vibration API is a degraded stand-in — feature-detect, never assume.

## 5. Performance on a real phone

- **Test on a mid-range Android device**, not on a desktop browser with a narrow window. The Capacitor WebView is the real target.
- **`backdrop-filter` is the top mobile cost.** Allow it on fixed chrome (dock, header, active sheet) only. Never on scrolling list items, never on more than ~2 simultaneous surfaces. Where it hurts, fall back to a solid tinted background — this is also what `prefers-reduced-transparency` asks for.
- **Virtualize any list past ~50 rows** (`@tanstack/react-virtual` is already in the stack) and keep row components memoized; a janky scroll destroys the sense of directness faster than any missing feature.
- **Animate only `transform`/`opacity`.** Shadow, blur-radius and layout animations on a phone drop frames immediately. If a clay/neumorphic surface needs a pressed look, pre-compose the two shadow states and cross-fade layers rather than animating `box-shadow`.
- **Images sized to the device**, lazy-loaded below the fold, with explicit dimensions so nothing reflows mid-scroll.
- **Budget the first interaction, not just the first paint.** A splash that finishes while the app is still unresponsive is worse than a slightly longer, honest loading state.

## 6. Mobile flows

- **One primary action per screen.** If two actions compete, one of them belongs on the next step or in the overflow.
- **Wizards over dense forms.** Break long entry (goods receipt, transfer, counts) into steps with visible progress, per-step inline validation, and state preserved if the app is backgrounded mid-flow.
- **Design for interruption.** A phone call, a scan, or a lock screen can happen at any moment; drafts must survive backgrounding and restore where the user left off.
- **Offline and flaky networks are normal.** Show a clear connection state, queue writes, and never let a spinner be the entire screen — show cached content with a staleness marker.
- **Barcode scanning is a first-class input mode**, not a button in a menu: keep the scan target large, confirm the scan with haptic + visual + (optional) sound on the same frame, and show what was scanned in a way that survives a glance in bad light.
- **Errors get a full, plain sentence and a next step** — a phone user cannot hover a tooltip to find out more.

## 7. Mobile accessibility

- Respect the OS text-size setting: `rem`-based type and spacing, layouts that reflow at 200% text.
- Every icon-only button gets an accessible label; TalkBack should be able to complete the primary flow.
- Contrast is a *daylight* problem here — 4.5:1 is the floor, and thin light-gray text over a clay surface usually fails it.
- Support both orientations, or lock one deliberately and say why; never let rotation break a layout mid-entry.
- `prefers-reduced-motion` on mobile: sheets cross-fade instead of sliding, no parallax, no springy overshoot, no auto-playing splash animation.

## Mobile review checklist

- [ ] All targets ≥44×44pt with ≥8px separation; primary action in thumb reach
- [ ] Safe-area insets applied top/bottom/sides; content clears the dock
- [ ] Keyboard: field stays visible, correct `inputMode`/`enterKeyHint`, inputs ≥16px, `100dvh`
- [ ] Sheets: drag handle, 1:1 tracking, velocity-projected snap, rubber-band, proportional scrim, scroll/drag cooperation
- [ ] No hover-only affordances; no gesture-only actions
- [ ] System gestures (back, shade, home bar) unobstructed
- [ ] Haptics from the shared vocabulary, on the same frame as the visual, user-disableable
- [ ] `backdrop-filter` limited to chrome; lists virtualized; only `transform`/`opacity` animated
- [ ] Verified on a real mid-range Android build, both orientations, offline
- [ ] Reduced-motion and reduced-transparency paths verified
