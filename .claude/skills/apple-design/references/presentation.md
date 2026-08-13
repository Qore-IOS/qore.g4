# Presentations, demos, screenshots, landing pages

Everything we *show* is governed by this skill too. A deck, a demo build, or a marketing page that looks and moves differently from the product either oversells (and burns trust at delivery) or undersells (and hides work we actually did). The rule is simple: **show the real thing, at the real quality bar.**

## 1. Demos and prototypes

- **A demo is product UI with a smaller scope, not a lower standard.** Same tokens, same spring presets, same touch targets, same reduced-motion handling. Fluidity is exactly what a demo is meant to communicate.
- **Prototype interactively.** An interactive demo is worth "a million static designs" (SKILL.md §17) — and it sets the bar that keeps the shipped implementation from degrading.
- **Demo on the surface you're claiming.** A mobile claim is demoed on a phone (or the Capacitor build), a desktop claim in a real window. A phone-shaped `<div>` in a desktop browser is not a mobile demo.
- **Use realistic data, in Turkish, at realistic length** — real product names, real hospital/kurum names, real miad dates, long strings that would actually wrap. Lorem ipsum and three-row tables hide every layout defect.
- **Rehearse the failure paths.** Show at least one empty state, one loading state, and one error — a demo of only the happy path teaches nothing about the product's craft.
- **No fake latency, no fake progress.** If something is slow, show the honest optimistic-UI treatment rather than a scripted spinner.
- **Never demo with a debug overlay, a dev toolbar, or test credentials on screen.** Use seeded demo data; keep real customer data out of any demo, screenshot or deck.

## 2. Screenshots and screen recordings

- **Capture at device pixel ratio ≥2**, in the app's real theme, with the correct status/title bar for the platform.
- **Show both themes** where the deck has room — light and dark are both product surfaces, not a toggle we forgot.
- **Record motion at 60fps** and don't speed it up. If a transition is worth showing, it's worth showing at real speed; review it once frame-by-frame to catch jumps at interruption points (SKILL.md §3).
- **Show the gesture, not just the result.** For a swipe, sheet, or drag, the recording should include the continuous tracking phase — that's the part that reads as fluid.
- **Frame consistently:** same device frame, same corner radius, same shadow across a whole deck. Mixed frames read as carelessness (§16 Craft).
- **Crop to the point.** A full 1920px screenshot shrunk into a slide shows nothing; crop to the panel being discussed and keep type legible at projection size.

## 3. Slides and documents

- **The deck uses the product's design language:** the same palette from `src/app/globals.css`, the same font stack, the same radii and elevation, generous whitespace.
- **Type discipline from SKILL.md §15:** tighten tracking on large titles (`-0.02em`), keep body near `0`, build hierarchy with weight and size together, never stretch or condense a face.
- **One idea per slide.** If the slide needs a paragraph to explain the screenshot, the screenshot is wrong or the idea belongs on two slides.
- **Charts follow the same restraint:** no 3D, no gradient fills for their own sake, direct labels over legends where possible, and color never as the sole carrier of meaning.
- **Legibility at the back of the room:** minimum ~24px equivalent body type, high contrast, no thin weights on light backgrounds.
- **Turkish typography matters:** correct `İ/ı` casing, no auto-capitalization that mangles Turkish, and headline widths that fit the longer Turkish strings.

## 4. Landing and marketing pages

- Same tokens and motion vocabulary as the app; a marketing page that bounces and parallaxes while the app is calm is a promise the product doesn't keep.
- Respect `prefers-reduced-motion` on marketing pages too — scroll-driven animation is exactly the category that hurts.
- Performance is part of the impression: compressed images at correct sizes, no layout shift, fast first interaction.
- Screenshots on the page must be current. An outdated hero screenshot is a bug.

## 5. Pre-demo checklist

- [ ] Running the real build on the real surface (phone / window), not a mock
- [ ] Realistic Turkish data at realistic length; no lorem, no debug UI, no real customer data
- [ ] Happy path + one empty + one loading + one error state prepared
- [ ] Both themes checked; status/title bar correct for the platform
- [ ] Motion reviewed once frame-by-frame; interruption (grab mid-animation) actually demonstrated
- [ ] Recordings at 60fps, real speed; screenshots at ≥2x, consistently framed
- [ ] Deck uses product palette, type scale, and radii; legible at projection size
- [ ] Reduced-motion path verified on anything public-facing
