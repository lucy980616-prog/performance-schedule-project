import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stripFence, runClaudeJson } from "../src/shared/claude.ts";

describe("shared/claude", () => {
  test("stripFence: 코드펜스를 벗긴다", () => {
    const fenced = "```json\n" + '{"a":1}' + "\n```";
    assert.equal(stripFence(fenced), '{"a":1}');
    assert.equal(stripFence("```\n" + '{"a":1}' + "\n```"), '{"a":1}');
  });

  test("stripFence: 앞뒤 잡소리를 잘라낸다", () => {
    assert.equal(stripFence('네, 정리했습니다.\n{"a":1}\n확인해 주세요.'), '{"a":1}');
  });

  test("stripFence: 순수 JSON은 그대로 둔다", () => {
    assert.equal(stripFence('{"a":1}'), '{"a":1}');
  });

  // 실제로 CLI를 띄운다. 느리고 구독 사용량을 쓰므로 기본은 건너뛴다.
  //   RUN_LIVE=1 npm test
  test(
    "live: claude -p 가 스키마에 맞는 JSON을 돌려준다",
    { skip: process.env.RUN_LIVE !== "1", timeout: 300_000 },
    async () => {
      const schema = z.object({ answer: z.number(), unit: z.string() });
      const got = await runClaudeJson({
        system: "answer(숫자)와 unit(문자열) 두 필드를 가진 JSON만 출력하세요.",
        prompt: "1시간은 몇 분입니까? answer에 숫자, unit에 단위를 넣으세요.",
        schema,
        model: "haiku",
      });
      assert.equal(got.answer, 60);
    },
  );
});
