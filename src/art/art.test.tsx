// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_IDS, ENDING_IDS, EXPRESSIONS } from '../types';
import { EndingBackground, LobbyBackground, OfficeBackground, TitleBackground } from './backgrounds/Backgrounds';
import { CharacterPortrait, CharacterSprite, LAYOUT_ASPECT } from './characters/CharacterSprite';
import { EXPRESSION_FADE_MS, canBlink } from './characters/SpriteLayers';
import { useCrossfade } from './characters/hooks/useCrossfade';
import { mouthLevelFor } from './characters/hooks/useMouthDriver';
import { SakuraPetals, petalParams } from './effects/SakuraPetals';
import { backgroundUrl, spriteSheet, spriteUrl, spriteUrls, type BackgroundName, type Rect } from './lib/assets';
import { mulberry32 } from './lib/random';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A file next to this test (a variable, so Vite leaves `new URL(…, import.meta.url)` alone). */
const local = (rel: string) => new URL(rel, import.meta.url);
const readText = (rel: string) => readFileSync(local(rel), 'utf8');

const imgs = (root: ParentNode, selector: string) => [...root.querySelectorAll<HTMLImageElement>(selector)];

describe('art assets', () => {
  const inside = ([x, y, w, h]: Rect, [cw, ch]: readonly [number, number]) => x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= cw && y + h <= ch;

  it.each(CHARACTER_IDS)('the %s sprite sheet is complete and every layer fits the canvas', (id) => {
    const sheet = spriteSheet(id);
    // one height for everyone; the width fits the shoulders
    expect(sheet.canvas[1]).toBe(1280);
    expect(sheet.canvas[0]).toBeGreaterThanOrEqual(960);
    expect(inside(sheet.face, sheet.canvas)).toBe(true);
    const [px, py, edge] = sheet.portrait;
    expect(inside([px, py, edge, edge], sheet.canvas)).toBe(true);
    for (const expression of EXPRESSIONS) {
      const frames = sheet.frames[expression];
      expect(frames.mouth).toHaveLength(3);
      for (const rect of frames.mouth) expect(inside(rect, sheet.canvas)).toBe(true);
      if (frames.blink) expect(inside(frames.blink, sheet.canvas)).toBe(true);
    }
  });

  it('has a blink frame for every expression except the ones painted with closed eyes', () => {
    // mirrors CLOSED_EYES in tools/art/build.py
    const closedEyes: Record<string, string[]> = { yuki: ['happy'], ethan: [], haru: ['happy'] };
    for (const id of CHARACTER_IDS) {
      const withoutBlink = EXPRESSIONS.filter((e) => !spriteSheet(id).frames[e].blink);
      expect(withoutBlink).toEqual(closedEyes[id]);
    }
  });

  it.each(CHARACTER_IDS)('ships exactly the %s files the sheet uses', (id) => {
    const expected = spriteUrls(id).map((url) => decodeURIComponent(url.split('/').pop()!.split('?')[0]));
    const onDisk = readdirSync(local(`./assets/characters/${id}`)).filter((f) => f.endsWith('.webp'));
    expect([...onDisk].sort()).toEqual([...expected].sort());
  });

  it('has every background', () => {
    const names: BackgroundName[] = [
      ...CHARACTER_IDS.flatMap((id) => [`office-${id}-day`, `office-${id}-evening`] as const),
      'title',
      'lobby',
      ...ENDING_IDS.map((e) => `ending-${e}` as const),
    ];
    for (const name of names) expect(backgroundUrl(name)).toMatch(new RegExp(`${name}\\.webp`));
    const onDisk = readdirSync(local('./assets/backgrounds')).filter((f) => f.endsWith('.webp'));
    expect(onDisk.sort()).toEqual(names.map((n) => `${n}.webp`).sort());
  });
});

