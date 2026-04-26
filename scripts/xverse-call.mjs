#!/usr/bin/env node
/**
 * 独立 XVERSE-Ent 调用脚本（OpenAI 兼容 chat-completions 接口）
 *
 * XVERSE-Ent 系列在 vLLM/sglang/HF TGI/魔搭 inference 上均提供
 * `/v1/chat/completions` 兼容协议。本脚本通过子进程隔离 fetch，
 * 与 scripts/llm-call.mjs 一致地绕过 Next.js Turbopack 的长请求阻塞问题。
 *
 * 用法: node scripts/xverse-call.mjs
 * 输入: stdin JSON {
 *   baseURL, apiKey, model,
 *   system, user,
 *   maxTokens, timeout, temperature, topP,
 *   responseFormat,           // 'json_object' | undefined
 *   stop                      // string[] | undefined
 * }
 * 输出: stdout JSON
 *   { ok: true,  content: "...", elapsed, usage }
 *   { ok: false, error: "...",   elapsed }
 */

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const {
      baseURL,
      apiKey,
      model,
      system,
      user,
      maxTokens = 4096,
      timeout = 180000,
      temperature = 0.7,
      topP = 0.9,
      responseFormat,
      stop,
    } = input;

    if (!baseURL) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'missing baseURL' }));
      process.exit(0);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const startTime = Date.now();

    // OpenAI 兼容路径——XVERSE 官方 vLLM/sglang 部署默认 `/v1/chat/completions`
    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';

    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
    };
    if (responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    if (Array.isArray(stop) && stop.length > 0) {
      body.stop = stop;
    }

    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!resp.ok) {
      const errBody = await resp.text();
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: `HTTP ${resp.status}: ${errBody.slice(0, 500)}`,
          elapsed,
        }),
      );
      process.exit(0);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const usage = data?.usage || null;
    process.stdout.write(
      JSON.stringify({ ok: true, content, elapsed, usage }),
    );
    process.exit(0);
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
    process.stdout.write(JSON.stringify({ ok: false, error: msg }));
    process.exit(0);
  }
});
