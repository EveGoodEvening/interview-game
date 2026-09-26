/**
 * Interview room. Shared layout (window on the left, décor on the right, quiet wall
 * behind the interviewer's head), dressed per company, with a sunset "evening" variant.
 */
import { memo } from 'react';
import type { CharacterId } from '../../types';
import { BG_H, BG_W, BgFrame, Cloud, Plant, Skyline, VGradient, Vignette } from './scenery';

export interface OfficeBackgroundProps {
  /** Each company has its own room décor. */
  characterId: CharacterId;
  /** Time of day shifts the palette (e.g. evening for the closing). */
  variant?: 'day' | 'evening';
}

type Variant = 'day' | 'evening';

interface RoomTheme {
  wall: string;
  wallLow: string;
  ceiling: string;
  floor: string;
  floorLine: string;
  baseboard: string;
  frame: string;
  frameDark: string;
}

const THEMES: Record<CharacterId, RoomTheme> = {
  yuki: {
    wall: '#f6e5dd',
    wallLow: '#f0d9cf',
    ceiling: '#fbefe9',
    floor: '#e7cfb6',
    floorLine: '#d8bb9e',
    baseboard: '#fff7f1',
    frame: '#fffaf6',
    frameDark: '#e0c7bb',
  },
  ethan: {
    wall: '#dfe5ec',
    wallLow: '#d3dbe5',
    ceiling: '#eef2f6',
    floor: '#bcc5d0',
    floorLine: '#aab4c1',
    baseboard: '#eef2f6',
    frame: '#f4f7fa',
    frameDark: '#b8c3cf',
  },
  haru: {
    wall: '#f5f0e9',
    wallLow: '#ede5da',
    ceiling: '#fbf8f3',
    floor: '#dcc9ae',
    floorLine: '#cbb392',
    baseboard: '#fbf8f3',
    frame: '#454a57',
    frameDark: '#2f333d',
  },
};

const WIN = { x: 70, y: 74, w: 500, h: 392 };

// ───────────────────────── window view ─────────────────────────

const WindowView = memo(function WindowView({ uid, variant, seed }: { uid: string; variant: Variant; seed: number }) {
  const eve = variant === 'evening';
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-sky`}
          stops={
            eve
              ? [
                  [0, '#6f63ad'],
                  [0.45, '#e592a6'],
                  [0.8, '#ffc27c'],
                  [1, '#ffd9a0'],
                ]
              : [
                  [0, '#9fd0fb'],
                  [0.7, '#d9eeff'],
                  [1, '#f1f8ff'],
                ]
          }
        />
        <clipPath id={`${uid}-win`}>
          <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-win)`}>
        <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} fill={`url(#${uid}-sky)`} />
        {eve ? (
          <circle cx={430} cy={392} r={46} fill="#fff1c9" opacity={0.85} />
        ) : (
          <>
            <Cloud x={180} y={150} s={0.8} opacity={0.85} />
            <Cloud x={430} y={120} s={0.6} opacity={0.7} />
          </>
        )}
        <Skyline
          seed={seed}
          x0={WIN.x - 20}
          x1={WIN.x + WIN.w + 20}
          baseY={WIN.y + WIN.h}
          minH={90}
          maxH={210}
          fill={eve ? '#9a86b6' : '#c3d3e4'}
          windows={eve ? { color: '#ffe3a3', chance: 0.18, opacity: 0.7 } : undefined}
        />
        <Skyline
          seed={seed + 3}
          x0={WIN.x - 30}
          x1={WIN.x + WIN.w + 30}
          baseY={WIN.y + WIN.h}
          minH={40}
          maxH={130}
          minW={50}
          maxW={110}
          fill={eve ? '#6f5f93' : '#a8bdd3'}
          windows={eve ? { color: '#ffd98a', chance: 0.28, opacity: 0.85 } : { color: '#e8f2fb', chance: 0.25, opacity: 0.8 }}
        />
        {/* glass reflection */}
        <path d={`M ${WIN.x + 40} ${WIN.y} L ${WIN.x + 150} ${WIN.y} L ${WIN.x + 30} ${WIN.y + WIN.h} L ${WIN.x - 80} ${WIN.y + WIN.h} Z`} fill="#ffffff" opacity={0.12} />
        <path d={`M ${WIN.x + 190} ${WIN.y} L ${WIN.x + 230} ${WIN.y} L ${WIN.x + 110} ${WIN.y + WIN.h} L ${WIN.x + 70} ${WIN.y + WIN.h} Z`} fill="#ffffff" opacity={0.1} />
      </g>
    </g>
  );
});

