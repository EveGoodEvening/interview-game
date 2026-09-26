# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy"]
# ///
"""
Art pipeline for the interviewer sprites and the backgrounds (see tools/art/README.md).

Every sprite frame is an EDIT of the same canonical base image made by gpt-image through the Codex
CLI (tools/art/gen.sh). Edits keep the picture aligned pixel-for-pixel, so each expression, talking
mouth and blink is shipped as a small feathered patch over one shared base:

    base (neutral)  ⊕  face-<expr>  ⊕  mouth-<expr>-<1|2|3>  /  blink-<expr>

Work files live in $ART_WORK (default tools/art/work, git-ignored):

    characters/<id>/source.png           chosen raw base (codex output)
    characters/<id>/base.png             cleaned base (alpha / despill)            <- `prep`
    characters/<id>/raw/expr-<e>.png     expression edits of base.png              (gen.sh)
    characters/<id>/raw/mouth-<e>-<k>.png, raw/blink-<e>.png   edits of comp/<e>.png (gen.sh)
    characters/<id>/landmarks.json       eyes / mouth boxes                        <- `landmarks`
    characters/<id>/patches/*.png|json   extracted patches                         <- `face`/`mouth`/`blink`
    characters/<id>/comp/<e>.png         base ⊕ face patch: the edit target for mouth / blink frames
    backgrounds/<name>.png               raw backgrounds (codex output)
    review/*.png                         contact sheets for eyeballing

Commands (run with `uv run tools/art/build.py <command> ...`):

    prompt base|expr|mouth|blink|bg <args>   print a generation prompt (feed it to gen.sh)
    prep <id>                                 clean source.png into base.png
    landmarks <id>                            detect eyes / mouth from the neutral blink + mouth-3 edits
    face <id> <expr>                          extract the face patch of an expression edit, write comp/<expr>.png
    mouth <id> <expr> <k>                     extract a lip-sync patch (k = 1..3)
    blink <id> <expr>                         extract a blink patch
    sheet <id>                                review sheet of every expression / mouth / blink
    pack                                      write WebP assets + manifest.ts into src/art/assets

`face` / `mouth` / `blink` print a JSON report (alignment shift, drift outside the patch, patch size,
issues) and write a review image; a non-empty `issues` list means: regenerate that edit.
"""
from __future__ import annotations

import functools
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(os.environ.get('ART_WORK', ROOT / 'tools' / 'art' / 'work'))
ASSETS = ROOT / 'src' / 'art' / 'assets'

CHARACTERS = ('yuki', 'ethan', 'haru')
EXPRESSIONS = ('neutral', 'smile', 'happy', 'thinking', 'serious', 'surprised', 'troubled')
MOUTH_LEVELS = (1, 2, 3)
#: Expressions painted with closed eyes (^ ^): they get no blink frame. Every other one must have one.
CLOSED_EYES = {'yuki': {'happy'}, 'ethan': set(), 'haru': {'happy'}}
OFFICE_VARIANTS = ('day', 'evening')
ENDINGS = ('perfect', 'offer', 'pending', 'rejected')
BACKGROUNDS = (
    [f'office-{c}-{v}' for c in CHARACTERS for v in OFFICE_VARIANTS]
    + ['title', 'lobby']
    + [f'ending-{e}' for e in ENDINGS]
)

#: Sprite canvas height; the width is fitted per character (at least MIN_CANVAS_W) so the shoulders
#: are never cut off. Every character is framed alike: same eye line, same span across both eyes.
CANVAS_H = 1280
MIN_CANVAS_W = 960
EYE_LINE_Y = 0.275
EYE_SPAN = 250
#: Portrait crop edge, in eye spans (head and shoulders).
PORTRAIT_SPANS = 2.9

# ─────────────────────────────── prompts ───────────────────────────────

STYLE = """Style/medium: premium Japanese visual novel / galgame character art, polished commercial anime illustration, clean confident lineart with soft colored lines, soft cel shading with gentle gradients, luminous detailed eyes with layered highlights, glossy hair strands, delicate skin blush, soft pastel palette, crisp high-resolution finish
Composition/framing: portrait orientation, single character, upper body from slightly above the top of the head down to the upper thighs, body facing the viewer with a very slight 3/4 turn, shoulders level and relaxed, both arms hanging naturally at the sides with hands out of frame, head fully inside the frame with generous empty margin above and on both sides, character horizontally centered
Lighting/mood: soft even studio lighting from the front-left
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for background removal; one uniform color with no shadows, gradients, texture, floor, or lighting variation
Constraints: do not use #00ff00 or any green anywhere on the character; crisp clean silhouette edges; no cast shadow, no contact shadow; no text, no logo, no watermark, no signature, no frame or border
Avoid: extra characters, props in hands, hands near the face, hair covering the eyes, chibi or super-deformed proportions, 3D render look, photorealism"""

BASE_SUBJECT = {
    'yuki': """Primary request: an original anime heroine, "Yuki", a gentle and kind HR manager in her mid-20s, standing and facing the viewer with a calm neutral expression
Subject: long dark-brown hair with soft loose waves falling below the chest, side-swept bangs that do not hide the eyes, a small pink cherry-blossom hair clip on the left side (no leaves); gentle slightly droopy eyes with rose-brown irises, looking straight at the viewer; mouth closed in a relaxed neutral line; cream-colored knit cardigan worn open over a white blouse with a small soft-pink ribbon bow at the collar; slender, graceful, warm approachable "kind senpai" aura""",
    'ethan': """Primary request: an original anime male lead, "Ethan", a calm, sharp-minded engineering director in his late 20s, standing and facing the viewer with a cool, composed neutral expression
Subject: short neat black hair with a subtle dark-blue sheen and slightly tousled bangs that do not hide the eyes; thin rectangular dark-navy metal-frame glasses with clear lenses and subtle highlights; sharp, calm steel-blue eyes looking straight at the viewer; mouth closed in a neutral line; tall, slim, handsome, reserved "cool type" bishounen; charcoal-gray tailored suit jacket (buttoned), crisp white dress shirt, slim dark-navy tie""",
    'haru': """Primary request: an original anime heroine, "Haru", an energetic startup founder and CEO in her mid-20s, standing and facing the viewer with a bright, confident neutral expression (mouth closed, slight upturn)
Subject: short orange-auburn bob with a small side ponytail on her left tied with a light-blue bead hair tie, and a single springy ahoge cowlick on top; big bright amber eyes full of energy looking straight at the viewer; petite, lively, cheerful "genki" vibe; mustard-yellow hoodie with white drawstrings worn under an open navy-blue blazer; a navy lanyard with a small blank white ID badge (no text on it) hanging on her chest""",
}

