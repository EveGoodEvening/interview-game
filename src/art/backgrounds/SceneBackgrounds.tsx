/** Title, lobby and ending backgrounds. */
import { memo } from 'react';
import type { EndingId } from '../../types';
import { n } from '../lib/geom';
import { mulberry32, between } from '../lib/random';
import { SakuraPetals } from '../effects/SakuraPetals';
import { BG_H, BG_W, BgFrame, Bokeh, Cloud, Plant, SakuraBranch, Skyline, Sparkles, VGradient, Vignette, scatter } from './scenery';

// ───────────────────────── Title ─────────────────────────

const TITLE_BOKEH = scatter(5, 8, 80, 60, 1200, 520, 16, 44);

const TitleScene = memo(function TitleScene({ uid }: { uid: string }) {
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-sky`}
          stops={[
            [0, '#a9c8fb'],
            [0.42, '#f3d6ec'],
            [0.72, '#ffe6ee'],
            [1, '#fff4ef'],
          ]}
        />
        <radialGradient id={`${uid}-sun`}>
          <stop offset="0" stopColor="#fffbe8" stopOpacity="0.95" />
          <stop offset="0.4" stopColor="#fff1d6" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffe6ee" stopOpacity="0" />
        </radialGradient>
        <VGradient
          id={`${uid}-tower`}
          stops={[
            [0, '#cfc4ee'],
            [1, '#b9aee0'],
          ]}
        />
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-sky)`} />
      <circle cx={880} cy={250} r={320} fill={`url(#${uid}-sun)`} />
      <g className="bg-drift bg-drift--slow">
        <Cloud x={180} y={140} s={1.1} opacity={0.75} />
        <Cloud x={620} y={90} s={0.8} opacity={0.6} />
        <Cloud x={1080} y={170} s={1} opacity={0.7} />
      </g>
      <g className="bg-drift bg-drift--slower">
        <Cloud x={420} y={230} s={0.6} opacity={0.5} />
        <Cloud x={960} y={300} s={0.55} opacity={0.45} />
      </g>
      <g className="bg-parallax-far">
        <Skyline seed={7} x0={-40} x1={1320} baseY={580} minH={60} maxH={170} fill="#ddd2f0" />
        {/* the office tower */}
        <g>
          <rect x={742} y={168} width={132} height={420} fill={`url(#${uid}-tower)`} />
          <path d="M 742 168 L 808 128 L 874 168 Z" fill="#c6bbea" />
          <rect x={804} y={96} width={6} height={34} fill="#c6bbea" />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={752 + i * 20} y={180} width={10} height={400} fill="#e4dcf7" opacity={0.6} />
          ))}
          <path d="M 742 168 L 790 168 L 742 300 Z" fill="#ffffff" opacity={0.3} />
          <rect x={890} y={262} width={96} height={326} fill="#c3b8e6" />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={898} y={272 + i * 26} width={80} height={10} fill="#ddd4f5" opacity={0.7} />
          ))}
        </g>
      </g>
      <g className="bg-parallax-near">
        <Skyline seed={11} x0={-60} x1={1340} baseY={620} minH={40} maxH={120} minW={50} maxW={110} fill="#cabde6" windows={{ color: '#f3edff', chance: 0.2, opacity: 0.7 }} />
        {/* blossoming park along the bottom */}
        {Array.from({ length: 11 }, (_, i) => {
          const r = mulberry32(100 + i);
          const x = -40 + i * 132 + between(r, -20, 20);
          const y = 628 + between(r, -14, 10);
          const s = between(r, 0.8, 1.2);
          return (
            <g key={i} transform={`translate(${n(x)} ${n(y)}) scale(${n(s)})`}>
              <rect x={-5} y={10} width={10} height={60} fill="#a98590" />
              <circle cx={-34} cy={8} r={42} fill="#ffc9dc" />
              <circle cx={28} cy={0} r={48} fill="#ffd6e5" />
              <circle cx={0} cy={-26} r={44} fill="#ffe0eb" />
              <circle cx={40} cy={30} r={30} fill="#ffbcd4" />
            </g>
          );
        })}
        <rect x={0} y={680} width={BG_W} height={40} fill="#ffd6e5" />
      </g>
      <Bokeh uid={uid} dots={TITLE_BOKEH} colors={['#ffffff', '#fff6fa']} />
      {/* framing branches */}
      <g className="bg-sway">
        <SakuraBranch
          seed={21}
          spine="M -40 40 C 60 60 160 70 260 120 C 320 150 380 150 440 140"
          twigs={['M 160 76 C 180 40 200 20 230 10', 'M 300 138 C 320 180 330 200 350 220', 'M 90 58 C 100 100 96 130 110 160']}
          clusters={[
            [40, 40, 50],
            [140, 70, 46],
            [236, 20, 34],
            [260, 120, 44],
            [350, 206, 32],
            [110, 160, 34],
            [430, 140, 36],
            [10, 110, 40],
          ]}
        />
      </g>
      <g className="bg-sway bg-sway--alt">
        <SakuraBranch
          seed={33}
          spine="M 1320 20 C 1220 50 1140 60 1060 100 C 1000 130 940 130 880 118"
          twigs={['M 1140 62 C 1130 100 1136 130 1120 160', 'M 1010 118 C 996 80 980 60 960 44']}
          clusters={[
            [1250, 40, 52],
            [1160, 70, 46],
            [1060, 100, 44],
            [1120, 160, 34],
            [960, 44, 32],
            [890, 118, 34],
            [1270, 120, 40],
          ]}
        />
      </g>
    </g>
  );
});

