"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Select, Textarea, Field } from "../ui/form";
import { Table, Th, Td, Tr } from "../ui/table";
import { Badge } from "../ui/badge";
import { ConfirmButton } from "../confirm";
import { Card, CardHeader, CardBody } from "../ui/card";
import { fmtDate, fmtRelative } from "@/lib/format";

type Member = { id: string; userId: string; email: string; name: string; roleKey: string; roleName: string; mfaEnabled: boolean; lastLoginAt: string | null; joinedAt: string };
type Inv = { id: string; email: string; roleKey: string; expiresAt: string; expired: boolean };
type Role = { key: string; name: string; description: string };

export function TeamManager({ members, invitations, roles, me, seats }: { members: Member[]; invitations: Inv[]; roles: Role[]; me: string; seats: { used: number; limit: number } }) {
  const org = useOrg();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState(roles.find((r) => r.key !== "OWNER")?.key ?? "");
  const invite = useAction(() => api<{ results: { email: string; status: string }[] }>("/memberships/invitations", { org: org.slug, body: { invites: emails.split(/[\s,;]+/).filter(Boolean).map((email) => ({ email, roleKey: role })) } }), {
    success: (r) => `${r.results.filter((x) => x.status === "invited").length} invitation(s) sent${r.results.some((x) => x.status === "already_member") ? "; some were already members" : ""}`,
    onSuccess: () => setEmails(""),
  });
  const changeRole = useAction((id: string, roleKey: string) => api(`/memberships/${id}`, { method: "PATCH", org: org.slug, body: { roleKey } }), { success: "Role updated" });
  const remove = useAction((id: string) => api(`/memberships/${id}`, { method: "DELETE", org: org.slug }), { success: "Member removed" });
  const revoke = useAction((id: string) => api(`/memberships/invitations/${id}`, { method: "DELETE", org: org.slug }), { success: "Invitation revoked" });
  const transfer = useAction((id: string) => api(`/memberships/${id}/transfer-ownership`, { org: org.slug, body: { confirm: true } }), { success: "Ownership transferred" });
  return (
    <div className="space-y-6">
      {org.can("members.invite") && (
        <Card><CardHeader title="Invite colleagues" description={`${seats.used} of ${seats.limit} seats used (members + pending invitations).`} /><CardBody className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <Field id="emails" label="Email addresses" hint="Separate with commas or new lines"><Textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} /></Field>
            <Field id="role" label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></Field>
          </div>
          <p className="text-xs text-subtle">{roles.find((r) => r.key === role)?.description}</p>
          <Button loading={invite.pending} disabled={!emails.trim()} onClick={() => invite.run()}>Send invitations</Button>
        </CardBody></Card>
      )}
      <Table caption="Members">
        <thead><tr><Th>Member</Th><Th>Role</Th><Th>MFA</Th><Th>Last sign-in</Th><Th>Joined</Th><Th /></tr></thead>
        <tbody>{members.map((m) => (
          <Tr key={m.id}>
            <Td><p className="font-medium">{m.name || m.email}{m.userId === me && <span className="ml-1 text-xs text-subtle">(you)</span>}</p><p className="text-xs text-subtle">{m.email}</p></Td>
            <Td>{org.can("members.manage") && m.userId !== me && roles.some((r) => r.key === m.roleKey) ? (
              <Select aria-label={`Role for ${m.email}`} className="h-8 w-48 text-sm" value={m.roleKey} onChange={(e) => changeRole.run(m.id, e.target.value)}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select>
            ) : <Badge tone={m.roleKey === "OWNER" ? "primary" : "neutral"}>{m.roleName}</Badge>}</Td>
            <Td>{m.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}</Td>
            <Td className="text-subtle">{fmtRelative(m.lastLoginAt)}</Td>
            <Td className="text-subtle">{fmtDate(m.joinedAt)}</Td>
            <Td className="text-right"><div className="flex justify-end gap-2">
              {org.can("org.transfer") && m.userId !== me && <ConfirmButton variant="secondary" label="Make owner" title={`Transfer ownership to ${m.email}?`} description="You will become an administrator. This is recorded in the audit log." onConfirm={() => transfer.run(m.id)} />}
              {org.can("members.manage") && m.userId !== me && <ConfirmButton label="Remove" title={`Remove ${m.email}?`} description="They lose access immediately. Their job assignments are cleared." onConfirm={() => remove.run(m.id)} />}
            </div></Td>
          </Tr>))}</tbody>
      </Table>
      {invitations.length > 0 && (
        <Table caption="Pending invitations">
          <thead><tr><Th>Pending invitation</Th><Th>Role</Th><Th>Expires</Th><Th /></tr></thead>
          <tbody>{invitations.map((i) => (
            <Tr key={i.id}><Td>{i.email}</Td><Td>{i.roleKey.replace(/_/g, " ").toLowerCase()}</Td><Td>{i.expired ? <Badge tone="danger">Expired</Badge> : fmtDate(i.expiresAt)}</Td><Td className="text-right"><Button size="sm" variant="ghost" onClick={() => revoke.run(i.id)}>Revoke</Button></Td></Tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
}
