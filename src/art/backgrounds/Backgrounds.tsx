/**
 * Backgrounds drawn in code. All of them fill their positioned parent
 * (position:absolute; inset:0), ignore pointer events and are designed for 1280×720
 * (SVG `xMidYMid slice`, so any aspect ratio is covered).
 */
import './Backgrounds.css';

export { OfficeBackground } from './OfficeBackground';
export type { OfficeBackgroundProps } from './OfficeBackground';
export { TitleBackground, LobbyBackground, EndingBackground } from './SceneBackgrounds';
export type { EndingBackgroundProps } from './SceneBackgrounds';