#: What each expression looks like, per character (the face only — pose and everything else stay).
EXPRESSION_LOOK = {
    'yuki': {
        'smile': 'a warm, gentle closed-mouth smile that reads clearly at small size, visibly different from the calm input face: both mouth corners lifted into a distinctly upturned, slightly wider closed-lip smile, the eyes gently curved into smiling crescents with the lower lids pushed up (eyes still open), relaxed brows, a little more blush on the cheeks',
        'happy': 'a delighted, beaming expression: eyes happily closed into upward-curved arcs (^ ^), brows raised and relaxed, a big open-mouthed smile showing the upper teeth, rosy blushing cheeks',
        'thinking': 'a pensive, thinking expression: eyes glancing up and to the side (towards the viewer\'s right), one brow slightly raised, lips lightly pursed to one side',
        'serious': 'a serious, attentive expression: brows lowered and drawn slightly together, eyes a little narrowed with a steady direct gaze at the viewer, mouth a firm straight line, almost no blush',
        'surprised': 'a surprised expression: eyes opened wide with slightly smaller irises and pupils, brows raised high, mouth a small round "o"',
        'troubled': 'a troubled, awkward expression: brows clearly tilted up in the middle in a worried ハ shape (the inner end near the nose lifted high, sloping down towards the temple — never lowered, flattened or hooked down at the inner end), eyes slightly downcast and glancing aside, a small wavy uneasy mouth, faint blush and one clearly visible light-blue anime sweat drop with a thin dark-blue outline on the side of the forehead',
    },
    'ethan': {
        'smile': 'a faint, restrained smile: just a slight upturn of the mouth corners with the lips closed, eyes softened a little, brows relaxed — still cool and composed',
        'happy': 'a rare, genuine warm smile: eyes gently narrowed into smiling eyes (still open), brows relaxed and slightly raised, an open smile showing a hint of the upper teeth',
        'thinking': 'a pensive, analytical expression: eyes glancing up and to the side (towards the viewer\'s right), one brow slightly raised, mouth closed and slightly pressed to one side',
        'serious': 'a stern, focused expression: brows lowered and drawn together, eyes narrowed with a sharp, piercing direct gaze at the viewer, mouth a firm straight line',
        'surprised': 'a restrained surprise: eyes opened a little wider than in the input while keeping the same large irises, pupils and thick dark upper lash line (no white showing above the irises), brows raised, lips slightly parted in a small round "o" that is narrower than the closed mouth',
        'troubled': 'a worried, uneasy, slightly awkward expression: brows knit and clearly tilted up in the middle (each inner end near the nose bridge higher than its outer end), eyes fully open (not narrowed or half-lidded) glancing slightly down and aside with an anxious look, a small uneasy wavy mouth, one clearly visible light-blue anime sweat drop with a thin dark-blue outline and a white highlight on the temple at the side of the forehead near the hairline, well away from the eyes and cheeks (so it never reads as a tear)',
    },
    'haru': {
        'smile': 'a warm, bright closed-mouth smile clearly different from the input face: the eyes stay open but curve into soft crescent smiling eyes with the lower lids pushed up and the upper lid line arched, the closed-mouth smile a little wider and softer with the corners turned up more, brows up and relaxed, rosy cheeks',
        'happy': 'an ecstatic, beaming expression: eyes squeezed shut into happy upward arcs (^ ^), brows raised, a huge open-mouthed grin showing the upper teeth, bright blushing cheeks',
        'thinking': 'a curious, thinking expression: eyes glancing up and to the side (towards the viewer\'s right), one brow raised, lips pushed into a small pout to one side',
        'serious': 'a serious, determined but calm expression (not angry): brows only slightly lowered and almost level, with no V shape and no crease between them, the upper eyelids lowered a little so the eyes look calmly narrowed with a steady direct gaze at the viewer, mouth a firm straight closed line',
        'surprised': 'a big surprised expression: eyes opened very wide with small pupils, brows raised high, mouth a round open "o"',
        'troubled': 'a flustered, troubled expression: brows tilted up in the middle, eyes glancing aside, a small wavy uneasy mouth, blushing cheeks and one clearly visible light-blue anime sweat drop with a thin dark-blue outline on the side of the forehead',
    },
}

#: The mood the mouth keeps while talking in each expression.
MOUTH_MOOD = {
    'neutral': 'relaxed, neutral mouth corners',
    'smile': 'gently smiling, upturned mouth corners',
    'happy': 'a big joyful smile with upturned mouth corners',
    'thinking': 'a pensive mouth, slightly pushed to one side',
    'serious': 'firm, straight mouth corners and a calm, flattish opening clearly wider than it is tall (steady composed speech, never a round "o" or a gritted slit)',
    'surprised': 'a rounded, "o"-shaped mouth',
    'troubled': 'uneasy, slightly wavy mouth corners',
}

