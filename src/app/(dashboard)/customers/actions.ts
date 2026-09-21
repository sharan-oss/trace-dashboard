"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getIdentity } from "@/lib/auth/session";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { getClients, istToday } from "@/lib/queries/overview";
import {
  searchCustomersForRecord,
  type CustomerHit,
  type DuplicateMatch,
  type RecordOutcome,
} from "@/lib/queries/manual-payments";
import {
  flattenFieldErrors,
  recordSchemaFor,
  type FieldErrors,
} from "@/lib/payments/record-schema";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Record and void hand-recorded upsell payments.
 *
 * Both go through the caller's own RLS-scoped client into security-invoker
 * RPCs (migration 20260921090000), so the database is the authorization: a
 * client user can only ever write under their own client_id, and only an
 * admin's void matches a policy row. Nothing here re-implements that. The
 * client is resolved from the cookie exactly as every page does — never from
 * the form, which anyone can edit.
 *
 * Server Functions are reachable by direct POST, so identity is checked here
 * and input is re-validated with the same zod schema the form ran.
 */

export type RecordState = {
  /** Echo of the submission's idempotency key so the form can match state to attempt. */
  key?: string;
  recorded?: {
    paymentId: string;
    customerId: string;
    customerName: string;
    amountPaise: number;
    createdCustomer: boolean;
  };
  duplicate?: DuplicateMatch;
  conflict?: { emailCustomer: CustomerHit; phoneCustomer: CustomerHit };
  error?: string;
  fieldErrors?: FieldErrors;
};

type RpcError = { code?: string; message: string; details?: string | null };

function fieldFromDetails(details: string | null | undefined): string | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { field?: unknown };
    return typeof parsed.field === "string" ? parsed.field : null;
  } catch {
    return null;
  }
}

async function selectedClientId(): Promise<string | null> {
  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const cookieStore = await cookies();
  return resolveSelectedClient(clients, cookieStore.get(CLIENT_COOKIE)?.value)?.id ?? null;
}

export async function recordManualPayment(
  _previous: RecordState,
  formData: FormData,
): Promise<RecordState> {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  const key = raw.idempotencyKey;

  const parsed = recordSchemaFor(istToday()).safeParse(raw);
  if (!parsed.success) {
    return { key, fieldErrors: flattenFieldErrors(parsed.error) };
  }
  const input = parsed.data;

  const identity = await getIdentity();
  if (!identity) return { key, error: "Your session expired — sign in again." };

  const clientId = await selectedClientId();
  if (clientId == null) return { key, error: "No client is selected." };
  // Belt and braces — RLS refuses this anyway, but the message is kinder.
  if (!identity.isAdmin && identity.clientId !== clientId) {
    return { key, error: "You can't record payments for this client." };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("record_manual_payment", {
    p_client_id: clientId,
    p_amount_paise: input.amountPaise,
    p_paid_day: input.paidDay,
    p_method: input.method,
    p_idempotency_key: input.idempotencyKey,
    p_customer_id: input.customerId,
    p_new_name: input.customerMode === "new" ? input.newName : null,
    p_new_email: input.customerMode === "new" ? input.newEmail || null : null,
    p_new_phone: input.customerMode === "new" ? input.newPhone || null : null,
    p_reference: input.reference || null,
    p_product_name: input.productName || null,
    p_note: input.note || null,
    p_confirm_duplicate: input.confirmDuplicate,
  });

  if (error) return { key, ...mapRecordError(error as RpcError) };

  const outcome = data as RecordOutcome;
  if (outcome.outcome === "duplicate") return { key, duplicate: outcome.match };
  if (outcome.outcome === "conflict") {
    return {
      key,
      conflict: {
        emailCustomer: outcome.email_customer,
        phoneCustomer: outcome.phone_customer,
      },
    };
  }

  // Overview, Ads and Customers all show L2 revenue.
  revalidatePath("/", "layout");
  return {
    key,
    recorded: {
      paymentId: outcome.payment_id,
      customerId: outcome.customer_id,
      customerName: outcome.customer_name,
      amountPaise: outcome.amount_paise,
      createdCustomer: outcome.created_customer,
    },
  };
}

function mapRecordError(error: RpcError): Pick<RecordState, "error" | "fieldErrors"> {
  switch (error.code) {
    case "TRVAL": {
      const field = fieldFromDetails(error.details);
      return field
        ? { fieldErrors: { [field]: error.message } as FieldErrors }
        : { error: error.message };
    }
    case "TRNOC":
      return { error: "That customer is no longer available — search again." };
    case "42501":
      return { error: "You can't record payments for this client." };
    default:
      return {
        error: /row-level security/i.test(error.message)
          ? "You can't record payments for this client."
          : error.message,
      };
  }
}

export type VoidState = { error?: string; ok?: boolean };

const VoidInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, "Give a short reason").max(300),
});

export async function voidManualPayment(
  _previous: VoidState,
  formData: FormData,
): Promise<VoidState> {
  const parsed = VoidInput.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: "Give a short reason for voiding." };

  const identity = await getIdentity();
  if (!identity) return { error: "Your session expired — sign in again." };

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("void_manual_payment", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const e = error as RpcError;
    return {
      error:
        e.code === "TRNOV"
          ? "Only a captured hand-recorded payment can be voided."
          : e.message,
    };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The combobox's search. Read-only, cookie-authenticated; RLS scopes the
 * result so a client user can only see their own people whatever clientId
 * they send.
 */
export async function searchCustomers(q: string): Promise<CustomerHit[]> {
  const clientId = await selectedClientId();
  if (clientId == null) return [];
  const supabase = await createServerClient();
  return searchCustomersForRecord(supabase, clientId, q);
}
