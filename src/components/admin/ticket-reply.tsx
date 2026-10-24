"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Textarea, Select, Checkbox } from "../ui/form";

export function TicketReply({ id, status }: { id: string; status: string }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [st, setSt] = useState(status === "OPEN" ? "PENDING" : status);
  const r = useAction(() => api(`/platform/tickets/${id}`, { body: { body, internal, status: st } }), { success: "Reply saved", onSuccess: () => setBody("") });
  return (
    <div className="space-y-2">
      <Textarea aria-label="Reply" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3"><Checkbox id="internal" checked={internal} onChange={(e) => setInternal(e.target.checked)} label="Internal note (not visible to customer)" /><Select aria-label="Status" className="w-40" value={st} onChange={(e) => setSt(e.target.value)}><option>OPEN</option><option>PENDING</option><option>RESOLVED</option><option>CLOSED</option></Select><Button size="sm" loading={r.pending} disabled={!body.trim()} onClick={() => r.run()}>Send</Button></div>
    </div>
  );
}
