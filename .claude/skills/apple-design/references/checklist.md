# Review checklist

Use this when reviewing a UI PR or self-checking before you ship. Anything unchecked is either fixed or explicitly called out in the PR description with a reason.

## Universal (every surface)

- [ ] **Response** — feedback on pointer-*down*, not on release; no artificial delay on the input path
- [ ] **Continuous feedback** — drags/sliders/sheets update 1:1 through the whole gesture, not only at the end
- [ ] **Interruptible** — you can grab a moving element mid-flight and reverse it; no input lockout during transitions
- [ ] **Springs, from the preset table** (`references/implementation.md` §1) — no ad-hoc stiffness values, no CSS transitions on grabbable things
- [ ] **Bounce only after momentum** — `bounce: 0` unless a flick/throw preceded it
- [ ] **Velocity handoff** — release velocity feeds the spring; **momentum projection** picks the snap target, not the release position
- [ ] **Rubber-band at boundaries**, no hard stop
- [ ] **Spatial consistency** — enters and exits along the same path, anchored to its trigger; same object keeps its identity
- [ ] **Only `transform`/`opacity` animated** — no layout, no `box-shadow`, no `width/height` per frame
- [ ] **Materials** — translucent chrome with content scrolling under, scroll-edge fade instead of hard dividers, no light-on-light stacking
- [ ] **Tokens only** — colors, radii, elevation and z-index from `globals.css`; verified in light *and* dark
- [ ] **Typography** — size-specific tracking, leading paired to size, hierarchy from weight+size, `rem` spacing, Turkish glyphs and string lengths checked
- [ ] **States designed** — empty, loading (skeleton matching real shape), error with a next step, success
- [ ] **Accessibility** — 4.5:1 contrast, visible `:focus-visible` ring, labels on icon-only controls, no color-only meaning
- [ ] **Reduced motion / transparency / contrast** paths all verified
- [ ] **Wayfinding** — where am I, where can I go, how do I get out; never trapped
- [ ] **Destructive actions** — preview + explicit confirmation; undo where possible (medical-supply data bar)

## Desktop (`references/desktop.md`)

- [ ] Hover state on every interactive element, none on dead content, **no layout shift on hover**
- [ ] Keyboard completes the whole flow; `Esc` backs out; focus restored on close; shortcuts documented
- [ ] Works at ~900px window, 1280px, 1920px — content grows, chrome doesn't
- [ ] Tables: sticky header, tabular numerics, sort indicator, virtualized past ~100 rows
- [ ] Right-click menu matches the row's action menu; multi-select with Shift/⌘
- [ ] Drags use pointer capture + spring settle **and** have a keyboard alternative
- [ ] No scroll-jacking; cursor shapes correct; springs at `response 0.25–0.35`
- [ ] Barcode/HID scanner input still reaches the global scanner

## Mobile (`references/mobile.md`)

- [ ] Targets ≥44×44pt with ≥8px separation; primary action within thumb reach
- [ ] Safe-area insets applied; scroll content clears the dock
- [ ] Keyboard: field stays visible, correct `inputMode`/`enterKeyHint`, inputs ≥16px, `100dvh` not `100vh`
- [ ] Sheets: drag handle, 1:1 tracking, projected snap, rubber-band, proportional scrim, scroll/drag cooperation
- [ ] No hover-only affordances; no gesture-only actions; system gestures unobstructed
- [ ] Haptics from the shared vocabulary via `src/lib/haptics.ts`, same frame as the visual, user-disableable
- [ ] `backdrop-filter` on chrome only; lists virtualized; verified on a real mid-range Android build
- [ ] Survives backgrounding mid-flow; offline/flaky network state is visible and honest

## Adaptive (`references/adaptive.md`)

- [ ] Same actions, names and validation on both surfaces
- [ ] Interaction branches on `(hover: hover)`/`(pointer: coarse)`, layout on width — never user-agent
- [ ] One component with one presentation layer, not two implementations
- [ ] Hardware back and `Esc` both back out exactly one level

## Demo / deck (`references/presentation.md`)

- [ ] Real build on the real surface; realistic Turkish data; no debug UI, no customer data
- [ ] Both themes; motion at real speed, 60fps; interruption actually shown
- [ ] Deck uses product palette, type scale and radii; legible at projection size
