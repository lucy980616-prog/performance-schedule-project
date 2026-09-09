"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { addFavoriteActor, removeFavoriteActor } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function FavoriteToggle({ name, initial }: { name: string; initial: boolean }) {
  // `initial`은 부모가 즐겨찾기 목록을 비동기로 불러온 뒤에야 확정되므로, 사용자가 직접
  // 누르기 전까지는 pending을 두지 않고 그때그때 prop 값을 그대로 반영한다(렌더링 중 계산).
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const on = pending ?? initial;

  async function toggle() {
    setBusy(true);
    const next = !on;
    setPending(next);
    try {
      if (next) await addFavoriteActor(name);
      else await removeFavoriteActor(name);
    } catch {
      setPending(null); // 실패하면 서버 상태(initial)로 되돌린다
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
