"use client";

import { useActionState, useEffect, useRef } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientRow } from "@/lib/queries/overview";
import { addClientUser, type ActionState } from "./actions";

const CONTROL =
  "h-9 rounded-lg border border-border bg-white/5 px-3 text-sm text-white transition-colors placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none";

/**
 * Adding a client user is the whole invite flow: no email is sent, nothing is
 * pending. The row pre-authorizes that address, and they get in the moment
 * they sign in with Google.
 */
export function AddUserForm({ clients }: { clients: ClientRow[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addClientUser,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="name@company.com"
          aria-label="Email address"
          className={`${CONTROL} min-w-56 flex-1`}
        />
        <select
          name="clientId"
          required
          defaultValue=""
          aria-label="Client account"
          className={`${CONTROL} max-w-52 flex-1`}
        >
          <option value="" disabled>
            Choose client…
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="lg" disabled={pending}>
          <UserPlus size={15} aria-hidden="true" />
          {pending ? "Adding…" : "Add client user"}
        </Button>
      </div>
      {state.error && (
        <p className="text-xs text-danger-foreground">{state.error}</p>
      )}
    </form>
  );
}
