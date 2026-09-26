/**
 * Visual assets drawn in code (SVG/CSS) — characters, backgrounds, effects.
 * OWNER: art agent. Keep exported names and props stable.
 */
export { CharacterSprite, CharacterPortrait } from './characters/CharacterSprite';
export type { CharacterSpriteProps, CharacterPortraitProps } from './characters/CharacterSprite';
export { OfficeBackground, TitleBackground, LobbyBackground, EndingBackground } from './backgrounds/Backgrounds';
export type { OfficeBackgroundProps, EndingBackgroundProps } from './backgrounds/Backgrounds';
export { SakuraPetals } from './effects/SakuraPetals';
// ArtPreviewScreen (the `?screen=artPreview` QA sheet) is imported from './ArtPreviewScreen' directly
// by the app shell so it stays in its own lazily loaded chunk.
export type { SakuraPetalsProps } from './effects/SakuraPetals';
