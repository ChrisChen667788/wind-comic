/**
 * v12.374:成片是哑的,而接口报的是成功。
 *
 * 项目 1 重合成返回 200 + `voiceover: 5`,ffprobe 也确实有音频流,
 * 实测 mean_volume = -91.0 dB —— 整条片子没有一点声音。
 * 三层原因叠在一起,每一层单独看都「不算错」:
 *   ① 配音 URL 指向 /tmp,文件早被系统清了 —— 而消费端只校验字符串非空;
 *   ② 重生配音硬编码 `voiceId: 'female-zh'`,MiniMax 回 2054 voice id not exist;
 *   ③ dispatch 失败不抛错、只返回 result:null,而调用点只有 `if (result) push`。
 * 于是失败一路无声,最后以「成功」的形态交付给用户。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { checkMediaReachable, isMediaReachable, filterReachable } from '@/lib/media-reachable';
import { pickShotVoice, isKnownVoiceId, NARRATOR_KEY } from '@/lib/shot-voice';
import { VOICE_CATALOG } from '@/lib/character-studio';
import { serveFilePathUrl } from '@/lib/serve-file-sign';

const ROUTE = path.join(process.cwd(), 'app/api/projects/[id]/recompose/route.ts');
const src = fs.readFileSync(ROUTE, 'utf-8');
/** 断言「代码里没有 X」时必须先剥掉注释 —— 本版的注释正在解释这个 X。 */
const codeOnly = src
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
// 过滤要留下代码:全被剥光的话,下面所有 not.toContain 都会变成永真
if (codeOnly.length < src.length * 0.5) throw new Error('注释过滤把代码也剥掉了,断言将失去区分力');

describe('media-reachable:URL 非空 ≠ 文件还在', () => {
  it('指向已被清理的 /tmp 路径 → missing(本 bug 的原始形态)', () => {
    expect(checkMediaReachable('/tmp/claude-501/qf-audio/mnx-does-not-exist.mp3')).toBe('missing');
  });

  it('serve-file?path= 包着的不存在路径同样 → missing', () => {
    const u = '/api/serve-file?path=' + encodeURIComponent('/tmp/qf-audio/gone.mp3') + '&sig=abc';
    expect(checkMediaReachable(u)).toBe('missing');
  });

  it('历史遗留的**无签名** /tmp URL → missing(项目 1 那 5 段配音的真实形态)', () => {
    const real = '/api/serve-file?path=' + encodeURIComponent('/tmp/claude-501/qf-audio/mnx-1780687841542-52ef6z.mp3');
    expect(real).not.toContain('sig=');
    expect(checkMediaReachable(real)).toBe('missing');
  });

  it('合法签名 + 白名单内 + 文件真在 → ok', () => {
    const f = path.join(process.cwd(), 'data', 'media', `.reachable-probe-${process.pid}.txt`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'x');
    try {
      expect(checkMediaReachable(f)).toBe('ok');
      expect(checkMediaReachable(serveFilePathUrl(f))).toBe('ok');
      fs.unlinkSync(f);
      expect(checkMediaReachable(serveFilePathUrl(f))).toBe('missing');
    } finally {
      try { fs.unlinkSync(f); } catch { /* 已删 */ }
    }
  });

  it('白名单外的路径不判定存在性 —— 否则就成了任意文件探测器', () => {
    // customBgm 来自用户 body,这条路一旦能问出「在不在」,就是 v12.237 那个侧门的复刻
    const inside = path.join(process.cwd(), 'app/api/projects/[id]/recompose/route.ts');
    expect(fs.existsSync(inside)).toBe(true);          // 文件确实存在
    expect(checkMediaReachable(inside)).toBe('missing'); // 但不在媒体根内 → 不承认、也不碰盘
    expect(checkMediaReachable('/etc/passwd')).toBe('missing');
    expect(checkMediaReachable('/api/serve-file?path=' + encodeURIComponent('/etc/passwd'))).toBe('missing');
  });

  it('远程 URL 一律 unknown —— 只拦「确认缺失」,不拦「无法确认」', () => {
    for (const u of ['https://cdn.example.com/a.mp3', 'http://x.cn/b.mp4', 'data:audio/mp3;base64,AAAA']) {
      expect(checkMediaReachable(u)).toBe('unknown');
      expect(isMediaReachable(u)).toBe(true);
    }
  });

  it('空值 / 畸形输入 → unknown 且永不抛错', () => {
    for (const u of [null, undefined, '', '   ', '::::', '%%%%'] as any[]) {
      expect(() => checkMediaReachable(u)).not.toThrow();
      expect(checkMediaReachable(u)).toBe('unknown');
    }
  });

  it('key= 指向不存在的资产 → missing', () => {
    expect(checkMediaReachable('/api/serve-file?key=' + 'f'.repeat(64))).toBe('missing');
  });

  it('filterReachable 分组,并把丢弃的原样交回给调用方上报', () => {
    const good = path.join(process.cwd(), 'data', 'media', `.filter-probe-${process.pid}.txt`);
    fs.mkdirSync(path.dirname(good), { recursive: true });
    fs.writeFileSync(good, 'x');
    const items = [
      { id: 'a', url: good },
      { id: 'b', url: '/tmp/qf-audio/gone-1.mp3' },
      { id: 'c', url: 'https://cdn.example.com/x.mp3' },
      { id: 'd', url: '/tmp/qf-audio/gone-2.mp3' },
    ];
    const { kept, dropped } = filterReachable(items, (i) => i.url);
    try {
      expect(kept.map((k) => k.id)).toEqual(['a', 'c']);
      expect(dropped.map((d) => d.id)).toEqual(['b', 'd']);
    } finally {
      try { fs.unlinkSync(good); } catch { /* 已删 */ }
    }
  });
});