describe('CharacterSprite', () => {
  it.each(CHARACTER_IDS)('layers every expression for %s', (id) => {
    for (const expression of EXPRESSIONS) {
      const { container, unmount } = render(<CharacterSprite characterId={id} expression={expression} height={400} />);
      const root = container.querySelector('.cs-sprite') as HTMLElement;
      expect(root.getAttribute('data-expression')).toBe(expression);
      expect(root.style.height).toBe('400px');
      expect(root.getAttribute('role')).toBe('img');
      expect(imgs(root, '.cs-base').map((i) => i.getAttribute('src'))).toEqual([spriteUrl(id, 'base')]);
      expect(imgs(root, '.cs-face').map((i) => i.getAttribute('src'))).toEqual([spriteUrl(id, `face-${expression}`)]);
      // each lip-sync level shows its own frame (level 1 = lips parted … 3 = open)
      for (const k of [1, 2, 3] as const) {
        expect(imgs(root, `.cs-mouth.cs-m${k}`).map((i) => i.getAttribute('src'))).toEqual([spriteUrl(id, `mouth-${expression}-${k}`)]);
      }
      const blink = spriteSheet(id).frames[expression].blink;
      expect(imgs(root, '.cs-blink').map((i) => i.getAttribute('src'))).toEqual(blink ? [spriteUrl(id, `blink-${expression}`)] : []);
      unmount();
    }
  });

  it('places every layer at its canvas rect, in percentages of the canvas', () => {
    // Ethan's canvas is wider than 3:4, so swapped axes or a wrong divisor would show
    const sheet = spriteSheet('ethan');
    const [cw, ch] = sheet.canvas;
    expect(cw).toBeGreaterThan(ch * LAYOUT_ASPECT);
    const { container } = render(<CharacterSprite characterId="ethan" expression="troubled" />);
    const check = (el: HTMLElement, [x, y, w, h]: readonly number[]) => {
      expect(parseFloat(el.style.left)).toBeCloseTo((x / cw) * 100, 3);
      expect(parseFloat(el.style.top)).toBeCloseTo((y / ch) * 100, 3);
      expect(parseFloat(el.style.width)).toBeCloseTo((w / cw) * 100, 3);
      expect(parseFloat(el.style.height)).toBeCloseTo((h / ch) * 100, 3);
    };
    check(imgs(container, '.cs-face')[0], sheet.face);
    const frames = sheet.frames.troubled;
    for (const k of [1, 2, 3] as const) check(imgs(container, `.cs-m${k}`)[0], frames.mouth[k - 1]);
    check(imgs(container, '.cs-blink')[0], frames.blink!);
  });

  it('takes a 3:4 layout box centred on the face, whatever the canvas width', () => {
    for (const id of CHARACTER_IDS) {
      const [cw, ch] = spriteSheet(id).canvas;
      const { container, unmount } = render(<CharacterSprite characterId={id} expression="neutral" height={640} />);
      const root = container.querySelector('.cs-sprite') as HTMLElement;
      expect(root.style.aspectRatio).toBe(`${cw} / ${ch}`);
      const overflow = (cw / ch - LAYOUT_ASPECT) / 2;
      if (overflow > 0) {
        // painted width + 2 × (negative) margin = 640 × 3/4 (jsdom folds the calc() into px)
        const margin = parseFloat(root.style.marginInline.replace(/^calc\(/, ''));
        expect(margin).toBeLessThan(0);
        expect(640 * (cw / ch) + 2 * margin).toBeCloseTo(640 * LAYOUT_ASPECT, 1);
      } else expect(root.style.marginInline).toBe('');
      unmount();
    }
  });

  it('draws a manga symbol for happy (sparkles) and surprised (shock lines) only', () => {
    const { container, rerender } = render(<CharacterSprite characterId="haru" expression="happy" />);
    expect(container.querySelectorAll('.cs-sparkle')).toHaveLength(3);
    rerender(<CharacterSprite characterId="haru" expression="surprised" />);
    expect(container.querySelectorAll('.cs-shock line')).toHaveLength(3);
    rerender(<CharacterSprite characterId="haru" expression="serious" />);
    expect(container.querySelector('[data-part="symbols"]')).toBeNull();
  });

  it('crossfades expressions: the new face fades in over the old one, then the old one goes', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CharacterSprite characterId="haru" expression="neutral" />);
    rerender(<CharacterSprite characterId="haru" expression="surprised" />);
    const layers = [...container.querySelectorAll('.cs-expr')];
    expect(layers.map((l) => l.getAttribute('data-expression'))).toEqual(['neutral', 'surprised']);
    expect(layers[0].classList.contains('cs-face-out')).toBe(true);
    expect(layers[1].classList.contains('cs-face-in')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect([...container.querySelectorAll('.cs-expr')].map((l) => l.getAttribute('data-expression'))).toEqual(['surprised']);
    expect(container.querySelectorAll('.cs-face-out, .cs-face-in')).toHaveLength(0);
  });

  it('drives the mouth from mouthLevelRef without re-rendering', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    const level = { current: 0.9 };
    const { container } = render(<CharacterSprite characterId="yuki" expression="smile" mouthLevelRef={level} />);
    const root = container.querySelector('.cs-root')!;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(root.getAttribute('data-mouth')).toBe('3');
    level.current = 0.2;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(root.getAttribute('data-mouth')).toBe('1');
    level.current = 0;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(root.getAttribute('data-mouth')).toBe('0');
  });

  it('flaps procedurally while speaking without a level source', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    const { container, rerender } = render(<CharacterSprite characterId="ethan" expression="neutral" speaking />);
    const root = container.querySelector('.cs-root')!;
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      act(() => {
        vi.advanceTimersByTime(50);
      });
      seen.add(root.getAttribute('data-mouth') ?? '');
    }
    expect([...seen].some((v) => v !== '0')).toBe(true);
    rerender(<CharacterSprite characterId="ethan" expression="neutral" speaking={false} />);
    expect(root.getAttribute('data-mouth')).toBe('0');
  });

  it('blinks on a timer by toggling data-blink', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { container } = render(<CharacterSprite characterId="yuki" expression="neutral" />);
    const root = container.querySelector('.cs-root')!;
    expect(root.hasAttribute('data-blink')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(4001); // 2000 + 0.5 * 4000
    });
    expect(root.hasAttribute('data-blink')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(root.hasAttribute('data-blink')).toBe(false);
  });

  it('does not blink where the painted eyes are already closed', () => {
    /** Every value data-blink took on the sprite root during 20 s. */
    const blinksOver20s = (id: (typeof CHARACTER_IDS)[number], expression: (typeof EXPRESSIONS)[number]) => {
      vi.useFakeTimers();
      const { container, unmount } = render(<CharacterSprite characterId={id} expression={expression} />);
      const root = container.querySelector('.cs-root')!;
      const set = vi.spyOn(root, 'setAttribute');
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      const count = set.mock.calls.filter(([name]) => name === 'data-blink').length;
      unmount();
      vi.useRealTimers();
      return count;
    };
    const closed = CHARACTER_IDS.flatMap((id) => EXPRESSIONS.filter((e) => !canBlink(id, e)).map((e) => [id, e] as const));
    expect(closed.length).toBeGreaterThan(0);
    for (const [id, expression] of closed) expect(blinksOver20s(id, expression)).toBe(0);
    // control: an open-eyed face blinks several times in the same 20 s
    expect(blinksOver20s('yuki', 'neutral')).toBeGreaterThan(2);
  });

  it('shows the frame the root attributes ask for (CSS contract)', () => {
    const css = readText('./characters/CharacterSprite.css');
    for (const k of [1, 2, 3]) expect(css).toContain(`.cs-root[data-mouth='${k}'] .cs-m${k}`);
    expect(css).toContain('.cs-root[data-blink] .cs-blink');
    expect(css).toMatch(/\.cs-mouth,\s*\.cs-blink\s*\{\s*visibility:\s*hidden;/);
    // the fade in CSS is the one the crossfade waits for
    expect(css).toMatch(new RegExp(`\\.cs-face-in \\{\\s*animation: cs-fade-in ${EXPRESSION_FADE_MS}ms`));
    // an expression group's layers stay inside it (the old blink never paints over the new face)
    expect(css).toMatch(/\.cs-expr \{[^}]*isolation: isolate;/);
    expect(css).not.toMatch(/\.cs-blink \{[^}]*z-index/);
  });
});

