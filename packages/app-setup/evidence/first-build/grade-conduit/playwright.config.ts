import { defineConfig } from '@playwright/test';
import { baseConfig } from './suite/specs/e2e/playwright.base';

// Grader config: extends the suite's own base config (as the suite's docs tell an
// implementation to do) and only overrides where the tests live, the app's URL and
// the reporters. Specs and helpers under ./suite are used unmodified.
const baseURL = process.env.CONDUIT_BASE_URL;
if (!baseURL) throw new Error('CONDUIT_BASE_URL is not set');
const out = process.env.GRADE_OUT || 'results';

export default defineConfig({
  ...baseConfig,
  testDir: './suite/specs/e2e',
  outputDir: `${out}/test-output`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${out}/report.json` }],
  ],
  use: { ...baseConfig.use, baseURL },
});
