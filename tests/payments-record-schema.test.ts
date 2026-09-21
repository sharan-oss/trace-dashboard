import { describe, expect, it } from "vitest";
import { flattenFieldErrors, recordSchemaFor } from "@/lib/payments/record-schema";
import { PAYMENT_METHODS, referenceHintFor } from "@/lib/payments/methods";

const TODAY = "2026-09-21";
const KEY = "5b2d3f4e-1111-4222-8333-444455556666";
const CUSTOMER = "0323164b-74ba-4bd6-abca-50925cca8e05";

const base = {
  customerMode: "existing",
  customerId: CUSTOMER,
  amount: "9724.20",
  paidDay: TODAY,
  method: "gpay",
  reference: "",
  productName: "Coaching program",
  note: "",
  idempotencyKey: KEY,
  confirmDuplicate: "",
};

describe("recordSchemaFor", () => {
  it("accepts a complete existing-customer submission and yields paise", () => {
    const parsed = recordSchemaFor(TODAY).safeParse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.amountPaise).toBe(972420);
    expect(parsed.data.customerId).toBe(CUSTOMER);
    expect(parsed.data.confirmDuplicate).toBe(false);
  });

  it("requires a customer id in existing mode", () => {
    const parsed = recordSchemaFor(TODAY).safeParse({ ...base, customerId: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(flattenFieldErrors(parsed.error)).toHaveProperty("customerId");
  });

  it("in new mode requires a name and at least one usable identity key", () => {
    const schema = recordSchemaFor(TODAY);
    const noKeys = schema.safeParse({
      ...base,
      customerMode: "new",
      customerId: "",
      newName: "Someone",
      newEmail: "not-an-email",
      newPhone: "123",
    });
    expect(noKeys.success).toBe(false);
    if (!noKeys.success) {
      // Catches: accepting '' as a key, which the DB CHECK would reject
      // later with a message no one can act on.
      expect(flattenFieldErrors(noKeys.error)).toHaveProperty("newEmail");
    }

    const phoneOnly = schema.safeParse({
      ...base,
      customerMode: "new",
      customerId: "",
      newName: "Someone",
      newEmail: "",
      newPhone: "+91 98765 43210",
    });
    expect(phoneOnly.success).toBe(true);

    const noName = schema.safeParse({
      ...base,
      customerMode: "new",
      customerId: "",
      newName: "  ",
      newEmail: "a@b.co",
      newPhone: "",
    });
    expect(noName.success).toBe(false);
    if (!noName.success) expect(flattenFieldErrors(noName.error)).toHaveProperty("newName");
  });

  it("rejects a future payment day and a malformed one", () => {
    const schema = recordSchemaFor(TODAY);
    expect(schema.safeParse({ ...base, paidDay: "2026-09-22" }).success).toBe(false);
    expect(schema.safeParse({ ...base, paidDay: "21/09/2026" }).success).toBe(false);
    expect(schema.safeParse({ ...base, paidDay: TODAY }).success).toBe(true);
  });

  it("rejects an unknown method and a bad amount with field-keyed errors", () => {
    const schema = recordSchemaFor(TODAY);
    const m = schema.safeParse({ ...base, method: "venmo" });
    expect(m.success).toBe(false);
    if (!m.success) expect(flattenFieldErrors(m.error)).toHaveProperty("method");
    const a = schema.safeParse({ ...base, amount: "0" });
    expect(a.success).toBe(false);
    if (!a.success) expect(flattenFieldErrors(a.error).amount).toMatch(/amount/i);
  });

  it("caps reference, product and note lengths", () => {
    const schema = recordSchemaFor(TODAY);
    expect(schema.safeParse({ ...base, reference: "x".repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ ...base, productName: "x".repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ ...base, note: "x".repeat(301) }).success).toBe(false);
  });

  it("reads the confirmDuplicate checkbox value", () => {
    const parsed = recordSchemaFor(TODAY).safeParse({ ...base, confirmDuplicate: "1" });
    expect(parsed.success && parsed.data.confirmDuplicate).toBe(true);
  });
});

describe("payment methods", () => {
  it("lists the Indian off-platform reality, gpay first", () => {
    expect(PAYMENT_METHODS[0].slug).toBe("gpay");
    expect(PAYMENT_METHODS.map((m) => m.slug)).toEqual([
      "gpay",
      "phonepe",
      "upi",
      "bank_transfer",
      "cash",
      "cheque",
      "other",
    ]);
  });

  it("gives a method-aware reference hint", () => {
    // Razorpay's own vocabulary: UPI payments reconcile on the 12-digit RRN/UTR.
    expect(referenceHintFor("gpay")).toMatch(/UTR/);
    expect(referenceHintFor("cheque")).toMatch(/cheque/i);
    expect(referenceHintFor("cash")).toMatch(/optional/i);
  });
});
