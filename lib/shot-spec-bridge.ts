/**
 * lib/shot-spec-bridge — 把 **Director 的逐镜规格**摆到 Writer 面前。v12.324。
 *
 * ── 病象:同一套镜头语言被要了两遍,只有一份算数 ────────────────────
 * Director 被要求为每镜产出 10 维 `shotSpec`(下划线命名),`director-enhance`
 * 还为它写了校验;注释自己承认「Director 是 known-heavy call…8 个 shotSpec
 * nested — 12-19K chars 输出」。
 * 与此同时 **Writer 被要求自己发明同一套字段**(驼峰命名:shotSize / lens /
 * cameraAngle / cameraMovement / lightingIntent / composition / editPattern),
 * 而只有 Writer 那份会经 `renderVeoProsePrefix` 进入 visualPrompt。
 *
 * 也就是说:Director 那份规格**花了钱、过了校验、然后没人读**。
 *   · 非改编路径:它混在 `JSON.stringify(plan)` 里到过 Writer 眼前,但**没有任何
 *     指令要 Writer 遵守**,等于一坨无标签噪声;
 *   · 改编路径:plan 被刻意精简成只剩视觉风格,shotSpec **被整个丢掉**。
 *
 * ── 为什么是「接上」而不是「删掉」 ────────────────────────────────
 * 覆盖率与剪辑语法(shot-reverse-shot、180 度线、eyeline-match)是**跨镜决策**,
 * 只有看得见全片的 Director 能做;Writer 逐镜发明必然各自为政。删掉 Director 那份
 * 会丢掉这层规划,所以正确做法是把它**标注清楚地**交给 Writer 当基线。
 *
 * ── 命名归一 ──────────────────────────────────────────────────────
 * 两套拼写(snake vs camel)本身就是分裂的来源。这里统一翻成 Writer 的字段名,
 * 让 Writer 看到的就是它自己要填的键 —— 不制造第三套说法。
 */

/** Director 侧的下划线键 → Writer 侧的驼峰键。缺的字段直接略过,不编。 */
const KEY_MAP: Record<string, string> = {
  shot_size: 'shotSize',
  shot_framing: 'framing',
  camera_angle: 'cameraAngle',
  lens: 'lens',
  lighting_type: 'lightingType',
  lighting_condition: 'lightingIntent',
  composition: 'composition',
  camera_movement: 'cameraMovement',
  duration_s: 'durationSec',
  edit_pattern: 'editPattern',
};

export interface NormalizedShotSpec {
  shotNumber: number;
  fields: Record<string, string | number>;
}

/** 从 plan 里把逐镜规格抽出来并归一命名。形状不确定时**宁可返回空**,不猜。 */
export function normalizeDirectorShotSpecs(plan: unknown): NormalizedShotSpec[] {
  const p = plan as any;
  const shots: any[] = Array.isArray(p?.shots) ? p.shots
    : Array.isArray(p?.shotSpecs) ? p.shotSpecs
    : [];
  const out: NormalizedShotSpec[] = [];
  shots.forEach((s, i) => {
    // director-enhance 的校验也是这个口径:规格可能挂在 shot.shotSpec,也可能就是 shot 自己
    const spec = (s?.shotSpec && typeof s.shotSpec === 'object') ? s.shotSpec : s;
    if (!spec || typeof spec !== 'object') return;
    const fields: Record<string, string | number> = {};
    for (const [snake, camel] of Object.entries(KEY_MAP)) {
      const v = spec[snake] ?? spec[camel];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'string' || typeof v === 'number') fields[camel] = v;
    }
    if (Object.keys(fields).length === 0) return;
    const n = Number(s?.shotNumber ?? s?.shot_number ?? i + 1);
    out.push({ shotNumber: Number.isFinite(n) ? n : i + 1, fields });
  });
  return out;
}

/**
 * 生成给 Writer 的**有标签**基线块。
 *
 * 刻意写明优先级:这是基线不是枷锁 —— 剧情需要时 Writer 可以改,但要**有意识地改**,
 * 而不是像现在这样根本不知道它存在。
 */
export function buildDirectorShotSpecHint(plan: unknown, maxShots = 24): string {
  const specs = normalizeDirectorShotSpecs(plan);
  if (specs.length === 0) return '';
  const shown = specs.slice(0, maxShots);
  const lines = shown.map((s) => {
    const kv = Object.entries(s.fields).map(([k, v]) => `${k}=${v}`).join(' · ');
    return `- 镜 ${s.shotNumber}: ${kv}`;
  });
  const omitted = specs.length > shown.length
    ? `\n(其余 ${specs.length - shown.length} 镜同理,未全部列出以控制上下文)`
    : '';
  return `

══ 导演的逐镜覆盖计划(基线,非枷锁)══
下面是导演在通盘看过全片后定的镜头规格。**请把它作为你填写 shotSize / lens /
cameraAngle / cameraMovement / lightingIntent / composition / editPattern 的默认值**;
剧情确有需要时可以调整,但请是有意识的调整,而不是另起一套。
其中 editPattern(shot-reverse-shot / 180-rule / eyeline-match 等)是**跨镜决策**,
除非明确更好,否则不要改 —— 逐镜各自为政正是剪辑不连贯的来源。
${lines.join('\n')}${omitted}`;
}
