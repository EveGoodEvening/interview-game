/**
 * Dev server config for the E2E run: the project's vite.config.ts (relay middleware, pre-bundled
 * lazy deps) with HMR switched off. A source file saved while the suite runs must not hot-update or
 * full-reload the page under test — that would reset an interview mid-test (seen as flaky
 * "back on the title screen" failures). Each test starts from a fresh page load, which always
 * serves the current sources.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.ts';

export default mergeConfig(base, defineConfig({ server: { hmr: false } }));
