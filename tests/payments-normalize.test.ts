import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "@/lib/payments/normalize";

/**
 * Byte-for-byte mirror of Trace's identity.service.ts (normalizeEmail /
 * normalizePhone). These cases are also run through the SQL twins
 * identity_normalize_email/phone in tests/manual-payments-rpc.test.ts, so
 * the two implementations cannot drift without a test noticing.
 */
export const EMAIL_CASES: Array<[string | null, string | null]> = [
  [" A@B.co ", "a@b.co"],
  ["Hetal6381@Gmail.com", "hetal6381@gmail.com"],
  ["ab@", null], // length <= 3
  ["abcd", null], // no @
  ["", null],
  [null, null],
  ["  ", null],
  ["first.last+tag@gmail.com", "first.last+tag@gmail.com"], // no dot/plus stripping
];

export const PHONE_CASES: Array<[string | null, string | null]> = [
  ["+91 98765-43210", "9876543210"],
  ["919818121133", "9818121133"], // 12 digits -> last 10
  ["09880758030", "9880758030"], // leading 0 dropped by last-10
  ["0123456789", "0123456789"], // exactly 10, kept as-is
  ["12345", null], // < 10 digits
  ["", null],
  [null, null],
  ["abc", null],
  ["(988) 012-3321", "9880123321"],
];

describe("normalizeEmail", () => {
  it.each(EMAIL_CASES)("%j -> %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it("never returns an empty string", () => {
    // '' would collide on customers' partial unique index and violate the
    // CHECK(email_norm is not null or phone_norm is not null) semantics.
    for (const [input] of EMAIL_CASES) expect(normalizeEmail(input)).not.toBe("");
  });
});

describe("normalizePhone", () => {
  it.each(PHONE_CASES)("%j -> %j", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("never returns an empty string", () => {
    for (const [input] of PHONE_CASES) expect(normalizePhone(input)).not.toBe("");
  });
});
