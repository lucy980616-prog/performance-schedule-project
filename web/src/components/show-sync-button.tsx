"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ShowSyncButton({ showId, tracked }: { showId: string; tracked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"detail" | "track" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function post(body: Record<string, unknown>, kind: "detail" | "track") {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch(`/api/shows/${showId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      if (kind === "detail") {
        setMsg(json.seeded > 0 ? `회차 ${json.seeded}개 생성` : "상세 정보 갱신");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => post({ seed: true }, "detail")}
        disabled={busy !== null}
      >
        <Download className="size-4" />
        {busy === "detail" ? "불러오는 중" : "KOPIS 상세 불러오기"}
      </Button>

      <Button
        variant={tracked ? "default" : "outline"}
        size="sm"
        onClick={() => post({ track: !tracked, seed: false }, "track")}
        disabled={busy !== null}
      >
        <Star className="size-4" fill={tracked ? "currentColor" : "none"} />
        {tracked ? "추적중" : "추적하기"}
      </Button>

      {msg && <span className="text-muted-foreground text-xs">{msg}</span>}
    </div>
  );
}
