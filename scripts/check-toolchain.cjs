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

function getRepoToolchain() {
  const repoRoot = path.resolve(__dirname, '..');
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

  const expectedEnginesNode = `${nodeMajor}.x`;
  const expectedEnginesNpm = `${npmMajor}.x`;
  if (enginesNode !== expectedEnginesNode) {
    throw new Error(
      `package.json engines.node must be "${expectedEnginesNode}" for platform compatibility (found "${enginesNode || '(missing)'}").`
    );
  }
  if (enginesNpm !== expectedEnginesNpm) {
    throw new Error(
      `package.json engines.npm must be "${expectedEnginesNpm}" for platform compatibility (found "${enginesNpm || '(missing)'}").`
    );
  }

  return {
    exactNode,
    exactNpm,
    nodeMajor,
    npmMajor,
  };
}

function printBlock(lines) {
  for (const line of lines) console.error(line);
}

function getNodeVersion() {
  // process.version is like "v20.19.6"
  const raw = process.version || '';
  return raw.startsWith('v') ? raw.slice(1) : raw;
}

function getNpmVersionFromUserAgent() {
  const ua = process.env.npm_config_user_agent || '';
  // Example: "npm/10.8.2 node/v20.19.6 darwin arm64 workspaces/false"
  const m = ua.match(/(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/);
  return m ? m[1] : null;
}

function fail(message) {
  let exactNode = '(unknown)';
  let exactNpm = '(unknown)';
  try {
    ({ exactNode, exactNpm } = getRepoToolchain());
  } catch {
    // ignore; message will still provide guidance
  }

  printBlock([
    '',
    'ERROR: Toolchain mismatch.',
    message,
    '',
    `Required (local/CI): Node ${exactNode} + npm ${exactNpm}`,
    `Detected: Node ${process.version} + npm ${process.env.npm_config_user_agent || '(unknown npm user agent)'}`,
    '',
    'Fix options (choose one):',
    '  1) Volta (recommended): https://volta.sh  (pins are in package.json)',
    '  2) macOS Homebrew: brew install node@20 && export PATH=\"/opt/homebrew/opt/node@20/bin:$PATH\"',
    '  3) nvm: nvm install && nvm use  (uses .nvmrc)',
    '',
    `Override (local experiments only): ${OVERRIDE_ENV}=1 npm ci`,
    '',
  ]);
  process.exit(1);
}

function warn(message) {
  printBlock([
    '',
    'WARNING: Toolchain mismatch (override enabled).',
    message,
    '',
  ]);
}

const overrideEnabled = process.env[OVERRIDE_ENV] === '1';

let exactNode;
let exactNpm;
let requiredNodeMajor;
let requiredNpmMajor;
try {
  const toolchain = getRepoToolchain();
  exactNode = toolchain.exactNode;
  exactNpm = toolchain.exactNpm;
  requiredNodeMajor = toolchain.nodeMajor;
  requiredNpmMajor = toolchain.npmMajor;
} catch (err) {
  fail(String(err?.message || err));
}

const nodeVersion = getNodeVersion();

const ua = process.env.npm_config_user_agent || '';
const isVercel = Boolean(process.env.VERCEL) || ua.includes('ci/vercel');

if (isVercel) {
  const actualMajor = parseMajor(nodeVersion);
  if (actualMajor !== requiredNodeMajor) {
    fail(`Node major must be ${requiredNodeMajor}.x on Vercel (got ${nodeVersion}).`);
  }
} else if (nodeVersion !== exactNode) {
  const msg = `Node must be exactly ${exactNode} (got ${nodeVersion}).`;
  if (overrideEnabled) warn(msg);
  else fail(msg);
}

const npmVersion = getNpmVersionFromUserAgent();
if (!npmVersion) {
  const msg =
    'Could not detect npm version from npm_config_user_agent. Please run installs with npm.';
  if (overrideEnabled) warn(msg);
  else fail(msg);
} else if (isVercel) {
  const actualMajor = parseMajor(npmVersion);
  if (actualMajor !== requiredNpmMajor) {
    fail(`npm major must be ${requiredNpmMajor}.x on Vercel (got ${npmVersion}).`);
  }
} else if (npmVersion !== exactNpm) {
  const msg = `npm must be exactly ${exactNpm} (got ${npmVersion}).`;
  if (overrideEnabled) warn(msg);
  else fail(msg);
}
