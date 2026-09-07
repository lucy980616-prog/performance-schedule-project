import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** backend/.tmp — 수집한 이미지를 잠깐 떨어뜨리는 곳. 쓰고 나면 지운다. */
export const TMP_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".tmp",
);

export function tmpPath(name: string): string {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  return path.join(TMP_DIR, name);
}

export function writeTmp(name: string, data: Buffer): string {
  const p = tmpPath(name);
  fs.writeFileSync(p, data);
  return p;
}

export function cleanup(paths: string[]) {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // 이미 지워졌으면 그만이다.
    }
  }
}
