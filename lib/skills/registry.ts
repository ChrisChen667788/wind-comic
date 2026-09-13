/**
 * 导演技能库 —— 运行时加载器(v12.437)。
 *
 * ## 为什么把方法论从代码搬成数据
 *
 * 对标 LibTV:100+ 个专业视频 Skill,由导演们把真实项目方法封装进去,用户还能发布自己的。
 * 修前我们的「题材镜头包」写死在 `lib/genre-shot-packs.ts` 里 —— 加一个题材要改代码发一版,
 * 用户也没法把自己的方法沉淀下来。
 *
 * ## 格式:沿用仓里已有的约定,不另起一套
 *
 * `skills/<id>/SKILL.md`,YAML frontmatter + Markdown 正文。这正是 Anthropic SKILL.md 规范,
 * 也是 Agent Plugins v1.0.0(2026-08)包裹的格式;仓里 `skills/screenwriter/SKILL.md` 早就是这个样子。
 *   · 规范必填:`name`(须与目录名一致)、`description`(Agent 据此判断何时使用);
 *   · wind-comic 专属字段一律放在规范允许的扩展点 `metadata.wind-comic` 下,不污染顶层;
 *   · 没有 `metadata.wind-comic` 的技能(比如 screenwriter)是**合法的外部技能**,只是不进流水线。
 *
 * ## 坏技能不能搞垮流水线
 *
 * 用户会往目录里丢自己写的技能。一个写错的 frontmatter 不许让整条创作流水线报错 ——
 * 加载器**从不抛出**,把问题收进 `problems` 返回,由 `npm run skills:check` 如实报出。
 *
 * ## 顺序是显式的
 *
 * 题材包取「第一个命中」。迁移前的顺序是悬疑 → 甜宠 → 古装;从目录读取默认是字母序
 * (costume → suspense → sweet),「宫廷悬疑」这种双命中的创意会**悄悄从悬疑变成古装**。
 * 所以用 `priority` 显式排序,测试锁住迁移前的结果。
 */

import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

export type SkillKind = 'genre-shot-pack' | 'director-method';
export const SKILL_KINDS: readonly SkillKind[] = ['genre-shot-pack', 'director-method'];

export interface PipelineSkillMeta {
  kind: SkillKind;
  label: string;
  priority: number;
  match: RegExp;
  /** 以下三项只有 genre-shot-pack 有 */
  cameraDefault?: string;
  editStyle?: string;
  bgmStyleHint?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  /** 有 metadata.wind-comic 才进流水线 */
  pipeline: PipelineSkillMeta | null;
  file: string;
}

export interface SkillProblem {
  id: string;
  file: string;
  message: string;
}

export interface SkillLoadResult {
  skills: Skill[];
  problems: SkillProblem[];
}

/** 规范:技能名只许小写字母、数字和连字符 */
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function splitFrontmatter(src: string): { front: string; body: string } | null {
  const text = src.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const after = text.slice(end + 4);
  // 结束分隔线后面必须是换行或文件结尾,「---x」不算
  if (after && !after.startsWith('\n')) return null;
  return { front: text.slice(4, end), body: after.replace(/^\n/, '') };
}