MOUTH_OPEN = {
    1: 'lips just slightly parted as when saying "i": the opening between the lips must be tiny, just a narrow slit, much smaller than a normal talking mouth',
    2: 'mouth half open mid-word, as when saying "e", clearly smaller than a fully open mouth, with only the upper teeth slightly visible (the lower teeth stay hidden behind the lower lip)',
    3: 'mouth open mid-word, as when saying "a", with the upper teeth and a hint of the tongue visible — natural, not exaggerated',
}
MOUTH_OPEN_SURPRISED = {
    1: 'a small round "o" mouth, lips slightly apart, no bigger than the mouth in the input image',
    2: 'a medium, relaxed oval opening as when saying "oh", about the same size as or slightly larger than the mouth in the input image',
    3: 'a larger open oval mouth, as when saying "oh!"',
}
MOUTH_OPEN_HAPPY = {
    1: 'a wide smile with the lips only a little apart, showing just the upper teeth — the mouth must end up clearly less open than in the input image',
    2: 'a smiling mouth, half open mid-word: visibly more open than in the input image (the jaw dropped a little so the opening is about one quarter taller, only the upper teeth showing) but clearly smaller than a wide laughing mouth',
    3: 'a wide open laughing smile, mid-word',
}

KEEP = """Constraints: keep everything else pixel-identical to the input image — same character, same pose, same framing and position, same hair strands, same clothes, same lighting, same colors, same image size; keep the transparent background; do not move, rescale, crop or redraw the head, hair or body
Avoid: text, watermark, new accessories, any change outside the {area}"""

BG_STYLE = """Style/medium: strictly a hand-painted 2D anime visual-novel background with clean line art, soft cel-like shading and a painterly sky — absolutely not a 3D render, CGI or photo; polished premium visual novel quality, clean architectural lines, soft painterly lighting, delicate detail, slightly soft focus and gentle bloom so foreground characters and UI stand out
Constraints: no people, no characters, no silhouettes, no text, no readable writing, no signage, no logos, no watermark, no signature or emblem in any corner; horizon and camera straight
Avoid: harsh contrast, heavy dark shadows, fisheye distortion, photorealism"""

BG_ASSET = 'Asset type: visual-novel background (wide 16:9 landscape) for a dating-sim style job-interview game'

BG_SUBJECT = {
    'office-yuki-day': """Primary request: the bright, cozy HR meeting room of "Stellar Tech", a friendly tech company, on a sunny spring morning; a character sprite will stand in the center and a dialogue box will cover the bottom third; no people
Scene/backdrop: eye-level view across the room; a large floor-to-ceiling window on the left with sheer blush-pink curtains and a soft blue sky with gentle clouds over a distant modern city skyline; the center of the room is a calm, uncluttered warm-cream wall (this is where the character will stand, keep it simple and low-contrast); on the right a low white bookshelf with a few pastel books, a small vase of pink flowers, a framed abstract star print on the wall, and a potted monstera; light wood floor; warm pendant light
Color palette: cream, blush pink, soft peach, sky blue
Lighting/mood: soft morning sunlight streaming through the window, warm, welcoming, calm""",
    'office-ethan-day': """Primary request: the quiet, modern meeting room of "DeepBlue Engine", a serious engineering company, on a clear morning; a character sprite will stand in the center and a dialogue box will cover the bottom third; no people
Scene/backdrop: eye-level view across the room; on the left a large window with half-raised white roller blinds and a crisp blue sky over a distant city of glass towers; the center of the room is a calm, uncluttered light blue-gray wall (this is where the character will stand, keep it simple and low-contrast); on the right a glass partition revealing a softly lit server room with rows of dark racks and tiny blue status lights, and in front of it a clean white desk with two monitors showing abstract blurred code-like colored lines (no readable text); a tall potted snake plant; pale gray floor
Color palette: cool blue-gray, white, steel blue, a few cyan accents
Lighting/mood: cool, clean daylight, calm and precise, minimalist""",
    'office-haru-day': """Primary request: the bright, lively loft office of "Clearsky Labs", a young startup, on a sunny day; a character sprite will stand in the center and a dialogue box will cover the bottom third; no people
Scene/backdrop: eye-level view across the room; on the left big black-framed factory-style windows with a bright blue sky and fluffy clouds over low city rooftops; the center of the room is a calm, uncluttered whitewashed brick wall (this is where the character will stand, keep it simple and low-contrast); on the right a large whiteboard covered with colorful sticky notes and simple doodled arrows (no readable text), a yellow beanbag, a shelf with plants and a small rocket model; warm wooden floor; exposed-bulb pendant lights
Color palette: warm white, sunny yellow, tangerine orange, sky blue, natural wood
Lighting/mood: sunny, energetic, cheerful, creative""",
    'title': """Primary request: the title-screen key background for a romantic job-interview visual novel: a sunny spring morning in a business district in full cherry-blossom bloom; no people
Scene/backdrop: a soft blue sky with big fluffy clouds; a sleek modern glass office tower rising in the distance slightly right of center, catching the light; cherry-blossom branches framing the top corners; blooming sakura trees along a clean plaza lower in the frame; a few petals drifting in the air; the left 35 % of the picture, from just below the top edge down to the plaza, is empty open soft-blue sky with only a few pale wispy clouds (a title logo and menu go there) — at most one small light blossom sprig hugging the very top-left edge, no dense cluster, no dark branches and no large blurry foreground blossoms at the bottom-left; the right half is where three characters will stand, so keep it airy and not busy
Color palette: pastel pink, lavender, sky blue, white
Lighting/mood: bright, dreamy, hopeful, gentle bloom and soft sunbeams""",
    'lobby': """Primary request: a bright, airy modern office lobby / reception atrium, used behind menus; no people
Scene/backdrop: a spacious two-story atrium with tall glass walls, light wood and white surfaces, a curved reception desk far in the background, indoor trees and hanging plants, soft sunlight falling in large diagonal beams, a few sakura branches in a tall vase; wide and uncluttered
Color palette: white, soft lavender, blush pink, pale wood, sky blue
Lighting/mood: calm, bright, soft and low-contrast (menus will sit on top of it)""",
    'ending-perfect': """Primary request: the "perfect ending" background: a celebratory rooftop terrace high above the city at golden hour; no people
Scene/backdrop: a clean rooftop garden with a glass railing and a few potted sakura trees in full bloom, the whole city skyline below bathed in warm light; brilliant golden sun low in the sky on the upper left sending radiant rays; glowing bokeh, lens sparkles and drifting cherry-blossom petals; the right half stays open (a character will stand there)
Color palette: radiant gold, warm peach, honey, soft pink
Lighting/mood: triumphant, radiant, glowing, joyful""",
    'ending-offer': """Primary request: the "offer" ending background: the plaza in front of a modern office building on a bright spring day; no people
Scene/backdrop: a wide sunny plaza lined with blooming cherry-blossom trees, a friendly glass office building behind them, a clear blue sky with a few white clouds, petals drifting and scattered on the pavement; the right half stays open (a character will stand there)
Color palette: fresh sky blue, sakura pink, white, spring green
Lighting/mood: fresh, hopeful, bright morning light""",
    'ending-pending': """Primary request: the "pending" ending background: a quiet pedestrian bridge over a city street at cloudy dusk; no people
Scene/backdrop: overcast lavender-gray clouds with a faint warm glow near the horizon, office towers with the first lit windows, street lights just turning on, a gentle breeze; calm and slightly uncertain; the right half stays open (a character will stand there)
Color palette: dusky lavender, slate blue, muted peach, soft gray
Lighting/mood: pensive, calm, a little uncertain, soft dusk light — painted in the same bright, clean pastel anime style as a sunny cherry-blossom visual novel: simple flat-shaded buildings with sparse soft windows instead of dense realistic detail, a light airy lavender-and-peach dusk sky, overall light mid-to-bright tones (never grey, murky, photographic or dark); the whole right half is open walkway, railing and sky with no lamp post, tree or tall building standing there""",
    'ending-rejected': """Primary request: the "not this time" ending background: a city street at night in the rain; no people
Scene/backdrop: a quiet sidewalk under a streetlight in steady rain, wet pavement with long reflections of neon-free soft shop lights and traffic lights, blurred bokeh of distant windows, falling rain streaks, puddles; the right half stays open (a character will stand there)
Color palette: deep blue, indigo, cold teal, with a few soft warm lights
Lighting/mood: melancholic but gentle, quiet, reflective (not scary) — an early blue-hour drizzle just after sunset rather than a dark night: a luminous periwinkle-and-lavender sky, light blue-grey pavement, simple clean anime shapes, gentle low contrast and warm glowing windows; every shopfront and wall stays plain with no signs, lettering, pseudo-letters, symbols, plaques or neon of any kind""",
}

