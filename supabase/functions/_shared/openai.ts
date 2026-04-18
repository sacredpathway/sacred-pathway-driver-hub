// Thin OpenAI Chat Completions client used by every edge function.
// Kept dependency-free (no SDK) so cold starts stay under ~200 ms.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "auto" | "low" | "high" };
    };

export interface ChatRequestOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  apiKey?: string;
}

export interface ChatResult {
  content: string;
  model: string;
  finishReason: string | null;
  usage: Record<string, number> | null;
}

/**
 * Call OpenAI Chat Completions with retry/back-off on transient errors.
 * Throws a typed ChatError on permanent failure.
 */
export async function chatCompletion(
  opts: ChatRequestOptions,
  retry = { attempts: 3, baseDelayMs: 800 },
): Promise<ChatResult> {
  const key = opts.apiKey ?? Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    throw new ChatError("missing_api_key", "OPENAI_API_KEY is not set on the Edge Function.");
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  let lastError: ChatError | null = null;

  for (let attempt = 0; attempt < retry.attempts; attempt++) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new ChatError(
          res.status === 429 ? "rate_limited" : `http_${res.status}`,
          `OpenAI ${res.status}: ${text.slice(0, 400)}`,
        );
        if (shouldRetry(res.status) && attempt < retry.attempts - 1) {
          lastError = err;
          await sleep(retry.baseDelayMs * Math.pow(2, attempt), attempt);
          continue;
        }
        throw err;
      }

      const json = await res.json() as OpenAIChatResponse;
      const choice = json.choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new ChatError("empty_response", "OpenAI returned an empty message.");
      }
      return {
        content,
        model: json.model ?? opts.model,
        finishReason: choice?.finish_reason ?? null,
        usage: json.usage ?? null,
      };
    } catch (err) {
      if (err instanceof ChatError) {
        if (err.code === "rate_limited" && attempt < retry.attempts - 1) {
          lastError = err;
          await sleep(retry.baseDelayMs * Math.pow(2, attempt), attempt);
          continue;
        }
        throw err;
      }
      // Network / DNS / abort — retry a couple times then bail.
      const wrapped = new ChatError("network", (err as Error).message ?? String(err));
      if (attempt < retry.attempts - 1) {
        lastError = wrapped;
        await sleep(retry.baseDelayMs * Math.pow(2, attempt), attempt);
        continue;
      }
      throw wrapped;
    }
  }
  throw lastError ?? new ChatError("unknown", "chatCompletion exhausted retries.");
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number, attempt: number): Promise<void> {
  // 20% jitter on top of exponential back-off to avoid thundering herd.
  const jitter = 0.8 + Math.random() * 0.4;
  return new Promise((resolve) => setTimeout(resolve, ms * jitter));
}

/** Strip accidental ```json fences (OpenAI sometimes adds them). */
export function stripJsonFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(json)?/i, "").replace(/```$/, "");
  }
  return out.trim();
}

export class ChatError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ChatError";
  }
}

interface OpenAIChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  model?: string;
  usage?: Record<string, number>;
}