describe('mouthLevelFor', () => {
  it('maps amplitude to four shapes', () => {
    expect([0, 0.05, 0.1, 0.3, 0.6, 1, Number.NaN].map(mouthLevelFor)).toEqual([0, 0, 1, 2, 3, 3, 0]);
  });
});

describe('CharacterPortrait', () => {
  it('crops the same sprite into the square frame', () => {
    const { container } = render(<CharacterPortrait characterId="haru" size={64} />);
    const frame = container.firstChild as HTMLElement;
    expect(frame.style.width).toBe('64px');
    expect(frame.style.height).toBe('64px');
    const [px, py, edge] = spriteSheet('haru').portrait;
    const [cw, ch] = spriteSheet('haru').canvas;
    const stage = container.querySelector('.cp-portrait__stage') as HTMLElement;
    expect(parseFloat(stage.style.width)).toBeCloseTo((cw / edge) * 100, 3);
    expect(parseFloat(stage.style.height)).toBeCloseTo((ch / edge) * 100, 3);
    expect(parseFloat(stage.style.left)).toBeCloseTo((-px / edge) * 100, 3);
    expect(parseFloat(stage.style.top)).toBeCloseTo((-py / edge) * 100, 3);
    expect(imgs(stage, '.cs-face').map((i) => i.getAttribute('src'))).toEqual([spriteUrl('haru', 'face-smile')]);
  });

  it('draws silhouettes without blinking', () => {
    vi.useFakeTimers();
    const { container } = render(<CharacterPortrait characterId="ethan" silhouette size={96} />);
    expect((container.firstChild as HTMLElement).classList.contains('cp-portrait--silhouette')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useCrossfade', () => {
  it('keeps the outgoing value for the fade, and snaps when disabled (even mid-fade)', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v, on }) => useCrossfade(v, 100, on), { initialProps: { v: 'a', on: true } });
    rerender({ v: 'b', on: true });
    expect(result.current).toEqual({ current: 'b', previous: 'a' });
    rerender({ v: 'b', on: false });
    expect(result.current).toEqual({ current: 'b', previous: null });
    // switching back on does not bring the dropped outgoing value back
    rerender({ v: 'b', on: true });
    expect(result.current).toEqual({ current: 'b', previous: null });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.previous).toBeNull();
    rerender({ v: 'c', on: false });
    expect(result.current).toEqual({ current: 'c', previous: null });
    expect(vi.getTimerCount()).toBe(0);
    rerender({ v: 'd', on: true });
    expect(result.current).toEqual({ current: 'd', previous: 'c' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toEqual({ current: 'd', previous: null });
  });
});

