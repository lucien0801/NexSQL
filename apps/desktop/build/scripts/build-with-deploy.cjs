'use strict';
/**
 * Build script that uses `pnpm deploy` to create a flat node_modules before packaging.
 *
 * WHY: pnpm workspace isolates each package's node_modules (only direct deps are symlinked).
 * electron-builder only sees apps/desktop/node_modules (direct deps), missing all transitive deps.
 * `pnpm deploy --prod` creates a flattened node_modules with ALL transitive deps resolved,
 * which electron-builder can then package correctly.
 *
 * Usage: node build/scripts/build-with-deploy.cjs [--win|--mac|--linux]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const platform = args.find((a) => /^--(win|mac|linux)$/.test(a)) || '--win';

const appDir = path.resolve(__dirname, '../../');
const workspaceRoot = path.resolve(appDir, '../../');
const deployDir = path.join(appDir, '.deploy-temp');

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function resolveOutputDir() {
  const preferred = path.join(appDir, 'release-prod');
  if (fs.existsSync(preferred)) {
    const removed = safeRemoveDir(preferred, 4);
    if (!removed) {
      throw new Error(
        `Cannot clean output directory: ${preferred}. Please close running app/processes (e.g. nexsql.exe) and retry.`,
      );
    }
  }
  return preferred;
}

function log(msg) {
  console.log(`\n\x1b[36m[build-deploy]\x1b[0m ${msg}\n`);
}

function cpRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      // skip symlinks - we want real files only
      continue;
    }
    if (entry.isDirectory()) {
      cpRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function safeRemoveDir(dir, retries = 3) {
  for (let i = 0; i < retries; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (i === retries - 1) {
        return false;
      }
    }
  }
  return false;
}

const outputDir = resolveOutputDir();

// ── Step 1: Build electron-vite bundle ──────────────────────────────────────
log('1/4  electron-vite build...');
execSync('pnpm exec electron-vite build', { cwd: appDir, stdio: 'inherit' });

// ── Step 2: pnpm deploy → flat node_modules ─────────────────────────────────
log('2/4  pnpm deploy (creating flat node_modules with ALL transitive deps)...');
if (fs.existsSync(deployDir)) {
  const removed = safeRemoveDir(deployDir, 4);
  if (!removed) {
    throw new Error(
      `Cannot clean deploy directory: ${deployDir}. Please close processes that are using it and retry.`,
    );
  }
}
// pnpm deploy creates: deployDir/package.json + deployDir/node_modules/ (self-contained .pnpm store)
// --legacy is required for pnpm v10+ in workspace mode
execSync(`pnpm --filter nexsql-desktop deploy --legacy --prod "${deployDir}"`, {
  cwd: workspaceRoot,
  stdio: 'inherit',
});

function hasDepInDeploy(dep) {
  const directPkg = path.join(deployDir, 'node_modules', dep, 'package.json');
  if (fs.existsSync(directPkg)) return true;

  const virtualStore = path.join(deployDir, 'node_modules', '.pnpm');
  if (!fs.existsSync(virtualStore)) return false;

  const depPrefix = dep.startsWith('@')
    ? `${dep.replace('/', '+')}@`
    : `${dep}@`;

  const candidates = fs
    .readdirSync(virtualStore, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(depPrefix));

  for (const c of candidates) {
    const candidatePkg = path.join(
      virtualStore,
      c.name,
      'node_modules',
      dep,
      'package.json',
    );
    if (fs.existsSync(candidatePkg)) return true;
  }
  return false;
}

const mustHaveRuntimeDeps = ['abort-controller', 'event-target-shim'];
for (const dep of mustHaveRuntimeDeps) {
  if (!hasDepInDeploy(dep)) {
    throw new Error(`Missing runtime dependency in deploy output: ${dep}`);
  }
}

// ── Step 3: Copy build artifacts into deploy dir ─────────────────────────────
log('3/4  copying build artifacts into deploy dir...');
// Copy compiled output (out/) - this is what electron-builder packages
cpRecursive(path.join(appDir, 'out'), path.join(deployDir, 'out'));

// Copy build resources (icons, entitlements, etc.)
const buildDir = path.join(appDir, 'build');
if (fs.existsSync(buildDir)) {
  cpRecursive(buildDir, path.join(deployDir, 'build'));
}

// Copy electron-builder.yml into deploy dir, override output to appDir/release
let yamlContent = fs.readFileSync(path.join(appDir, 'electron-builder.yml'), 'utf8');
// Use forward slashes and an absolute path for the output directory
const outputDirFwd = outputDir.replace(/\\/g, '/');
yamlContent = yamlContent.replace(/^(\s*output:\s*).+$/m, `$1"${outputDirFwd}"`);
fs.writeFileSync(path.join(deployDir, 'electron-builder.yml'), yamlContent);

// ── Step 4: Run electron-builder from deploy dir ─────────────────────────────
log(`4/4  electron-builder ${platform} (projectDir = .deploy-temp)...`);

// electron is a devDependency so pnpm deploy --prod doesn't include it.
// Read the installed version from appDir so electron-builder can locate it.
const electronVersion = require(path.join(appDir, 'node_modules', 'electron', 'package.json')).version;

const env = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    'https://npmmirror.com/mirrors/electron-builder-binaries/',
};
// --projectDir points electron-builder at the deploy dir which has flat node_modules
// --config.electronVersion passes the electron version since it's not in deployDir/node_modules
execSync(
  `pnpm exec electron-builder ${platform} --projectDir "${deployDir}" --config.electronVersion=${electronVersion}`,
  { cwd: appDir, stdio: 'inherit', env },
);

log(`Done! Installer output → ${outputDir}`);
