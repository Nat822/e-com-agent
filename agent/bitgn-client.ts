/**
 * BitGN Harness client for the ECOM benchmark.
 *
 * Protocol: ConnectRPC over HTTP — the BitGN harness accepts the Connect
 * JSON protocol (Content-Type: application/json, POST to the method URL).
 * No gRPC/protobuf dependency needed on the TypeScript side.
 *
 * Flow (mirrors ecom-py/main.py):
 *   startRun(benchmarkId) → { runId, trialIds[] }
 *     for each trialId:
 *       startTrial(trialId) → { taskId, instruction, harnessUrl }
 *         ← run the agent against harnessUrl ←
 *       endTrial(trialId)   → { score?, scoreDetail[] }
 *   submitRun(runId)
 *
 * The harnessUrl returned by startTrial becomes WS_BASE_URL for that trial's
 * Docker container. It is unique per trial — never share it across tasks.
 */

// ── Response shapes (subset we actually use) ─────────────────────────────────

export interface BitGNRunStarted {
  runId: string;
  trialIds: string[];
}

export interface BitGNTrialStarted {
  trialId: string;
  taskId: string;
  /** The task description sent to the agent as its system prompt. */
  instruction: string;
  /** Per-trial workspace endpoint — becomes WS_BASE_URL in the Docker container. */
  harnessUrl: string;
}

export interface BitGNTrialResult {
  trialId: string;
  scoreAvailable: boolean;
  /** 0.0 – 1.0. Only meaningful when scoreAvailable is true. */
  score: number;
  scoreDetail: string[];
}

export interface BitGNTrialHead {
  trialId: string;
  taskId: string;
  state: number;
}

export interface BitGNRunInfo {
  runId: string;
  benchmarkId: string;
  trials: BitGNTrialHead[];
}

const HARNESS_SERVICE = "bitgn.harness.HarnessService";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ── Client ────────────────────────────────────────────────────────────────────

export class BitGNClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  // ── Status ping ─────────────────────────────────────────────────────────────

  async status(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this._post(`${HARNESS_SERVICE}/Status`, {});
      const status = asString(res.status);
      const version = asString(res.version);
      return { ok: true, message: version ? `${status || "ok"} (${version})` : status || "ok" };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  // ── Run lifecycle ────────────────────────────────────────────────────────────

  /**
   * Open a new benchmark run. Returns a runId and the list of trial IDs to
   * process. The caller must iterate trialIds and call startTrial / endTrial
   * for each, then call submitRun when all are done.
   */
  async startRun(benchmarkId: string, runName = "BitGN @Nat80ai"): Promise<BitGNRunStarted> {
    const body = {
      name: runName,
      benchmarkId,
      apiKey: this.apiKey,
    };
    const res = await this._post(`${HARNESS_SERVICE}/StartRun`, body);
    return {
      runId: asString(res.runId ?? res.run_id),
      trialIds: asStringArray(res.trialIds ?? res.trial_ids),
    };
  }

  /**
   * Fetch run metadata. Used to map prepared trial IDs to benchmark task IDs
   * before starting any trial.
   */
  async getRun(runId: string): Promise<BitGNRunInfo> {
    const res = await this._post(`${HARNESS_SERVICE}/GetRun`, { runId });
    const rawTrials = Array.isArray(res.trials) ? res.trials : [];
    return {
      runId: asString(res.runId ?? res.run_id, runId),
      benchmarkId: asString(res.benchmarkId ?? res.benchmark_id),
      trials: rawTrials
        .filter((trial): trial is Record<string, unknown> => typeof trial === "object" && trial !== null)
        .map((trial) => ({
          trialId: asString(trial.trialId ?? trial.trial_id),
          taskId: asString(trial.taskId ?? trial.task_id),
          state: asNumber(trial.state),
        }))
        .filter((trial) => trial.trialId && trial.taskId),
    };
  }

  /**
   * Start a single trial. Returns the task instruction and the per-trial
   * workspace URL that the Docker agent must connect to.
   */
  async startTrial(trialId: string): Promise<BitGNTrialStarted> {
    const res = await this._post(`${HARNESS_SERVICE}/StartTrial`, { trialId });
    return {
      trialId: asString(res.trialId ?? res.trial_id, trialId),
      taskId: asString(res.taskId ?? res.task_id),
      instruction: asString(res.instruction ?? res.systemPrompt ?? res.system_prompt),
      harnessUrl: asString(res.harnessUrl ?? res.harness_url),
    };
  }

  /**
   * End a single trial after the agent has finished (called regardless of
   * outcome — the harness records whatever ws.answer() submitted).
   */
  async endTrial(trialId: string): Promise<BitGNTrialResult> {
    const res = await this._post(`${HARNESS_SERVICE}/EndTrial`, { trialId });
    return {
      trialId: asString(res.trialId ?? res.trial_id, trialId),
      scoreAvailable: asBoolean(res.scoreAvailable ?? res.score_available),
      score: asNumber(res.score),
      scoreDetail: asStringArray(res.scoreDetail ?? res.score_detail),
    };
  }

  /**
   * Submit the completed run to BitGN for scoring. Pass force=true to submit
   * even if some trials did not finish (safe to call in a finally block).
   */
  async submitRun(runId: string, force = true): Promise<void> {
    await this._post(`${HARNESS_SERVICE}/SubmitRun`, { runId, force });
  }

  // ── HTTP transport ───────────────────────────────────────────────────────────

  /**
   * ConnectRPC JSON protocol: POST /<package>/<Service>/<Method>
   * with Content-Type: application/json.
   *
   * The BitGN harness accepts both the gRPC-Web and the Connect JSON protocol.
   * We use Connect JSON because it needs no special codec — plain fetch.
   */
  private async _post(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // ConnectRPC JSON protocol requires this header to distinguish it from
        // gRPC-Web. Some BitGN gateway versions also accept plain application/json.
        "Connect-Protocol-Version": "1",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new BitGNError(res.status, text, method);
    }

    const json = (await res.json()) as Record<string, unknown>;

    // ConnectRPC surfaces application errors in an `error` envelope field.
    if (json.error) {
      const err = typeof json.error === "object" && json.error !== null
        ? json.error as Record<string, unknown>
        : {};
      throw new BitGNError(
        asNumber(err.code),
        asString(err.message, JSON.stringify(err)),
        method
      );
    }

    return json;
  }
}

// ── Error class ───────────────────────────────────────────────────────────────

export class BitGNError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly method: string
  ) {
    super(`BitGN ${method} failed (${code}): ${message}`);
    this.name = "BitGNError";
  }
}

// ── Factory helper ────────────────────────────────────────────────────────────

/**
 * Create a BitGNClient from environment variables.
 * Throws if BITGN_API_KEY is missing.
 */
export function createBitGNClient(): BitGNClient {
  const apiKey = process.env.BITGN_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("BITGN_API_KEY is not set. Add it to your .env file.");
  }
  const baseUrl = process.env.BITGN_API_URL ?? "https://api.bitgn.com";
  return new BitGNClient(baseUrl, apiKey);
}