export function TitleBackground() {
  return (
    <BgFrame className="bg-title" testId="bg-title">
      {(uid) => (
        <>
          <TitleScene uid={uid} />
          <rect width={BG_W} height={BG_H} fill="#ffffff" opacity={0.06} />
        </>
      )}
    </BgFrame>
  );
}

// ───────────────────────── Lobby ─────────────────────────

const LOBBY_BOKEH = scatter(9, 9, 60, 60, 1220, 520, 26, 70);
const LOBBY_WINDOWS = [150, 520, 890];

/** Arched window: rectangle with a semicircular top (absolute path). */
function archPath(x: number, y: number, w: number, h: number): string {
  const r = w / 2;
  return `M ${x} ${y + h} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
}

const LobbyScene = memo(function LobbyScene({ uid }: { uid: string }) {
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-bg`}
          stops={[
            [0, '#fbf1f5'],
            [0.55, '#f3edfa'],
            [1, '#ece5f8'],
          ]}
        />
        <VGradient
          id={`${uid}-sky`}
          stops={[
            [0, '#cfe6ff'],
            [0.65, '#eef5ff'],
            [1, '#fdeef5'],
          ]}
        />
        <VGradient
          id={`${uid}-shaft`}
          stops={[
            [0, '#ffffff', 0.7],
            [1, '#ffffff', 0],
          ]}
        />
        <VGradient
          id={`${uid}-floor`}
          stops={[
            [0, '#e6ddf4'],
            [1, '#f6f1fb'],
          ]}
        />
        <VGradient
          id={`${uid}-reflect`}
          stops={[
            [0, '#ffffff', 0.55],
            [1, '#ffffff', 0],
          ]}
        />
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-bg)`} />
      {/* wall panels */}
      <g stroke="#eadff3" strokeWidth={2} fill="none">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={20 + i * 370} y={40} width={330} height={500} rx={14} />
        ))}
      </g>
      {LOBBY_WINDOWS.map((x) => (
        <g key={x}>
          <path d={archPath(x - 10, 60, 250, 490)} fill="#ffffff" opacity={0.85} />
          <path d={archPath(x, 70, 230, 480)} fill={`url(#${uid}-sky)`} />
          <g opacity={0.7}>
            <Cloud x={x + 80} y={200} s={0.55} opacity={0.9} />
            <Cloud x={x + 170} y={300} s={0.4} opacity={0.7} />
          </g>
          <g stroke="#ffffff" strokeWidth={6} opacity={0.9}>
            <line x1={x + 115} y1={70} x2={x + 115} y2={550} />
            <line x1={x} y1={300} x2={x + 230} y2={300} />
          </g>
          {/* reflection on the polished floor */}
          <rect x={x} y={566} width={230} height={120} fill={`url(#${uid}-reflect)`} opacity={0.6} />
        </g>
      ))}
      <rect x={0} y={556} width={BG_W} height={164} fill={`url(#${uid}-floor)`} />
      {LOBBY_WINDOWS.map((x) => (
        <rect key={x} x={x} y={566} width={230} height={110} fill={`url(#${uid}-reflect)`} opacity={0.55} />
      ))}
      <rect x={0} y={548} width={BG_W} height={10} fill="#f8f3fc" />
      <line x1={0} y1={558} x2={BG_W} y2={558} stroke="#ddd0ee" strokeWidth={2} />
      {/* light shafts */}
      {LOBBY_WINDOWS.map((x) => (
        <path key={x} d={`M ${x} 80 L ${x + 230} 80 L ${x + 420} 720 L ${x + 120} 720 Z`} fill={`url(#${uid}-shaft)`} opacity={0.35} />
      ))}
      <g opacity={0.75}>
        <Plant x={62} y={600} s={0.9} pot="#fbf7ff" potLine="#dcd0ec" leaf="#b9dfc4" leafDark="#9dcfae" />
        <Plant x={1220} y={600} s={0.9} pot="#fbf7ff" potLine="#dcd0ec" leaf="#b9dfc4" leafDark="#9dcfae" />
      </g>
      <Bokeh uid={uid} dots={LOBBY_BOKEH} colors={['#ffffff', '#ffe1ec', '#fff4d6']} />
      <rect width={BG_W} height={BG_H} fill="#ffffff" opacity={0.18} />
    </g>
  );
});

