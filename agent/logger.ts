import * as fs from "fs";
import * as path from "path";
import type { TaskResult } from "./types";

export class RunLogger {
  private logDir: string;
  private runId: string;
  private startTime: number;

  constructor(runsDir: string) {
    this.runId = new Date().toISOString().replace(/[:.]/g, "-");
    this.logDir = path.join(runsDir, this.runId);
    this.startTime = Date.now();
    fs.mkdirSync(this.logDir, { recursive: true });
    this.write("run.jsonl", JSON.stringify({ event: "run_start", runId: this.runId, time: new Date().toISOString() }));
  }

  taskStart(taskId: string) {
    console.log(`[${taskId}] starting`);
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "task_start", taskId, time: Date.now() }));
  }

  taskInstruction(taskId: string, instruction: string) {
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "task_instruction", taskId, instruction }));
  }

  turn(taskId: string, turn: number, stopReason: string | null) {
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "turn", taskId, turn, stopReason }));
  }

  codeCall(taskId: string, turn: number, code: string) {
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "code_call", taskId, turn, codeLength: code.length }));
    // Also save full code for debugging
    fs.writeFileSync(path.join(this.logDir, `${taskId}_turn${turn}_code.py`), code);
  }

  toolCallSkipped(taskId: string, turn: number, reason: string, details: Record<string, unknown> = {}) {
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "tool_call_skipped", taskId, turn, reason, ...details }));
  }

  codeResult(taskId: string, turn: number, result: { output: string; exitCode: number; answered: boolean }) {
    this.write(`${taskId}.jsonl`, JSON.stringify({
      event: "code_result", taskId, turn,
      exitCode: result.exitCode, answered: result.answered,
      outputSnippet: result.output.slice(0, 200),
    }));
    fs.writeFileSync(path.join(this.logDir, `${taskId}_turn${turn}_output.txt`), result.output);
  }

  taskEnd(taskId: string, result: TaskResult) {
    const elapsed = Date.now() - this.startTime;
    console.log(`[${taskId}] ${result.outcome} — ${result.answer?.toString().slice(0, 60)} (${elapsed}ms)`);
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "task_end", taskId, result, elapsed }));
    this.write("run.jsonl", JSON.stringify({ event: "task_result", taskId, outcome: result.outcome }));
  }

  harnessResult(taskId: string, result: { scoreAvailable: boolean; score: number; scoreDetail: string[] }) {
    this.write(`${taskId}.jsonl`, JSON.stringify({
      event: "harness_result",
      taskId,
      scoreAvailable: result.scoreAvailable,
      score: result.score,
      scoreDetail: result.scoreDetail,
    }));
    this.write("run.jsonl", JSON.stringify({
      event: "harness_result",
      taskId,
      scoreAvailable: result.scoreAvailable,
      score: result.score,
      scoreDetail: result.scoreDetail,
    }));
  }

  warn(taskId: string, msg: string) {
    console.warn(`[${taskId}] WARN: ${msg}`);
    this.write(`${taskId}.jsonl`, JSON.stringify({ event: "warn", taskId, msg }));
  }

  summary(results: TaskResult[]) {
    const ok = results.filter((r) => r.outcome === "OUTCOME_OK").length;
    const total = results.length;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`\n=== Run complete: ${ok}/${total} OK in ${elapsed}s ===`);
    this.write("run.jsonl", JSON.stringify({ event: "run_end", ok, total, elapsed }));
  }

  private write(filename: string, line: string) {
    fs.appendFileSync(path.join(this.logDir, filename), line + "\n");
  }
}
