export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  model: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (response: ChatResponse) => void;
  onError: (error: Error) => void;
}

export async function chatCompletion(
  provider: "ollama" | "openai",
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  stream: boolean = true,
  callbacks?: StreamCallbacks
): Promise<ChatResponse> {
  if (provider === "ollama") {
    return ollamaChat(endpoint, model, messages, stream, callbacks);
  }
  return openaiChat(endpoint, model, messages, stream, callbacks);
}

async function ollamaChat(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  callbacks?: StreamCallbacks
): Promise<ChatResponse> {
  const url = `${endpoint}/api/chat`;
  const start = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  if (stream && callbacks && res.body) {
    let fullContent = "";
    let tokensIn = 0;
    let tokensOut = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullContent += data.message.content;
            callbacks.onToken(data.message.content);
          }
          if (data.done) {
            tokensIn = data.prompt_eval_count || 0;
            tokensOut = data.eval_count || 0;
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    const resp: ChatResponse = {
      content: fullContent,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - start,
      model,
    };
    callbacks.onDone(resp);
    return resp;
  }

  // Non-streaming
  const data = (await res.json()) as any;
  return {
    content: data.message?.content || "",
    tokensIn: data.prompt_eval_count || 0,
    tokensOut: data.eval_count || 0,
    durationMs: Date.now() - start,
    model,
  };
}

async function openaiChat(
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  callbacks?: StreamCallbacks
): Promise<ChatResponse> {
  const url = `${endpoint}/v1/chat/completions`;
  const start = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream, max_tokens: 4096 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  if (stream && callbacks && res.body) {
    let fullContent = "";
    let tokensIn = 0;
    let tokensOut = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;
        try {
          const data = JSON.parse(payload);
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            callbacks.onToken(delta);
          }
          if (data.usage) {
            tokensIn = data.usage.prompt_tokens || 0;
            tokensOut = data.usage.completion_tokens || 0;
          }
        } catch {
          // skip
        }
      }
    }

    const resp: ChatResponse = {
      content: fullContent,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - start,
      model,
    };
    callbacks.onDone(resp);
    return resp;
  }

  // Non-streaming
  const data = (await res.json()) as any;
  return {
    content: data.choices?.[0]?.message?.content || "",
    tokensIn: data.usage?.prompt_tokens || 0,
    tokensOut: data.usage?.completion_tokens || 0,
    durationMs: Date.now() - start,
    model,
  };
}
