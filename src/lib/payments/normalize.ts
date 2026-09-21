/**
 * Identity keys for the customer spine, mirrored byte-for-byte from Trace's
 * `src/modules/sync/identity.service.ts` (normalizeEmail / normalizePhone).
 * Trace matches its synced payments to people with exactly these rules, so a
 * hand-recorded payment must resolve the same person the same way or it lands
 * on a duplicate customer. Twins of these live in Postgres as
 * identity_normalize_email/phone (migration 20260921090000) and
 * tests/manual-payments-rpc.test.ts asserts parity on shared fixtures.
 *
 * Both return null, never '' — customers' partial unique indexes and its
 * CHECK(email_norm is not null or phone_norm is not null) depend on it.
 */

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v.length <= 3 || !v.includes("@")) return null;
  return v;
}

// Digits only, last 10 — strips +91 / 91 / 0 prefixes so every format the
// coach might type collides onto one key.
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
