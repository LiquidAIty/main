#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptDir = __dirname;
const tauriDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(tauriDir, '..', '..');
const backendDir = path.join(repoRoot, 'backend');
const privacyCoreDir = path.join(repoRoot, 'privacy-core');
const outputDir = path.join(tauriDir, 'src-tauri', 'backend-runtime');
const venvMarkerPath = path.join(backendDir, '.venv-dir');
const releaseAttestationPath = path.join(backendDir, 'data', 'release_attestation.json');
const stagedReleaseAttestationPath = path.join(
  outputDir,
  'data',
  'release_attestation.json',
);

const excludedNames = new Set([
  '.env',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
  'backend.egg-info',
  'build',
  'data',
  'tests',
  'timemachine',
]);

const excludedFiles = new Set([
  '.env.example',
  'ais_cache.json',
  'carrier_cache.json',
  'cctv.db',
  'dm_token_pepper.key',
  'pytest.ini',
]);

function backendPythonPath() {
  let venvDir = 'venv';
  try {
    const persisted = fs.readFileSync(venvMarkerPath, 'utf8').trim();
    if (persisted) {
      venvDir = persisted;
    }
  } catch {}

  if (process.platform === 'win32') {
    return path.join(backendDir, venvDir, 'Scripts', 'python.exe');
  }
  return path.join(backendDir, venvDir, 'bin', 'python3');
}

function shouldCopy(srcPath) {
  const relativePath = path.relative(backendDir, srcPath);
  if (!relativePath) return true;

  const parts = relativePath.split(path.sep);
  return parts.every((part, index) => {
    const isLeaf = index === parts.length - 1;
    if (excludedNames.has(part)) return false;
    if (isLeaf && excludedFiles.has(part)) return false;
    if (/^test_.*\.py$/i.test(part)) return false;
    return true;
  });
}

function ensureRuntimePrereqs() {
  if (!fs.existsSync(path.join(backendDir, 'main.py'))) {
    throw new Error(`Missing backend/main.py at ${backendDir}`);
  }
  if (!fs.existsSync(backendPythonPath())) {
    throw new Error(
      `Missing bundled backend Python runtime at ${backendPythonPath()}. ` +
      'Create the backend venv before packaging the desktop app.',
    );
  }
  if (!fs.existsSync(path.join(backendDir, 'node_modules', 'ws'))) {
    throw new Error(
      `Missing backend/node_modules/ws at ${path.join(backendDir, 'node_modules', 'ws')}. ` +
      'Install backend Node dependencies before packaging the desktop app.',
    );
  }
}

function privacyCoreArtifactName() {
  if (process.platform === 'win32') return 'privacy_core.dll';
  if (process.platform === 'darwin') return 'libprivacy_core.dylib';
  return 'libprivacy_core.so';
}

function privacyCoreArtifactPath() {
  return path.join(privacyCoreDir, 'target', 'release', privacyCoreArtifactName());
}

function ensurePrivacyCoreArtifact() {
  const artifact = privacyCoreArtifactPath();
  if (fs.existsSync(artifact)) {
    return artifact;
  }
  console.log('privacy-core release library missing; building it for desktop packaging...');
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', path.join(privacyCoreDir, 'Cargo.toml')],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      'Failed to build privacy-core release library. Install Rust/Cargo and rerun the desktop build.',
    );
  }
  if (!fs.existsSync(artifact)) {
    throw new Error(`privacy-core build completed but artifact is missing: ${artifact}`);
  }
  return artifact;
}

function stageBackendRuntime() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.cpSync(backendDir, outputDir, {
    recursive: true,
    filter: shouldCopy,
  });
  stagePrivacyCoreArtifact();
  stageReleaseAttestation();
  stageStartScripts();
}

/**
 * Copy ``start.bat`` and ``start.sh`` from the repo root into the
 * staged backend-runtime/ so they sit next to ``privacy_core.dll``.
 *
 * Why: an MSI/EXE/AppImage user who wants to launch via the dev-style
 * scripts (because the desktop shell is failing, or they prefer the
 * browser frontend at localhost:3000) shouldn't have to clone the
 * source repo just to get the scripts. Having them inside the install
 * directory also means the bundled ``privacy_core.dll`` fallback in
 * those scripts resolves to the SAME directory as the script, which
 * is exactly the layout the v0.9.81 script update is looking for.
 *
 * Tracked from issue #319: users who fell back to start.bat from
 * their MSI install dir had to go fetch it from GitHub, then saw a
 * scary "install Rust" warning because the script didn't know where
 * the bundled DLL was. Bundling the script removes both problems.
 */
function stageStartScripts() {
  const scripts = ['start.bat', 'start.sh'];
  for (const name of scripts) {
    const src = path.join(repoRoot, name);
    if (!fs.existsSync(src)) {
      console.warn(`backend-runtime staged without ${name} (not at repo root)`);
      continue;
    }
    const dst = path.join(outputDir, name);
    fs.copyFileSync(src, dst);
    // Preserve executable bit on POSIX systems for the .sh script.
    if (name.endsWith('.sh') && process.platform !== 'win32') {
      try {
        fs.chmodSync(dst, 0o755);
      } catch {
        /* best-effort; not fatal on filesystems that don't honor chmod */
      }
    }
  }
}

function stagePrivacyCoreArtifact() {
  const artifact = ensurePrivacyCoreArtifact();
  const stagedPath = path.join(outputDir, path.basename(artifact));
  fs.copyFileSync(artifact, stagedPath);
}

function stageReleaseAttestation() {
  if (!fs.existsSync(releaseAttestationPath)) {
    console.warn(`backend-runtime staged without release attestation: ${releaseAttestationPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(stagedReleaseAttestationPath), { recursive: true });
  fs.copyFileSync(releaseAttestationPath, stagedReleaseAttestationPath);
}

function writeBundleVersion() {
  const versionPath = path.join(outputDir, '.bundle-version');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'desktop-shell', 'package.json'), 'utf8'),
  );
  fs.writeFileSync(versionPath, `${pkg.version || '0.0.0'}\n`, 'utf8');
}

function fileCount(root) {
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      count += fileCount(fullPath);
    } else {
      count += 1;
    }
  }
  return count;
}

ensureRuntimePrereqs();
stageBackendRuntime();
writeBundleVersion();
console.log(`backend-runtime staged: ${fileCount(outputDir)} files`);