export function LobbyBackground() {
  return <BgFrame className="bg-lobby" testId="bg-lobby">{(uid) => <LobbyScene uid={uid} />}</BgFrame>;
}

// ───────────────────────── Endings ─────────────────────────

export interface EndingBackgroundProps {
  ending: EndingId;
  /**
   * A static frame for thumbnails (Records, Gallery grid): no CSS animations (clouds, rays,
   * sparkles, bokeh, rain hold their resting pose) and no falling-petal overlay.
   */
  still?: boolean;
}

const GOLD_SPARKLES = scatter(41, 26, 40, 30, 1240, 690, 6, 16);
const GOLD_BOKEH = scatter(43, 14, 40, 40, 1240, 680, 30, 90);

const Perfect = memo(function Perfect({ uid }: { uid: string }) {
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a0 = ((i * 22.5 - 4) * Math.PI) / 180;
    const a1 = ((i * 22.5 + 4) * Math.PI) / 180;
    const R = 1400;
    return `M 0 0 L ${n(Math.cos(a0) * R)} ${n(Math.sin(a0) * R)} L ${n(Math.cos(a1) * R)} ${n(Math.sin(a1) * R)} Z`;
  });
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-g`}
          stops={[
            [0, '#fff7df'],
            [0.5, '#ffe3a1'],
            [1, '#ffc977'],
          ]}
        />
        <radialGradient id={`${uid}-core`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#fff4cf" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff4cf" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-g)`} />
      <g transform="translate(640 120)">
        <g className="bg-spin">
          {rays.map((d, i) => (
            <path key={i} d={d} fill="#ffffff" opacity={0.22} />
          ))}
        </g>
      </g>
      <circle cx={640} cy={120} r={420} fill={`url(#${uid}-core)`} />
      <Bokeh uid={uid} dots={GOLD_BOKEH} colors={['#ffffff', '#fff1b8', '#ffd98a']} />
      <Sparkles dots={GOLD_SPARKLES} />
    </g>
  );
});