/** Class names that start a CSS animation (loops, pop-ins, crossfades). */
const ANIMATED_CLASS = /\b(cs-(sparkle|shock|face-in|breathe)|bg-(drift|twinkle|rain__fall)|sp-(fall|sway|spin))\b/;

function animatedElements(root: ParentNode): string[] {
  return [...root.querySelectorAll('[class]')].map((el) => el.getAttribute('class')!).filter((c) => ANIMATED_CLASS.test(c));
}

describe('still thumbnails', () => {
  it('CharacterPortrait still: no blink timer, no looping symbols, no crossfade', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CharacterPortrait characterId="haru" expression="happy" size={120} still />);
    expect(vi.getTimerCount()).toBe(0);
    const root = container.firstChild as HTMLElement;
    expect(root.classList.contains('cp-portrait--still')).toBe(true);
    // the sparkles are still drawn (the frame looks complete), just not animated
    expect(container.querySelectorAll('[data-part="symbols"] path')).toHaveLength(3);
    expect(animatedElements(container)).toEqual([]);
    for (const expression of ['troubled', 'surprised', 'neutral'] as const) {
      rerender(<CharacterPortrait characterId="haru" expression={expression} size={120} still />);
      expect(container.querySelectorAll('.cs-expr')).toHaveLength(1);
      expect(container.querySelectorAll('.cs-face-out, .cs-face-in')).toHaveLength(0);
      expect(animatedElements(container)).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    }
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector('.cs-root')!.hasAttribute('data-blink')).toBe(false);
  });

  it('CharacterPortrait without still keeps blinking and animating', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CharacterPortrait characterId="haru" expression="smile" size={120} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // blink scheduled
    rerender(<CharacterPortrait characterId="haru" expression="happy" size={120} />);
    expect(container.querySelectorAll('.cs-face-out')).not.toHaveLength(0);
    expect(container.querySelectorAll('.cs-sparkle')).not.toHaveLength(0);
  });

  it('EndingBackground still: no petal overlay and every animation switched off', () => {
    for (const ending of ENDING_IDS) {
      const { container, unmount } = render(<EndingBackground ending={ending} still />);
      const layer = container.querySelector('.bg-layer')!;
      expect(layer.classList.contains('bg-still')).toBe(true);
      expect(container.querySelector('.sp-layer')).toBeNull();
      expect(animatedElements(container)).toEqual([]);
      // the scene itself is complete
      expect(imgs(layer, '.bg-layer__img').map((i) => i.getAttribute('src'))).toEqual([backgroundUrl(`ending-${ending}`)]);
      unmount();
    }
    // the rules that hold every descendant still
    const css = readText;
    expect(css('./backgrounds/Backgrounds.css')).toMatch(/\.bg-still \*\s*\{\s*animation:\s*none !important;\s*\}/);
    expect(css('./characters/CharacterSprite.css')).toMatch(/\.cp-portrait--still \*\s*\{\s*animation:\s*none !important;\s*\}/);
  });

  it('EndingBackground keeps its petals and effects when animated', () => {
    const { container } = render(<EndingBackground ending="offer" />);
    expect(container.querySelector('.bg-layer')!.classList.contains('bg-still')).toBe(false);
    expect(container.querySelectorAll('.sp-fall')).toHaveLength(16);
    cleanup();
    const rain = render(<EndingBackground ending="rejected" />);
    expect(rain.container.querySelectorAll('.bg-rain__fall')).toHaveLength(2);
    cleanup();
    const perfect = render(<EndingBackground ending="perfect" />);
    expect(perfect.container.querySelectorAll('.bg-twinkle').length).toBeGreaterThan(5);
  });
});

