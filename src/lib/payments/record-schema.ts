import { z } from "zod";
import { parseDayParam } from "@/lib/range";
import { parseRupeesToPaise } from "./amount";
import { METHOD_SLUGS } from "./methods";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * The record-payment form, validated once on the client (submit-time error
 * summary, GOV.UK style) and again in the server action — the same schema so
 * the two can never disagree. Field names are the form's input names.
 *
 * Every value arrives as a FormData string; the schema turns them into what
 * the RPC wants (paise, booleans, normalised keys). Built per request with
 * today's IST day so "not in the future" is decided where the clock is.
 */

const trimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .transform((v) => v ?? "");

export const RECORD_FIELDS = [
  "customerMode",
  "customerId",
  "newName",
  "newEmail",
  "newPhone",
  "amount",
  "paidDay",
  "method",
  "reference",
  "productName",
  "note",
  "idempotencyKey",
  "confirmDuplicate",
] as const;

export type RecordField = (typeof RECORD_FIELDS)[number];
export type FieldErrors = Partial<Record<RecordField, string>>;

export function recordSchemaFor(today: string) {
  return z
    .object({
      customerMode: z.enum(["existing", "new"]),
      customerId: z.string().trim().optional().transform((v) => v ?? ""),
      newName: trimmed(120),
      newEmail: trimmed(254),
      newPhone: trimmed(32),
      amount: z.string().trim(),
      paidDay: z
        .string()
        // parseDayParam rejects "2026-02-31" rather than rolling it into March.
        .refine((d) => parseDayParam(d) != null, "Enter the date received")
        .refine((d) => d <= today, "Date received cannot be in the future"),
      method: z.enum(METHOD_SLUGS, { error: "Choose how the payment was made" }),
      reference: trimmed(100),
      productName: trimmed(200),
      note: trimmed(300),
      idempotencyKey: z.uuid("Missing submission key — reload and try again"),
      confirmDuplicate: z
        .string()
        .optional()
        .transform((v) => v === "1" || v === "true" || v === "on"),
    })
    .superRefine((v, ctx) => {
      if (v.customerMode === "existing") {
        if (!z.uuid().safeParse(v.customerId).success) {
          ctx.addIssue({ code: "custom", path: ["customerId"], message: "Choose a customer" });
        }
      } else {
        if (v.newName.length === 0) {
          ctx.addIssue({ code: "custom", path: ["newName"], message: "Enter the customer's name" });
        }
        if (normalizeEmail(v.newEmail) == null && normalizePhone(v.newPhone) == null) {
          ctx.addIssue({
            code: "custom",
            path: ["newEmail"],
            message: "Enter a valid email or a 10-digit phone number",
          });
        }
      }
      if (parseRupeesToPaise(v.amount) == null) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: "Enter the amount in rupees, e.g. 9724.20",
        });
      }
    })
    .transform((v) => ({
      ...v,
      amountPaise: parseRupeesToPaise(v.amount) ?? 0,
      customerId: v.customerMode === "existing" ? v.customerId : null,
      emailNorm: normalizeEmail(v.newEmail),
      phoneNorm: normalizePhone(v.newPhone),
    }));
}

export type RecordInput = z.output<ReturnType<typeof recordSchemaFor>>;

/** One message per field — the first issue wins, GOV.UK style. */
export function flattenFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in out)) {
      out[field as RecordField] = issue.message;
    }
  }
  return out;
}
