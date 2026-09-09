"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { addFavoriteActor, removeFavoriteActor } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function FavoriteToggle({ name, initial }: { name: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !on;
    try {
      if (next) await addFavoriteActor(name);
      else await removeFavoriteActor(name);
      setOn(next);
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
