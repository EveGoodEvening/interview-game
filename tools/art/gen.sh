#!/usr/bin/env bash
# One image through the Codex CLI's built-in image_gen tool (gpt-image, via the `imagegen` skill).
#
#   tools/art/gen.sh <out.png> <prompt-file> [input.png ...]
#
# With input images the prompt is applied as an EDIT of them (expression / lip-sync / blink frames,
# evening variants); without, it generates from scratch. The prompt file is passed verbatim.
# The result is found through the session's thread id ($CODEX_HOME/generated_images/<thread>/*.png),
# so nothing depends on the agent copying files. At most $ART_GEN_SLOTS (default 8) run at once
# across all callers (flock slots), so a fan-out of generators does not flood the account.
set -uo pipefail
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
here=$(cd "$(dirname "$0")" && pwd)
work_root="${ART_WORK:-$here/work}"
if [ $# -lt 2 ]; then
  echo "usage: $0 <out.png> <prompt-file> [input.png ...]" >&2
  exit 2
fi
out=$(realpath -m "$1")
promptfile=$(realpath -m "$2")
shift 2
# fail before queueing for a slot: codex would happily run with an empty prompt or a missing image
if [ ! -s "$promptfile" ]; then
  echo "gen.sh: missing or empty prompt file $promptfile" >&2
  exit 2
fi
for f in "$@"; do
  if [ ! -f "$f" ]; then
    echo "gen.sh: missing input image $f" >&2
    exit 2
  fi
done

mkdir -p "$work_root/.gen" "$work_root/.slots"
work=$(mktemp -d "$work_root/.gen/job.XXXXXX")
imgs=()
for f in "$@"; do imgs+=("--image=$(realpath "$f")"); done
if [ ${#imgs[@]} -gt 0 ]; then
  mode="The attached image(s) are the edit target. Use the built-in image_gen tool (imagegen skill, built-in mode) exactly once to EDIT the attached image, passing the prompt between the markers verbatim."
else
  mode="Use the built-in image_gen tool (imagegen skill, built-in mode) exactly once, passing the prompt between the markers verbatim."
fi
{
  echo "$mode Do not add, remove or rephrase anything in the prompt. Do not read any skill files or other files first, and do not run any shell commands. After the image is generated, reply with just the word DONE."
  echo
  echo "<<<PROMPT"
  cat "$promptfile"
  echo "PROMPT>>>"
} > "$work/instructions.txt"
echo "$out" > "$work/target.txt"

# Take a free slot (fd 9 stays locked for the codex run). When all are busy, queue on one slot with a
# blocking flock instead of polling, so a waiting job cannot be overtaken indefinitely.
slots="${ART_GEN_SLOTS:-8}"
got=""
for i in $(seq 0 $((slots - 1))); do
  exec 9> "$work_root/.slots/$i.lock"
  if flock -n 9; then got=1; break; fi
  exec 9>&-
done
if [ -z "$got" ]; then
  exec 9> "$work_root/.slots/$((RANDOM % slots)).lock"
  flock 9
fi

# The prompt comes from stdin ("-"), placed before the images: `-i/--image` takes several values and
# would read a trailing "-" as one more image path. `9>&-`: codex's helpers must not inherit the slot lock.
(cd "$work" && timeout 1200 codex exec --skip-git-repo-check -s read-only -c model_reasoning_effort=\"low\" \
  --json - "${imgs[@]}" < instructions.txt > events.jsonl 2> stderr.txt 9>&-)
rc=$?
exec 9>&-

thread=$(python3 - "$work/events.jsonl" <<'PY' 2>/dev/null
import json, sys
for line in open(sys.argv[1]):
    try:
        event = json.loads(line)
    except ValueError:
        continue
    if event.get('type') == 'thread.started':
        print(event['thread_id'])
        break
PY
)
png=""
if [ -n "$thread" ] && [ -d "$CODEX_HOME/generated_images/$thread" ]; then
  png=$(ls -t "$CODEX_HOME/generated_images/$thread"/*.png 2>/dev/null | head -1)
fi
if [ -n "$png" ]; then
  mkdir -p "$(dirname "$out")"
  cp "$png" "$out"
  echo "OK $out"
  exit 0
fi
echo "FAIL rc=$rc thread=${thread:-?} log=$work" >&2
tail -c 1500 "$work/stderr.txt" >&2
tail -c 1500 "$work/events.jsonl" >&2
exit 1
