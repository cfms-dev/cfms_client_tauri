---
name: cfms-lottie-motion
description: Review, create, or repair CFMS release-highlight Lottie animations, especially timing, easing, choreography, geometry bounds, loop seams, reduced-motion end states, light/dark parity, and lottie-web versus Skottie compatibility. Use for files under src/lib/release-highlights/animations or renderer behavior in LottieScene.svelte. Do not use for unrelated CSS or Svelte motion.
---

# CFMS Lottie Motion

Treat the renderer used by the product as the source of truth. A valid Bodymovin file or a successful Skottie preview does not prove that the animation plays in CFMS.

## Establish the runtime contract

Before changing animation JSON, inspect the current consumer and tests. Record:

- renderer and build: CFMS currently loads `lottie-web/build/player/lottie_light`;
- renderer mode: SVG;
- playback options such as `loop`, `autoplay`, speed, and segment control;
- reduced-motion behavior: `LottieScene.svelte` freezes a meaningful final frame;
- paired light/dark assets and any structural-parity tests.

If these facts have changed, follow the code rather than this snapshot.

When motion quality is in scope, apply `motion-design` first to diagnose choreography. Use `text-to-lottie` for the JSON implementation and Skottie inspection. This skill adds the CFMS-specific compatibility and verification layer.

## Review before editing

Preserve the existing visual language. Diagnose only behavior that harms comprehension or polish:

1. Name each semantic beat and its frame range.
2. Check hierarchy, anticipation, follow-through, dwell time, and perceived velocity at the loop seam.
3. Remove shapes with no semantic role, such as unexplained scan ellipses.
4. Calculate transformed bounds for moving or growing geometry. For a local point `x`, use `worldX = positionX + (x - anchorX) * scaleX / 100`. Check the entire animated range, not only the first frame.
5. Keep light and dark variants identical in timing, geometry, layer order, and names unless a documented theme-specific behavior is intentional.

Use restrained easing and short anticipation for diagnostic/status UI. Avoid elastic overshoot, decorative bouncing, and constant motion during the calm hold.

## Author for the real renderer

For every non-hold, nonterminal animated keyframe, store both incoming and outgoing easing handles on that same keyframe:

```json
{
  "t": 24,
  "s": [0],
  "e": [100],
  "i": { "x": [0.33], "y": [0.33] },
  "o": { "x": [0.67], "y": [0.67] }
}
```

Do not split `o` onto the starting keyframe and `i` onto the destination keyframe. Skottie may accept that representation, but the `lottie-web` version used by CFMS reads both handles from the current keyframe and can silently render the property as static.

Hold keyframes may use `"h": 1`. Keep frame times sorted and preserve complete terminal values.

For a seamless loop, make the first and last rendered states identical and align their perceived velocities. Because reduced motion freezes the final frame, the seam state must also be a useful completed state rather than a blank reset.

## Verify in layers

Run the static checker on both theme assets. Add `--loop` only when a seamless loop is intended; add `--pair` for light/dark siblings:

```powershell
node .agents/skills/cfms-lottie-motion/scripts/check-lottie.mjs --loop --pair <light.json> <dark.json>
```

Then verify all of the following:

1. Render frame 0, at least two semantic midpoints, and `op - 1` with the actual `lottie-web` package. Assert that the generated SVG changes between animated frames. A test that only mocks `loadAnimation` cannot detect frozen keyframes.
2. Run the relevant release-highlight tests, including `src/lib/release-highlights/lottie-web-compat.test.ts` when applicable.
3. Inspect the same pinned frames in the official Skottie player. Confirm important geometry stays inside its intended container and the first/last frames are visually identical for loops.
4. Run `pnpm check` and the focused Vitest files.
5. If a temporary development server is needed, follow the repository instructions and stop it before finishing.

Do not accept “JSON parses,” “Skottie looks correct,” or “the component mounted” as proof of playback. Completion requires observable frame changes through the product renderer.

## Diagnose recurring failures

| Symptom | First check |
| --- | --- |
| Works in Skottie but is static in CFMS | Missing same-keyframe `i` and `o` handles |
| Progress or scan shape crosses its container | Position, anchor, local size, and scale transformed together |
| Light and dark move differently | Structural drift beyond color properties |
| Loop flashes or jumps | First/last pixels and velocity continuity |
| Reduced motion shows an empty/reset state | Whether `op - 1` communicates completion |
| Tests pass while UI is frozen | Whether tests render multiple frames with real `lottie-web` |
