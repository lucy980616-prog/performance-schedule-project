"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Heart, LayoutGrid, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "오늘의 공연", icon: CalendarDays },
  { href: "/shows", label: "전체 공연", icon: LayoutGrid },
  { href: "/my/actors", label: "애배 달력", icon: Star },
  { href: "/my/calendar", label: "내 달력", icon: Heart },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur">
      <div className="mx-auto flex max-w-3xl">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs transition-colors",
                active
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
