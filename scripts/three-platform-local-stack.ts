import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { LOCAL_ACCEPTANCE_USERS } from './three-platform-local-fixture';

export const ROOT = process.cwd();

function readPinnedNpmVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    volta?: { npm?: string };
  };
  const version = packageJson.volta?.npm?.trim();
  if (!version) {
    throw new Error('Missing package.json volta.npm pin.');
  }
  return version;
}

const PINNED_NPM_VERSION = readPinnedNpmVersion();

export type LocalSupabaseStatus = {
  API_URL: string;
  ANON_KEY: string;
  DB_URL: string;
  SERVICE_ROLE_KEY: string;
};

function resolveCommand(command: string, args: string[]) {
  const npmExecPath = process.env.npm_execpath?.trim();
  if (command === 'npm' && npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args]
    };
  }

  return { command, args };
}

type RunCommandOptions = {
  env?: NodeJS.ProcessEnv;
  optional?: boolean;
};

function extractStatusJson(output: string) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Unable to parse Supabase status output:\n${output}`);
  }

  return JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>;
}

function requireStatusValue(status: Record<string, unknown>, key: keyof LocalSupabaseStatus) {
  const value = typeof status[key] === 'string' ? status[key].trim() : '';
  if (!value) {
    throw new Error(`Supabase status is missing ${key}.`);
  }
  return value;
}

export function runRootCommand(command: string, args: string[], options: RunCommandOptions = {}) {
  const resolved = resolveCommand(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ...options.env,
      npm_config_user_agent:
        typeof options.env?.npm_config_user_agent === 'string'
          ? options.env.npm_config_user_agent
          :
        `npm/${PINNED_NPM_VERSION} node/v${process.version.replace(/^v/, '')} ${process.platform} ${process.arch} workspaces/true`
    }
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0 && !options.optional) {
    throw new Error(`Command failed: ${resolved.command} ${resolved.args.join(' ')}`);
  }

  return result;
}

export function readLocalSupabaseStatus() {
  const result = spawnSync('supabase', ['status', '-o', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'Unable to read local Supabase status.');
  }

  const status = extractStatusJson(`${result.stdout || ''}${result.stderr || ''}`);
  return {
    API_URL: requireStatusValue(status, 'API_URL'),
    ANON_KEY: requireStatusValue(status, 'ANON_KEY'),
    DB_URL: requireStatusValue(status, 'DB_URL'),
    SERVICE_ROLE_KEY: requireStatusValue(status, 'SERVICE_ROLE_KEY')
  } satisfies LocalSupabaseStatus;
}

export function ensureLocalSupabaseStarted() {
  try {
    return readLocalSupabaseStatus();
  } catch {
    runRootCommand('supabase', ['start']);
    return readLocalSupabaseStatus();
  }
}

export function resetLocalSupabase() {
  runRootCommand('supabase', ['db', 'reset', '--local', '--no-seed', '--yes']);
  return readLocalSupabaseStatus();
}

function replaceHost(url: string, host: string) {
  const parsed = new URL(url);
  parsed.hostname = host;
  return parsed.toString().replace(/\/+$/, '');
}

export function buildLocalWebEnv(status: LocalSupabaseStatus): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY
  };
}

export function buildLocalMobileE2EEnv(
  status: LocalSupabaseStatus,
  platform: 'ios' | 'android'
): NodeJS.ProcessEnv {
  const deviceHost = platform === 'android' ? '10.0.2.2' : '127.0.0.1';

  return {
    ...process.env,
    EXPO_PUBLIC_API_BASE_URL: replaceHost('http://127.0.0.1:3000', deviceHost),
    EXPO_PUBLIC_SUPABASE_URL: replaceHost(status.API_URL, deviceHost),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    EXPO_PUBLIC_EAS_PROJECT_ID: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '00000000-0000-4000-8000-000000000000',
    EXPO_PUBLIC_MOBILE_E2E_PUSH: '1',
    EXPO_PUBLIC_MOBILE_E2E_PUSH_TOKEN: 'ExponentPushToken[detox-local]',
    TMZ_MOBILE_E2E_EMAIL: LOCAL_ACCEPTANCE_USERS.premium.email,
    TMZ_MOBILE_E2E_PASSWORD: LOCAL_ACCEPTANCE_USERS.premium.password
  };
}

export function spawnRootProcess(
  command: string,
  args: string[],
  {
    env,
    logFile
  }: {
    env?: NodeJS.ProcessEnv;
    logFile: string;
  }
): ChildProcess {
  const resolved = resolveCommand(command, args);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(resolved.command, resolved.args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
      npm_config_user_agent:
        typeof env?.npm_config_user_agent === 'string'
          ? env.npm_config_user_agent
          :
        `npm/${PINNED_NPM_VERSION} node/v${process.version.replace(/^v/, '')} ${process.platform} ${process.arch} workspaces/true`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  return child;
}

export async function waitForHttpReady(url: string, options?: { timeoutMs?: number; headers?: Record<string, string> }) {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: options?.headers
      });
      if (response.status < 500) {
        return;
      }
    } catch {
      // Server is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}`);
}
