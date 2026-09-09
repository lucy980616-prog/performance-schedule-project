import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "차인표, 오만석, 연정훈" → ["차인표","오만석","연정훈"] */
export function splitNames(raw: string): string[] {
  return raw
    .split(/[,、·/|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 30)
}

export function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
