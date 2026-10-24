"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Select } from "../ui/form";
import { Table, Th, Td, Tr } from "../ui/table";

type Member = { userId: string; name: string; email: string; roleKey: string };
type A = { userId: string; role: string };

export function TeamAssign({ jobId, members, initial }: { jobId: string; members: Member[]; initial: A[] }) {
  const org = useOrg();
  const [rows, setRows] = useState<A[]>(initial);
  const [pick, setPick] = useState({ userId: "", role: "RECRUITER" });
  const save = useAction(() => api(`/jobs/${jobId}/assignments`, { method: "PUT", org: org.slug, body: { assignments: rows } }), { success: "Hiring team saved" });
  const canEdit = org.can("jobs.edit");
  return (
    <div className="space-y-4">
      <Table caption="Hiring team">
        <thead><tr><Th>Member</Th><Th>Role on this vacancy</Th><Th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={3} className="text-subtle">No one is assigned. Recruiters and hiring managers only see vacancies they&apos;re assigned to.</Td></tr>}
          {rows.map((r, i) => {
            const m = members.find((x) => x.userId === r.userId);
            return (
              <Tr key={`${r.userId}-${r.role}`}>
                <Td><p className="font-medium">{m?.name ?? "Former member"}</p><p className="text-xs text-subtle">{m?.email}</p></Td>
                <Td>{r.role.replace("_", " ").toLowerCase()}</Td>
                <Td className="text-right">{canEdit && <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Member" className="w-64" value={pick.userId} onChange={(e) => setPick({ ...pick, userId: e.target.value })}><option value="">Choose member…</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email} ({m.roleKey.replace("_", " ").toLowerCase()})</option>)}</Select>
          <Select aria-label="Role" className="w-48" value={pick.role} onChange={(e) => setPick({ ...pick, role: e.target.value })}><option value="RECRUITER">Recruiter</option><option value="HIRING_MANAGER">Hiring manager</option><option value="REVIEWER">Reviewer</option></Select>
          <Button variant="secondary" disabled={!pick.userId} onClick={() => { setRows([...rows.filter((r) => !(r.userId === pick.userId && r.role === pick.role)), pick]); setPick({ ...pick, userId: "" }); }}>Add</Button>
          <Button loading={save.pending} onClick={() => save.run()}>Save team</Button>
        </div>
      )}
    </div>
  );
}
