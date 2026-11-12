import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { issueLicense } from '../server/license.js';

const [command, ...args] = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}
function required(name: string) {
  const value = option(name);
  if (!value || value.startsWith('--')) throw new Error(`--${name} gerekli.`);
  return value;
}
try {
  if (command === 'keygen') {
    const out = resolve(option('out') ?? 'private-keys');
    if (existsSync(resolve(out, 'private.pem')) || existsSync(resolve(out, 'public.pem')))
      throw new Error('Anahtar dosyaları zaten var; üzerine yazılmadı.');
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    writeFileSync(resolve(out, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
      flag: 'wx',
    });
    writeFileSync(resolve(out, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }), {
      mode: 0o644,
      flag: 'wx',
    });
    console.log(
      `Anahtarlar oluşturuldu: ${out}\nprivate.pem dosyasını müşteriye gönderme veya git'e ekleme.`,
    );
  } else if (command === 'issue') {
    const days = Number(required('days'));
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('--days 1–3650 aralığında olmalı.');
    const file = issueLicense(
      {
        version: 1,
        id: randomUUID(),
        customer: required('customer'),
        installationId: required('installation'),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
        plan: 'studio',
      },
      readFileSync(resolve(required('key')), 'utf8'),
    );
    const out = resolve(required('out'));
    if (!out.endsWith('.license.json')) throw new Error('Çıktı adı .license.json ile bitmeli.');
    if (!existsSync(dirname(out))) throw new Error('Çıktı klasörü mevcut değil.');
    writeFileSync(out, JSON.stringify(file, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Lisans oluşturuldu: ${out}`);
  } else
    throw new Error(
      'Komut: keygen --out private-keys | issue --key ... --customer ... --installation ... --days 365 --out customer.license.json',
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lisans işlemi başarısız.');
  process.exitCode = 1;
}
