/**
 * Put the page's cache-busting version on every module it loads.
 *
 *     node tools/stamp-version.mjs
 *
 * Runs at the end of `pnpm build:site`, locally and on the Pages deploy.
 *
 * ## The hour this exists to stop being lost again
 *
 * Chrome caches `style.css` through a normal reload and through
 * `location.reload(true)`. The page has carried `?v=` on the stylesheet and the
 * entry script for a while because of that, and twice the new markup arrived
 * with the old styles and the obvious conclusion was that the change had not
 * worked.
 *
 * Versioning only the entry point moves that failure one layer down rather than
 * fixing it. `app.js?v=11` is fetched fresh and then imports `./lib/engine/
 * game.js`, which imports `./physics.js`, and neither of those carries a version
 * at all. A fresh game module running against a stale physics module is the same
 * defect wearing a different hat, and it is harder to spot because the file you
 * edited really did reload.
 *
 * So the version is stamped across the whole graph, and it is read from
 * `site/index.html` rather than declared here, because two places to write the
 * number down is one place for them to disagree. Bumping the `?v=` in the HTML
 * stays the single thing anyone has to do.
 *
 * Idempotent: any existing `?v=` on a relative specifier is stripped first, so
 * running it twice is the same as running it once.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');

/** Every `from '...'` and `import('...')` whose target is a relative path. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+?)(?:\?v=[^'"]*)?\2/g;

async function jsFilesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFilesUnder(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

async function main() {
  const html = await readFile(join(SITE, 'index.html'), 'utf8');
  const found = html.match(/app\.js\?v=(\d+)/);
  if (!found) {
    // Failing loudly beats deploying a page whose modules are silently
    // uncacheable-busting, which is the exact class of problem this prevents.
    throw new Error('no `app.js?v=N` in site/index.html, so there is no version to stamp');
  }
  const version = found[1];

  const targets = [join(SITE, 'app.js'), join(SITE, 'i18n.js'), ...await jsFilesUnder(join(SITE, 'lib'))];

  let changed = 0;
  for (const file of targets) {
    const before = await readFile(file, 'utf8');
    const after = before.replace(SPECIFIER, (_m, head, quote, path) => `${head}${quote}${path}?v=${version}${quote}`);
    if (after === before) continue;
    await writeFile(file, after);
    changed += 1;
  }

  const where = targets.map((f) => relative(ROOT, f));
  console.log(`stamped ?v=${version} across ${changed} of ${where.length} module files`);
}

await main();
