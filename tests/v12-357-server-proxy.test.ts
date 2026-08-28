/**
 * v12.357:服务端 fetch 不认系统代理 —— 整条经该网关的 LLM 通路在服务端不可达。
 *
 * 顺着 v12.356 留下的欠账(「导演评审 happy path 跑不通」)往下挖,挖到的不是导演的问题。
 *
 * **两层病根,第一层在这里(更根本)**:
 * Node 的 fetch(undici)**默认不读 `HTTPS_PROXY`**。本机全局挂 ClashX,
 * `api.vectorengine.ai` 只能经代理到达 —— 于是服务端每一次打该网关的 LLM 调用都超时。
 *
 * 表现极具迷惑性:`curl` **2.2 秒**返回(curl 认 `*_proxy`),服务端同模型同 key
 * **必然 timeout**;而走 OpenRouter 的端点(hook-ideas)一切正常 —— 那个域名不需要代理。
 * 看起来像「导演功能坏了」,实际是**一整类网关在服务端不可达**。
 *
 * `scripts/api-health-audit.mjs` 的文件头**早就记着这个坑**,并在脚本里装了 ProxyAgent ——
 * 但只装在那个脚本里,**服务端从来没装过**。知识写在一处、消费方在另一处,是本仓的老毛病。
 *
 * **第二层病根**:`agent-chat.service` 把异常 `yield { type:'content' }` ——
 * **错误伪装成模型的回答**。v12.356 靠正则猜文本是不是报错,那是没有类型时的将就;
 * 现在产出独立的 `type:'error'`,消费方不必再猜。
 *
 * 修完实测:导演评审 **73 秒出真结论**(评分 40、8 条问题),
 * 并当场查出 owner 数据里的真 bug —— 年代剧女主角的概念图 prompt 写着 cyberpunk 装。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { proxyFromEnv, __resetServerProxyForTest } from '@/lib/server-proxy';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.357 代理地址解析', () => {
  it('大小写变体都认(与 curl 行为一致)', () => {
    expect(proxyFromEnv({ HTTPS_PROXY: 'http://a:1' } as never)).toBe('http://a:1');
    expect(proxyFromEnv({ https_proxy: 'http://b:2' } as never)).toBe('http://b:2');
    expect(proxyFromEnv({ ALL_PROXY: 'http://c:3' } as never)).toBe('http://c:3');
    expect(proxyFromEnv({ all_proxy: 'http://d:4' } as never)).toBe('http://d:4');
  });

  it('优先级:HTTPS > HTTP > ALL', () => {
    expect(proxyFromEnv({ HTTPS_PROXY: 'https://x', HTTP_PROXY: 'http://y', ALL_PROXY: 'http://z' } as never))
      .toBe('https://x');
  });

  it('没配代理返回空串,不返回 undefined', () => {
    expect(proxyFromEnv({} as never)).toBe('');
  });

  it('去空白 —— .env 里常见尾随空格', () => {
    expect(proxyFromEnv({ HTTPS_PROXY: '  http://p:7890  ' } as never)).toBe('http://p:7890');
  });
});

describe('v12.357 安装行为', () => {
  const SRC = read('lib/server-proxy.ts');

  it('幂等 —— 重复 register 不该叠装 dispatcher', () => {
    expect(SRC).toMatch(/if \(installed\) return/);
    expect(SRC).toMatch(/installed = true/);
  });

  it('**装不上不能让服务起不来** —— 退回直连而不是抛', () => {
    expect(SRC).toMatch(/catch \{\s*return '';\s*\}/);
  });

  it('用显式 ProxyAgent,而不是设 NODE_USE_ENV_PROXY(进程内设已太晚)', () => {
    expect(SRC).toMatch(/setGlobalDispatcher\(new ProxyAgent\(proxy\)\)/);
    expect(SRC).toMatch(/进程内再设已经太晚/);
  });

  it('在 instrumentation 里**最先**执行 —— 后续初始化都可能发请求', () => {
    const I = read('instrumentation.ts');
    const iProxy = I.indexOf('installServerProxy');
    const iSentry = I.indexOf('initSentry');
    expect(iProxy).toBeGreaterThan(-1);
    expect(iProxy).toBeLessThan(iSentry);
  });

  it('装上要打日志 —— 否则下次再遇到超时又要重新排查一遍', () => {
    expect(read('instrumentation.ts')).toMatch(/服务端已挂系统代理/);
  });
});

describe('v12.357 错误不再伪装成回答', () => {
  const CHAT = read('services/agent-chat.service.ts');

  it('异常产出独立的 type:error', () => {
    expect(CHAT).toMatch(/yield \{ type: 'error', error: msg/);
  });

  it('签名里有 error 字段(否则消费方拿不到类型提示)', () => {
    expect(CHAT).toMatch(/AsyncGenerator<\{ type: string; content\?: string; action\?: AgentAction; error\?: string \}>/);
  });

  it('仍带人可读 content —— 只认 content 的老消费方不至于拿到空', () => {
    expect(CHAT).toMatch(/content: `抱歉，出现了错误: \$\{msg\}`/);
  });

  it('director-review 改为**按类型判断**,不再靠正则猜文本', () => {
    const R = read('app/api/projects/[id]/director-review/route.ts');
    expect(R).toMatch(/if \(chunk\.type === 'error'\)/);
    expect(R).toMatch(/upstreamErr/);
  });

  it('chat 路由把错误如实透出,且**不存进聊天记录**', () => {
    const C = read('app/api/projects/[id]/chat/route.ts');
    expect(C).toMatch(/chunk\.type === 'error' \?/);
    // assistantReply 只在 content 时累加 —— 错误不会被当成助手回复
    expect(C).toMatch(/if \(chunk\.type === 'content'\) assistantReply \+=/);
  });
});
