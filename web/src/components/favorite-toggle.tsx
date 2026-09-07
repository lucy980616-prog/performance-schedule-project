"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FavoriteToggle({ name, initial }: { name: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function toggle() {
    setBusy(true);
    const next = !on;
    try {
      const res = await fetch("/api/favorites", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      setOn(next);
      startTransition(() => router.refresh());
    } catch {
      // 실패하면 상태를 되돌린다
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={on ? "default" : "outline"} size="sm" onClick={toggle} disabled={busy}>
      <Star className="size-4" fill={on ? "currentColor" : "none"} />
      {on ? "애배" : "애배 등록"}
    </Button>
  );
}
