#!/usr/bin/env node
/**
 * 独立 LLM 调用脚本 —— 通过子进程运行，绕过 Next.js Turbopack 运行时的 fetch 阻塞问题。
 *
 * 用法: node scripts/llm-call.mjs
 * 输入: stdin JSON { baseURL, apiKey, model, system, user, maxTokens, timeout }
 * 输出: stdout JSON { ok: true, content: "..." } 或 { ok: false, error: "..." }
 */

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const { baseURL, apiKey, model, system, user, maxTokens = 4096, timeout = 150000 } = input;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const startTime = Date.now();
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!resp.ok) {
      const errBody = await resp.text();
      process.stdout.write(JSON.stringify({ ok: false, error: `HTTP ${resp.status}: ${errBody.slice(0, 500)}`, elapsed }));
      process.exit(0);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    process.stdout.write(JSON.stringify({ ok: true, content, elapsed }));
    process.exit(0);
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
    process.stdout.write(JSON.stringify({ ok: false, error: msg }));
    process.exit(0);
  }
});