EVENING_EDIT = """Use case: lighting-weather
Asset type: evening variant of a visual-novel background (must line up with the day version exactly)
Primary request: change ONLY the time of day to a late-afternoon sunset: the sky outside turns warm orange and pink with lilac clouds, the distant city lights start to glow, warm amber sunset light falls across the walls and the floor, interior lamps glow softly
Treat this as a colour grade of the attached picture: the city seen through the windows keeps exactly the same buildings — every tower, rooftop, antenna, window grid and tree keeps its outline, facade, size and position, nothing replaced, redrawn, added or removed — only the sky behind them is repainted, the existing buildings take a warm tint and some of their existing windows light up
Constraints: keep the room layout, every piece of furniture and decor, the camera, the composition and the image size identical; no people; no text
Avoid: moving or adding objects, darkening the scene too much, harsh contrast"""


def prompt(kind: str, *args: str) -> str:
    if kind == 'base':
        (cid,) = args
        return '\n'.join([
            'Use case: stylized-concept',
            'Asset type: visual-novel character sprite (tachie) for a dating-sim style job-interview game; will be cut out with chroma key',
            BASE_SUBJECT[cid],
            STYLE,
        ])
    if kind == 'expr':
        cid, expr = args
        return '\n'.join([
            'Use case: identity-preserve',
            'Asset type: expression variant of a visual-novel character sprite (must overlay the original exactly)',
            f'Primary request: change ONLY the facial expression to {EXPRESSION_LOOK[cid][expr]}',
            'Only the eyes, brows, mouth and cheeks change; the nose, face outline, accessories and every hair strand stay exactly where they are, not shifted by even one pixel',
            KEEP.format(area='eyes, brows, mouth, cheeks and forehead'),
        ])
    if kind == 'mouth':
        cid, expr, k = args
        level = int(k)
        table = MOUTH_OPEN_SURPRISED if expr == 'surprised' else MOUTH_OPEN_HAPPY if expr == 'happy' else MOUTH_OPEN
        glasses = ' and the glasses' if cid == 'ethan' else ''
        return '\n'.join([
            'Use case: identity-preserve',
            'Asset type: lip-sync frame of a visual-novel character sprite (must overlay the original exactly)',
            f'Primary request: change ONLY the mouth so the character is talking: {table[level]}; keep {MOUTH_MOOD[expr]} so it still fits the current expression; keep the eyes, brows{glasses} exactly as they are',
            'Style: draw the mouth in the same simple clean anime style as the picture, with a thin dark outline, a soft pink mouth interior, no colored, glossy or lipstick-like lips and no stray strokes',
            KEEP.format(area='mouth'),
        ])
    if kind == 'blink':
        cid, expr = args
        glasses = (
            '. Only the eyelids and lashes inside the lenses change; the glasses frame, every hair strand and the cheeks below the lenses stay untouched'
            if cid == 'ethan'
            else ''
        )
        return '\n'.join([
            'Use case: identity-preserve',
            'Asset type: blink frame of a visual-novel character sprite (must overlay the original exactly)',
            'Primary request: change ONLY the eyes so they are closed mid-blink: upper eyelids lowered all the way, the closed lids drawn as relaxed, nearly straight lash lines (not upward-curved smiling arcs) at the same position and size as the open eyes; the brows, any sweat drop and the mouth must stay exactly as in the input image. Each closed eye is a flat or very slightly downward-curved lid line with lashes hanging down, never an upward ∩ arch, and shows no white catchlight or highlight anywhere on the lash line' + glasses,
            KEEP.format(area='eyes'),
        ])
    if kind == 'bg':
        (name,) = args
        if name.endswith('-evening'):
            return EVENING_EDIT
        return '\n'.join(['Use case: stylized-concept', BG_ASSET, BG_SUBJECT[name], BG_STYLE])
    raise SystemExit(f'unknown prompt kind {kind!r}')


