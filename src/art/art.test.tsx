// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_IDS, ENDING_IDS, EXPRESSIONS } from '../types';
import { EndingBackground, LobbyBackground, OfficeBackground, TitleBackground } from './backgrounds/Backgrounds';
import { CharacterPortrait, CharacterSprite } from './characters/CharacterSprite';
import { DESIGNS } from './characters/designs';
import { useCrossfade } from './characters/hooks/useCrossfade';
import { mouthLevelFor } from './characters/hooks/useMouthDriver';
import { SakuraPetals, petalParams } from './effects/SakuraPetals';
import { mirrorPath } from './lib/geom';
import { mulberry32 } from './lib/random';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Every url(#id) used in the document must point at an element that exists, and ids must be unique. */
function checkSvgReferences(root: ParentNode) {
  const ids = [...root.querySelectorAll('[id]')].map((el) => el.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  expect(dupes).toEqual([]);
  const idSet = new Set(ids);
  const missing: string[] = [];
  for (const el of root.querySelectorAll('*')) {
    for (const attr of ['fill', 'stroke', 'clip-path', 'mask', 'filter']) {
      const v = el.getAttribute(attr);
      const m = v?.match(/^url\(#(.+)\)$/);
      if (m && !idSet.has(m[1])) missing.push(`${attr}=${v}`);
    }
  }
  expect(missing).toEqual([]);
}

describe('CharacterSprite', () => {
  it.each(CHARACTER_IDS)('renders every expression for %s', (id) => {
    for (const expression of EXPRESSIONS) {
      const { container, unmount } = render(<CharacterSprite characterId={id} expression={expression} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 600 800');
      expect(svg.querySelectorAll('.cs-mouth')).toHaveLength(4);
      expect(svg.getAttribute('data-expression')).toBe(expression);
      unmount();
    }
  });

  it('keeps SVG ids unique and resolvable with many instances on screen', () => {
    const { container } = render(
      <div>
        {CHARACTER_IDS.map((id) => (
          <CharacterSprite key={id} characterId={id} expression="happy" dimmed />
        ))}
        <CharacterSprite characterId="yuki" expression="troubled" />
        <CharacterPortrait characterId="ethan" />
        <CharacterPortrait characterId="ethan" expression="serious" shape="rounded" />
        <CharacterPortrait characterId="haru" silhouette />
        <OfficeBackground characterId="yuki" />
        <OfficeBackground characterId="ethan" variant="evening" />
        <OfficeBackground characterId="haru" />
        <TitleBackground />
        <LobbyBackground />
        {ENDING_IDS.map((e) => (
          <EndingBackground key={e} ending={e} />
        ))}
      </div>,
    );
    checkSvgReferences(container);
  });

  it('crossfades expressions and settles on the new one', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CharacterSprite characterId="haru" expression="neutral" />);
    rerender(<CharacterSprite characterId="haru" expression="surprised" />);
    expect(container.querySelectorAll('.cs-face-out')).not.toHaveLength(0);
    expect(container.querySelectorAll('.cs-face-in')).not.toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelectorAll('.cs-face-out')).toHaveLength(0);
    checkSvgReferences(container);
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
});

describe('mouthLevelFor', () => {
  it('maps amplitude to four shapes', () => {
    expect([0, 0.05, 0.1, 0.3, 0.6, 1, Number.NaN].map(mouthLevelFor)).toEqual([0, 0, 1, 2, 3, 3, 0]);
  });
});

describe('CharacterPortrait', () => {
  it('crops the same drawing into a square viewBox', () => {
    const { container } = render(<CharacterPortrait characterId="haru" size={64} />);
    const [, , w, h] = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBe(h);
    expect(w).toBe(DESIGNS.haru.portraitCrop[2]);
    expect((container.firstChild as HTMLElement).style.width).toBe('64px');
  });
});

describe('brows over the bangs (see-through hair)', () => {
  /** Opacity where every band overlaps (right at the brow edge). */
  const peakOpacity = (ops: number[]) => 1 - ops.reduce((acc, o) => acc * (1 - o), 1);

  it.each(CHARACTER_IDS)('%s: a tight, brow-shaped, skin-tinted window clipped to the front hair — no glow blob or light rim', (id) => {
    const design = DESIGNS[id];
    for (const expression of EXPRESSIONS) {
      const { container, unmount } = render(<CharacterSprite characterId={id} expression={expression} />);
      const brows = container.querySelector('[data-part="brows"]')!;
      // the old look: a blurry radial-gradient ellipse per brow and a pale halo stroke on the brow
      expect(brows.querySelectorAll('ellipse')).toHaveLength(0);
      expect(container.querySelector('[id$="-browglow"]')).toBeNull();
      const fill = brows.lastElementChild!;
      expect(fill.getAttribute('fill')).toBe(design.brows.color);
      expect(fill.hasAttribute('stroke')).toBe(false);
      const browDs = [...fill.querySelectorAll('path')].map((p) => p.getAttribute('d'));
      expect(browDs).toHaveLength(2);

      // the see-through window: the forehead's shadow tone, only where the bangs are
      const see = brows.querySelector('[data-part="brows-see-through"]')!;
      expect(see.getAttribute('stroke')).toBe(design.skin.shade);
      expect(see.getAttribute('fill')).toBe('none');
      const clipId = see.getAttribute('clip-path')!.match(/^url\(#(.+)\)$/)![1];
      const clip = container.querySelector(`[id="${clipId}"]`)!;
      expect(clip.tagName.toLowerCase()).toBe('clippath');
      expect([...clip.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(design.bangShadow.shapes);

      // it follows each brow's own outline, reaches at most 4 units past it and stays faint
      const bands = [...see.querySelectorAll('path')];
      expect(bands.length).toBeGreaterThan(0);
      for (const d of browDs) {
        const own = bands.filter((b) => b.getAttribute('d') === d);
        expect(own.length).toBe(bands.length / 2);
        expect(Math.max(...own.map((b) => Number(b.getAttribute('stroke-width')) / 2))).toBeLessThanOrEqual(4);
        const peak = peakOpacity(own.map((b) => Number(b.getAttribute('stroke-opacity'))));
        expect(peak).toBeGreaterThan(0.25); // still reads on Ethan's near-black hair
        expect(peak).toBeLessThanOrEqual(0.4); // never a white smear
      }
      checkSvgReferences(container);
      unmount();
    }
  });

  it('the portrait crop carries the same clip, so thumbnails get the same brows', () => {
    const { container } = render(<CharacterPortrait characterId="yuki" expression="surprised" size={96} />);
    expect(container.querySelector('[data-part="brows-see-through"]')).not.toBeNull();
    checkSvgReferences(container);
  });
});

describe('useCrossfade', () => {
  it('keeps the outgoing value for the fade, and snaps when disabled (even mid-fade)', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v, on }) => useCrossfade(v, 170, on), { initialProps: { v: 'a', on: true } });
    rerender({ v: 'b', on: true });
    expect(result.current).toEqual({ current: 'b', previous: 'a' });
    rerender({ v: 'b', on: false }); // switched off mid-fade: the stale outgoing face goes at once
    expect(result.current).toEqual({ current: 'b', previous: null });
    rerender({ v: 'b', on: true }); // and does not come back when switched on again
    expect(result.current.previous).toBeNull();
    rerender({ v: 'c', on: false });
    expect(result.current).toEqual({ current: 'c', previous: null });
    expect(vi.getTimerCount()).toBe(0);
    rerender({ v: 'd', on: true });
    expect(result.current).toEqual({ current: 'd', previous: 'c' });
    act(() => {
      vi.advanceTimersByTime(170);
    });
    expect(result.current).toEqual({ current: 'd', previous: null });
  });
});

/** Class names that start a CSS animation (loops, pop-ins, crossfades). */
const ANIMATED_CLASS = /\b(cs-(sparkle|sweat|shock|face-in|face-out|bob-body|bob-head)|bg-(drift|parallax-far|parallax-near|sway|float|twinkle|spin|blink|rain)|sp-(fall|sway|spin))\b/;

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
    expect(container.querySelectorAll('[data-part="symbols"] path')).not.toHaveLength(0);
    expect(animatedElements(container)).toEqual([]);
    for (const expression of ['troubled', 'surprised', 'neutral'] as const) {
      rerender(<CharacterPortrait characterId="haru" expression={expression} size={120} still />);
      expect(container.querySelectorAll('.cs-face-out, .cs-face-in')).toHaveLength(0);
      expect(container.querySelectorAll('[data-part="brows"]')).toHaveLength(1);
      expect(animatedElements(container)).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    }
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector('.cs-root')!.hasAttribute('data-blink')).toBe(false);
    checkSvgReferences(container);
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
      // the scene itself is complete (sky, skyline, props)
      expect(layer.querySelectorAll('svg path, svg rect, svg circle').length).toBeGreaterThan(20);
      unmount();
    }
    // the rules that hold every descendant still
    const css = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    const backgroundsCss = css('./backgrounds/Backgrounds.css');
    const spriteCss = css('./characters/CharacterSprite.css');
    expect(backgroundsCss).toMatch(/\.bg-still \*\s*\{\s*animation:\s*none !important;\s*\}/);
    expect(spriteCss).toMatch(/\.cp-portrait--still \*\s*\{\s*animation:\s*none !important;\s*\}/);
  });

  it('EndingBackground keeps its petals when animated', () => {
    const { container } = render(<EndingBackground ending="offer" />);
    expect(container.querySelector('.bg-layer')!.classList.contains('bg-still')).toBe(false);
    expect(container.querySelectorAll('.sp-fall')).toHaveLength(16);
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
});

describe('geometry helpers', () => {
  it('mirrors absolute paths around x = 300', () => {
    expect(mirrorPath('M 200 10 C 210 20 220 30 230 40 L 100 5 Z')).toBe('M 400 10 C 390 20 380 30 370 40 L 500 5 Z');
    expect(() => mirrorPath('m 1 2')).toThrow();
    expect(() => mirrorPath('M 0 0 A 5 5 0 0 1 10 0')).toThrow();
  });

  it('seeded random is repeatable', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