describe('backgrounds', () => {
  it('OfficeBackground stacks the day and evening paintings and crossfades by class', () => {
    const { container, rerender } = render(<OfficeBackground characterId="ethan" />);
    const layer = () => container.querySelector('.bg-layer') as HTMLElement;
    expect(layer().getAttribute('data-testid')).toBe('bg-office-ethan-day');
    expect(imgs(layer(), '.bg-layer__img').map((i) => i.getAttribute('src'))).toEqual([
      backgroundUrl('office-ethan-day'),
      backgroundUrl('office-ethan-evening'),
    ]);
    // the evening painting and its veil fade in together (gradients cannot be transitioned)
    const evening = layer().querySelector('.bg-office__evening')!;
    expect(evening.querySelector('.bg-veil--office-evening')).not.toBeNull();
    expect(evening.querySelector('img')!.getAttribute('src')).toBe(backgroundUrl('office-ethan-evening'));
    expect(layer().classList.contains('bg-office--day')).toBe(true);
    rerender(<OfficeBackground characterId="ethan" variant="evening" />);
    expect(layer().getAttribute('data-testid')).toBe('bg-office-ethan-evening');
    expect(layer().classList.contains('bg-office--evening')).toBe(true);
  });

  it('title and lobby are decorative, non-interactive layers', () => {
    for (const el of [<TitleBackground key="t" />, <LobbyBackground key="l" />]) {
      const { container, unmount } = render(el);
      const layer = container.querySelector('.bg-layer')!;
      expect(layer.getAttribute('aria-hidden')).toBe('true');
      expect(imgs(layer, 'img').every((i) => i.getAttribute('alt') === '')).toBe(true);
      unmount();
    }
  });
});

describe('SakuraPetals', () => {
  it('renders nothing under reduced motion', () => {
    const { container } = render(<SakuraPetals reduceMotion />);
    expect(container.innerHTML).toBe('');
  });

  it('is deterministic and respects count', () => {
    expect(petalParams(6)).toEqual(petalParams(6));
    const { container } = render(<SakuraPetals count={7} />);
    expect(container.querySelectorAll('.sp-fall')).toHaveLength(7);
  });

  it('seeded random is repeatable', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
