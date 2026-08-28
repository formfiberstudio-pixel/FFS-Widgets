import crypto from 'node:crypto';

// Notion tokens for every buyer now live in our KV store, not just our own --
// encrypt them at rest so a leaked/misconfigured KV store doesn't hand out
// plaintext tokens. TOKEN_ENCRYPTION_KEY must be a 32-byte key, base64 or
// hex encoded (openssl rand -base64 32).
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map(b => b.toString('base64')).join('.');
}

export function decryptSecret(payload) {
  const key = getKey();
  const [ivB64, authTagB64, encryptedB64] = payload.split('.');
  if (!ivB64 || !authTagB64 || !encryptedB64) throw new Error('Malformed encrypted payload');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// The tenant id is a one-way hash of the buyer's license key -- it's the
// only thing that ever appears in an embed URL. Nobody can work backwards
// from it to the license key, so exposing it in a Notion embed (which the
// buyer's own client might see) can't be used to re-run setup and hijack
// the tenant's stored Notion token; that still requires the real license key.
export function tenantIdFromLicenseKey(licenseKey) {
  return crypto.createHash('sha256').update(licenseKey.trim()).digest('hex').slice(0, 32);
}
