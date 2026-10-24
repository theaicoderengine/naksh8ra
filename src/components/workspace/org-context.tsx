"use client";
import * as React from "react";

export type OrgClient = { slug: string; name: string; type: "EMPLOYER" | "UNIVERSITY"; role: string; permissions: string[] };
const Ctx = React.createContext<OrgClient | null>(null);

export function OrgProvider({ value, children }: { value: OrgClient; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useOrg outside OrgProvider");
  return { ...v, can: (p: string) => v.permissions.includes(p) };
}
