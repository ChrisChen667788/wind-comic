import { NextRequest } from 'next/server';
import { API_CONFIG } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const model = API_CONFIG.openai.model;
  const start = Date.now();

  console.log(`[TEST-LLM] 开始测试 model=${model}`);

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 120000);

    const resp = await fetch(`${API_CONFIG.openai.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_CONFIG.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是AI导演。输出纯JSON。' },
          { role: 'user', content: '输出 {"hello":"world","model":"' + model + '"}' },
        ],
        max_tokens: 100,
      }),
      signal: controller.signal,
    });

    const data = await resp.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (data.choices) {
      const content = data.choices[0].message.content;
      console.log(`[TEST-LLM] ✅ 完成 ${elapsed}s: ${content.slice(0, 100)}`);
      return Response.json({ ok: true, elapsed: `${elapsed}s`, model, content });
    } else {
      console.log(`[TEST-LLM] ❌ API错误: ${JSON.stringify(data.error || data).slice(0, 200)}`);
      return Response.json({ ok: false, error: data.error?.message || 'unknown', elapsed: `${elapsed}s` });
    }
  } catch (e: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[TEST-LLM] ❌ 异常 ${elapsed}s: ${e.message}`);
    return Response.json({ ok: false, error: e.message, elapsed: `${elapsed}s` });
  }
}
