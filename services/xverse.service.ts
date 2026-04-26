/**
 * XVERSE-Ent 编剧服务
 *
 * 接入开源 MoE 模型 XVERSE-Ent-A4.2B / A5.7B 作为编剧/导演阶段
 * 的 LLM 主用或 fallback 引擎。
 *
 * - GitHub:     https://github.com/xverse-ai/XVERSE-Ent
 * - HuggingFace:
 *     https://huggingface.co/xverse/XVERSE-Ent-A4.2B
 *     https://huggingface.co/xverse/XVERSE-Ent-A5.7B
 * - ModelScope:
 *     https://modelscope.cn/models/xverse/XVERSE-Ent-A4.2B
 *     https://modelscope.cn/models/xverse/XVERSE-Ent-A5.7B
 *
 * 设计要点：
 * 1. **OpenAI 兼容 chat-completions 协议**——通过 vLLM/sglang/HF TGI 部署。
 * 2. **子进程隔离** —— 复用与 llm-call.mjs 相同的策略（scripts/xverse-call.mjs），
 *    避开 Next.js Turbopack 对长 fetch 的阻塞。
 * 3. **双模型分工**：
 *    - A5.7B (model)     → 创意密集任务（导演 plan、编剧初稿）
 *    - A4.2B (fastModel) → 高频小任务（镜头规划 Pass1、校验补丁、修补 JSON）
 * 4. **与 mckee-skill 深度融合**：
 *    - 重用 getMcKeeWriterPrompt / getDirectorSystemPrompt 一切系统提示
 *    - 在 user prompt 头部追加"质量自检 checklist"，弥补开源模型在结构化输出上的偏差
 *    - 内置 JSON 提取/修复/校验/重试三段式
 * 5. **流式心跳** —— 通过回调通知前端"编剧思考中"避免长任务无反馈。
 */

import { execFile } from 'child_process';
import path from 'path';
import { API_CONFIG } from '@/lib/config';
import {
  getDirectorSystemPrompt,
  getMcKeeWriterPrompt,
  validateDirectorOutput,
  validateWriterOutput,
} from '@/lib/mckee-skill';
import type { DirectorPlan, Script } from '@/types/agents';

// ────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────

export interface XVerseChatOptions {
  /** 使用快速模型（A4.2B）而非创意模型（A5.7B） */
  fast?: boolean;
  /** 期望返回 JSON */
  json?: boolean;
  /** 采样温度（覆盖默认） */
  temperature?: number;
  /** topP 覆盖 */
  topP?: number;
  /** 最大输出 tokens 覆盖 */
  maxTokens?: number;
  /** 心跳回调 */
  onHeartbeat?: () => void;
  /** stop tokens */
  stop?: string[];
}

export interface XVerseCallResult {
  ok: boolean;
  content: string;
  elapsed: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  error?: string;
  /** 实际命中的模型名 */
  model: string;
}

export interface WriteScriptOptions {
  /** Director plan，即上游输出 */
  plan: DirectorPlan;
  /** 用户自由意图 / 原始剧本上下文 */
  userContext: string;
  /** 是否为剧本改编模式 */
  isAdaptation?: boolean;
  /** 强制最小镜头数 */
  minShots?: number;
  /** 强制最大镜头数 */
  maxShots?: number;
  /** Director 建议镜头数 */
  directorTotalShots?: number;
  /** 角色名列表 */
  characterNames?: string[];
  /** 角色外貌映射 */
  characterAppearances?: Record<string, string>;
  /** 场景数 */
  sceneCount?: number;
  /** 心跳回调 */
  onHeartbeat?: (msg: string) => void;
}

// ────────────────────────────────────────────
// 配置 & 可用性检测
// ────────────────────────────────────────────

export function hasXVerse(): boolean {
  const cfg = API_CONFIG.xverse;
  if (!cfg) return false;
  if (cfg.enabled) return true;
  // 即便没开 enabled，只要配了 baseURL 也可作为 fallback
  return !!cfg.baseURL && cfg.baseURL.length > 0 && cfg.fallback;
}

export function isXVersePrimary(): boolean {
  return !!API_CONFIG.xverse?.enabled;
}

// ────────────────────────────────────────────
// 子进程调用
// ────────────────────────────────────────────

function getScriptPath(): string {
  return [process.cwd(), 'scripts', 'xverse-call.mjs'].join(path.sep);
}

async function runXVerseChild(payload: Record<string, unknown>, timeout: number): Promise<string> {
  const scriptPath = getScriptPath();
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      'node',
      [scriptPath],
      {
        timeout: timeout + 10_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env },
      },
      (err, stdout) => {
        if (err) {
          reject(new Error(err.killed ? 'timeout' : err.message || String(err)));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.write(JSON.stringify(payload));
    child.stdin?.end();
  });
}