describe('shot-voice:兜底也必须落在真实音色目录内', () => {
  /** 本版的病根就是一个「看起来合理」但不存在的音色 id。这条是唯一值得锁死的行为。 */
  it('任何输入都返回 VOICE_CATALOG 内真实存在的 id', () => {
    const inputs = [
      undefined, null, {}, { speaker: '' }, { characters: [] },
      { characters: ['李长安'] }, { characters: ['柳如烟', '李长安'] },
      { speaker: '李长安' }, { characters: [null, 123, {}] as any },
      { speaker: '   ' }, { characters: '不是数组' as any },
    ];
    for (const i of inputs) {
      const v = pickShotVoice(i as any);
      expect(isKnownVoiceId(v), `pickShotVoice(${JSON.stringify(i)}) => ${v} 不在目录内`).toBe(true);
    }
  });

  it('绝不吐出 female-zh / male-zh —— 它们不在目录里,MiniMax 报 2054', () => {
    expect(VOICE_CATALOG.some((v) => v.id === 'female-zh' || v.id === 'male-zh')).toBe(false);
    const seen = new Set<string>();
    for (const n of ['李长安', '柳如烟', '旁白', '墨七', '张三', '', 'A']) {
      seen.add(pickShotVoice({ speaker: n }));
      seen.add(pickShotVoice({ characters: [n] }));
    }
    expect(seen.has('female-zh')).toBe(false);
    expect(seen.has('male-zh')).toBe(false);
  });

  it('显式 speaker 优先于出场角色', () => {
    const a = pickShotVoice({ speaker: '李长安', characters: ['柳如烟'] });
    expect(a).toBe(pickShotVoice({ speaker: '李长安' }));
  });

  it('单角色镜用该角色;多角色镜不猜,退旁白', () => {
    expect(pickShotVoice({ characters: ['柳如烟'] })).toBe(pickShotVoice({ speaker: '柳如烟' }));
    const multi = pickShotVoice({ characters: ['柳如烟', '李长安'] });
    expect(multi).toBe(pickShotVoice({ speaker: NARRATOR_KEY }));
  });

  it('同一角色恒定同音色(重配一镜不能换嗓)', () => {
    const runs = Array.from({ length: 5 }, () => pickShotVoice({ characters: ['柳如烟'] }));
    expect(new Set(runs).size).toBe(1);
  });
});

describe('recompose 接线', () => {
  it('消费 timeline 里的历史配音时先过可达性,不再只看字符串非空', () => {
    const branch = codeOnly.slice(codeOnly.indexOf('parse(timelineAssets[0]?.data)?.voiceoverClips'));
    // 注意:codeOnly 已把注释行剥掉了,所以窗口右界只能用**代码**锚点,不能用注释锚点
    const end = branch.indexOf('const { composeVideo');
    expect(end).toBeGreaterThan(0);
    const win = branch.slice(0, end);
    expect(win).toContain('filterReachable');
    expect(win).toContain('voiceoverDropped');
  });

  it('BGM 走同一条防线', () => {
    // v12.379 修订:那版把 BGM 从「取第一条再看可不可达」改成「在候选里挑可达的」,
    // `const musicRaw` 这个变量随之消失 —— 锚点指向一个已不存在的名字,
    // indexOf 返回 -1、窗口切歪,断言以**错误的理由**变红(行为其实更强了)。
    // 现在锚在选路段落的开头,并先自证窗口有效。
    const start = codeOnly.indexOf('const musicCandidates');
    const end = codeOnly.indexOf('const keepSet', start);
    expect(start, 'BGM 选路段落找不到了').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const win = codeOnly.slice(start, end);
    expect(win).toMatch(/isMediaReachable|filterReachable/);
    expect(win).toContain('musicDropped');
  });

  it('重生配音走 pickShotVoice,代码里不再有写死的音色 id', () => {
    expect(codeOnly).toContain('pickShotVoice');
    expect(codeOnly).not.toContain("'female-zh'");
    expect(codeOnly).not.toContain("'male-zh'");
  });

  it('TTS 无结果不再被静默吞掉 —— 失败要带着镜号、音色、原因浮上来', () => {
    const win = codeOnly.slice(codeOnly.indexOf('dispatchTTSGenerate'));
    const body = win.slice(0, 1400);
    expect(body).toContain('voiceoverFailed');
    expect(body).toContain('shotNumber');
    expect(body).toContain('voiceId');
    // catch 分支也要上报,不能只处理「返回 null」那一支
    expect(body.split('voiceoverFailed.push').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('响应如实回报丢弃与失败,而不是只报一个好看的数字', () => {
    const win = codeOnly.slice(codeOnly.indexOf('ok: true, finalVideoUrl'));
    const body = win.slice(0, 500);
    expect(body).toContain('voiceoverDropped');
    expect(body).toContain('musicDropped');
    expect(body).toContain('voiceoverFailed');
  });

  it('提示文案指向真实存在的参数名(旧文案写的 regenerateVoiceover 并不存在)', () => {
    expect(src).toContain('regenVoiceover');
    expect(src).not.toContain('regenerateVoiceover');
  });
});
