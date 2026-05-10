// ── Domain types ─────────────────────────────────────────

export type OutcomeCode =
  | "OUTCOME_OK"
  | "OUTCOME_DENIED_SECURITY"
  | "OUTCOME_NONE_UNSUPPORTED"
  | "OUTCOME_NONE_CLARIFICATION"
  | "OUTCOME_ERR_INTERNAL";

export type TaskType = "SHOPPER" | "CHECKOUT" | "MERCHANT" | "SUPPORT";

export interface TaskResult {
  taskId: string;
  outcome: OutcomeCode;
  answer: string;
  refs: string[];
  policycitation?: string;
  scratchpad?: Scratchpad;
}

export interface Scratchpad {
  context?: { unixTime: number; time: string };
  task_type?: TaskType;
  answer?: string;
  outcome?: OutcomeCode;
  refs?: string[];
  policy_citation?: string;

  // Commerce gates
  fraud_gate?: "OK" | "BLOCKED";
  payment_gate?: "OK" | "BLOCKED";
  customer_identity_gate?: "YES" | "NO";
  auth_direction_gate?: "YES" | "NO";
  availability_gate?: "OK" | "NO_STOCK";
  delivery_evidence?: "confirmed" | "missing" | "partial";
  last_scan?: Record<string, unknown>;

  // Discount tracking
  requested_discount?: number;
  policy_max_discount?: number;

  // Arbitrary gate keys — any "NO" or "BLOCKED" blocks OUTCOME_OK
  [key: string]: unknown;
}

// ── Workspace execution result ────────────────────────────

export interface CodeExecutionResult {
  output: string;   // stdout/stderr merged
  exitCode: number;
  answered: boolean;           // true if ws.answer() was called
  taskResult?: TaskResult;     // populated when answered=true
}

// ── Run config ────────────────────────────────────────────

export interface RunConfig {
  bench: string;             // e.g. "bitgn/ecom-dev"
  concurrency: number;
  submit: boolean;
  model: string;
  runsDir: string;
}

// ── BitGN API types (subset needed) ──────────────────────

export interface BitGNTask {
  /** Benchmark task id, e.g. t01. */
  id: string;
  /** Harness trial id, required for EndTrial/GetTrial. */
  trialId?: string;
  systemPrompt: string;
  workspaceId: string;
}

export interface BitGNRunResult {
  runId: string;
  score: number;
  totalTasks: number;
  completedTasks: number;
}

// OpenAI-compatible chat completions types (subset used by this runner)

export interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

export interface OAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OAIResponse {
  choices: Array<{
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OAIToolCall[];
    };
  }>;
}