// ───────────────────────── per-company window treatment ─────────────────────────

function WindowFrame({ theme, style }: { theme: RoomTheme; style: 'curtains' | 'blinds' | 'grid' }) {
  const { x, y, w, h } = WIN;
  if (style === 'grid') {
    const cols = [x + w / 4, x + w / 2, x + (3 * w) / 4];
    const rows = [y + h / 3, y + (2 * h) / 3];
    return (
      <g fill="none" stroke={theme.frame} strokeLinecap="square">
        <rect x={x} y={y} width={w} height={h} strokeWidth={12} />
        {cols.map((cx) => (
          <line key={cx} x1={cx} y1={y} x2={cx} y2={y + h} strokeWidth={6} />
        ))}
        {rows.map((ry) => (
          <line key={ry} x1={x} y1={ry} x2={x + w} y2={ry} strokeWidth={6} />
        ))}
        <rect x={x - 10} y={y + h + 4} width={w + 20} height={12} fill={theme.frameDark} stroke="none" />
      </g>
    );
  }
  return (
    <g>
      <g fill="none" stroke={theme.frame} strokeWidth={14}>
        <rect x={x} y={y} width={w} height={h} />
        <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} strokeWidth={8} />
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={theme.frameDark} strokeWidth={1.5} />
      <rect x={x - 14} y={y + h + 2} width={w + 28} height={14} rx={3} fill={theme.frame} stroke={theme.frameDark} strokeWidth={1.5} />
      {style === 'blinds' && (
        <g>
          <rect x={x + 4} y={y + 4} width={w - 8} height={112} fill="#eef2f7" />
          <g stroke="#c9d2dd" strokeWidth={2}>
            {Array.from({ length: 11 }, (_, i) => (
              <line key={i} x1={x + 4} y1={y + 12 + i * 10} x2={x + w - 4} y2={y + 12 + i * 10} />
            ))}
          </g>
          <rect x={x + 4} y={y + 112} width={w - 8} height={8} rx={2} fill="#d5dde7" />
          <line x1={x + w - 30} y1={y + 120} x2={x + w - 30} y2={y + 190} stroke="#b7c1cc" strokeWidth={2} />
        </g>
      )}
      {style === 'curtains' && (
        <g>
          <path d={`M ${x - 34} ${y - 20} L ${x + 70} ${y - 20} C ${x + 60} ${y + 120} ${x + 34} ${y + 260} ${x + 44} ${y + h + 40} L ${x - 34} ${y + h + 40} Z`} fill="#ffdbe6" opacity={0.78} />
          <path d={`M ${x + w + 34} ${y - 20} L ${x + w - 70} ${y - 20} C ${x + w - 60} ${y + 120} ${x + w - 34} ${y + 260} ${x + w - 44} ${y + h + 40} L ${x + w + 34} ${y + h + 40} Z`} fill="#ffdbe6" opacity={0.78} />
          <g stroke="#f4b9cc" strokeWidth={2} opacity={0.8}>
            <path d={`M ${x + 6} ${y - 10} C ${x + 4} ${y + 150} ${x - 4} ${y + 300} ${x + 2} ${y + h + 30}`} fill="none" />
            <path d={`M ${x + 30} ${y - 10} C ${x + 26} ${y + 150} ${x + 14} ${y + 300} ${x + 22} ${y + h + 30}`} fill="none" />
            <path d={`M ${x + w - 6} ${y - 10} C ${x + w - 4} ${y + 150} ${x + w + 4} ${y + 300} ${x + w - 2} ${y + h + 30}`} fill="none" />
            <path d={`M ${x + w - 30} ${y - 10} C ${x + w - 26} ${y + 150} ${x + w - 14} ${y + 300} ${x + w - 22} ${y + h + 30}`} fill="none" />
          </g>
          <rect x={x - 44} y={y - 28} width={w + 88} height={10} rx={5} fill="#e9cdbf" />
        </g>
      )}
    </g>
  );
}

