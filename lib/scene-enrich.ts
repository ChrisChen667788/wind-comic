/**
 * lib/scene-enrich (v2.13.5)
 *
 * 把 Writer 真正写出的 shots 内容贴回 Director plan 的 scenes,
 * 让 Scene Designer 出图时知道"这个场景里实际在演什么", 而不是用 Director 的占位描述。
 *
 * 修复用户反馈"角色/场景设计环节并没有按照输入剧本生成对应剧情":
 * 之前 plan.scenes[].description 是 Director 阶段的简短占位 ("古代街道, 阳光明媚"),
 * Scene Designer 完全看不到 Writer 在这个场景写了什么对白 / 动作 / 情绪 → 出图与剧情无关。
 *
 * 匹配策略:
 *   1. location 关键词在 shot.sceneDescription / shot.action 里查 (大小写不敏感)
 *   2. 找不到 → 按顺序均分 (第 i 个 plan scene ≈ shots 中第 i 段),
 *      保证关联性而不是完全无关
 *
 * 纯函数, 不调 LLM, 不依赖 orchestrator 实例 — 方便单独单测。
 */

import type { Script } from '@/types/agents';

export interface SceneInputForEnrich {
  id: string;
  location: string;
  description: string;
  visual?: any;
  // 透传任意附加字段 (genre / mood 等),不做破坏性修改
  [k: string]: any;
}

/**
 * 用 Writer 的 shots 把 plan.scenes 的 description 加厚。
 * 已存在的 [剧本细节] 段落不会重复添加 (幂等)。
 */
export function enrichScenesFromWriterScript(
  scenes: SceneInputForEnrich[],
  script: Script | null | undefined,
): SceneInputForEnrich[] {
  if (!Array.isArray(scenes) || scenes.length === 0) return scenes;
  if (!script || !Array.isArray(script.shots) || script.shots.length === 0) {
    return scenes;
  }
  const shots = script.shots;
  const totalShots = shots.length;
  const sceneCount = Math.max(1, scenes.length);
  return scenes.map((scene, i) => {
    // 已经被 enrich 过 → 不重复加
    if (typeof scene.description === 'string' && scene.description.includes('[剧本细节]')) {
      return scene;
    }
    const loc = (scene.location || '').toLowerCase().trim();
    let matched = loc
      ? shots.filter((sh) =>
          ((sh.sceneDescription || '') + ' ' + (sh.action || ''))
            .toLowerCase()
            .includes(loc),
        )
      : [];
    if (matched.length === 0) {
      // 兜底: 按顺序均分
      const span = Math.max(1, Math.ceil(totalShots / sceneCount));
      matched = shots.slice(i * span, (i + 1) * span);
    }
    if (matched.length === 0) return scene;

    const snippets = matched.slice(0, 3).map((sh) => {
      const head = `[镜${sh.shotNumber ?? '-'}]`;
      const action = sh.action ? `${sh.action}` : '';
      const dlg = sh.dialogue ? `"${sh.dialogue}"` : '';
      return `${head} ${action}${dlg ? ' · ' + dlg : ''}`.trim();
    });
    const enriched = `${scene.description || ''}\n[剧本细节] ${snippets.join(' / ')}`.trim();
    return { ...scene, description: enriched };
  });
}
