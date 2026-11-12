import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { issueLicense, verifyLicense, type LicensePayload } from '../server/license.js';

const keys = generateKeyPairSync('ed25519');
const now = Date.now();
const payload: LicensePayload = {
  version: 1,
  id: randomUUID(),
  customer: 'Test müşteri',
  installationId: randomUUID(),
  issuedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 86400000).toISOString(),
  plan: 'studio',
};
test('valid signature for matching installation enables live features', () => {
  const info = verifyLicense(
    issueLicense(payload, keys.privateKey),
    keys.publicKey,
    payload.installationId,
    now,
  );
  assert.equal(info.status, 'valid');
  assert.equal(info.liveAllowed, true);
});
test('a changed payload fails verification', () => {
  const file = issueLicense(payload, keys.privateKey);
  file.payload = Buffer.from(JSON.stringify({ ...payload, customer: 'Modified' })).toString('base64url');
  assert.equal(verifyLicense(file, keys.publicKey, payload.installationId, now).status, 'invalid');
});
test('wrong installation and wrong signing key are rejected', () => {
  const file = issueLicense(payload, keys.privateKey);
  assert.equal(verifyLicense(file, keys.publicKey, randomUUID(), now).status, 'invalid');
  assert.equal(
    verifyLicense(file, generateKeyPairSync('ed25519').publicKey, payload.installationId, now).status,
    'invalid',
  );
});
test('expired licenses are not live-enabled', () => {
  const info = verifyLicense(
    issueLicense(payload, keys.privateKey),
    keys.publicKey,
    payload.installationId,
    now + 86400001,
  );
  assert.equal(info.status, 'expired');
  assert.equal(info.liveAllowed, false);
});
test('malformed and future-issued licenses fail safely', () => {
  assert.equal(
    verifyLicense({ payload: 'broken', signature: '?' }, keys.publicKey, payload.installationId, now).status,
    'invalid',
  );
  const future = issueLicense(
    { ...payload, issuedAt: new Date(now + 3600000).toISOString() },
    keys.privateKey,
  );
  assert.equal(verifyLicense(future, keys.publicKey, payload.installationId, now).status, 'invalid');
});
