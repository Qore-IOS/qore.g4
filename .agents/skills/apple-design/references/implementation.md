# Implementation — this repo's stack

Concrete mapping of SKILL.md onto INV-zen / Qore: Next.js 14 App Router, React 18, TypeScript, Tailwind + shadcn/ui (Radix), Framer Motion 11, Capacitor 7 (Android), Electron (`desktop/`), terminal app.

## 1. Spring presets — one vocabulary, no per-component numbers

Apple's two parameters (damping ratio, response) map onto Framer Motion as `bounce` + `duration`. **Important:** Framer Motion ignores `duration`/`bounce` when `stiffness`, `damping`, or `mass` are also set — pick one form per transition, don't mix them. Velocity handoff (SKILL.md §5) needs the physical form, so both columns are listed.

| Preset | Use for | `bounce`/`duration` form | Physical form |
| --- | --- | --- | --- |
| `snappy` | Desktop popovers, menus, hover-scale, small chrome | `{ duration: 0.25, bounce: 0 }` | `{ stiffness: 630, damping: 50 }` |
| `default` | Most UI: panel enter/exit, dialogs, list transitions | `{ duration: 0.3, bounce: 0 }` | `{ stiffness: 440, damping: 42 }` |
| `gentle` | Large surfaces, full-screen moves, reposition | `{ duration: 0.4, bounce: 0 }` | `{ stiffness: 250, damping: 32 }` |
| `sheet` | Bottom sheets, drawers, dock panels (momentum) | `{ duration: 0.3, bounce: 0.2 }` | `{ stiffness: 440, damping: 34 }` |
| `flick` | Drag/throw release, swipe-to-dismiss, reorder settle | `{ duration: 0.4, bounce: 0.2 }` | `{ stiffness: 250, damping: 25 }` |

Create `src/lib/motion.ts` on first use and import from there — never hand-tune stiffness in a component:

```ts
// src/lib/motion.ts
import type { Transition } from 'framer-motion';

export const spring = {
  snappy:  { type: 'spring', stiffness: 630, damping: 50 },
  default: { type: 'spring', stiffness: 440, damping: 42 },
  gentle:  { type: 'spring', stiffness: 250, damping: 32 },
  sheet:   { type: 'spring', stiffness: 440, damping: 34 },
  flick:   { type: 'spring', stiffness: 250, damping: 25 },
} satisfies Record<string, Transition>;

// Non-grabbable, discrete state changes (color, opacity, focus ring)
export const ease = {
  fast:   { duration: 0.12, ease: [0.4, 0, 0.2, 1] },
  normal: { duration: 0.2,  ease: [0.4, 0, 0.2, 1] },
} satisfies Record<string, Transition>;
```

Existing code already clusters near these values (`stiffness: 420, damping: 34` in the dock, start menu and Dynamic Island toast is effectively `sheet`; `600/25` in `dock.tsx` is close to `snappy` with unnecessary bounce). **When you touch one of those components, replace the literal with the preset** rather than adding another ad-hoc pair. Don't do a repo-wide sweep as a side quest.

Also drop the reflexive `whileHover={{ scale: 1.03, y: -5 }}` pattern on touch surfaces — it only makes sense behind `(hover: hover)` (see `adaptive.md`), and −5px lift plus 1.03 scale is above the "keep hover motion small" bar in `desktop.md` §4 for dense grids; prefer `scale: 1.02, y: -2`.

## 2. Gestures with Framer Motion

- **Drag with 1:1 tracking:** `drag`, `dragElastic` for rubber-banding (`0.15–0.3`, not `1`), `dragConstraints` for bounds.
- **Momentum projection (SKILL.md §6):** Framer's inertia animation *is* the projection — use `dragTransition={{ power: 0.3, timeConstant: 350, modifyTarget: snapToNearest }}`. `modifyTarget` receives the projected endpoint; return the snap point nearest it. That is exactly "snap from the projection, not from the release point."
- **Velocity handoff (§5):** in `onDragEnd(event, info)`, `info.velocity.{x,y}` is px/s — pass it as `velocity` alongside a physical-form spring when you animate manually.
- **Commit vs. reverse:** decide on `Math.abs(info.velocity.y) > 400 ? sign(velocity) : positionPastHalfway`. Velocity wins.
- **Interruptibility (§3):** Framer animates from the current value by default — do **not** defeat it by keying components on state, forcing `initial` on re-render, or setting `animate` from a value you computed at render time.
- **Shared element / identity (§7):** `layoutId` for row→detail promotions, `layout` for reflow. Wrap in `LayoutGroup` where several siblings move together.
- **Pointer capture:** for custom gestures outside Framer, use Pointer Events + `setPointerCapture` (SKILL.md §2) so one code path serves mouse, pen and touch.

