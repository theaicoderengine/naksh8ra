"use client";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

export function ResumeUpload({ onUploaded }: { onUploaded?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
        <Upload className="h-5 w-5 text-subtle" aria-hidden="true" />
        <div className="flex-1 text-sm"><p className="font-medium">Upload a resume</p><p className="text-subtle">PDF, DOCX or TXT · up to 10 MB. We extract details for you to review — nothing is invented.</p></div>
        <input ref={ref} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="sr-only" id="resume-file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setMsg(null);
            const form = new FormData();
            form.append("file", file);
            form.append("label", file.name);
            try {
              await api("/students/me/resumes", { form });
              setMsg({ tone: "success", text: `${file.name} uploaded. Review the extracted details on your Resumes page.` });
              onUploaded?.();
            } catch (err) {
              setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Upload failed" });
            } finally {
              setBusy(false);
              if (ref.current) ref.current.value = "";
            }
          }} />
        <Button variant="secondary" loading={busy} onClick={() => ref.current?.click()} aria-controls="resume-file">Choose file</Button>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