# ─────────────────────────────── image helpers ───────────────────────────────


def load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32)


def save(arr: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(path)


def cdir(cid: str) -> Path:
    return WORK / 'characters' / cid


def box_json(b) -> list[int]:
    return [int(v) for v in b]


def phase_shift(a: np.ndarray, b: np.ndarray, region) -> tuple[int, int]:
    """Integer translation of b relative to a over `region` (x0, y0, x1, y1), by phase correlation."""
    x0, y0, x1, y1 = region
    ga = a[y0:y1, x0:x1, :3].mean(-1)
    gb = b[y0:y1, x0:x1, :3].mean(-1)
    ga = ga - ga.mean()
    gb = gb - gb.mean()
    f = np.fft.fft2(ga) * np.conj(np.fft.fft2(gb))
    r = np.fft.ifft2(f / (np.abs(f) + 1e-6)).real
    dy, dx = np.unravel_index(int(r.argmax()), r.shape)
    h, w = r.shape
    if dy > h // 2:
        dy -= h
    if dx > w // 2:
        dx -= w
    return int(dy), int(dx)


def diff_map(ref: np.ndarray, edit: np.ndarray) -> np.ndarray:
    """Per-pixel colour difference (0..255) where the reference is opaque; 0 elsewhere."""
    solid = ndi.binary_erosion(ref[..., 3] > 250, iterations=3)
    return np.abs(ref[..., :3] - edit[..., :3]).mean(-1) * solid


def components(mask: np.ndarray, min_frac: float = 0.08) -> np.ndarray:
    """Keep the connected components whose size is at least min_frac of the largest."""
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= min_frac * sizes.max()]
    return np.isin(lab, keep)


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def clamp_box(b, w, h):
    x0, y0, x1, y1 = b
    return max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(h, int(y1))


# ─────────────────────────────── prep / landmarks ───────────────────────────────


