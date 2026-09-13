/**
 * 题材镜头包(v12.193.0,对标 Miora Skills / genre shot-pack)。
 *
 * ad-factory 模式泛化:按题材一键注入「运镜默认 + 剪辑风格 + BGM 风格词」组合拳。
 * 只在用户**未显式选择**对应项时注入(显式选择永远优先,与情绪运镜同哲学);
 * 检测按 idea 关键词(纯函数),命中透出 agentTalk。
 *
 * v12.437:数据搬到 `skills/<id>/SKILL.md`(kind: genre-shot-pack)。本文件只保留原有的
 * 导出形状,供老调用方与老测试使用 —— **数据只有一份**,在技能库里。修前加一个题材要改代码
 * 发一版;现在往 skills/ 里丢一个文件夹就行。
 */
import { pipelineSkills, type Skill } from './skills/registry';

export interface GenreShotPack {
  id: string;
  label: string;
  match: RegExp;
  cameraDefault: string;   // 与创作页 cameraDefault preset id 对齐
  editStyle: string;       // 一句话剪辑风格(setEditStyle 语义)
  bgmStyleHint: string;    // 拼进 BGM prompt 的风格词
  /** v12.437:技能正文(导演方法论),命中时注入导演提示词 */
  body: string;
}

function toPack(s: Skill): GenreShotPack {
  const m = s.pipeline!;
  return {
    id: s.id, label: m.label, match: m.match,
    cameraDefault: m.cameraDefault!, editStyle: m.editStyle!, bgmStyleHint: m.bgmStyleHint!,
    body: s.body,
  };
}

/** 按 priority 排好序;惰性读取,调用时才碰文件系统。 */
export function genreShotPacks(): GenreShotPack[] {
  return pipelineSkills('genre-shot-pack').map(toPack);
}

/** 兼容老导出:模块加载时读一次。 */
export const GENRE_SHOT_PACKS: GenreShotPack[] = genreShotPacks();

/** idea → 命中的镜头包;不命中 null(不强塞)。多个命中取 priority 最小的。 */
export function detectShotPack(idea: string | null | undefined): GenreShotPack | null {
  const t = (idea || '').slice(0, 500);
  if (!t) return null;
  for (const p of genreShotPacks()) if (p.match.test(t)) return p;
  return null;
}

/**
 * v12.437:导演技法(kind: director-method)—— 与题材包不同,**可以叠加**:
 * 一部悬疑片里既有对峙戏又有追逐戏,两套方法都该给导演。上限 3 个,免得提示词被撑爆。
 */
export const MAX_DIRECTOR_METHODS = 3;

export interface DirectorMethod { id: string; label: string; body: string }

export function detectDirectorMethods(idea: string | null | undefined): DirectorMethod[] {
  const t = (idea || '').slice(0, 500);
  if (!t) return [];
  return pipelineSkills('director-method')
    .filter((s) => s.pipeline!.match.test(t))
    .slice(0, MAX_DIRECTOR_METHODS)
    .map((s) => ({ id: s.id, label: s.pipeline!.label, body: s.body }));
}

/** 命中的技能正文拼成一段导演提示词。空数组返回空串,调用方直接拼接即可。 */
export function buildSkillDirectiveBlock(skills: Array<{ label: string; body: string }>): string {
  const usable = skills.filter((s) => s.body.trim());
  if (!usable.length) return '';
  return '\n\n## 本片启用的导演技能(来自技能库,按此执行)\n\n'
    + usable.map((s) => `### 技能:${s.label}\n\n${s.body.trim()}`).join('\n\n');
}
