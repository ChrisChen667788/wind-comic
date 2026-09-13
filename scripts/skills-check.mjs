#!/usr/bin/env node
/**
 * 校验 skills/ 目录里的技能(v12.437)。
 *
 * 对标 LibTV「把自己的方法保存成 Skill,可以上传 Markdown 文件或文件夹」:用户往 skills/
 * 里丢一个 `<名字>/SKILL.md`,跑一下这个就知道写对没有、会不会进流水线。
 *
 * 流水线加载时**从不因为坏技能报错**(一个写错的文件不许搞垮整条创作),所以问题只能在这里看到。
 * 有问题时退出码为 1,可以挂进 CI 或 pre-commit。
 *
 *   npm run skills:check
 */
import { loadSkills } from '../lib/skills/registry.ts';

const { skills, problems } = loadSkills({ reset: true });

console.log(`\n技能库:${skills.length} 个可用\n`);
for (const s of skills) {
  const m = s.pipeline;
  const tag = !m ? '外部技能(不进流水线)' : m.kind === 'genre-shot-pack' ? `题材包 · ${m.label}` : `导演技法 · ${m.label}`;
  console.log(`  ✓ ${s.id.padEnd(20)} ${tag}${m ? `  · 优先级 ${m.priority}` : ''}`);
}

if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题(这些技能不会进流水线):\n`);
  for (const p of problems) console.log(`  ✗ ${p.file}\n      ${p.message}`);
  console.log('');
  process.exit(1);
}
console.log('\n没有问题。\n');
