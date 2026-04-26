/**
 * lib/character-traits — 角色多维特征 LLM 抽取器
 *
 * 解决的问题 (用户反馈 #3):
 *   编剧/Director 阶段产出的 character 描述常常是 "古装人物，身着传统汉服/古装服饰，..."
 *   这种全角色一模一样的占位文字, 直接喂给 Midjourney 后所有角色长得也一样,
 *   下游一致性、Cameo 评分都救不回来。
 *
 * 这里做的事:
 *   1. 拿到原始剧本 + 角色名清单
 *   2. 调 LLM, 让它针对每个角色, 从剧本对白/动作/旁白里反向推理出 6-8 个关键维度:
 *      性别 / 年龄段 / 体型 / 肤色 / 面部特征 / 发型 / 服饰 / 性格关键词
 *   3. 返回结构化数组, 字段缺失时填"未明示"而不是瞎编 (避免 hallucination 污染下游)
 *
 * 之后 orchestrator 把结果塞进 character.visual (McKee 11 维), 让
 * getCharacterVisualPrompt 走结构化分支, 拼出真正区分度高的 MJ prompt。
 */

import OpenAI from 'openai';
import { API_CONFIG } from './config';
import { robustJsonParse } from './polish-json';

export interface CharacterTraits {
  name: string;
  /** 性别 — male / female / unknown (剧本里实在看不出就 unknown, 不要瞎猜) */
  gender: 'male' | 'female' | 'unknown';
  /** 年龄段 — 童年(<10) / 少年(10-17) / 青年(18-30) / 中年(31-50) / 老年(>50) / 未明示 */
  ageGroup: '童年' | '少年' | '青年' | '中年' | '老年' | '未明示';
  /** 体型描述 — 自然语言, 例如 "瘦削修长" / "壮硕高大" / "娇小玲珑" */
  build: string;
  /** 肤色 — 白皙 / 健康小麦色 / 黝黑 / 苍白 / 未明示 */
  skinTone: string;
  /** 面部特征 + 发型, 合并一句话 */
  appearance: string;
  /** 服饰 — 包括款式 / 颜色 / 配件 */
  costume: string;
  /** 性格 / 气质关键词, 2-3 个 */
  personality: string;
  /** 其他剧本中明确的特殊标记 (疤痕、纹身、配饰...) */
  signature: string;
  /** LLM 是否对该角色找到足量线索 (false → 下游应该走通用 fallback) */
  confident: boolean;
}

const SYSTEM_PROMPT = `你是一个专业的剧本读者, 任务是从一段中文剧本里, 为每个出场角色逆向推理出他们的视觉/性格档案。

要求:
1. 严格基于剧本里出现的台词、动作、旁白、人物称谓推理。看不出的字段必须填 "未明示" 而不是猜。
2. 角色名以传入的 names 为准, 不能新增/合并角色。
3. 输出严格 JSON, 形如:
{
  "characters": [
    {
      "name": "林小满",
      "gender": "female",
      "ageGroup": "青年",
      "build": "纤细中等身高",
      "skinTone": "白皙",
      "appearance": "黑长直发, 瓜子脸, 眼神倔强",
      "costume": "素白校服",
      "personality": "倔强 隐忍 偏执",
      "signature": "左腕红绳",
      "confident": true
    }
  ]
}

4. gender 只能是 "male" / "female" / "unknown" 三选一。
5. ageGroup 只能是 "童年" / "少年" / "青年" / "中年" / "老年" / "未明示" 之一。
6. build / skinTone / appearance / costume / personality / signature 是自然语言, 但要简练 (每个字段 ≤ 30 字)。
7. confident: 如果你只能填一两个字段, 其它都 "未明示", 设为 false。一半以上有真材实料才 true。
8. 严禁: 给所有角色填同一份描述; 给次要角色硬编出主角才有的细节; 暴力捏造剧本未提及的痣/纹身。`;

export interface ExtractOptions {
  /** 调用超时, 默认 60s */
  timeoutMs?: number;
  /** model 重写, 默认走 API_CONFIG.openai.model */
  model?: string;
  /** AbortSignal — 上层取消时立刻中断 */
  signal?: AbortSignal;
}

/**
 * 从剧本 + 角色名清单, 抽取每个角色的 6-8 维特征。
 *
 * 失败语义:
 *   · 网络/超时/解析失败 → 返回 null, 调用方继续走原 descriptionHints fallback
 *   · 部分角色 confident=false → 调用方应该把那些角色当成"信息不足", 让下游走 placeholder 而不是用错描述
 */
