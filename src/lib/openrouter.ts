// Server-only OpenRouter helper (ported from Millennium Bug). The key never reaches the browser.
const DEFAULT_MODEL = "openrouter/free";

export type Turn = { role: "user" | "assistant"; content: string };

async function askOnce(system: string, messages: Turn[], maxTokens: number): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "X-Title": "Arda",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        temperature: 0.9,
        reasoning: { exclude: true },
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    if (!res.ok) {
      console.error("OpenRouter API error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") return null; // cut off mid-answer
    return choice?.message?.content ?? null;
  } catch (err) {
    console.error("OpenRouter request failed", err);
    return null;
  }
}

// Pulls the first {...} object out of a reply. Free models often wrap JSON in
// code fences, add a sentence before it, or think out loud in <think> tags.
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Asks for a JSON object and checks it with `valid`. Tries up to 3 times (the free
// router picks a different model each time). Returns null so the caller can use a fallback.
export async function askJson<T>(
  system: string,
  user: string,
  valid: (x: unknown) => x is T,
  maxTokens = 600,
): Promise<T | null> {
  for (let tries = 0; tries < 3; tries++) {
    const text = await askOnce(system, [{ role: "user", content: user }], maxTokens);
    if (text === null && !process.env.OPENROUTER_API_KEY) return null;
    const json = text ? extractJson(text) : null;
    if (valid(json)) return json;
  }
  return null;
}
