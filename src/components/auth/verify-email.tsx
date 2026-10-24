"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Alert } from "../ui/feedback";
import { Spinner } from "../ui/spinner";

export function VerifyEmail({ token }: { token: string | null }) {
  const [state, setState] = useState<"working" | "ok" | "error">(token ? "working" : "error");
  const [msg, setMsg] = useState(token ? "" : "This link is missing its token.");
  const ran = useRef(false);
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api("/auth/verify-email", { body: { token } })
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error");
        setMsg(e instanceof ApiError ? e.message : "Verification failed");
      });
  }, [token]);
  if (state === "working") return <Spinner label="Verifying your email" />;
  if (state === "ok")
    return (
      <Alert tone="success" title="Email verified">
        Your account is active. <Link href="/login?next=/onboarding" className="font-medium text-primary hover:underline">Sign in to continue setup</Link>.
      </Alert>
    );
  return (
    <Alert tone="danger" title="We couldn't verify this link">
      {msg} <Link href="/verify-email/sent" className="font-medium text-primary hover:underline">Request a new link</Link>.
    </Alert>
  );
}
