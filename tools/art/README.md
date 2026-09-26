# Art pipeline

The interviewer sprites and all backgrounds are painted with gpt-image through the
[Codex CLI](https://github.com/openai/codex)'s built-in `image_gen` tool (the `imagegen` skill), then
cut into layers and packed as WebP by `build.py`. The game ships only the packed files
(`src/art/assets/`); the raw generations stay in `tools/art/work/` (git-ignored).

Requirements: a logged-in `codex` CLI with image generation enabled (`codex features list` shows
`image_generation … true`), [`uv`](https://docs.astral.sh/uv/) (runs `build.py` with numpy / pillow /
scipy from its inline metadata), `python3`, `flock`.

## How a sprite is built

Every frame is an **edit** of one canonical base picture. gpt-image edits stay pixel-aligned with
their input (`build.py` checks this with phase correlation), so each change is shipped as a small
feathered patch:

```
base.png ── edit "expression e" ──► face patch ──► comp/<e>.png = base ⊕ face
comp/<e>.png ── edit "talking, level k" ──► mouth-<e>-<k> patch   (k = 1 lips parted … 3 open)
comp/<e>.png ── edit "eyes closed" ──► blink-<e> patch             (skipped when the eyes are closed)
```

A patch is the region that really changed (blurred colour difference above a threshold, inside a
window around the face / mouth / eyes found from the neutral blink and open-mouth edits), grown,
feathered, and tone-matched to the picture underneath. `pack` then:

- frames every character the same way (eye line at 27.5 % of a 1280-px-high canvas, same eye span, the
  face centred; the canvas is at least 960 px wide and widened where the shoulders need it —
  `CharacterSprite` gives it negative side margins, so every sprite still takes a 3:4 box in layout),
- writes `base.webp`, one `face-<e>.webp` per expression — all sharing one mask, the union of every
  expression's patch, so any expression can fade in over any other — plus `mouth-<e>-<k>.webp` and
  `blink-<e>.webp` (required for every expression except those painted with closed eyes, listed in
  `CLOSED_EYES`; a missing frame stops `pack`),
- writes `src/art/assets/manifest.ts` (canvas-pixel rects of every layer, the portrait crop, the head
  box for manga symbols) and the backgrounds as `src/art/assets/backgrounds/<name>.webp`.

At runtime (`src/art/characters/SpriteLayers.tsx`) the layers are stacked with `<img>` elements; the
blink and lip-sync hooks only toggle `data-blink` / `data-mouth` on the root and CSS shows the frame.

## Regenerating

```sh
export ART_WORK=$PWD/tools/art/work          # default; anywhere works
B="uv run --quiet tools/art/build.py"
G=tools/art/gen.sh                            # gen.sh <out.png> <prompt.txt> [edit-input.png]
C=$ART_WORK/characters/yuki

# 1. base: generate a few candidates, pick one as source.png, clean it
$B prompt base yuki > /tmp/p.txt && $G $C/source.png /tmp/p.txt && $B prep yuki
# 2. landmarks from the neutral blink + wide-open mouth edits
$B prompt blink yuki neutral > /tmp/b.txt && $G $C/raw/blink-neutral.png /tmp/b.txt $C/base.png
$B prompt mouth yuki neutral 3 > /tmp/m.txt && $G $C/raw/mouth-neutral-3.png /tmp/m.txt $C/base.png
$B landmarks yuki && $B face yuki neutral
# 3. per expression: face first, then its mouth / blink frames (edits of comp/<e>.png)
$B prompt expr yuki smile > /tmp/e.txt && $G $C/raw/expr-smile.png /tmp/e.txt $C/base.png && $B face yuki smile
$B prompt mouth yuki smile 1 > /tmp/m1.txt && $G $C/raw/mouth-smile-1.png /tmp/m1.txt $C/comp/smile.png && $B mouth yuki smile 1
$B prompt blink yuki smile > /tmp/b1.txt && $G $C/raw/blink-smile.png /tmp/b1.txt $C/comp/smile.png && $B blink yuki smile
# … every expression × mouth 1–3 + blink, then eyeball everything:
$B sheet yuki                                # $ART_WORK/review/yuki-sheet.png
# 4. backgrounds: $B prompt bg <name>; the office evenings are edits of the day paintings
$B prompt bg office-yuki-day > /tmp/bg.txt && $G $ART_WORK/backgrounds/office-yuki-day.png /tmp/bg.txt
$B prompt bg office-yuki-evening > /tmp/ev.txt && $G $ART_WORK/backgrounds/office-yuki-evening.png /tmp/ev.txt $ART_WORK/backgrounds/office-yuki-day.png
# 5. pack into src/art/assets (needs every character complete and all 12 backgrounds)
$B pack
```

`face` / `mouth` / `blink` print a JSON report and write a review image
(`[original | composited | patch mask]`). A non-empty `issues` list — the edit moved the picture,
redrew too much, or changed nothing — means: generate that frame again. Always look at the review
images; the numbers do not catch a wrong expression or a smudged mouth. `gen.sh` runs at most
`ART_GEN_SLOTS` (default 8) generations at a time, so many can be started in parallel.

Prompts live in `build.py` (`STYLE`, `BASE_SUBJECT`, `EXPRESSION_LOOK`, `MOUTH_*`, `BG_SUBJECT`).
After changing one frame, re-run its extraction and `pack`; after changing a face, regenerate that
expression's mouth and blink frames too (they are edits of the old face).
