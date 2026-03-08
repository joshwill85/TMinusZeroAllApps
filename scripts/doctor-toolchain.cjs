#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OVERRIDE_ENV = 'ALLOW_TOOLCHAIN_MISMATCH';

function parseMajor(version) {
  const cleaned = String(version || '').trim().replace(/^v/, '');
  const m = cleaned.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function getRepoToolchain(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(raw);

  const exactNode = pkg?.volta?.node;
  const exactNpm = pkg?.volta?.npm;
  const enginesNode = pkg?.engines?.node;
  const enginesNpm = pkg?.engines?.npm;

  if (!exactNode || !exactNpm) {
    throw new Error(
      'Missing required toolchain pins. Ensure package.json contains volta.node and volta.npm.'
    );
  }

  const nodeMajor = parseMajor(exactNode);
  const npmMajor = parseMajor(exactNpm);
  if (!nodeMajor || !npmMajor) {
    throw new Error(
      `Invalid volta pins in package.json (node=${exactNode}, npm=${exactNpm}).`
    );
  }

  return {
    exactNode,
    exactNpm,
    enginesNode,
    enginesNpm,
    expectedEnginesNode: `${nodeMajor}.x`,
    expectedEnginesNpm: `${npmMajor}.x`,
  };
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function die(lines, code = 1) {
  for (const line of lines) console.error(line);
  process.exit(code);
}

function ok(lines) {
  for (const line of lines) console.log(line);
}

function extractNpmVersionFromUserAgent(ua) {
  const m = (ua || '').match(/(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/);
  return m ? m[1] : null;
}

const repoRoot = process.cwd();

let exactNode;
let exactNpm;
let enginesNode;
let enginesNpm;
let expectedEnginesNode;
let expectedEnginesNpm;
try {
  ({
    exactNode,
    exactNpm,
    enginesNode,
    enginesNpm,
    expectedEnginesNode,
    expectedEnginesNpm,
  } = getRepoToolchain(repoRoot));
} catch (err) {
  die([`toolchain: FAIL`, String(err?.message || err)]);
}

const mismatches = [];

// Local runtime (if run via npm, we can inspect user agent)
const nodeVersion = (process.version || '').replace(/^v/, '');
if (nodeVersion !== exactNode) {
  mismatches.push(`Node is ${nodeVersion} (required ${exactNode}).`);
}

const npmUa = process.env.npm_config_user_agent || '';
const npmVersion = extractNpmVersionFromUserAgent(npmUa);
if (!npmVersion) {
  mismatches.push('npm version not detected (run via npm).');
} else if (npmVersion !== exactNpm) {
  mismatches.push(`npm is ${npmVersion} (required ${exactNpm}).`);
}

// Repo pins
const nvmrc = (readText(path.join(repoRoot, '.nvmrc')) || '').trim();
const nodeVersionFile = (readText(path.join(repoRoot, '.node-version')) || '').trim();
if (!nvmrc) mismatches.push('Missing .nvmrc.');
if (!nodeVersionFile) mismatches.push('Missing .node-version.');
if (nvmrc && nvmrc !== exactNode) mismatches.push(`.nvmrc is ${nvmrc} (required ${exactNode}).`);
if (nodeVersionFile && nodeVersionFile !== exactNode) {
  mismatches.push(`.node-version is ${nodeVersionFile} (required ${exactNode}).`);
}
if (nvmrc && nodeVersionFile && nvmrc !== nodeVersionFile) {
  mismatches.push(`.nvmrc (${nvmrc}) != .node-version (${nodeVersionFile}).`);
}

// Platform engines (Vercel only supports major selection)
if (enginesNode !== expectedEnginesNode) {
  mismatches.push(`package.json engines.node must be "${expectedEnginesNode}" (found "${enginesNode || '(missing)'}").`);
}
if (enginesNpm !== expectedEnginesNpm) {
  mismatches.push(`package.json engines.npm must be "${expectedEnginesNpm}" (found "${enginesNpm || '(missing)'}").`);
}

// npm strictness
const npmrc = readText(path.join(repoRoot, '.npmrc')) || '';
if (!npmrc.split(/\r?\n/).some((l) => l.trim() === 'engine-strict=true')) {
  mismatches.push('.npmrc is missing engine-strict=true.');
}

// Docker pin
const dockerfile = readText(path.join(repoRoot, 'Dockerfile')) || '';
const fromLine = dockerfile.split(/\r?\n/).find((l) => l.trim().startsWith('FROM ')) || '';
if (!fromLine) {
  mismatches.push('Dockerfile missing FROM line.');
} else if (!fromLine.includes(`node:${exactNode}-alpine`)) {
  mismatches.push(`Dockerfile base image not pinned to node:${exactNode}-alpine (found: ${fromLine.trim()}).`);
}
if (dockerfile && dockerfile.includes('--ignore-scripts')) {
  mismatches.push('Dockerfile must not use --ignore-scripts (install hooks must run for parity).');
}
if (dockerfile && !dockerfile.includes('npm ci')) {
  mismatches.push('Dockerfile should use npm ci (deterministic installs).');
}

// Compose determinism
const compose = readText(path.join(repoRoot, 'docker-compose.yml')) || '';
if (compose && !compose.includes('npm ci')) {
  mismatches.push('docker-compose.yml does not use npm ci (deterministic installs).');
}
if (compose && !compose.includes('node_modules:/app/node_modules')) {
  mismatches.push('docker-compose.yml does not mount a dedicated node_modules volume (prevents clobbering host node_modules).');
}

const overrideEnabled = process.env[OVERRIDE_ENV] === '1';
if (mismatches.length === 0) {
  ok([
    'toolchain: ok',
    `node: v${nodeVersion}`,
    `npm: ${npmVersion || '(unknown)'}`,
    `pins: Node ${exactNode} / npm ${exactNpm}`,
  ]);
  process.exit(0);
}

if (overrideEnabled) {
  ok(['toolchain: WARNING (override enabled)', ...mismatches.map((m) => `- ${m}`)]);
  process.exit(0);
}

die([
  'toolchain: FAIL',
  ...mismatches.map((m) => `- ${m}`),
  '',
  'Fix options:',
  '  - Volta (recommended): https://volta.sh',
  '  - nvm: nvm install && nvm use',
  '  - macOS Homebrew: brew install node@20 && export PATH=\"/opt/homebrew/opt/node@20/bin:$PATH\"',
  '',
  `Override (local only): ${OVERRIDE_ENV}=1 npm ci`,
]);
