import { verify, sign, type KeyLike } from 'node:crypto';
import { z } from 'zod';
import type { LicenseInfo } from '../shared/schema.js';
import type { Store } from './store.js';

const payloadSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    customer: z.string().min(1).max(120),
    installationId: z.string().uuid(),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    plan: z.literal('studio'),
  })
  .strict();
export type LicensePayload = z.infer<typeof payloadSchema>;
export const licenseFileSchema = z
  .object({ payload: z.string().min(1).max(4000), signature: z.string().min(1).max(300) })
  .strict();
export type LicenseFile = z.infer<typeof licenseFileSchema>;

export function issueLicense(payload: LicensePayload, privateKey: KeyLike): LicenseFile {
  const encoded = Buffer.from(JSON.stringify(payloadSchema.parse(payload))).toString('base64url');
  return { payload: encoded, signature: sign(null, Buffer.from(encoded), privateKey).toString('base64url') };
}

export function verifyLicense(
  file: unknown,
  publicKey: KeyLike,
  installationId: string,
  now = Date.now(),
): LicenseInfo {
  const base = { installationId, liveAllowed: false };
  try {
    const signed = licenseFileSchema.parse(file);
    if (!verify(null, Buffer.from(signed.payload), publicKey, Buffer.from(signed.signature, 'base64url')))
      throw new Error('signature');
    const payload = payloadSchema.parse(
      JSON.parse(Buffer.from(signed.payload, 'base64url').toString('utf8')),
    );
    if (
      payload.installationId !== installationId ||
      Date.parse(payload.issuedAt) > now + 5 * 60_000 ||
      Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)
    )
      throw new Error('installation');
    const info = { ...base, customer: payload.customer, expiresAt: payload.expiresAt };
    if (Date.parse(payload.expiresAt) <= now)
      return { ...info, status: 'expired', message: 'Lisans süresi doldu. Demo modu kullanılabilir.' };
    return { ...info, status: 'valid', message: 'Studio lisansı doğrulandı.', liveAllowed: true };
  } catch {
    return { ...base, status: 'invalid', message: 'Lisans imzası veya kurulum kimliği geçersiz.' };
  }
}

export class LicenseManager {
  constructor(
    private store: Store,
    private publicKey?: string,
    private ownerOverride = false,
  ) {}
  info(): LicenseInfo {
    const installationId = this.store.get<string>('installationId')!;
    if (!this.publicKey)
      return {
        status: 'development',
        installationId,
        liveAllowed: this.ownerOverride,
        message: this.ownerOverride
          ? 'Sahip geliştirme modu; lisans denetimi devre dışı.'
          : 'Demo kurulumu. Canlı bağlantı için lisans yapılandırması gerekli.',
      };
    const file = this.store.get('license');
    if (!file)
      return {
        status: 'missing',
        installationId,
        liveAllowed: false,
        message: 'Bu kurulum için lisans dosyası yükle.',
      };
    return verifyLicense(file, this.publicKey, installationId);
  }
  activate(file: unknown) {
    if (!this.publicKey) throw new Error('Sunucuda LICENSE_PUBLIC_KEY_FILE yapılandırılmamış.');
    const info = verifyLicense(file, this.publicKey, this.store.get<string>('installationId')!);
    if (info.status !== 'valid') throw new Error(info.message);
    this.store.set('license', licenseFileSchema.parse(file));
    return info;
  }
}
