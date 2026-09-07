"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface ExtractResult {
  ok: boolean;
  saved?: number;
  roles?: number;
  warnings?: string[];
  error?: string;
}

/**
 * 예매처 캐스팅 캘린더를 붙여넣거나 캡처를 올리면 회차별 캐스팅으로 변환한다.
 * KOPIS가 주지 않는 유일한 정보라 이 화면이 실질적인 데이터 입력구다.
 */
export function ExtractDialog({ showId }: { showId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      if (file) form.set("image", file);
      else form.set("text", text);

      const res = await fetch(`/api/shows/${showId}/extract`, { method: "POST", body: form });
      const json: ExtractResult = await res.json();
      setResult(json);

      if (json.ok) {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "추출 실패" });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setText("");
    setFile(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Sparkles className="size-4" />
        캐스팅 등록
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>캐스팅 자동 등록</DialogTitle>
          <DialogDescription>
            예매처의 캐스팅 일정표를 붙여넣거나 캡처 이미지를 올리면 회차별 캐스팅으로 정리합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setText("");
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload className="size-4" />
              {file ? file.name : "캡처 이미지 선택"}
            </Button>
          </div>

          <div className="text-muted-foreground text-center text-xs">또는</div>

          <Textarea
            placeholder={
              "예매처에서 복사한 캐스팅 일정을 붙여넣으세요.\n예)\n8/31(일) 14:00 김배우, 이배우, 박배우\n8/31(일) 18:30 최배우, 이배우, 정배우"
            }
            rows={7}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) setFile(null);
            }}
            disabled={busy || !!file}
          />

          {result && (
            <div
              className={
                result.ok
                  ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
              }
            >
              {result.ok ? (
                <>
                  <p className="font-medium">
                    회차 {result.saved}건
                    {result.roles ? `, 배역 ${result.roles}개` : ""} 저장했습니다.
                  </p>
                  {result.warnings && result.warnings.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-xs opacity-90">
                      {result.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p>{result.error}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={reset} disabled={busy}>
            초기화
          </Button>
          <Button onClick={submit} disabled={busy || (!file && !text.trim())}>
            {busy ? "분석 중…" : "변환해서 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
