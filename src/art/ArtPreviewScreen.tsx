/**
 * QA sheet: every character × expression, portraits and backgrounds. Open with ?screen=artPreview.
 * Developer-facing, but still bilingual (labels are local to this file because src/art owns no i18n namespace).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CHARACTERS } from '../characters';
import { useUiLang } from '../i18n';
import { useGameStore } from '../store/game';
import { CHARACTER_IDS, ENDING_IDS, EXPRESSIONS, type CharacterId, type EndingId, type Expression, type Lang } from '../types';
import { EndingBackground, LobbyBackground, OfficeBackground, TitleBackground } from './backgrounds/Backgrounds';
import { CharacterPortrait, CharacterSprite } from './characters/CharacterSprite';
import { SakuraPetals } from './effects/SakuraPetals';
import './ArtPreviewScreen.css';

const L = {
  zh: {
    title: '美术 QA · 立绘与背景',
    back: '返回标题',
    speaking: '说话（口型）',
    dimmed: '变暗',
    level: '口型强度',
    levelAuto: '程序口型',
    featured: '主视图',
    expressions: '全部表情',
    portraits: '头像',
    backgrounds: '背景',
    scenes: '场景合成',
    silhouette: '剪影',
    rounded: '圆角',
    day: '白天',
    evening: '傍晚',
    office: '面试室',
    titleBg: '标题',
    lobby: '大厅',
    ending: '结局',
    petals: '樱花',
    still: '静帧（记录 / 图鉴缩略图）',
    close: '关闭',
  },
  en: {
    title: 'Art QA · Sprites & Backgrounds',
    back: 'Back to title',
    speaking: 'Speaking (lip-sync)',
    dimmed: 'Dimmed',
    level: 'Mouth level',
    levelAuto: 'procedural',
    featured: 'Featured',
    expressions: 'All expressions',
    portraits: 'Portraits',
    backgrounds: 'Backgrounds',
    scenes: 'Scene composites',
    silhouette: 'Silhouette',
    rounded: 'Rounded',
    day: 'day',
    evening: 'evening',
    office: 'Office',
    titleBg: 'Title',
    lobby: 'Lobby',
    ending: 'Ending',
    petals: 'Petals',
    still: 'Still frames (Records / Gallery thumbnails)',
    close: 'Close',
  },
} satisfies Record<Lang, Record<string, string>>;

const EXPRESSION_LABELS: Record<Lang, Record<Expression, string>> = {
  zh: { neutral: '平静', smile: '微笑', happy: '开心', thinking: '思考', serious: '严肃', surprised: '惊讶', troubled: '困扰' },
  en: {
    neutral: 'neutral',
    smile: 'smile',
    happy: 'happy',
    thinking: 'thinking',
    serious: 'serious',
    surprised: 'surprised',
    troubled: 'troubled',
  },
};

const ENDING_LABELS: Record<Lang, Record<EndingId, string>> = {
  zh: { perfect: '完美', offer: '录用', pending: '待定', rejected: '未通过' },
  en: { perfect: 'perfect', offer: 'offer', pending: 'pending', rejected: 'rejected' },
};

/** The interviewer's face on each ending's CG. */
function endingExpression(ending: EndingId): Expression {
  return ending === 'rejected' ? 'troubled' : ending === 'pending' ? 'thinking' : 'happy';
}

const PORTRAIT_SIZES = [32, 48, 64, 96, 128, 180] as const;

function Section({ title, children, qa }: { title: string; children: ReactNode; qa: string }) {
  return (
    <section className="ap-section" data-qa={qa}>
      <h2 className="ap-section__title">{title}</h2>
      {children}
    </section>
  );
}

function Thumb({ label, qa, children, onOpen }: { label: string; qa: string; children: ReactNode; onOpen: (node: ReactNode) => void }) {
  return (
    <figure className="ap-thumb" data-qa={qa}>
      <button type="button" className="ap-thumb__frame" onClick={() => onOpen(children)} aria-label={label}>
        {children}
      </button>
      <figcaption className="ap-thumb__label">{label}</figcaption>
    </figure>
  );
}