export async function extractCharacterTraits(
  rawScript: string,
  names: string[],
  opts: ExtractOptions = {},
): Promise<CharacterTraits[] | null> {
  if (!rawScript || rawScript.trim().length === 0) return null;
  if (!Array.isArray(names) || names.length === 0) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[character-traits] OPENAI_API_KEY 未配置, 跳过抽取');
    return null;
  }

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const model = opts.model || API_CONFIG.openai.model;
  // 长剧本截断到 12k 字符 — 够大部分短剧, 既保证 LLM context 又控成本
  const trimmedScript = rawScript.slice(0, 12000);

  const userPrompt = `角色名清单 (按出场顺序, 严格使用这些 name):\n${names.map((n) => `- ${n}`).join('\n')}\n\n剧本原文:\n---\n${trimmedScript}\n---\n\n请为以上所有角色输出 JSON。`;

  // 上层取消 + 内部超时, 取较早的那个
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onUpstreamAbort = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onUpstreamAbort);

  try {
    const resp = await fetch(`${API_CONFIG.openai.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_CONFIG.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,                        // 低温 — 抽取任务要稳定
        response_format: { type: 'json_object' },
        max_tokens: 3000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      console.warn(`[character-traits] LLM ${resp.status}, 降级`);
      return null;
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed: any = robustJsonParse(raw);
    if (!parsed || !Array.isArray(parsed.characters)) {
      console.warn('[character-traits] 解析失败, 降级');
      return null;
    }

    // 白名单清洗 + 字段长度 cap, 防止模型返回奇怪结构
    const validGenders = new Set(['male', 'female', 'unknown']);
    const validAges = new Set(['童年', '少年', '青年', '中年', '老年', '未明示']);
    const cleaned: CharacterTraits[] = parsed.characters
      .map((c: any) => {
        const name = typeof c?.name === 'string' ? c.name.trim() : '';
        if (!name) return null;
        return {
          name,
          gender: validGenders.has(c?.gender) ? c.gender : 'unknown',
          ageGroup: validAges.has(c?.ageGroup) ? c.ageGroup : '未明示',
          build: capStr(c?.build, 50),
          skinTone: capStr(c?.skinTone, 30),
          appearance: capStr(c?.appearance, 80),
          costume: capStr(c?.costume, 80),
          personality: capStr(c?.personality, 50),
          signature: capStr(c?.signature, 50),
          confident: Boolean(c?.confident),
        } as CharacterTraits;
      })
      .filter((c: CharacterTraits | null): c is CharacterTraits => c !== null);

    // 仅保留输入 names 里的角色 (防 LLM 编造新角色)
    const nameSet = new Set(names);
    return cleaned.filter((c) => nameSet.has(c.name));
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.warn('[character-traits] aborted/timed out');
    } else {
      console.warn('[character-traits] error:', e?.message || e);
    }
    return null;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onUpstreamAbort);
  }
}

/**
 * 把 CharacterTraits 转成 getCharacterVisualPrompt 的 visual 11 维结构。
 * 没有的字段不要填空字符串(会让结构化判定误判长度), 直接 undefined。
 */
export function traitsToVisual(t: CharacterTraits): {
  age?: string;
  bodyType?: string;
  skinTone?: string;
  face?: string;
  hair?: string;
  outfit?: string;
  props?: string;
} {
  const out: ReturnType<typeof traitsToVisual> = {};
  // 年龄段映射成英文区间
  const ageMap: Record<string, string> = {
    '童年': 'around 8',
    '少年': 'around 15',
    '青年': 'around 25',
    '中年': 'around 40',
    '老年': 'around 60',
  };
  if (ageMap[t.ageGroup]) out.age = ageMap[t.ageGroup];
  if (t.build && t.build !== '未明示') out.bodyType = t.build;
  if (t.skinTone && t.skinTone !== '未明示') out.skinTone = t.skinTone;
  if (t.appearance && t.appearance !== '未明示') {
    // appearance 同时含面部和发型, 拆给 face + hair, MJ 才知道分别下笔
    if (t.appearance.includes('发')) {
      out.hair = t.appearance;
      out.face = t.appearance.replace(/[^,，;；]*发[^,，;；]*/g, '').replace(/[,，;；]+/g, ',').trim() || t.appearance;
    } else {
      out.face = t.appearance;
    }
  }
  if (t.costume && t.costume !== '未明示') out.outfit = t.costume;
  if (t.signature && t.signature !== '未明示') out.props = t.signature;
  return out;
}

/**
 * 把 CharacterTraits 拼成一段中文 description 字符串, 给 character.description 字段用。
 * 这是给 UI 展示的 "可读版", 也给老路径的 prompt 拼接 fallback 用。
 */
export function traitsToDescription(t: CharacterTraits): string {
  const parts: string[] = [];
  const genderLabel = t.gender === 'male' ? '男' : t.gender === 'female' ? '女' : '';
  const ageLabel = t.ageGroup !== '未明示' ? t.ageGroup : '';
  if (genderLabel || ageLabel) parts.push(`${ageLabel}${genderLabel}`.trim() || (genderLabel || ageLabel));
  if (t.build && t.build !== '未明示') parts.push(t.build);
  if (t.skinTone && t.skinTone !== '未明示') parts.push(`${t.skinTone}肤色`);
  if (t.appearance && t.appearance !== '未明示') parts.push(t.appearance);
  if (t.costume && t.costume !== '未明示') parts.push(`着装: ${t.costume}`);
  if (t.personality && t.personality !== '未明示') parts.push(`气质: ${t.personality}`);
  if (t.signature && t.signature !== '未明示') parts.push(`记号: ${t.signature}`);
  return parts.join(' · ');
}

function capStr(v: any, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// ────────────────────────────────────────────────────────────────────
// Sprint A.2 · 用户脸 → 6 维档案 反向抽取 (traitsFromFace)
// ────────────────────────────────────────────────────────────────────
//
// extractCharacterTraits 是从「剧本文字」推角色; traitsFromFace 是从「上传脸图」推角色。
// 两者输出结构一致 (CharacterTraits), 让 orchestrator 不论数据来自哪条路径,
// 后续 traitsToVisual / traitsToDescription 都能复用。
//
// 用户使用场景:
//   1. 上传一张希望"全片所有镜头都长这样"的主角脸
//   2. 我们立刻调 GPT-4o Vision 出 6 维档案 (性别/年龄/肤色/体型/服饰/气质)
//   3. 用户在 character manager UI 看到 6 维卡片, 可以微调几项
//   4. 确认后存进 character.visual + character.bible, 后续所有 prompt 自动带

const TRAITS_FROM_FACE_SYSTEM_PROMPT = `你是一个角色 IP 设计师。
用户上传了一张人脸照片, 计划用它作为 AI 视频里"主角脸"的视觉锚定。
请基于照片本身可看到的视觉特征, 推理出 6-8 个角色档案维度。

要求:
1. 严格基于照片可见, 不可见的字段填 "未明示", 绝不瞎猜。
2. 性别 / 年龄段 / 肤色 / 体型 / 面部+发型 / 服饰 / 气质关键词 / 特殊记号 (8 维)
3. 输出严格 JSON, 形如:
{
  "name": "未命名",
  "gender": "female",
  "ageGroup": "青年",
  "build": "未明示" 或 "纤细修长",
  "skinTone": "白皙",
  "appearance": "黑长直发, 鹅蛋脸, 双眼皮",
  "costume": "白色衬衫" 或 "未明示",
  "personality": "清冷 内敛",
  "signature": "未明示",
  "confident": true
}

字段约束 (跟 extractCharacterTraits 完全一致, 上层共用 CharacterTraits 类型):
- gender: "male" / "female" / "unknown" 三选一
- ageGroup: "童年" / "少年" / "青年" / "中年" / "老年" / "未明示"
- 自然语言字段每个 ≤ 30-50 字, 简练
- confident: 至少 4 个维度有真材实料才填 true

特殊处理:
- 照片不是人脸 (动物/物品/动漫) → confident=false, 性别 unknown, 大量"未明示"
- 多张人脸 → 评估画面里最大/最居中的那张
- 脸被遮挡 (口罩/墨镜) → 跳过遮挡部分, 不要硬猜五官
- 服饰只看到上半身 → costume 只描述能看到的, 不要补全裤子鞋子`;

export interface FaceTraitsOptions {
  /** 默认给个角色名, 用户可在 UI 改 */
  defaultName?: string;
  /** 调用超时 ms, 默认 60s */
  timeoutMs?: number;
  /** model 重写 */
  model?: string;
  /** AbortSignal */
  signal?: AbortSignal;
}

/**
 * 从人脸照片反向抽取 CharacterTraits。
 *
 * 走 GPT-4o Vision (复用 cameo-vision 的 toVisionImageInput 逻辑能解析 /api/serve-file 等内部 URL)。
 *
 * 失败时返回 null —— 上层应该提示用户"自动识别失败, 请手工填写或重传一张更清晰的"。
 *
 * 成本: 1 次 vision call ≈ $0.005, 用户上传瞬间触发, 比让用户跑全 pipeline 后发现脸不对再重传划算。
 */
export async function traitsFromFace(
  imageUrl: string,
  opts: FaceTraitsOptions = {},
): Promise<CharacterTraits | null> {
  if (!imageUrl) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[traitsFromFace] OPENAI_API_KEY 未配置');
    return null;
  }

  // resolveVisionInput 处理 http(s) / data: / /api/serve-file?key=xxx / 本地路径
  const visionInputUrl = await resolveVisionInput(imageUrl);
  if (!visionInputUrl) {
    console.warn('[traitsFromFace] 无法解析图片 URL:', imageUrl.slice(0, 80));
    return null;
  }

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const model = opts.model || API_CONFIG.openai.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onUpstreamAbort = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onUpstreamAbort);

  try {
    const client = new OpenAI({
      apiKey: API_CONFIG.openai.apiKey,
      baseURL: API_CONFIG.openai.baseURL,
    });
    const resp = await client.chat.completions.create(
      {
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 600,
        messages: [
          { role: 'system', content: TRAITS_FROM_FACE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请基于这张照片输出 8 维 JSON 角色档案。' },
              { type: 'image_url', image_url: { url: visionInputUrl } },
            ],
          },
        ],
      },
      { signal: controller.signal },
    );

    const raw = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!raw) return null;

    const parsed: any = robustJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[traitsFromFace] JSON 解析失败');
      return null;
    }

    const validGenders = new Set(['male', 'female', 'unknown']);
    const validAges = new Set(['童年', '少年', '青年', '中年', '老年', '未明示']);
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : (opts.defaultName || '未命名角色'),
      gender: validGenders.has(parsed.gender) ? parsed.gender : 'unknown',
      ageGroup: validAges.has(parsed.ageGroup) ? parsed.ageGroup : '未明示',
      build: capStr(parsed.build, 50) || '未明示',
      skinTone: capStr(parsed.skinTone, 30) || '未明示',
      appearance: capStr(parsed.appearance, 80) || '未明示',
      costume: capStr(parsed.costume, 80) || '未明示',
      personality: capStr(parsed.personality, 50) || '未明示',
      signature: capStr(parsed.signature, 50) || '未明示',
      confident: Boolean(parsed.confident),
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.warn('[traitsFromFace] aborted/timed out');
    } else {
      console.warn('[traitsFromFace] error:', e?.message || e);
    }
    return null;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onUpstreamAbort);
  }
}

/**
 * 把任意 URL (http / data: / /api/serve-file?key=xxx / 本地路径) 转成 vision API 能消费的 URL。
 *
 * 复用 cameo-vision.ts 里同样逻辑 — 但避免直接引用造成 vision/traits 双向依赖, 自己再实现一份精简版。
 * 不需要的 case (data: URI 已经是合法格式) 直接透传。
 */
async function resolveVisionInput(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  if (imageUrl.startsWith('data:')) return imageUrl;

  // /api/serve-file 走本地解析, 转成 data: URI
  if (imageUrl.startsWith('/api/serve-file')) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { resolveByKey } = await import('./asset-storage');
      const u = new URL(imageUrl, 'http://localhost');
      const key = u.searchParams.get('key');
      const p = u.searchParams.get('path');
      let absPath: string | null = null;
      let ext = '';
      if (key) {
        const r = resolveByKey(key);
        if (!r) return null;
        absPath = r.absPath;
        ext = r.ext;
      } else if (p && fs.existsSync(p)) {
        absPath = p;
        ext = path.extname(p);
      }
      if (!absPath) return null;
      const buf = fs.readFileSync(absPath);
      const mime =
        ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
        : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  // 本地绝对路径
  try {
    const fs = await import('fs');
    const path = await import('path');
    if (fs.existsSync(imageUrl)) {
      const buf = fs.readFileSync(imageUrl);
      const ext = path.extname(imageUrl).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
        : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch { /* ignore */ }
  return null;
}
