/**
 * BitGN Ecom Agent — main entry point
 *
 * Architecture: Pangolin-style single-tool REPL agent
 * Tool: execute_code (Python in Docker, preloaded workspace client)
 * Provider: neuraldeep.ru — OpenAI-compatible API
 * Model: gpt-oss-120b
 */

import { SYSTEM_PROMPT } from "./system-prompt";
import { WorkspaceClient } from "./workspace-client";
import { RunLogger } from "./logger";
import type { TaskResult, OAIMessage, OAITool, OAIResponse } from "./types";

// ── Provider config ───────────────────────────────────────

const MAX_TOKENS = 8192;
const MAX_TURNS  = 8;

type ProviderConfig = {
  name: string;
  apiBase: string;
  apiKey: string;
  model: string;
  fallbackOnAnyError?: boolean;
};

class LLMAPIError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    message: string
  ) {
    super(message);
  }
}

function providerConfigs(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  if (process.env.LLM_API_KEY) {
    providers.push({
      name: "primary",
      apiBase: process.env.LLM_API_BASE ?? "https://api.neuraldeep.ru/v1",
      apiKey: process.env.LLM_API_KEY,
      model: process.env.MODEL ?? "gpt-oss-120b",
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    const apiBase = process.env.OPENROUTER_API_BASE ?? "https://openrouter.ai/api/v1";
    providers.push({
      name: "openrouter:gpt-oss",
      apiBase,
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-120b:free",
      fallbackOnAnyError: true,
    });
    providers.push({
      name: "openrouter:nemotron",
      apiBase,
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_FALLBACK_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free",
      fallbackOnAnyError: true,
    });
  }

  if (providers.length === 0) {
    throw new Error("No LLM provider key is set. Add LLM_API_KEY or OPENROUTER_API_KEY to .env.");
  }

  return providers;
}

// ── Raw OpenAI-compatible HTTP client ────────────────────

async function chatCompletion(messages: OAIMessage[]): Promise<OAIResponse> {
  const providers = providerConfigs();
  const errors: string[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      return await chatCompletionWithProvider(provider, messages);
    } catch (err) {
      const llmErr = err as LLMAPIError;
      const status = llmErr.status ?? null;
      errors.push(`${provider.name}: ${llmErr.message}`);

      const isPrimaryRateLimit = i === 0 && status === 429;
      const canFallback = i < providers.length - 1 && (isPrimaryRateLimit || provider.fallbackOnAnyError);
      if (!canFallback) {
        throw new Error(`LLM API error via ${provider.name}: ${llmErr.message}`);
      }

      console.warn(`LLM provider ${provider.name} failed${status ? ` (${status})` : ""}; trying fallback.`);
    }
  }

  throw new Error(`All LLM providers failed: ${errors.join(" | ")}`);
}

async function chatCompletionWithProvider(
  provider: ProviderConfig,
  messages: OAIMessage[]
): Promise<OAIResponse> {
  const body = JSON.stringify({
    model: provider.model,
    max_tokens: MAX_TOKENS,
    tools: [EXECUTE_CODE_TOOL],
    tool_choice: "auto",
    messages,
  });

  let res: Response;
  try {
    res = await fetch(`${provider.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...(provider.apiBase.includes("openrouter.ai")
          ? {
              "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
              "X-Title": process.env.OPENROUTER_APP_NAME ?? "BitGN Ecom Agent",
            }
          : {}),
      },
      body,
    });
  } catch (err) {
    throw new LLMAPIError(provider.name, null, err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new LLMAPIError(provider.name, res.status, `${res.status}: ${text}`);
  }

  const json = await res.json() as OAIResponse;
  if (!json.choices?.length) {
    throw new LLMAPIError(provider.name, null, "empty response choices");
  }

  return json;
}

// ── Core agent loop ───────────────────────────────────────

export async function runTask(
  taskId: string,
  taskSystemPrompt: string,
  workspaceTree: string,
  wsClient: WorkspaceClient,
  logger: RunLogger
): Promise<TaskResult> {
  const messages: OAIMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: buildUserMessage(taskSystemPrompt, workspaceTree) },
  ];

  logger.taskStart(taskId);
  logger.taskInstruction(taskId, taskSystemPrompt);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await chatCompletion(messages);
    const choice   = response.choices[0];
    const msg      = choice.message;

    logger.turn(taskId, turn, choice.finish_reason);

    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
      logger.warn(taskId, "Agent stopped without calling ws.answer()");
      break;
    }

    if (choice.finish_reason === "tool_calls") {
      for (const toolCall of msg.tool_calls ?? []) {
        if (toolCall.function.name !== "execute_code") {
          logger.toolCallSkipped(taskId, turn, "unexpected_tool_name", { toolName: toolCall.function.name });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Invalid tool call: use only execute_code with a JSON object containing a non-empty string field named code.",
          });
          continue;
        }

        let code: string;
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          // Try known key names in order — gpt-oss-120b may use any of these
          code = (
            parsed.code ??
            parsed.python ??
            parsed.script ??
            parsed.input ??
            parsed.content
          ) as string;
          if (!code) throw new Error("no recognized code key in tool arguments");
        } catch (err) {
          const raw = toolCall.function.arguments ?? "";
          const trimmed = raw.trim();
          const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
          if (!trimmed || looksLikeJson) {
            logger.toolCallSkipped(taskId, turn, "invalid_tool_arguments", {
              error: err instanceof Error ? err.message : String(err),
              argumentLength: raw.length,
              argumentPreview: raw.slice(0, 200),
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: "Invalid execute_code arguments: provide valid JSON like {\"code\":\"...python...\"}. Your next turn must call execute_code with a non-empty code string and should call ws.answer(scratchpad, verify) if enough evidence has been gathered.",
            });
            continue;
          }
          // Last resort for providers that pass raw Python instead of JSON.
          code = raw;
        }

        if (!code.trim()) {
          logger.toolCallSkipped(taskId, turn, "empty_code");
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Invalid execute_code arguments: code was empty. Your next turn must call execute_code with non-empty Python code.",
          });
          continue;
        }

        logger.codeCall(taskId, turn, code);

        const result = await wsClient.executeCode(taskId, code);
        logger.codeResult(taskId, turn, result);

        if (result.answered) {
          logger.taskEnd(taskId, result.taskResult!);
          return result.taskResult!;
        }

        const recoveryHint = result.exitCode === 124
          ? "\n\nEXECUTION TIMEOUT: Your previous code took too long. Next call must be SQL-only using catalog_sql(), catalog_first_kind_id(), or catalog_count_by_kind_phrase(), or must call ws.answer() immediately from already inspected candidates. Do not repeat tree walking or full catalogue traversal."
          : "";

        const finalizationHint = turn >= 5 && !result.answered
          ? "\n\nLATE TURN: You are at/after turn 5. The next execute_code call must call ws.answer(); do not do more exploration. If exact-line candidates are known, intersect requested properties within those candidates only, then answer <YES> or <NO>. Do not print more candidate paths without submitting."
          : "";

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `${result.output}${recoveryHint}${finalizationHint}`,
        });
      }
      continue;
    }

    break;
  }

  return {
    taskId,
    outcome: "OUTCOME_ERR_INTERNAL",
    answer: "Agent exceeded max turns",
    refs: [],
  };
}

// ── Tool definition (OpenAI function-calling format) ─────

const EXECUTE_CODE_TOOL: OAITool = {
  type: "function",
  function: {
    name: "execute_code",
    description: `Run Python 3 in a locked-down Docker container with a preloaded workspace client.
The container has: json, sys, os, re, csv, math, hashlib, base64, yaml, datetime, timedelta, date,
defaultdict, Counter, PurePosixPath, dateutil_parser, relativedelta already imported.
'ws' is a Workspace instance. 'scratchpad' is a persistent JSON dict across calls.
Helpers available: norm(x), norm_num(x), prop(record, *names), blob_text(record), has_text(record, *terms), verify(sp), csv_rows(stdout), sql_query(query), catalog_sql(query), catalog_find_kind_id(kind_phrase), catalog_first_kind_id(kind_phrase), catalog_count_by_kind(kind_id), catalog_count_by_kind_value(kind_id), catalog_count_by_kind_phrase(kind_phrase), catalog_answer_count(kind_phrase, submit=True), catalog_product_rows(...), catalog_score_product(record, required), catalog_find_matching_products(required, limit=100), catalog_product_rows_broad(required, limit=200), catalog_score_product_v2(record, required), catalog_answer_existence(required, submit=True).
STABILITY_EXPERIMENT_CATALOG_COUNT_V1_2026_05_10: for catalogue count tasks requiring <COUNT:n>, prefer catalog_answer_count("Kind Phrase", submit=True) before custom scratchpad code.
STABILITY_EXPERIMENT_CATALOG_EXISTENCE_V2_2026_05_10: for binary catalogue existence tasks, prefer catalog_answer_existence({... full product line as "line" ...}, submit=True) before custom matching code.
Variables you define persist between calls (strings, numbers, lists, dicts — JSON-serializable only).
Call ws.answer(scratchpad, verify) as your final step.`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Python 3 code to execute",
        },
      },
      required: ["code"],
    },
  },
};

// ── Message builder ───────────────────────────────────────

function buildUserMessage(taskSystemPrompt: string, workspaceTree: string): string {
  return `<task-system-prompt>
${taskSystemPrompt}
</task-system-prompt>

<workspace-tree>
${workspaceTree}
</workspace-tree>

<scratchpad>
{}
</scratchpad>

Call execute_code now — do not respond with text first.`;
}