const Offer = memo(function Offer({ uid }: { uid: string }) {
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-g`}
          stops={[
            [0, '#86cdfb'],
            [0.55, '#d4efff'],
            [1, '#fff6fa'],
          ]}
        />
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-g)`} />
      <circle cx={1060} cy={130} r={70} fill="#ffffff" opacity={0.7} />
      <circle cx={1060} cy={130} r={140} fill="#ffffff" opacity={0.18} />
      <g className="bg-drift bg-drift--slow">
        <Cloud x={200} y={150} s={1.2} opacity={0.95} />
        <Cloud x={700} y={110} s={0.9} opacity={0.9} />
        <Cloud x={500} y={260} s={0.6} opacity={0.75} />
      </g>
      <Skyline seed={51} x0={-40} x1={1320} baseY={600} minH={60} maxH={150} fill="#cfe2f4" windows={{ color: '#ffffff', chance: 0.2, opacity: 0.8 }} />
      <path d="M 0 600 C 240 560 460 590 700 580 C 940 570 1100 560 1280 590 L 1280 720 L 0 720 Z" fill="#c8ebb6" />
      <path d="M 0 650 C 300 620 600 660 900 640 C 1080 630 1180 640 1280 650 L 1280 720 L 0 720 Z" fill="#b2e0a0" />
      <SakuraBranch
        seed={61}
        spine="M -40 60 C 60 80 160 100 260 150 C 320 180 380 170 420 160"
        twigs={['M 160 96 C 180 60 200 40 230 30']}
        clusters={[
          [40, 60, 52],
          [150, 96, 46],
          [236, 36, 34],
          [270, 150, 44],
          [400, 160, 34],
          [20, 140, 40],
        ]}
      />
      <SakuraBranch
        seed={62}
        spine="M 1320 420 C 1240 440 1180 470 1130 520"
        clusters={[
          [1260, 420, 50],
          [1180, 460, 44],
          [1130, 520, 36],
          [1270, 500, 40],
        ]}
      />
    </g>
  );
});

const Pending = memo(function Pending({ uid }: { uid: string }) {
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-g`}
          stops={[
            [0, '#8c90b8'],
            [0.5, '#c8a9bf'],
            [0.85, '#f0c7a6'],
            [1, '#f6d6b8'],
          ]}
        />
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-g)`} />
      <circle cx={900} cy={520} r={60} fill="#ffe2c2" opacity={0.6} />
      <g className="bg-drift bg-drift--slower">
        <Cloud x={180} y={120} s={1.6} fill="#a9a7c9" opacity={0.85} />
        <Cloud x={620} y={80} s={1.3} fill="#b6b0cf" opacity={0.8} />
        <Cloud x={1080} y={150} s={1.5} fill="#a5a2c4" opacity={0.85} />
      </g>
      <g className="bg-drift bg-drift--slow">
        <Cloud x={380} y={260} s={1.1} fill="#c9b7cc" opacity={0.7} />
        <Cloud x={920} y={320} s={1} fill="#d4bcc8" opacity={0.7} />
      </g>
      <Skyline seed={71} x0={-40} x1={1320} baseY={600} minH={80} maxH={220} fill="#7d7a9e" windows={{ color: '#ffe0a8', chance: 0.12, opacity: 0.8 }} />
      <Skyline seed={73} x0={-60} x1={1340} baseY={640} minH={40} maxH={120} minW={50} maxW={110} fill="#66648a" windows={{ color: '#ffd98a', chance: 0.18, opacity: 0.85 }} />
      <rect x={0} y={640} width={BG_W} height={80} fill="#5a5880" />
      <rect width={BG_W} height={BG_H} fill="#ffffff" opacity={0.06} />
    </g>
  );
});

/** Rain falls along (−RAIN_SLANT, 1); one loop moves a full screen height (see .bg-rain in CSS). */
const RAIN_SLANT = 0.22;
/** Horizontal travel of one loop; the second copy starts offset by this so the loop is seamless. */
const RAIN_DX = Math.round(BG_H * RAIN_SLANT);