def cmd_prep(cid: str) -> None:
    """Clean the chosen codex output: solid interior alpha, no key-colour spill on the edges."""
    src = load(cdir(cid) / 'source.png')
    a = src[..., 3]
    a = np.where(a >= 240, 255.0, a)  # the tool leaves the interior at 252–254
    a = np.where(a <= 8, 0.0, a)
    rgb = src[..., :3].copy()
    edge = (a > 0) & (a < 255)
    near = ndi.binary_dilation(a < 255, iterations=4) & (a > 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    spill = near & (g > np.maximum(r, b))  # green fringe from the chroma key
    rgb[..., 1] = np.where(spill, np.maximum(r, b), g)
    out = np.dstack([rgb, a])
    out[a == 0, :3] = 0
    save(out, cdir(cid) / 'base.png')
    print(json.dumps({'id': cid, 'edge_px': int(edge.sum()), 'despilled_px': int(spill.sum())}))


def cmd_landmarks(cid: str) -> None:
    """Eyes box from the neutral blink edit, mouth box from the neutral wide-open mouth edit."""
    d = cdir(cid)
    base = load(d / 'base.png')
    h, w = base.shape[:2]
    top = bbox(base[..., 3] > 128)[1]
    region = np.zeros((h, w), bool)
    region[top : top + int(h * 0.42), int(w * 0.2) : int(w * 0.8)] = True

    def detect(edit_path: Path, thr: float):
        dm = ndi.gaussian_filter(diff_map(base, load(edit_path)), 3) * region
        m = components(dm > thr, 0.15)
        return bbox(m), dm

    eyes, _ = detect(d / 'raw' / 'blink-neutral.png', 28)
    mouth, _ = detect(d / 'raw' / 'mouth-neutral-3.png', 28)
    if eyes is None or mouth is None:
        raise SystemExit(f'{cid}: could not find eyes/mouth (eyes={eyes}, mouth={mouth})')
    span = eyes[2] - eyes[0]
    cx = (eyes[0] + eyes[2]) / 2
    face = clamp_box(
        (cx - span * 0.85, eyes[1] - span * 0.5, cx + span * 0.85, mouth[3] + span * 0.3),
        w,
        h,
    )
    data = {
        'eyes': box_json(eyes),
        'mouth': box_json(mouth),
        'face': box_json(face),
        'span': int(span),
        'center_x': float(cx),
        'eye_line': float((eyes[1] + eyes[3]) / 2),
    }
    (d / 'landmarks.json').write_text(json.dumps(data, indent=2))
    print(json.dumps({'id': cid, **data}))


def landmarks(cid: str) -> dict:
    return json.loads((cdir(cid) / 'landmarks.json').read_text())


def windows(cid: str) -> dict:
    lm = landmarks(cid)
    s = lm['span']
    ex0, ey0, ex1, ey1 = lm['eyes']
    mx0, my0, mx1, my1 = lm['mouth']
    mcx = (mx0 + mx1) / 2
    return {
        'face': lm['face'],
        'eyes': (ex0 - s * 0.08, ey0 - s * 0.14, ex1 + s * 0.08, ey1 + s * 0.12),
        'mouth': (mcx - s * 0.36, my0 - s * 0.12, mcx + s * 0.36, my1 + s * 0.3),
    }


# ─────────────────────────────── patch extraction ───────────────────────────────

EDGE_LIMIT = {'face': 400, 'mouth': 60, 'blink': 60}

PATCH_PARAMS = {
    #          thr  close grow feather
    'face': (14.0, 14, 18, 6.0),
    'mouth': (16.0, 6, 10, 3.0),
    'blink': (16.0, 6, 10, 3.0),
}


def extract(ref: np.ndarray, edit: np.ndarray, window, kind: str) -> dict:
    """
    Soft patch of what changed between ref and edit inside `window`.
    Returns the RGBA patch (cropped), its box, and review metrics.
    """
    h, w = ref.shape[:2]
    thr, close, grow, feather = PATCH_PARAMS[kind]
    win = clamp_box(window, w, h)
    x0, y0, x1, y1 = win
    inside = np.zeros((h, w), bool)
    inside[y0:y1, x0:x1] = True

    dm = diff_map(ref, edit)
    shift = phase_shift(ref, edit, win)
    solid = ref[..., 3] > 250
    outside = solid & ~ndi.binary_dilation(inside, iterations=40)
    drift = float(dm[outside].mean()) if outside.any() else 0.0

    smooth = ndi.gaussian_filter(dm, 2.0)
    changed = components((smooth > thr) & inside, 0.02)
    # changes that run into the window's border mean the edit touched more than this area
    band = 3
    edge_px = int(
        changed[y0:y1, x0 : x0 + band].sum()
        + changed[y0 : y0 + band, x0:x1].sum()
        + changed[y0:y1, x1 - band : x1].sum()
        + changed[y1 - band : y1, x0:x1].sum()
    )
    core = ndi.binary_closing(changed, iterations=close)
    core = ndi.binary_fill_holes(core)
    grown = ndi.binary_dilation(core, iterations=grow) & inside
    alpha = ndi.gaussian_filter(grown.astype(np.float32), feather)
    # soften the window's own edge too, so a clipped patch never shows a hard line
    edge = ndi.gaussian_filter(ndi.binary_erosion(inside, iterations=int(feather * 2)).astype(np.float32), feather)
    alpha = np.clip(alpha * edge, 0, 1) * (ref[..., 3] / 255.0)
    alpha[alpha < 1 / 255] = 0

    # match the edit's overall tone to the reference around the patch (regeneration drifts a little)
    ring = ndi.binary_dilation(grown, iterations=10) & ~grown & solid & (dm < 18)
    offset = np.median(ref[ring, :3] - edit[ring, :3], axis=0) if ring.sum() > 50 else np.zeros(3)
    offset = np.clip(offset, -12, 12)

    box = bbox(alpha > 0)
    issues = []
    if shift != (0, 0):
        issues.append(f'edit is shifted by {shift} (dy, dx) — regenerate')
    if drift > 10:
        issues.append(f'edit redrew too much outside the {kind} area (drift {drift:.1f} > 10)')
    if box is None or changed.sum() < 60:
        issues.append(f'no visible change in the {kind} area — regenerate')
        box = (x0, y0, x0 + 1, y0 + 1)
    bx0, by0, bx1, by1 = box
    patch = np.zeros((by1 - by0, bx1 - bx0, 4), np.float32)
    patch[..., :3] = np.clip(edit[by0:by1, bx0:bx1, :3] + offset, 0, 255)
    patch[..., 3] = alpha[by0:by1, bx0:bx1] * 255
    if edge_px > EDGE_LIMIT[kind]:
        issues.append(f'{edge_px} changed pixels on the border of the {kind} window: the edit may have changed more than the {kind}')
    return {
        'patch': patch,
        'box': box,
        'window': win,
        'shift': shift,
        'drift': round(drift, 2),
        'changed_px': int(changed.sum()),
        'edge_px': edge_px,
        'offset': [round(float(v), 1) for v in offset],
        'issues': issues,
    }


def composite(base: np.ndarray, patch: np.ndarray, box) -> np.ndarray:
    out = base.copy()
    x0, y0, x1, y1 = box
    a = patch[..., 3:4] / 255.0
    out[y0:y1, x0:x1, :3] = patch[..., :3] * a + out[y0:y1, x0:x1, :3] * (1 - a)
    return out


def review_image(ref: np.ndarray, edit: np.ndarray, res: dict, path: Path, zoom_box, scale: float) -> None:
    """[reference | composited result | alpha of the patch] around zoom_box, enlarged."""
    comp = composite(ref, res['patch'], res['box'])
    mask = np.zeros(ref.shape[:2], np.float32)
    x0, y0, x1, y1 = res['box']
    mask[y0:y1, x0:x1] = res['patch'][..., 3]
    zx0, zy0, zx1, zy1 = clamp_box(zoom_box, ref.shape[1], ref.shape[0])
    tiles = []
    bg = np.array([246, 240, 244], np.float32)
    for arr in (ref, comp):
        crop = arr[zy0:zy1, zx0:zx1]
        a = crop[..., 3:4] / 255
        tiles.append(Image.fromarray((crop[..., :3] * a + bg * (1 - a)).astype(np.uint8)))
    m = mask[zy0:zy1, zx0:zx1]
    tiles.append(Image.fromarray(np.dstack([m, m * 0.35, m * 0.6]).astype(np.uint8)))
    tw, th = tiles[0].size
    tw2, th2 = int(tw * scale), int(th * scale)
    sheet = Image.new('RGB', (tw2 * 3 + 20, th2), (30, 30, 36))
    for i, t in enumerate(tiles):
        sheet.paste(t.resize((tw2, th2), Image.LANCZOS), (i * (tw2 + 10), 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def write_patch(cid: str, name: str, res: dict) -> None:
    d = cdir(cid) / 'patches'
    save(res['patch'], d / f'{name}.png')
    (d / f'{name}.json').write_text(json.dumps({'box': box_json(res['box'])}))


def report(cid: str, name: str, res: dict, review: Path) -> None:
    keys = ('box', 'window', 'shift', 'drift', 'changed_px', 'edge_px', 'offset', 'issues')
    print(json.dumps({'id': cid, 'patch': name, **{k: res[k] for k in keys}, 'review': str(review)}, default=list))


def cmd_face(cid: str, expr: str) -> None:
    d = cdir(cid)
    base = load(d / 'base.png')
    win = windows(cid)['face']
    if expr == 'neutral':
        # the neutral "patch" is the base itself; the comp is the base
        save(base, d / 'comp' / 'neutral.png')
        print(json.dumps({'id': cid, 'patch': 'face-neutral', 'issues': []}))
        return
    edit = load(d / 'raw' / f'expr-{expr}.png')
    res = extract(base, edit, win, 'face')
    write_patch(cid, f'face-{expr}', res)
    save(composite(base, res['patch'], res['box']), d / 'comp' / f'{expr}.png')
    review = WORK / 'review' / cid / f'face-{expr}.png'
    lm = landmarks(cid)
    s = lm['span']
    x0, y0, x1, y1 = win
    review_image(base, edit, res, review, (x0 - s * 0.3, y0 - s * 0.35, x1 + s * 0.3, y1 + s * 0.25), 1.0)
    report(cid, f'face-{expr}', res, review)


def cmd_frame(kind: str, cid: str, expr: str, k: str | None = None) -> None:
    d = cdir(cid)
    ref = load(d / 'comp' / f'{expr}.png')
    name = f'mouth-{expr}-{k}' if kind == 'mouth' else f'blink-{expr}'
    edit = load(d / 'raw' / f'{name}.png')
    win = windows(cid)['mouth' if kind == 'mouth' else 'eyes']
    res = extract(ref, edit, win, kind)
    write_patch(cid, name, res)
    review = WORK / 'review' / cid / f'{name}.png'
    x0, y0, x1, y1 = win
    s = landmarks(cid)['span']
    review_image(ref, edit, res, review, (x0 - s * 0.2, y0 - s * 0.2, x1 + s * 0.2, y1 + s * 0.2), 2.0 if kind == 'mouth' else 1.5)
    report(cid, name, res, review)


# ─────────────────────────────── review sheet ───────────────────────────────


def blink_frames(cid: str, expr: str) -> bool:
    return (cdir(cid) / 'patches' / f'blink-{expr}.png').exists()


def patch_of(cid: str, name: str):
    d = cdir(cid) / 'patches'
    if not (d / f'{name}.png').exists():
        return None
    return load(d / f'{name}.png'), json.loads((d / f'{name}.json').read_text())['box']


def cmd_sheet(cid: str) -> None:
    """One row per expression: expression | mouth 1 | 2 | 3 | blink — head crops."""
    d = cdir(cid)
    base = load(d / 'base.png')
    lm = landmarks(cid)
    s = lm['span']
    cx, ey = lm['center_x'], lm['eye_line']
    crop = clamp_box((cx - s * 1.0, ey - s * 0.75, cx + s * 1.0, ey + s * 1.05), base.shape[1], base.shape[0])
    cols = ['', 'mouth-1', 'mouth-2', 'mouth-3', 'blink']
    tile_w = 300
    x0, y0, x1, y1 = crop
    tile_h = int(tile_w * (y1 - y0) / (x1 - x0))
    sheet = Image.new('RGB', (tile_w * len(cols), tile_h * len(EXPRESSIONS)), (40, 40, 48))
    draw = ImageDraw.Draw(sheet)
    bg = np.array([246, 240, 244], np.float32)
    for r, expr in enumerate(EXPRESSIONS):
        comp_path = d / 'comp' / f'{expr}.png'
        if not comp_path.exists():
            continue
        comp = load(comp_path)
        for c, col in enumerate(cols):
            img = comp
            if col.startswith('mouth'):
                p = patch_of(cid, f'mouth-{expr}-{col[-1]}')
                img = composite(comp, *p) if p else None
            elif col == 'blink':
                p = patch_of(cid, f'blink-{expr}')
                img = composite(comp, *p) if p else None
            if img is None:
                continue
            t = img[y0:y1, x0:x1]
            a = t[..., 3:4] / 255
            tile = Image.fromarray((t[..., :3] * a + bg * (1 - a)).astype(np.uint8)).resize((tile_w, tile_h), Image.LANCZOS)
            sheet.paste(tile, (c * tile_w, r * tile_h))
            draw.text((c * tile_w + 6, r * tile_h + 4), f'{expr} {col}'.strip(), fill=(20, 20, 20))
    out = WORK / 'review' / f'{cid}-sheet.png'
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(out)


# ─────────────────────────────── pack ───────────────────────────────


def premultiplied(img: Image.Image) -> Image.Image:
    return img.convert('RGBa')


@functools.cache
def framing(cid: str) -> tuple[float, float, float, int]:
    """(scale, offset_x, offset_y, canvas_width) mapping source pixels onto the output canvas."""
    lm = landmarks(cid)
    s = EYE_SPAN / lm['span']
    oy = CANVAS_H * EYE_LINE_Y - lm['eye_line'] * s
    alpha = load(cdir(cid) / 'base.png')[..., 3]
    visible_rows = int(min(alpha.shape[0], (CANVAS_H - oy) / s))  # rows that land on the canvas
    cols = np.nonzero(alpha[:visible_rows].max(0) > 64)[0]
    cx = lm['center_x']
    half = max(cx - cols[0], cols[-1] + 1 - cx) * s + 16
    cw = max(MIN_CANVAS_W, int(np.ceil(2 * half / 16)) * 16)
    return s, cw / 2 - cx * s, oy, cw


def to_canvas(arr: np.ndarray, cid: str) -> Image.Image:
    s, ox, oy, cw = framing(cid)
    img = premultiplied(Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), 'RGBA'))
    out = img.transform(
        (cw, CANVAS_H),
        Image.AFFINE,
        (1 / s, 0, -ox / s, 0, 1 / s, -oy / s),
        resample=Image.BICUBIC,
    )
    return out.convert('RGBA')


def save_webp(img: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, 'WEBP', quality=quality, method=6, alpha_quality=100, exact=False)


def pack_character(cid: str) -> dict:
    """
    base.webp, one face layer per expression, 3 mouth frames per expression, blink frames.

    Every face layer shares ONE rect and ONE mask (the union of all expression patches), holding
    base ⊕ that expression's patch. So an expression fading in over another covers it exactly, and
    the neutral layer is simply the base cut out with the same mask.
    """
    d = cdir(cid)
    base = load(d / 'base.png')
    h, w = base.shape[:2]
    out_dir = ASSETS / 'characters' / cid
    save_webp(to_canvas(base, cid), out_dir / 'base.webp', 90)

    union = np.zeros((h, w), np.float32)
    comps = {'neutral': base}
    for expr in EXPRESSIONS[1:]:
        p = patch_of(cid, f'face-{expr}')
        if p is None:
            raise SystemExit(f'{cid}: missing face patch for {expr}')
        patch, box = p
        x0, y0, x1, y1 = box
        union[y0:y1, x0:x1] = np.maximum(union[y0:y1, x0:x1], patch[..., 3])
        comps[expr] = composite(base, patch, box)
    face_rect = None
    for expr in EXPRESSIONS:
        layer = comps[expr].copy()
        layer[..., 3] = union
        img = to_canvas(layer, cid)
        if face_rect is None:
            b = img.getchannel('A').getbbox()
            face_rect = [b[0], b[1], b[2] - b[0], b[3] - b[1]]
        fx, fy, fw, fh = face_rect
        save_webp(img.crop((fx, fy, fx + fw, fy + fh)), out_dir / f'face-{expr}.webp', 92)

    def put(name: str):
        p = patch_of(cid, name)
        if p is None:
            return None
        patch, box = p
        full = np.zeros((h, w, 4), np.float32)
        x0, y0, x1, y1 = box
        full[y0:y1, x0:x1] = patch
        img = to_canvas(full, cid)
        b = img.getchannel('A').getbbox()
        if b is None:
            return None
        save_webp(img.crop(b), out_dir / f'{name}.webp', 92)
        return [b[0], b[1], b[2] - b[0], b[3] - b[1]]

    frames = {}
    for expr in EXPRESSIONS:
        mouths = [put(f'mouth-{expr}-{k}') for k in MOUTH_LEVELS]
        if any(m is None for m in mouths):
            raise SystemExit(f'{cid}: missing mouth frames for {expr}')
        entry = {'mouth': mouths}
        if expr not in CLOSED_EYES[cid]:
            blink = put(f'blink-{expr}')
            if blink is None:
                raise SystemExit(f'{cid}: missing or empty blink frame for {expr} (or add it to CLOSED_EYES)')
            entry['blink'] = blink
        frames[expr] = entry

    # square head-and-shoulders crop for portraits, and the head box (for effects)
    lm = landmarks(cid)
    s, ox, oy, cw = framing(cid)
    span = lm['span'] * s
    cx = lm['center_x'] * s + ox
    ey = lm['eye_line'] * s + oy
    size = span * PORTRAIT_SPANS
    return {
        'canvas': [cw, CANVAS_H],
        'portrait': [round(cx - size / 2, 1), round(ey - size * 0.4, 1), round(size, 1)],
        'head': [round(cx - span * 1.05, 1), round(ey - span * 1.1, 1), round(span * 2.1, 1), round(span * 1.95, 1)],
        'face': face_rect,
        'frames': frames,
    }


def pack_background(name: str) -> None:
    img = Image.open(WORK / 'backgrounds' / f'{name}.png').convert('RGB')
    if name == 'lobby':
        img = img.filter(ImageFilter.GaussianBlur(2.5))  # menus sit on it: keep it soft
    out = ASSETS / 'backgrounds' / f'{name}.webp'
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, 'WEBP', quality=84, method=6)