## 3. Reduced motion

`prefers-reduced-motion` is handled ad hoc today (CSS blocks in `clay-kit.tsx`, `wizard-form.css`, a local hook in `clay-home.tsx`). For new work:

- Wrap the app once in `<MotionConfig reducedMotion="user">` — Framer then disables transforms and keeps opacity transitions automatically.
- In components with custom gestures, use `useReducedMotion()` from `framer-motion` to swap a spring for a cross-fade and to skip overshoot.
- Keep the CSS `@media (prefers-reduced-motion: reduce)` blocks for anything animated in plain CSS (clay pressed states, shimmer, splash).
- Also honour `prefers-reduced-transparency` (drop `backdrop-filter`, raise background opacity) and `prefers-contrast: more` (solid background + defined border) on every translucent surface.

## 4. Tokens, theme and surfaces

- **All color comes from CSS variables in `src/app/globals.css`** — `--background/--foreground/--card/--primary/...` in HSL for shadcn, plus the `--qc-*` clay palette and the `--dashboard-*` / `--device-*` families. Never hardcode a hex in a component; if a shade is missing, add a token.
- **Light and dark are both first-class.** Every new surface must be checked in both; the `--qc-*` families already define both, so use them instead of literal `rgba()`.
- **Clay / neumorphic surfaces** use `--dashboard-raised`, `--dashboard-raised-soft`, `--dashboard-pressed` (and `--device-elev-1/2`, `--device-pressed`). Elevation is a token, not an invented `box-shadow`.
  - **Never animate `box-shadow`** (SKILL.md §11). For a pressed state, cross-fade two pre-composed shadow layers or animate `opacity` on an overlay pseudo-element.
  - Clay's soft, low-contrast edges make focus rings and 4.5:1 text contrast harder — verify both explicitly on any clay surface.
- **Radius** comes from `--radius` (1rem) and the Tailwind mapping; nested surfaces use a smaller radius than their parent, never larger.
- **Type:** Urbanist via `--font-urbanist` with a system-font fallback stack. Apply SKILL.md §15 tracking/leading discipline through Tailwind utilities rather than one global `letter-spacing`.
- **Z-index is tokenized** (`--z-content/--z-sticky/--z-dock/--z-modal-overlay/--z-modal/--z-float`). Use them; a raw `z-index: 9999` is a bug.
- **Dock geometry** is `--dock-h` / `--dock-gap` plus `use-dock`; scroll containers must clear it (see `mobile.md` §2).

## 5. shadcn / Radix

- **Keep Radix's behavior.** Focus trapping, focus restore, `Esc` to close, aria wiring and scroll locking are already correct — style the primitives, don't reimplement them.
- Extend rather than fork: variants via `cva`/`tailwind-merge` in `src/components/ui/*`, so every consumer inherits the fix.
- Radix animates via `data-state` + CSS. For anything grabbable (sheets, drawers), drive motion with Framer instead so it stays interruptible; for simple open/close popovers, the CSS path is fine.
- The responsive `Modal` primitive described in `adaptive.md` §4 belongs in `src/components/ui/` — dialog on `(pointer: fine)`, bottom sheet on `(pointer: coarse)`.

## 6. Haptics

`src/lib/haptics.ts` exposes `haptic()` / `hapticDouble()` over the Vibration API with an 80ms throttle. Use it — do not call `navigator.vibrate` directly (several panels still do; convert them when you touch them).

The Capacitor Haptics plugin is **not installed**. On Android the Vibration API works inside the WebView but gives no impact/notification styles. If we want the full vocabulary in `mobile.md` §4, add `@capacitor/haptics` and extend `src/lib/haptics.ts` to prefer the native plugin with the Vibration API as fallback — keep the call sites unchanged.

Rules that apply either way: same frame as the visual, never on every scroll tick, never the only signal, user-disableable.

## 7. Performance

- Virtualize lists past ~50 rows on mobile / ~100 on desktop with `@tanstack/react-virtual` (already a dependency).
- Animate `transform`/`opacity` only; add `will-change` where motion is imminent and remove it after.
- Keep `backdrop-filter` on chrome only (dock, headers, active sheet) — never on list rows.
- Optimistic UI over blocking spinners for Firestore writes; use the global loading context (`GLOBAL_LOADING_USAGE.md`) for genuine app-wide waits, not for a single row update.
- Verify on a mid-range Android Capacitor build and in the Electron window at ~900px — not only in a desktop browser.

## 8. Commands

```bash
pnpm dev              # web (port 9002)
pnpm typecheck        # ratcheted TS check — must pass before commit
pnpm lint
pnpm test             # node test runner
pnpm android:sync     # terminal/mobile build + cap sync android
pnpm android:apk      # APK for on-device verification
```
