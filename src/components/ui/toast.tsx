"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
const Ctx = React.createContext<{ toast: (message: string, tone?: Toast["tone"]) => void }>({ toast: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const toast = React.useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-pop", t.tone === "success" && "border-success/30 bg-success-soft", t.tone === "error" && "border-danger/30 bg-danger-soft", t.tone === "info" && "border-border bg-surface")}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => React.useContext(Ctx);
