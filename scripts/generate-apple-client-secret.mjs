import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

function normalizePemValue(value) {
  if (!value) return null;
  return String(value).trim().replace(/\\n/g, '\n');
}

function readExpiryDays() {
  const raw = process.env.APPLE_SIGN_IN_EXPIRES_IN_DAYS?.trim();
  if (!raw) return 180;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('APPLE_SIGN_IN_EXPIRES_IN_DAYS must be a positive integer.');
  }
  if (value > 180) {
    throw new Error('APPLE_SIGN_IN_EXPIRES_IN_DAYS cannot exceed 180.');
  }
  return value;
}

function createAppleClientSecret() {
  const teamId = readRequiredEnv('APPLE_SIGN_IN_TEAM_ID');
  const clientId = readRequiredEnv('APPLE_SIGN_IN_CLIENT_ID');
  const keyId = readRequiredEnv('APPLE_SIGN_IN_KEY_ID');
  const inlinePrivateKey = normalizePemValue(readOptionalEnv('APPLE_SIGN_IN_PRIVATE_KEY'));
  const privateKeyPath = readOptionalEnv('APPLE_SIGN_IN_PRIVATE_KEY_PATH');
  const resolvedPrivateKeyPath = privateKeyPath ? path.resolve(privateKeyPath) : null;
  const privateKeyPem = inlinePrivateKey || (resolvedPrivateKeyPath ? normalizePemValue(fs.readFileSync(resolvedPrivateKeyPath, 'utf8')) : null);
  if (!privateKeyPem) {
    throw new Error('APPLE_SIGN_IN_PRIVATE_KEY or APPLE_SIGN_IN_PRIVATE_KEY_PATH is required.');
  }
  const now = Math.floor(Date.now() / 1000);
  const expiresInDays = readExpiryDays();
  const expiresAt = now + expiresInDays * 24 * 60 * 60;

  const encodedHeader = base64UrlEncode(
    JSON.stringify({
      alg: 'ES256',
      kid: keyId,
      typ: 'JWT'
    })
  );
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: expiresAt,
      aud: 'https://appleid.apple.com',
      sub: clientId
    })
  );

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), createPrivateKey(privateKeyPem));
  const token = `${signingInput}.${base64UrlEncode(signature)}`;

  return {
    token,
    teamId,
    clientId,
    keyId,
    expiresAt,
    issuedAt: now,
    privateKeyPath: resolvedPrivateKeyPath
  };
}

function main() {
  const rawOutput = process.argv.includes('--raw');
  const secret = createAppleClientSecret();

  if (rawOutput) {
    process.stdout.write(secret.token);
    return;
  }

  process.stdout.write(
    JSON.stringify(
      {
        teamId: secret.teamId,
        clientId: secret.clientId,
        keyId: secret.keyId,
        privateKeyPath: secret.privateKeyPath,
        issuedAt: new Date(secret.issuedAt * 1000).toISOString(),
        expiresAt: new Date(secret.expiresAt * 1000).toISOString(),
        token: secret.token
      },
      null,
      2
    )
  );
}

main();