// ───────────────────────── props ─────────────────────────

function PendantLamp({ x, len, color, glow, uid }: { x: number; len: number; color: string; glow: string; uid: string }) {
  return (
    <g>
      <line x1={x} y1={0} x2={x} y2={len} stroke="#b9a9a0" strokeWidth={2} />
      <circle cx={x} cy={len + 26} r={70} fill={`url(#${uid}-lampglow)`} opacity={0.7} />
      <path d={`M ${x - 28} ${len + 22} C ${x - 26} ${len + 4} ${x + 26} ${len + 4} ${x + 28} ${len + 22} Z`} fill={color} stroke="#c9a896" strokeWidth={1.5} />
      <ellipse cx={x} cy={len + 23} rx={12} ry={4} fill={glow} />
    </g>
  );
}

// ── Stellar Tech (yuki): warm pastel, soft lighting ─────────────────────
const BOOKS: [x: number, h: number, color: string][] = [
  [20, 52, '#f7b6c9'],
  [36, 60, '#f6d7a6'],
  [52, 48, '#c9d9f2'],
  [66, 56, '#f2c1a0'],
  [80, 50, '#d9c4ee'],
];
const VASE_FLOWERS: [x: number, y: number, color: string][] = [
  [236, -76, '#ff9fbe'],
  [252, -90, '#ffc0d4'],
  [268, -74, '#ff9fbe'],
  [246, -60, '#ffe0ea'],
  [262, -58, '#ffb3cb'],
];

function StellarDecor({ uid }: { uid: string }) {
  return (
    <g>
      {/* framed star art */}
      <g transform="translate(958 150)">
        <rect x={0} y={0} width={176} height={128} rx={6} fill="#fffaf6" stroke="#e2c6b8" strokeWidth={3} />
        <rect x={12} y={12} width={152} height={104} rx={3} fill="#ffe9ef" />
        <circle cx={88} cy={64} r={40} fill="#ffd6e2" />
        <path d="M 88 34 L 97 56 L 120 57 L 102 71 L 109 94 L 88 81 L 67 94 L 74 71 L 56 57 L 79 56 Z" fill="#f7a8c4" stroke="#e6799f" strokeWidth={2} strokeLinejoin="round" />
      </g>
      {/* low cabinet with books and a vase */}
      <g transform="translate(900 432)">
        <rect x={0} y={0} width={320} height={132} rx={6} fill="#fbf1e9" stroke="#e0c8b8" strokeWidth={2.5} />
        <line x1={160} y1={8} x2={160} y2={124} stroke="#e8d6c8" strokeWidth={2} />
        <circle cx={146} cy={70} r={4} fill="#e0c8b8" />
        <circle cx={174} cy={70} r={4} fill="#e0c8b8" />
        {BOOKS.map(([bx, bh, c]) => (
          <rect key={bx} x={bx} y={-bh} width={13} height={bh} rx={2} fill={c} stroke="#d9bfae" strokeWidth={1.5} />
        ))}
        <path d="M 97 -40 L 124 -6 L 110 0 L 90 -34 Z" fill="#bfe0cf" stroke="#98c2ad" strokeWidth={1.5} />
        {/* vase */}
        <path d="M 240 0 C 226 -10 226 -34 238 -44 L 262 -44 C 274 -34 274 -10 260 0 Z" fill="#ffffff" stroke="#e2c6b8" strokeWidth={2} />
        {VASE_FLOWERS.map(([fx, fy, c], i) => (
          <g key={i}>
            <line x1={250} y1={-44} x2={fx} y2={fy} stroke="#8fc39c" strokeWidth={2} />
            <circle cx={fx} cy={fy} r={10} fill={c} stroke="#ee8fb0" strokeWidth={1.2} />
          </g>
        ))}
      </g>
      <PendantLamp x={760} len={70} color="#fff3ea" glow="#fff6c8" uid={uid} />
      <PendantLamp x={1060} len={52} color="#fff3ea" glow="#fff6c8" uid={uid} />
      <Plant x={126} y={560} s={1.05} />
    </g>
  );
}

