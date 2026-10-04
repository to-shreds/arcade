import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install browser test dependencies with npm ci, then run npx playwright install chromium.', { cause: error });
  playwright = require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`);
}
export const chromium = playwright.chromium;
export const executablePath = process.env.ARCADE_CHROMIUM || process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
export const browserLaunchOptions = { headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
