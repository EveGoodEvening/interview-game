# AGENTS.md

Project spec: `docs/DESIGN.md`. Art pipeline: `tools/art/README.md`.

## Lessons

- **Image generation goes through the Codex CLI** (`codex exec`, built-in `image_gen` tool of the
  `imagegen` skill; no OpenAI API key needed). Use `tools/art/gen.sh <out.png> <prompt.txt> [input.png]`
  — it passes the prompt verbatim and finds the result itself.
  - The result lands in `$CODEX_HOME/generated_images/<thread_id>/*.png`; `CODEX_HOME` is usually not set
    in the shell (asking the codex agent to `cp $CODEX_HOME/...` fails), so take the thread id from the
    `thread.started` event of `codex exec --json` and default `CODEX_HOME` to `~/.codex`.
  - `codex exec -i/--image` takes several values: a trailing `-` (prompt from stdin) is read as one more
    image ("could not read the local image at `-`"). Put `-` before the images or use `--image=path`.
  - `-c model_reasoning_effort="low"` is enough (the agent only relays the prompt); ~60–120 s per image;
    8 in parallel worked. A Bash call is capped at 10 min: run big fan-outs in the background.
  - Character prompts asking for a flat chroma-key background come back as **native transparent RGBA**
    PNGs (1024×1536); interior alpha is 252–254, so clamp ≥ 240 to 255. Backgrounds come out 1672×941.
  - **Edits (`-i input.png`) stay pixel-aligned** with the input (phase-correlation shift 0,0 — evening
    variants of backgrounds too) and keep identity, but regenerate the whole picture with small noise
    (mean diff ~3–5): ship only the changed region as a feathered, tone-matched patch
    (`tools/art/build.py`), never the whole edited frame. Gaze changes sometimes come back shifted by
    1 px (`build.py` flags it; retry). Keep every try as `<name>.tryN.png`: re-saving over the final
    before extraction loses it.
- **gpt-image needs explicit wording for fine distinctions** (all now in the `build.py` prompts, found by
  retrying with one corrective sentence at a time): level-1 talking mouths come back as open as level 2;
  when the rest mouth is already open (happy), mouth-2 copies it; teeth come back as a white ring around
  the opening ("upper teeth only"); blinks come back as smiling ^ arcs, keep the eye catchlight as a white
  dot, or redraw brows / glasses rims; worried brows only tilt when told "inner end higher than the
  outer end"; "brows lowered and drawn together" gives an angry V; a "closed-mouth grin" smile barely
  differs from neutral; "smaller pupils" gives bug eyes; a sweat drop under the glasses reads as a tear;
  a pale sweat drop falls under the patch threshold and silently vanishes (check `comp/`, not `raw/`);
  mouths turn glossy "lipstick"; offices / night scenes drift to a 3D-render look and dusk / night come
  back dark grey unless asked for "light pastel"; evening edits redraw the skyline unless told "a colour
  grade: every building keeps its outline"; a "calm left third" still gets a dense blossom cluster unless
  it says "empty open sky, at most one small sprig at the very edge"; backgrounds grow garbled signs and a
  faint watermark squiggle in a corner. Always compare rows side by side (`build.py sheet`), zoom corners /
  lash lines / patch borders, blend day + evening at 50 %, and run 2 tries in parallel for flaky frames.
- Vitest runs through Vite, which rewrites `new URL('<string literal>', import.meta.url)` into an asset
  URL (http scheme → `readFileSync` throws "The URL must be of scheme file"). Pass the path through a
  variable / helper (`const local = (rel) => new URL(rel, import.meta.url)`).
- Vite inlines assets under 4 KB as base64 into the importing chunk — an eager `import.meta.glob` of
  small sprite patches bloated the entry chunk by ~110 kB. Use `query: '?no-inline'` for art files.
- CSS gradients (`background`) do not transition: crossfade two layers with `opacity` instead.
  `z-index` inside a sprite leaks into the page unless the container has `isolation: isolate`.
- `git stash` also stashes staged deletions but leaves untracked files; check `git status` after popping.
- Don't `rm -rf` temp dirs from scripts or the current directory — the harness blocks removals of
  workspace dirs; keep generation logs under the (git-ignored) work dir instead.
