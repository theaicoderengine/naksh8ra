"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { Input, Select } from "../ui/form";
import { Button } from "../ui/button";

export function JobFilters({ showEligible }: { showEligible?: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete("page");
    router.push(`${pathname}?${n.toString()}`);
  };
  return (
    <form
      role="search"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        set("q", q);
      }}
    >
      <label className="sr-only" htmlFor="q">Search jobs</label>
      <Input id="q" className="lg:col-span-2" placeholder="Role, skill or keyword" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select aria-label="Work arrangement" value={sp.get("remote") ?? ""} onChange={(e) => set("remote", e.target.value)}>
        <option value="">Any arrangement</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option>
      </Select>
      <Select aria-label="Employment type" value={sp.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">Any type</option><option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option><option value="INTERNSHIP">Internship</option><option value="GRADUATE_PROGRAMME">Graduate programme</option><option value="CONTRACT">Contract</option>
      </Select>
      {showEligible ? (
        <Select aria-label="Eligibility" value={sp.get("eligibleOnly") ?? ""} onChange={(e) => set("eligibleOnly", e.target.value)}>
          <option value="">All roles</option><option value="true">Only roles I&apos;m eligible for</option>
        </Select>
      ) : (
        <Input aria-label="Country code" placeholder="Country (e.g. GB)" maxLength={2} defaultValue={sp.get("country") ?? ""} onBlur={(e) => set("country", e.target.value.toUpperCase())} />
      )}
      <Button type="submit">Search</Button>
    </form>
  );
}