function rainStreaks(seed: number, count: number, len: number): string {
  const rand = mulberry32(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = between(rand, -200, BG_W + 220);
    const y = between(rand, 0, BG_H);
    const l = len * between(rand, 0.6, 1.2);
    d += `M ${n(x)} ${n(y)} L ${n(x - l * RAIN_SLANT)} ${n(y + l)} `;
  }
  return d;
}

const RAIN_FAR = rainStreaks(81, 90, 26);
const RAIN_NEAR = rainStreaks(83, 50, 46);

const Rejected = memo(function Rejected({ uid }: { uid: string }) {
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-g`}
          stops={[
            [0, '#1f2849'],
            [0.6, '#34426e'],
            [1, '#4b5b88'],
          ]}
        />
        <radialGradient id={`${uid}-lamp`}>
          <stop offset="0" stopColor="#ffe3a3" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffe3a3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-g)`} />
      <Skyline seed={91} x0={-40} x1={1320} baseY={600} minH={100} maxH={260} fill="#2a3358" windows={{ color: '#ffd98a', chance: 0.08, opacity: 0.6 }} />
      <Skyline seed={93} x0={-60} x1={1340} baseY={630} minH={50} maxH={140} minW={50} maxW={110} fill="#222a4a" windows={{ color: '#ffe3a3', chance: 0.12, opacity: 0.75 }} />
      <rect x={0} y={630} width={BG_W} height={90} fill="#1e2542" />
      {/* street lamp */}
      <g>
        <rect x={1046} y={380} width={8} height={250} fill="#141a31" />
        <path d="M 1030 380 L 1070 380 L 1062 364 L 1038 364 Z" fill="#141a31" />
        <circle cx={1050} cy={392} r={150} fill={`url(#${uid}-lamp)`} />
        <ellipse cx={1050} cy={660} rx={120} ry={14} fill="#ffe3a3" opacity={0.2} />
      </g>
      {/* puddle reflections */}
      <g stroke="#8fa3d6" strokeWidth={3} strokeLinecap="round" opacity={0.35}>
        {[
          [120, 660, 80],
          [380, 690, 120],
          [700, 668, 90],
          [930, 700, 60],
          [1150, 676, 70],
        ].map(([x, y, w]) => (
          <line key={x} x1={x} y1={y} x2={x + w} y2={y} />
        ))}
      </g>
      <g className="bg-rain bg-rain--far" stroke="#b9c8f0" strokeWidth={1.4} strokeLinecap="round" opacity={0.45}>
        <path d={RAIN_FAR} />
        <path d={RAIN_FAR} transform={`translate(${RAIN_DX} ${-BG_H})`} />
      </g>
      <g className="bg-rain bg-rain--near" stroke="#d6e0ff" strokeWidth={2} strokeLinecap="round" opacity={0.5}>
        <path d={RAIN_NEAR} />
        <path d={RAIN_NEAR} transform={`translate(${RAIN_DX} ${-BG_H})`} />
      </g>
      <rect width={BG_W} height={BG_H} fill="#7d8fc4" opacity={0.08} />
    </g>
  );
});

const ENDING_PETALS: Record<EndingId, number> = { perfect: 8, offer: 16, pending: 0, rejected: 0 };

export function EndingBackground({ ending, still = false }: EndingBackgroundProps) {
  const petals = still ? 0 : ENDING_PETALS[ending];
  return (
    <BgFrame
      className={`bg-ending bg-ending--${ending}${still ? ' bg-still' : ''}`}
      testId={`bg-ending-${ending}`}
      overlay={petals > 0 ? <SakuraPetals count={petals} /> : null}
    >
      {(uid) => (
        <>
          {ending === 'perfect' && <Perfect uid={uid} />}
          {ending === 'offer' && <Offer uid={uid} />}
          {ending === 'pending' && <Pending uid={uid} />}
          {ending === 'rejected' && <Rejected uid={uid} />}
          <Vignette uid={uid} strength={ending === 'rejected' ? 0.3 : 0.14} />
        </>
      )}
    </BgFrame>
  );
}