// ── DeepBlue Engine (ethan): cool glass, monitors, server racks ─────────
function DeepBlueDecor({ variant }: { variant: Variant }) {
  const eve = variant === 'evening';
  const racks = [900, 990, 1080, 1170];
  return (
    <g>
      {/* server room behind a glass wall */}
      <rect x={862} y={40} width={418} height={522} fill={eve ? '#56597a' : '#4a5a72'} />
      {racks.map((rx, i) => (
        <g key={rx}>
          <rect x={rx} y={120} width={74} height={442} rx={3} fill={eve ? '#34364f' : '#2c3850'} stroke="#23293b" strokeWidth={2} />
          {Array.from({ length: 14 }, (_, j) => (
            <g key={j}>
              <rect x={rx + 8} y={134 + j * 30} width={58} height={20} rx={2} fill={eve ? '#3f4260' : '#37445e'} />
              <circle className={(i + j) % 5 === 0 ? 'bg-blink' : undefined} style={{ animationDelay: `${((i * 7 + j * 3) % 10) / 4}s` }} cx={rx + 16} cy={144 + j * 30} r={2.2} fill={(i + j) % 3 === 0 ? '#6ff0c0' : '#79b8ff'} />
              <circle cx={rx + 24} cy={144 + j * 30} r={2} fill={(i + j) % 4 === 0 ? '#ffd36b' : '#79b8ff'} opacity={0.8} />
            </g>
          ))}
        </g>
      ))}
      {/* glass tint, frosted band and mullions */}
      <rect x={862} y={40} width={418} height={522} fill="#dbe8f5" opacity={0.5} />
      <rect x={862} y={318} width={418} height={40} fill="#f4f8fc" opacity={0.75} />
      <g stroke="#9fb0c3" strokeWidth={6}>
        <line x1={862} y1={40} x2={862} y2={562} />
        <line x1={1072} y1={40} x2={1072} y2={562} strokeWidth={4} />
      </g>
      <path d="M 900 40 L 960 40 L 880 562 L 862 562 L 862 300 Z" fill="#ffffff" opacity={0.18} />
      {/* desk with two monitors */}
      <g transform="translate(884 408)">
        <rect x={0} y={60} width={360} height={14} rx={3} fill="#e8edf3" stroke="#9fb0c3" strokeWidth={2} />
        <rect x={20} y={74} width={10} height={80} fill="#b7c3d0" />
        <rect x={330} y={74} width={10} height={80} fill="#b7c3d0" />
        {[40, 196].map((mx) => (
          <g key={mx}>
            <rect x={mx} y={-50} width={130} height={82} rx={5} fill="#1f2a3d" stroke="#3a4760" strokeWidth={3} />
            <rect x={mx + 6} y={-44} width={118} height={70} rx={2} fill={eve ? '#223355' : '#1c3150'} />
            {[0, 1, 2, 3, 4, 5].map((l) => (
              <rect key={l} x={mx + 14 + (l % 3) * 8} y={-36 + l * 10} width={30 + ((l * 23 + mx) % 50)} height={4} rx={2} fill={l % 2 ? '#79b8ff' : '#6ff0c0'} opacity={0.75} />
            ))}
            <rect x={mx + 58} y={32} width={14} height={20} fill="#9fb0c3" />
            <rect x={mx + 40} y={52} width={50} height={8} rx={3} fill="#9fb0c3" />
          </g>
        ))}
        <circle cx={60} cy={62} r={60} fill="#79b8ff" opacity={0.06} />
      </g>
      {/* ceiling LED strips */}
      <g>
        {[300, 700].map((lx) => (
          <g key={lx}>
            <rect x={lx} y={14} width={220} height={8} rx={4} fill="#ffffff" />
            <rect x={lx - 20} y={22} width={260} height={30} fill="#ffffff" opacity={0.18} />
          </g>
        ))}
      </g>
      <Plant x={120} y={560} s={0.95} pot="#e9eef4" potLine="#b8c3cf" leaf="#9ccfb4" leafDark="#77b597" />
    </g>
  );
}