// ────────────────────────────────────────────
// 公共 chat API
// ────────────────────────────────────────────

/** 注入可替换的传输层（用于测试） */
export type XVerseTransport = (payload: Record<string, unknown>, timeout: number) => Promise<string>;

export class XVerseService {
  private cfg = API_CONFIG.xverse;
  private transport: XVerseTransport = runXVerseChild;

  /** 注入测试用 transport（生产请勿使用） */
  __setTransport(transport: XVerseTransport): void {
    this.transport = transport;
  }

  /** 单次 chat-completion 调用 */
  async chat(
    systemPrompt: string,
    userMessage: string,
    options: XVerseChatOptions = {},
  ): Promise<XVerseCallResult> {
    const cfg = this.cfg;
    if (!cfg || !cfg.baseURL) {
      return {
        ok: false,
        content: '',
        elapsed: 0,
        error: 'XVERSE_BASE_URL is not configured',
        model: 'unknown',
      };
    }

    const model = options.fast ? cfg.fastModel : cfg.model;
    const callId = `xverse-${Date.now().toString(36)}`;
    const timeout = options.maxTokens && options.maxTokens > 4096 ? Math.max(cfg.timeout, 240_000) : cfg.timeout;

    // 心跳
    const heartbeat = options.onHeartbeat
      ? setInterval(() => {
          try { options.onHeartbeat?.(); } catch {/* ignore */}
        }, 8_000)
      : null;

    // ── 构建 system / user
    const finalSystem = options.json
      ? systemPrompt + '\n\n【输出协议】严格输出纯 JSON 对象，不要任何 ``` 包裹、不要任何前后注释。'
      : systemPrompt;

    let finalUser = userMessage;
    // XVERSE 上下文 32K，预留 6K 给输出
    const MAX_USER_CHARS = 24_000;
    if (finalUser.length > MAX_USER_CHARS) {
      finalUser = finalUser.slice(0, MAX_USER_CHARS) + '\n\n[... 已截断 ...]';
    }

    const payload = {
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model,
      system: finalSystem,
      user: finalUser,
      maxTokens: options.maxTokens || cfg.maxTokens,
      timeout,
      temperature: options.temperature ?? cfg.temperature,
      topP: options.topP ?? cfg.topP,
      responseFormat: options.json ? 'json_object' : undefined,
      stop: options.stop,
    };

    const t0 = Date.now();
    try {
      console.log(
        `[XVerse:${callId}] → ${model} | sys=${finalSystem.length} user=${finalUser.length} json=${!!options.json}`,
      );
      const stdout = await this.transport(payload, timeout);
      const elapsed = (Date.now() - t0) / 1000;

      let parsed: { ok: boolean; content?: string; error?: string; usage?: any };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return {
          ok: false,
          content: '',
          elapsed,
          error: `bad child stdout: ${stdout.slice(0, 200)}`,
          model,
        };
      }

      if (!parsed.ok) {
        console.error(`[XVerse:${callId}] ❌ ${parsed.error} | ${elapsed.toFixed(1)}s`);
        return { ok: false, content: '', elapsed, error: parsed.error || 'unknown', model };
      }

      let content = (parsed.content || '').trim();

      // 清理 markdown code-fence
      if (options.json && content) {
        content = content.replace(/^```(?:json)?\s*\n?/i, '');
        content = content.replace(/\n?\s*```\s*$/i, '');
        content = content.trim();
      }

      console.log(
        `[XVerse:${callId}] ✅ ${elapsed.toFixed(1)}s | out=${content.length}chars | usage=${JSON.stringify(parsed.usage || {})}`,
      );

      return { ok: true, content, elapsed, usage: parsed.usage || null, model };
    } catch (e: any) {
      const elapsed = (Date.now() - t0) / 1000;
      const msg = e?.message || String(e);
      console.error(`[XVerse:${callId}] ❌ ${msg} | ${elapsed.toFixed(1)}s`);
      return { ok: false, content: '', elapsed, error: msg, model };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  // ────────────────────────────────────────
  // 高级 API：导演 / 编剧 / 镜头规划
  // ────────────────────────────────────────

  /** 调用导演 plan（创意模型 A5.7B） */
  async runDirector(
    userPrompt: string,
    options: { isAdaptation?: boolean; characterCount?: number; sceneCount?: number; onHeartbeat?: () => void } = {},
  ): Promise<{ ok: boolean; plan?: DirectorPlan; raw: string; error?: string; elapsed: number }> {
    const sysPrompt = getDirectorSystemPrompt({
      isScriptAdaptation: options.isAdaptation,
      parsedCharacterCount: options.characterCount,
      parsedSceneCount: options.sceneCount,
    });

    const result = await this.chat(sysPrompt, userPrompt, {
      fast: false,
      json: true,
      maxTokens: 4096,
      onHeartbeat: options.onHeartbeat,
    });

    if (!result.ok || !result.content) {
      return { ok: false, raw: '', error: result.error || 'empty', elapsed: result.elapsed };
    }

    const parsed = safeJSONParse<DirectorPlan>(result.content);
    if (!parsed) {
      return { ok: false, raw: result.content, error: 'json-parse-failed', elapsed: result.elapsed };
    }

    // 自动校验，必要时一次性修正
    const validation = validateDirectorOutput(parsed);
    if (!validation.passed) {
      const fixRes = await this.chat(
        sysPrompt,
        `你之前的输出存在以下问题：\n${validation.fixInstructions}\n\n原始输出（需修正）：\n${result.content}\n\n请输出修正后的完整 JSON。`,
        { fast: false, json: true, maxTokens: 4096, onHeartbeat: options.onHeartbeat },
      );
      const fixed = fixRes.ok ? safeJSONParse<DirectorPlan>(fixRes.content) : null;
      if (fixed) {
        return { ok: true, plan: fixed, raw: fixRes.content, elapsed: result.elapsed + fixRes.elapsed };
      }
    }

    return { ok: true, plan: parsed, raw: result.content, elapsed: result.elapsed };
  }

  /**
   * Two-Pass 编剧主流程：
   * - Pass 1（A4.2B 快速模型）：自然语言镜头规划
   * - Pass 2（A5.7B 创意模型）：基于规划生成结构化 Script JSON
   * - 自动校验 + 一次修补
   */
  async writeScript(opts: WriteScriptOptions): Promise<{
    ok: boolean;
    script?: Script;
    error?: string;
    elapsedMs: number;
    passes: { pass1Ms: number; pass2Ms: number; fixMs?: number };
  }> {
    const { plan, userContext } = opts;
    const t0 = Date.now();

    const directorTotalShots = plan.storyStructure?.totalShots || opts.directorTotalShots || 0;
    const minShots = opts.minShots || (directorTotalShots > 0 ? Math.max(4, directorTotalShots - 2) : 4);
    const maxShots = opts.maxShots || (directorTotalShots > 0 ? Math.max(directorTotalShots + 2, 8) : 12);

    // ── Pass 1: 镜头规划（A4.2B 快速模型 + 纯文本）
    opts.onHeartbeat?.('XVerse 编剧 Pass 1：规划镜头分配...');
    const planningPrompt = `你是一位精通分镜的中文编剧。请先分析素材，规划镜头拆分方案。

【硬性规则】
- 你必须规划 ${minShots} 到 ${maxShots} 个镜头
- 一个场景通常拆分为 2-5 个镜头（每段重要对话/动作/情绪转折 = 1 个镜头）
- **绝对禁止只规划 1-3 个镜头**，最少 ${minShots} 个

【输出格式（纯文本，不要 JSON）】
首行写："共规划 N 个镜头"
然后逐行列出：
镜头1: [场景名] - [核心内容] - 角色:[名字] - 台词:"[原文台词]"
镜头2: ...`;

    const pass1Res = await this.chat(planningPrompt, userContext, {
      fast: true,        // A4.2B
      json: false,
      maxTokens: 1500,
      temperature: 0.6,  // 规划阶段降温
      onHeartbeat: () => opts.onHeartbeat?.('XVerse 编剧 Pass 1：规划中...'),
    });

    const pass1Ms = pass1Res.elapsed * 1000;
    const shotPlanText = pass1Res.ok ? pass1Res.content : '';
    const planShotCount = (shotPlanText.match(/镜头\s*\d+/g) || []).length;
    console.log(`[XVerse-Writer] Pass1 done in ${pass1Ms.toFixed(0)}ms, planShotCount=${planShotCount}`);

    // ── Pass 2: 结构化 JSON（A5.7B 创意模型）
    opts.onHeartbeat?.('XVerse 编剧 Pass 2：生成完整剧本 JSON...');
    const writerSystemPrompt = getMcKeeWriterPrompt(plan.genre || '', plan.style || '', {
      isScriptAdaptation: opts.isAdaptation,
      characterNames: opts.characterNames,
      characterAppearances: opts.characterAppearances,
      sceneCount: opts.sceneCount,
      minShots,
      maxShots,
      directorTotalShots,
    });

    const trimmedUserCtx = userContext.length > 8000 ? userContext.slice(0, 8000) + '\n[...已截断...]' : userContext;
    const pass2Context = shotPlanText
      ? `══ 镜头规划（严格按此规划生成 JSON）══\n${shotPlanText}\n\n══ 素材 ══\n${trimmedUserCtx}\n\n══ 指令 ══\nshots 数组必须有 ${planShotCount || minShots} 个镜头。`
      : `${trimmedUserCtx}\n\nshots 数组必须有 ${minShots}-${maxShots} 个镜头。`;

    const pass2Res = await this.chat(writerSystemPrompt, pass2Context, {
      fast: false,        // A5.7B
      json: true,
      maxTokens: 8192,
      onHeartbeat: () => opts.onHeartbeat?.('XVerse 编剧 Pass 2：撰写中...'),
    });

    const pass2Ms = pass2Res.elapsed * 1000;
    if (!pass2Res.ok || !pass2Res.content) {
      return {
        ok: false,
        error: pass2Res.error || 'pass2-empty',
        elapsedMs: Date.now() - t0,
        passes: { pass1Ms, pass2Ms },
      };
    }

    let script = safeJSONParse<Script>(pass2Res.content);
    if (!script) {
      // 尝试一次修复（A4.2B，只做格式化）
      opts.onHeartbeat?.('XVerse 编剧：修复 JSON 格式...');
      const fixRes = await this.chat(
        '你是一个 JSON 修复机。把以下文本严格规整成有效 JSON，不要修改任何语义。直接输出 JSON 对象。',
        pass2Res.content,
        { fast: true, json: true, maxTokens: 8192, temperature: 0.1 },
      );
      script = fixRes.ok ? safeJSONParse<Script>(fixRes.content) : null;
      if (!script) {
        return {
          ok: false,
          error: 'pass2-json-parse-failed',
          elapsedMs: Date.now() - t0,
          passes: { pass1Ms, pass2Ms, fixMs: fixRes.elapsed * 1000 },
        };
      }
    }

    // ── 镜头数兜底（不足时再补一刀）
    let fixMs = 0;
    if (script.shots && script.shots.length < minShots) {
      opts.onHeartbeat?.(`XVerse 编剧：镜头不足 ${script.shots.length}/${minShots}，补充中...`);
      const retryRes = await this.chat(
        writerSystemPrompt,
        `🚨 严重问题：你只生成了 ${script.shots.length} 个镜头，但要求是 ${minShots}-${maxShots} 个。\n\n请参考以下镜头规划重新生成完整 JSON：\n${shotPlanText}\n\n你之前的不完整输出：\n${pass2Res.content.slice(0, 2000)}\n\n请输出修正后的完整 JSON，shots 数组至少 ${minShots} 个镜头。`,
        { fast: false, json: true, maxTokens: 8192, onHeartbeat: () => opts.onHeartbeat?.('XVerse 编剧：补镜头中...') },
      );
      fixMs = retryRes.elapsed * 1000;
      const retryScript = retryRes.ok ? safeJSONParse<Script>(retryRes.content) : null;
      if (retryScript?.shots && retryScript.shots.length > script.shots.length) {
        script = retryScript;
      }
    }

    // ── 质量自检 + 一次性修补
    const validation = validateWriterOutput(script);
    if (!validation.passed) {
      opts.onHeartbeat?.(`XVerse 编剧：自检发现 ${validation.issues.length} 处不达标，修补中...`);
      const fixRes = await this.chat(
        writerSystemPrompt,
        `你之前的输出存在以下问题：\n${validation.fixInstructions}\n\n原始输出：\n${JSON.stringify(script).slice(0, 6000)}\n\n请输出修正后的完整 JSON，shots 数量不可减少。`,
        { fast: false, json: true, maxTokens: 8192, onHeartbeat: () => opts.onHeartbeat?.('XVerse 编剧：修补中...') },
      );
      fixMs += fixRes.elapsed * 1000;
      const fixedScript = fixRes.ok ? safeJSONParse<Script>(fixRes.content) : null;
      if (fixedScript?.shots && fixedScript.shots.length >= (script.shots?.length || 0)) {
        script = fixedScript;
      }
    }

    return {
      ok: true,
      script,
      elapsedMs: Date.now() - t0,
      passes: { pass1Ms, pass2Ms, fixMs: fixMs || undefined },
    };
  }
}

// ────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────

export function safeJSONParse<T = any>(text: string): T | null {
  if (!text) return null;
  // 直接尝试
  try { return JSON.parse(text) as T; } catch {/* fallthrough */}
  // 尝试提取首个 `{...}` 块
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice) as T; } catch {/* ignore */}
  }
  return null;
}

// 默认单例供编排器复用
export const xverseService = new XVerseService();
