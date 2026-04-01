import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const cwd = process.cwd();

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (typeof result.status === 'number') return result.status;
  return 1;
}

function latestMatch(regex) {
  const files = readdirSync(cwd).filter((name) => regex.test(name)).sort();
  return files.length ? files[files.length - 1] : null;
}

function fallbackStaticBuild() {
  const jsAsset = latestMatch(/^index-.*\.js$/);
  const cssAsset = latestMatch(/^index-.*\.css$/);

  if (!jsAsset || !cssAsset) {
    console.error('[build] Static fallback failed: prebuilt index-*.js/css assets are missing.');
    return 1;
  }

  const distDir = join(cwd, 'dist');
  mkdirSync(distDir, { recursive: true });
  copyFileSync(join(cwd, jsAsset), join(distDir, jsAsset));
  copyFileSync(join(cwd, cssAsset), join(distDir, cssAsset));

  const sourceHtml = existsSync(join(cwd, 'index.html'))
    ? readFileSync(join(cwd, 'index.html'), 'utf8')
    : '<!doctype html><html><head><meta charset="UTF-8" /><title>Pharmacy Analytics</title></head><body><div id="root"></div></body></html>';

  const builtHtml = sourceHtml
    .replace(/<script type="module" src="\/main\.tsx"><\/script>/, '')
    .replace('</head>', `  <link rel="stylesheet" href="./${cssAsset}" />\n  </head>`)
    .replace('</body>', `  <script type="module" src="./${jsAsset}"></script>\n  </body>`);

  writeFileSync(join(distDir, 'index.html'), builtHtml, 'utf8');
  console.warn('[build] Built dist/ from checked-in prebuilt assets (offline fallback).');
  return 0;
}

let exitCode = 1;
try {
  const viteCli = require.resolve('vite/bin/vite.js');
  exitCode = run(process.execPath, [viteCli, ...args]);
} catch {
  console.warn('[build] Local vite not found, falling back to npm exec vite.');
  exitCode = run('npm', ['exec', '--yes', 'vite', ...args]);
  if (exitCode !== 0 && args[0] === 'build') {
    console.warn('[build] npm exec vite failed, trying offline static fallback.');
    exitCode = fallbackStaticBuild();
  }
}

process.exit(exitCode);