export function ArtPreviewScreen() {
  const lang = useUiLang();
  const t = L[lang];
  const navigate = useGameStore((s) => s.navigate);
  const [speaking, setSpeaking] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [featured, setFeatured] = useState<CharacterId>('yuki');
  const [featuredExpr, setFeaturedExpr] = useState<Expression>('smile');
  /** -1 = procedural flapping (no real level); otherwise a fixed level fed through the ref. */
  const [level, setLevel] = useState(-1);
  const levelRef = useRef(0);
  useEffect(() => {
    levelRef.current = level < 0 ? 0 : level;
  }, [level]);

  const lipRef = level < 0 ? undefined : levelRef;
  /** Full-stage view of a clicked thumbnail. */
  const [zoomed, setZoomed] = useState<ReactNode>(null);
  const name = (id: CharacterId) => CHARACTERS[id].name[lang];

  return (
    <div className="ap-screen gg-scroll" data-testid="art-preview">
      <header className="ap-toolbar">
        <h1 className="ap-toolbar__title">{t.title}</h1>
        <label className="ap-toggle">
          <input type="checkbox" checked={speaking} onChange={(e) => setSpeaking(e.target.checked)} data-qa="toggle-speaking" />
          {t.speaking}
        </label>
        <label className="ap-toggle">
          <input type="checkbox" checked={dimmed} onChange={(e) => setDimmed(e.target.checked)} />
          {t.dimmed}
        </label>
        <label className="ap-toggle ap-toggle--range">
          {t.level}
          <input
            type="range"
            min={-0.05}
            max={1}
            step={0.05}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value) < 0 ? -1 : Number(e.target.value))}
          />
          <span className="ap-toggle__value">{level < 0 ? t.levelAuto : level.toFixed(2)}</span>
        </label>
        <button type="button" className="ap-btn" onClick={() => navigate('title')}>
          {t.back}
        </button>
      </header>

      <Section title={t.featured} qa="featured">
        <div className="ap-featured">
          <div className="ap-featured__stage" data-qa="featured-stage">
            <OfficeBackground characterId={featured} />
            <CharacterSprite
              className="ap-featured__sprite"
              characterId={featured}
              expression={featuredExpr}
              speaking={speaking}
              mouthLevelRef={lipRef}
              dimmed={dimmed}
              height={560}
            />
          </div>
          <div className="ap-featured__controls">
            <div className="ap-chips">
              {CHARACTER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ap-chip${id === featured ? ' ap-chip--on' : ''}`}
                  style={{ '--ap-accent': CHARACTERS[id].themeColor } as CSSProperties}
                  onClick={() => setFeatured(id)}
                  data-qa={`pick-${id}`}
                >
                  {name(id)}
                </button>
              ))}
            </div>
            <div className="ap-chips">
              {EXPRESSIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`ap-chip${e === featuredExpr ? ' ap-chip--on' : ''}`}
                  onClick={() => setFeaturedExpr(e)}
                  data-qa={`expr-${e}`}
                >
                  {EXPRESSION_LABELS[lang][e]}
                </button>
              ))}
            </div>
            <div className="ap-featured__portraits">
              <CharacterPortrait characterId={featured} expression={featuredExpr} size={180} />
              <CharacterPortrait characterId={featured} expression={featuredExpr} size={96} shape="rounded" />
            </div>
          </div>
        </div>
      </Section>

      <Section title={t.expressions} qa="expressions">
        {CHARACTER_IDS.map((id) => (
          <div key={id} className="ap-row" data-qa={`row-${id}`}>
            <div className="ap-row__name" style={{ color: CHARACTERS[id].themeColor }}>
              {name(id)}
            </div>
            <div className="ap-row__cells">
              {EXPRESSIONS.map((e) => (
                <figure key={e} className="ap-cell" data-qa={`sprite-${id}-${e}`}>
                  <CharacterSprite characterId={id} expression={e} speaking={speaking} mouthLevelRef={lipRef} dimmed={dimmed} height={228} />
                  <figcaption className="ap-cell__label">{EXPRESSION_LABELS[lang][e]}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title={t.portraits} qa="portraits">
        {CHARACTER_IDS.map((id) => (
          <div key={id} className="ap-portraits" data-qa={`portraits-${id}`}>
            {PORTRAIT_SIZES.map((size) => (
              <CharacterPortrait key={size} characterId={id} size={size} />
            ))}
            <CharacterPortrait characterId={id} size={96} shape="rounded" expression="happy" />
            <CharacterPortrait characterId={id} size={96} expression="serious" />
            <div className="ap-portraits__tagged">
              <CharacterPortrait characterId={id} size={96} silhouette />
              <span>{t.silhouette}</span>
            </div>
          </div>
        ))}
      </Section>

      <Section title={t.backgrounds} qa="backgrounds">
        <div className="ap-grid">
          {CHARACTER_IDS.flatMap((id) =>
            (['day', 'evening'] as const).map((variant) => (
              <Thumb onOpen={setZoomed} key={`${id}-${variant}`} label={`${t.office} · ${name(id)} · ${t[variant]}`} qa={`bg-office-${id}-${variant}`}>
                <OfficeBackground characterId={id} variant={variant} />
              </Thumb>
            )),
          )}
          <Thumb onOpen={setZoomed} label={t.titleBg} qa="bg-title">
            <TitleBackground />
          </Thumb>
          <Thumb onOpen={setZoomed} label={t.lobby} qa="bg-lobby">
            <LobbyBackground />
          </Thumb>
          <Thumb onOpen={setZoomed} label={`${t.lobby} + ${t.petals}`} qa="bg-lobby-petals">
            <LobbyBackground />
            <SakuraPetals count={18} />
          </Thumb>
          {ENDING_IDS.map((ending) => (
            <Thumb onOpen={setZoomed} key={ending} label={`${t.ending} · ${ENDING_LABELS[lang][ending]}`} qa={`bg-ending-${ending}`}>
              <EndingBackground ending={ending} />
            </Thumb>
          ))}
        </div>
      </Section>

      <Section title={t.scenes} qa="scenes">
        <div className="ap-grid">
          {CHARACTER_IDS.map((id) => (
            <Thumb onOpen={setZoomed} key={id} label={`${name(id)} · ${t.office}`} qa={`scene-${id}`}>
              <OfficeBackground characterId={id} />
              <CharacterSprite className="ap-scene__sprite" characterId={id} expression="smile" speaking={speaking} height={236} />
            </Thumb>
          ))}
          {ENDING_IDS.map((ending, i) => {
            const id = CHARACTER_IDS[i % CHARACTER_IDS.length];
            const expr = endingExpression(ending);
            return (
              <Thumb onOpen={setZoomed} key={ending} label={`${name(id)} · ${ENDING_LABELS[lang][ending]}`} qa={`scene-ending-${ending}`}>
                <EndingBackground ending={ending} />
                <CharacterSprite className="ap-scene__sprite" characterId={id} expression={expr} height={236} />
              </Thumb>
            );
          })}
        </div>
      </Section>

      <Section title={t.still} qa="still">
        <div className="ap-grid">
          {ENDING_IDS.map((ending, i) => {
            const id = CHARACTER_IDS[i % CHARACTER_IDS.length];
            return (
              <Thumb onOpen={setZoomed} key={ending} label={`${name(id)} · ${ENDING_LABELS[lang][ending]}`} qa={`still-ending-${ending}`}>
                <EndingBackground ending={ending} still />
                <CharacterPortrait className="ap-still__portrait" characterId={id} expression={endingExpression(ending)} size={120} shape="rounded" still />
              </Thumb>
            );
          })}
        </div>
        {CHARACTER_IDS.map((id) => (
          <div key={id} className="ap-portraits" data-qa={`still-portraits-${id}`}>
            {EXPRESSIONS.map((e) => (
              <CharacterPortrait key={e} characterId={id} expression={e} size={96} still />
            ))}
          </div>
        ))}
      </Section>

      {zoomed !== null && (
        <button type="button" className="ap-zoom" data-qa="zoom" onClick={() => setZoomed(null)} aria-label={t.close}>
          {zoomed}
        </button>
      )}
    </div>
  );
}
