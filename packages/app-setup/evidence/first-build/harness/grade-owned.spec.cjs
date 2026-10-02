// Independent grader: keep the upstream files and assertions byte-identical.
// Three upstream literals bypass API_BASE. In SPA mode only, configure their
// transport target exactly as API_BASE configures the other upstream helpers.
const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const demo = 'https://api.realworld.show/api';
const owned = process.env.API_BASE;
if (!owned || !/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(owned)) throw new Error('Expected disposable local API_BASE');
const remap = value => typeof value === 'string' && (value === demo || value.startsWith(demo + '/')) ? owned + value.slice(demo.length) : value;
test.beforeEach(async ({ page, request, context }) => {
  if (process.env.TEST_MODE === 'spa') {
    const route = page.route.bind(page);
    page.route = (url, handler, options) => route(remap(url), handler, options);
    const get = request.get.bind(request);
    request.get = (url, options) => get(remap(url), options);
  }
  await context.route(demo + '/**', route => route.abort('blockedbyclient'));
});
for (const file of fs.readdirSync(path.join(__dirname, 'suite/specs/e2e')).filter(f => f.endsWith('.spec.ts')).sort()) {
  // Preserve each source file's hook scope when loading through one adapter.
  test.describe(file, () => require('./suite/specs/e2e/' + file));
}
