"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { Input, Select } from "../ui/form";
import { Button } from "../ui/button";

export function CandidateFilters({ jobs, stages }: { jobs: { id: string; title: string }[]; stages: { id: string; name: string }[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete("page");
    router.push(`${path}?${n}`);
  };
  return (
    <form role="search" className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); set("q", q); }}>
      <Input aria-label="Search candidates" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} className="lg:col-span-2" />
      <Select aria-label="Vacancy" value={sp.get("jobId") ?? ""} onChange={(e) => set("jobId", e.target.value)}><option value="">All vacancies</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</Select>
      <Select aria-label="Stage" value={sp.get("stageId") ?? ""} onChange={(e) => set("stageId", e.target.value)}><option value="">All stages</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      <Button type="submit" variant="secondary">Search</Button>
    </form>
  );
}
