"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: 3 }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setMsg(`${json.imported}건 불러옴`);
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "동기화 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-muted-foreground text-xs">{msg}</span>}
      <Button variant="outline" size="sm" onClick={sync} disabled={busy}>
        <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
        {busy ? "불러오는 중" : "KOPIS 동기화"}
      </Button>
    </div>
  );
}
