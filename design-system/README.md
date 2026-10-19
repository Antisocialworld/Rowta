# design-system

Rowta's design system. Source of truth: **your Figma export** (the three `design-tokens.*.json` files, untouched). Everything added is labelled and lives in its own file.

## Files
| File | What it is |
|---|---|
| `design-tokens.token.json`, `design-tokens.tokens.json`, `design-tokens.tokenss.json` | Your originals. Never edited. |
| `design-tokens.material3.json` | NEW. Only what your export did not have, taken from Google Material 3. Each token carries its source. |
| `convertTokens.js` | Your converter, with 4 fixes (below). Reads all four JSON files and writes `design-variables.css`. |
| `design-variables.css` | Generated. 391 variables. Do not edit by hand. |
| `verifyTokens.js` | Checks every JSON token is in the CSS with the same value and the CSS holds nothing else. |

Rebuild and check: `node convertTokens.js && node verifyTokens.js`

## What was fixed in the converter (no colour value changed)
1. Four colour tokens were silently skipped because they sit one group deeper in the JSON: `inverse surface`, `inverse on surface`, `surface tint`, `surface tint color`. They are in the CSS now.
2. Roles pointed at the wrong ramp when two ramps share a value (`on-primary` pointed at `error-100`). Each role now points at its own ramp. The resolved colour of every variable is identical to your CSS (checked: 317 of 317).
3. Typography sizes were written in `rem` by the converter but your delivered CSS had `px`. The converter now writes `px`, matching your CSS.
4. Reads the new `design-tokens.material3.json`.

## What was added (Google Material 3), and where each value comes from
- **warning** and **success**: Material 3 has no warning or success role, so these follow Google's custom-colour method. Source colours are Google's Material palette Amber 500 `#ffc107` and Green 500 `#4caf50`; a 14-step tonal palette (0 to 100, the same steps as your ramps) is computed with the Material hue/chroma/tone (HCT) method. Roles use the same tones your `error` roles use: 40, 100, 90, 30. Needs your approval (Q11).
- **Missing M3 roles**, valued from your own ramps: `background`, `on-background`, `surface-bright`, `inverse-primary`, `scrim`, `shadow`, and the `fixed` roles for primary, secondary and tertiary. `surface-dim` is neutral tone 87, computed (your ramp has no tone 87).
- **Shape**: corner radius none 0, extra-small 4, small 8, medium 12, large 16, extra-large 28, full (circular, written 9999px).
- **State layers**: hover 0.08, focus 0.10, pressed 0.10, dragged 0.16, disabled container 0.12, disabled content 0.38.
Shape and state values were read from Google's published Material 3 data; the colour hexes of Amber 500 and Green 500 from the published Material palette.

## Not changed, reported only
- `on-tertiary-container` on `tertiary-container` has contrast 1.86 (needs 4.5 for text). Do not use that pair for text.
- `neutral-20` is `#000000`, the same as `neutral-0`; `secondary-60` is pink (`#c062d0`) inside a blue ramp.
- Your ramp numbers are not CIE lightness (for example `error-40` has lightness 38, `pry-40` has 27). New ramps use true Material tones, so a "40" from the new ramps is lighter than your `pry-40`.
- There is no dark colour set (Q9) and no "info" colour; use `primary` or `secondary` roles for information.

## Integrity (blake2b512 of your originals)
```
5f3afbb5e42d331f96f7d18e4f2638d69773f6d743a7f2efc13dc698cb501ab792ef47c31bfa8c03aadab202584386d234c3f710d23b7c9105e8030b1cc39727  design-tokens.token.json
3a9178cabf82641fb9e56da0433d1da3e569071bd1caf883babc3c4417861b09252cf6271ee6efb32f25b0b7743edb3b04ffb64f0c07e46c8c9d957c1604166f  design-tokens.tokens.json
a821e15f82599787b886e5e2be7a87ab330e358088ef1b97065bd49184d13db26a0527428f24707515d99450aaafabeabb9097fb7411c6c5b3389b495277f9bc  design-tokens.tokenss.json
```