// ── Clearsky Labs (haru): bright startup loft ──────────────────────────
/** Painted brick texture for the loft (drawn under the window). */
function BrickWall() {
  return (
    <g stroke="#e7ddd0" strokeWidth={2} opacity={0.9}>
      {Array.from({ length: 15 }, (_, r) => {
        const y = 38 + r * 36;
        return (
          <g key={r}>
            <line x1={0} y1={y} x2={BG_W} y2={y} />
            {Array.from({ length: 19 }, (_, c) => {
              const x = c * 72 + (r % 2 ? 36 : 0);
              return <line key={c} x1={x} y1={y} x2={x} y2={y + 36} />;
            })}
          </g>
        );
      })}
    </g>
  );
}

function ClearskyDecor({ uid }: { uid: string }) {
  const notes: [number, number, string, number][] = [
    [936, 180, '#ffe27a', -4],
    [990, 170, '#ffb8d0', 3],
    [1044, 184, '#9fe3c8', -2],
    [944, 244, '#9cd3ff', 2],
    [1000, 236, '#ffe27a', -3],
    [1150, 176, '#ffcf9c', 4],
    [1158, 246, '#ffb8d0', -3],
  ];
  return (
    <g>
      {/* whiteboard */}
      <g>
        <rect x={900} y={140} width={320} height={236} rx={8} fill="#ffffff" stroke="#c5cad3" strokeWidth={4} />
        <rect x={912} y={376} width={296} height={10} rx={4} fill="#d9dde4" />
        <path d="M 1080 330 L 1110 300 L 1134 316 L 1172 262 L 1196 270" fill="none" stroke="#4fa3e0" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 1186 256 L 1198 268 L 1182 274" fill="none" stroke="#4fa3e0" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 930 330 C 950 316 980 344 1000 326 C 1020 310 1040 336 1060 322" fill="none" stroke="#ff9f43" strokeWidth={3.5} strokeLinecap="round" />
        <circle cx={1112} cy={210} r={18} fill="none" stroke="#ffb13b" strokeWidth={3.5} />
        <path d="M 1104 230 L 1120 230 M 1106 238 L 1118 238" stroke="#ffb13b" strokeWidth={3.5} strokeLinecap="round" />
        {notes.map(([x, y, c, rot], i) => (
          <g key={i} transform={`rotate(${rot} ${x + 22} ${y + 22})`}>
            <rect x={x} y={y} width={44} height={44} fill={c} />
            <path d={`M ${x} ${y + 44} L ${x + 44} ${y + 44} L ${x + 44} ${y + 36} Z`} fill="#000" opacity={0.06} />
            <line x1={x + 8} y1={y + 16} x2={x + 34} y2={y + 16} stroke="#000" strokeOpacity={0.18} strokeWidth={2} />
            <line x1={x + 8} y1={y + 26} x2={x + 28} y2={y + 26} stroke="#000" strokeOpacity={0.18} strokeWidth={2} />
          </g>
        ))}
      </g>
      {/* Edison bulbs */}
      {[700, 780, 1060, 1150].map((bx, i) => {
        const len = [90, 60, 44, 78][i];
        return (
          <g key={bx}>
            <line x1={bx} y1={0} x2={bx} y2={len} stroke="#3d3f47" strokeWidth={2} />
            <circle cx={bx} cy={len + 16} r={46} fill={`url(#${uid}-lampglow)`} opacity={0.8} />
            <rect x={bx - 6} y={len} width={12} height={8} fill="#6a5a4a" />
            <ellipse cx={bx} cy={len + 18} rx={10} ry={12} fill="#fff1c2" stroke="#e8c27a" strokeWidth={1.5} />
          </g>
        );
      })}
      {/* bean bag */}
      <g transform="translate(1080 628)">
        <ellipse cx={0} cy={60} rx={150} ry={22} fill="#000" opacity={0.08} />
        <path d="M -140 50 C -150 -10 -90 -60 -10 -56 C 70 -60 150 -20 140 44 C 130 70 -130 74 -140 50 Z" fill="#ff9f43" stroke="#d67a26" strokeWidth={3} />
        <path d="M -80 -30 C -40 -10 10 -8 60 -34" fill="none" stroke="#d67a26" strokeWidth={3} strokeLinecap="round" />
        <path d="M -100 10 C -60 -4 -20 -30 20 -40" fill="none" stroke="#ffc07e" strokeWidth={6} strokeLinecap="round" opacity={0.8} />
      </g>
      <Plant x={866} y={566} s={0.7} pot="#ffffff" potLine="#c5cad3" />
    </g>
  );
}