/** 解析单个技能文件。纯函数(传入文本),便于测试;问题一律返回,不抛。 */
export function parseSkill(id: string, file: string, src: string): { skill: Skill | null; problems: SkillProblem[] } {
  const problems: SkillProblem[] = [];
  const bad = (message: string) => problems.push({ id, file, message });

  const parts = splitFrontmatter(src);
  if (!parts) { bad('缺少 YAML frontmatter(文件要以 --- 开头,并有配对的 --- 结束)'); return { skill: null, problems }; }

  let fm: any;
  try {
    fm = parseYaml(parts.front);
  } catch (e) {
    bad(`frontmatter 不是合法 YAML:${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    return { skill: null, problems };
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) { bad('frontmatter 必须是键值对'); return { skill: null, problems }; }

  const name = typeof fm.name === 'string' ? fm.name.trim() : '';
  const description = typeof fm.description === 'string' ? fm.description.trim() : '';
  if (!name) bad('缺少必填字段 name');
  else if (!NAME_RE.test(name)) bad(`name「${name}」只许小写字母、数字和连字符`);
  else if (name !== id) bad(`name「${name}」必须与目录名「${id}」一致`);
  if (!description) bad('缺少必填字段 description —— Agent 靠它判断什么时候用这个技能');

  let pipeline: PipelineSkillMeta | null = null;
  const wc = fm?.metadata?.['wind-comic'];
  if (wc !== undefined) {
    if (!wc || typeof wc !== 'object') {
      bad('metadata.wind-comic 必须是键值对');
    } else {
      const kind = wc.kind;
      if (!SKILL_KINDS.includes(kind)) bad(`metadata.wind-comic.kind 必须是 ${SKILL_KINDS.join(' / ')} 之一,当前是「${kind}」`);
      const label = typeof wc.label === 'string' ? wc.label.trim() : '';
      if (!label) bad('metadata.wind-comic.label 必填(界面上显示的名字)');
      const priority = typeof wc.priority === 'number' && Number.isFinite(wc.priority) ? wc.priority : NaN;
      if (Number.isNaN(priority)) bad('metadata.wind-comic.priority 必须是数字(决定多个技能同时命中时的先后)');

      let match: RegExp | null = null;
      const src = typeof wc.match === 'string' ? wc.match.trim() : '';
      if (!src) bad('metadata.wind-comic.match 必填(创意里出现哪些词时启用)');
      else {
        try { match = new RegExp(src, 'i'); }
        catch { bad(`metadata.wind-comic.match 不是合法正则:${src}`); }
        // 能匹配空串的正则会命中一切创意,等于强塞给所有项目
        if (match && match.test('')) { bad('metadata.wind-comic.match 能匹配空字符串,会命中所有创意'); match = null; }
      }

      const str = (k: string) => (typeof wc[k] === 'string' ? wc[k].trim() : '');
      // 初版只「报问题」没「拦下来」:缺 cameraDefault 的题材包照样进流水线,
      // 带着空串被选中,执行 setCameraDefault('')。报了问题却不拦,等于没报。
      let packComplete = true;
      if (kind === 'genre-shot-pack') {
        for (const k of ['cameraDefault', 'editStyle', 'bgmStyleHint']) {
          if (!str(k)) { bad(`题材镜头包必须提供 metadata.wind-comic.${k}`); packComplete = false; }
        }
      }

      if (SKILL_KINDS.includes(kind) && label && !Number.isNaN(priority) && match && packComplete) {
        pipeline = {
          kind, label, priority, match,
          ...(kind === 'genre-shot-pack'
            ? { cameraDefault: str('cameraDefault'), editStyle: str('editStyle'), bgmStyleHint: str('bgmStyleHint') }
            : {}),
        };
      }
    }
  }

  if (!name || !description || name !== id || !NAME_RE.test(name)) return { skill: null, problems };
  // 有 wind-comic 元数据却写坏了 → 整个技能不进流水线,但不影响其它技能
  if (wc !== undefined && !pipeline) return { skill: null, problems };

  return { skill: { id, name, description, body: parts.body.trim(), pipeline, file }, problems };
}

export function loadSkillsFrom(dir: string): SkillLoadResult {
  const skills: Skill[] = [];
  const problems: SkillProblem[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { skills, problems }; // 目录不存在不是错误:部署里可以不带技能
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    let src: string;
    try { src = fs.readFileSync(file, 'utf-8'); } catch { continue; } // 没有 SKILL.md 的子目录不是技能
    const r = parseSkill(e.name, path.relative(process.cwd(), file), src);
    problems.push(...r.problems);
    if (r.skill) skills.push(r.skill);
  }
  skills.sort((a, b) => (a.pipeline?.priority ?? Infinity) - (b.pipeline?.priority ?? Infinity) || a.id.localeCompare(b.id));
  return { skills, problems };
}

export const SKILLS_DIR = path.join(process.cwd(), 'skills');

let cache: SkillLoadResult | null = null;

/** 进程内缓存一次;测试或热加载时可以 reset。 */
export function loadSkills(opts: { reset?: boolean } = {}): SkillLoadResult {
  if (opts.reset || !cache) cache = loadSkillsFrom(SKILLS_DIR);
  return cache;
}

export function pipelineSkills(kind?: SkillKind): Skill[] {
  return loadSkills().skills.filter((s) => s.pipeline && (!kind || s.pipeline.kind === kind));
}