MANIFEST_TS = """// Generated by `uv run tools/art/build.py pack` (tools/art/README.md) — do not edit by hand.
import type {{ ArtManifest }} from '../lib/assets';

export const ART_MANIFEST: ArtManifest = {body};
"""


def cmd_pack() -> None:
    characters = {cid: pack_character(cid) for cid in CHARACTERS}
    for name in BACKGROUNDS:
        pack_background(name)
    body = json.dumps({'characters': characters}, indent=2)
    # one line per rect: [x, y, w, h]
    body = re.sub(r'\[\s*([-\d.,\s]+?)\s*\]', lambda m: '[' + ', '.join(v.strip() for v in m.group(1).split(',')) + ']', body)
    path = ASSETS / 'manifest.ts'
    path.write_text(MANIFEST_TS.format(body=body))
    total = sum(p.stat().st_size for p in ASSETS.rglob('*.webp'))
    print(json.dumps({'manifest': str(path), 'webp_files': len(list(ASSETS.rglob('*.webp'))), 'webp_bytes': total}))


def main(argv: list[str]) -> None:
    if not argv:
        print(__doc__)
        return
    cmd, *args = argv
    if cmd == 'prompt':
        print(prompt(*args))
    elif cmd == 'prep':
        cmd_prep(*args)
    elif cmd == 'landmarks':
        cmd_landmarks(*args)
    elif cmd == 'face':
        cmd_face(*args)
    elif cmd == 'mouth':
        cmd_frame('mouth', *args)
    elif cmd == 'blink':
        cmd_frame('blink', *args)
    elif cmd == 'sheet':
        cmd_sheet(*args)
    elif cmd == 'pack':
        cmd_pack()
    else:
        raise SystemExit(f'unknown command {cmd!r}\n{__doc__}')


if __name__ == '__main__':
    main(sys.argv[1:])
