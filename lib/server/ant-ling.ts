/**
 * Minimal server-only client for Ant Ling's OpenAI-compatible Chat Completions API.
 * Docs: https://developer.ant-ling.com/en/docs/api-reference/chat/openai/
 *
 * The API key is read from the server environment and is never returned, logged or sent to the browser.
 * ANT_LING_BASE_URL and ANT_LING_MODEL allow the same OpenAI-compatible protocol to be pointed at a
 * different host serving Ling models (for example OpenRouter) without code changes.
 */

export const ANT_LING_DEFAULT_BASE_URL = 'https://api.ant-ling.com/v1';
export const ANT_LING_DEFAULT_MODEL = 'Ling-3.2-flash';

export type AntLingConfig = { apiKey: string; baseUrl: string; model: string };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatResult = {
  content: string;
  model: string;
  requestId: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
};
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class AntLingError extends Error {
  code: 'not_configured' | 'auth' | 'quota' | 'rate_limited' | 'timeout' | 'upstream' | 'bad_response';
  status: number | null;
  constructor(code: AntLingError['code'], message: string, status: number | null = null) {
    super(message);
    this.name = 'AntLingError';
    this.code = code;
    this.status = status;
  }
}

export function antLingConfig(env: Record<string, string | undefined> = process.env): AntLingConfig | null {
  const apiKey = env.ANT_LING_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.ANT_LING_BASE_URL?.trim() || ANT_LING_DEFAULT_BASE_URL).replace(/\/+$/, '');
  // https only; plain http is accepted solely for a local stand-in server during development tests.
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseUrl)) {
    throw new AntLingError('not_configured', 'ANT_LING_BASE_URL must be an https URL');
  }
  return { apiKey, baseUrl, model: env.ANT_LING_MODEL?.trim() || ANT_LING_DEFAULT_MODEL };
}

function isAntLingHost(baseUrl: string) {
  try { return new URL(baseUrl).hostname === 'api.ant-ling.com'; } catch { return false; }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function chatCompletion(config: AntLingConfig, messages: ChatMessage[],
  options: { fetchImpl?: FetchLike; timeoutMs?: number; temperature?: number; maxTokens?: number } = {}): Promise<ChatResult> {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
  const payload: Record<string, unknown> = {
    model: config.model, messages, stream: false, temperature: options.temperature ?? 0.2, max_tokens: options.maxTokens ?? 700,
  };
  // Ant Ling-specific switch: skip the reasoning phase (faster, fewer tokens).
  if (isAntLingHost(config.baseUrl)) payload.thinking = { type: 'disabled' };
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new AntLingError('timeout', 'Ant Ling did not respond in time. Try again.');
    throw new AntLingError('upstream', 'Could not reach Ant Ling. Check the network and base URL.');
  } finally {
    clearTimeout(timer);
  }

  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  if (!response.ok) {
    let detail = '';
    try { const data = await response.json() as { error?: { message?: unknown } | string; message?: unknown };
      const raw = typeof data.error === 'string' ? data.error : data.error?.message ?? data.message;
      if (typeof raw === 'string') detail = raw.replaceAll(config.apiKey, '[redacted]').slice(0, 200);
    } catch { /* non-JSON error body */ }
    const suffix = detail ? ` (${detail})` : '';
    if (response.status === 401 || response.status === 403) throw new AntLingError('auth', `Ant Ling rejected the API key${suffix}`, response.status);
    if (response.status === 402) throw new AntLingError('quota', `Ant Ling quota or balance is used up${suffix}`, response.status);
    if (response.status === 429) throw new AntLingError('rate_limited', `Ant Ling rate limit reached. Wait a moment and try again${suffix}`, response.status);
    throw new AntLingError('upstream', `Ant Ling returned HTTP ${response.status}${suffix}`, response.status);
  }

  let data: { id?: unknown; model?: unknown; choices?: { message?: { content?: unknown } }[]; usage?: Record<string, unknown> };
  try { data = await response.json() as typeof data; }
  catch { throw new AntLingError('bad_response', 'Ant Ling returned a response that was not JSON'); }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AntLingError('bad_response', 'Ant Ling returned an empty response');
  return {
    content,
    model: typeof data.model === 'string' ? data.model : config.model,
    requestId: requestId ?? (typeof data.id === 'string' ? data.id : null),
    usage: {
      promptTokens: numberOrNull(data.usage?.prompt_tokens),
      completionTokens: numberOrNull(data.usage?.completion_tokens),
      totalTokens: numberOrNull(data.usage?.total_tokens),
    },
  };
}
