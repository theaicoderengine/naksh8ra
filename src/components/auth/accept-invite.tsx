"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

export function AcceptInvite({ token }: { token: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      {err && <Alert tone="danger">{err}</Alert>}
      <Button
        className="w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api<{ slug: string }>("/invitations/accept", { body: { token } });
            window.location.href = `/w/${r.slug}`;
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : "Could not accept invitation");
          } finally {
            setBusy(false);
          }
        }}
      >
        Accept invitation
      </Button>
    </div>
  );
}