// ───────────────────────── room ─────────────────────────

const Room = memo(function Room({ characterId, variant, uid }: { characterId: CharacterId; variant: Variant; uid: string }) {
  const theme = THEMES[characterId];
  const eve = variant === 'evening';
  const seed = { yuki: 11, ethan: 23, haru: 37 }[characterId];
  return (
    <g>
      <defs>
        <VGradient
          id={`${uid}-wall`}
          stops={[
            [0, theme.ceiling],
            [0.12, theme.wall],
            [1, theme.wallLow],
          ]}
        />
        <VGradient
          id={`${uid}-floor`}
          stops={[
            [0, theme.floor],
            [1, theme.floorLine],
          ]}
        />
        <radialGradient id={`${uid}-lampglow`}>
          <stop offset="0" stopColor={eve ? '#ffd9a0' : '#fff6d8'} stopOpacity="0.9" />
          <stop offset="1" stopColor={eve ? '#ffd9a0' : '#fff6d8'} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-soft`} cx="0.5" cy="0.35" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-wall)`} />
      <rect width={BG_W} height={34} fill={theme.ceiling} />
      <line x1={0} y1={34} x2={BG_W} y2={34} stroke={theme.frameDark} strokeWidth={1.5} opacity={0.6} />
      {/* soft light pool behind the interviewer */}
      {characterId === 'haru' && <BrickWall />}
      <ellipse cx={660} cy={300} rx={360} ry={300} fill={`url(#${uid}-soft)`} />
      <WindowView uid={uid} variant={variant} seed={seed} />
      <WindowFrame theme={theme} style={characterId === 'yuki' ? 'curtains' : characterId === 'ethan' ? 'blinds' : 'grid'} />
      {/* floor */}
      <rect x={0} y={572} width={BG_W} height={BG_H - 572} fill={`url(#${uid}-floor)`} />
      <g stroke={theme.floorLine} strokeWidth={2} opacity={0.7}>
        {characterId === 'ethan'
          ? null
          : Array.from({ length: 9 }, (_, i) => <line key={i} x1={-200 + i * 190} y1={BG_H} x2={260 + i * 100} y2={572} />)}
        <line x1={0} y1={640} x2={BG_W} y2={640} opacity={0.5} />
      </g>
      <rect x={0} y={560} width={BG_W} height={14} fill={theme.baseboard} />
      <line x1={0} y1={574} x2={BG_W} y2={574} stroke={theme.frameDark} strokeWidth={1.5} />
      {/* window light on the floor */}
      <path d="M 70 574 L 570 574 L 700 720 L 60 720 Z" fill={eve ? '#ffb877' : '#ffffff'} opacity={eve ? 0.3 : 0.22} />
      {characterId === 'yuki' && <StellarDecor uid={uid} />}
      {characterId === 'ethan' && <DeepBlueDecor variant={variant} />}
      {characterId === 'haru' && <ClearskyDecor uid={uid} />}
      {eve && (
        <>
          {/* sunset light through the window, cast across the wall */}
          <path d="M 590 90 L 820 60 L 1040 470 L 700 520 Z" fill="#ffa86b" opacity={0.18} />
          <rect width={BG_W} height={BG_H} fill="#ff9a6a" opacity={0.1} />
          <rect width={BG_W} height={BG_H} fill="#5a3c8c" opacity={0.08} />
        </>
      )}
    </g>
  );
});

export function OfficeBackground({ characterId, variant = 'day' }: OfficeBackgroundProps) {
  return (
    <BgFrame className="bg-office" testId={`bg-office-${characterId}-${variant}`}>
      {(uid) => (
        <>
          <Room characterId={characterId} variant={variant} uid={uid} />
          {/* haze keeps the room soft so the sprite and UI pop */}
          <rect width={BG_W} height={BG_H} fill="#ffffff" opacity={variant === 'day' ? 0.12 : 0.05} />
          <Vignette uid={uid} strength={variant === 'day' ? 0.16 : 0.26} />
        </>
      )}
    </BgFrame>
  );
}
