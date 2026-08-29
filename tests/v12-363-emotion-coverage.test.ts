/**
 * v12.363:情感 TTS 只对 37% 的镜头生效 —— 而且失效是静默的。
 *
 * 全仓扫单字正则扫到 `lib/emotion-tag`。**但真实数据推翻了我的假设**:
 * 这个函数的输入是 `shot.emotion`(短情绪词),不是自由文本,所以
 * 「灯火→愤怒」「音乐→喜悦」那类误判在实际数据里不会发生。
 *
 * 拿 owner 的 **223 个有情绪标注的真实镜头**跑一遍,真问题是**漏判**:
 *   neutral 171 镜(77%),其中 **141 镜(63%)是「本有情绪、却退化成 neutral」**
 *   —— `毛骨悚然` / `寒意彻骨` / `释然` / `挣扎` / `暗涌` / `碾压式的胜利` 全部落空。
 * 模块立意是「让 speech-2.8-hd 的情感表达真正接通」,实际只接通 37%。
 *
 * 两处改动:① 词表按真实取值补全(编剧写的是「毛骨悚然」不是「恐惧」);
 * ② **区分「判定为中性」与「判不出」** —— 旧实现两者都返回 neutral,静默不可观测。
 *
 * 补完降到 40%,**剩下的是「暗涌」「毁灭与献祭交织的崇高感」这类文学化描述,
 * 关键词表覆盖不了 —— 如实承认,并让它看得见**(调用点告警),而不是继续静默。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { classifyEmotion, emotionToMinimaxEmotion } from '@/lib/emotion-tag';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.363 编剧的真实写法要判得出', () => {
  it.each([
    ['毛骨悚然', 'fearful'], ['寒意彻骨', 'fearful'], ['警觉', 'fearful'], ['窒息感', 'fearful'],
    ['释然', 'happy'], ['欣慰', 'happy'], ['温馨', 'happy'], ['碾压式的胜利', 'happy'], ['希望', 'happy'],
    ['沉重', 'sad'], ['苦涩', 'sad'], ['黯然', 'sad'], ['心酸', 'sad'],
    ['不甘', 'angry'], ['咬牙', 'angry'], ['杀意', 'angry'],
    ['错愕', 'surprised'], ['难以置信', 'surprised'],
    ['不屑', 'disgusted'], ['轻蔑', 'disgusted'],
  ])('%s → %s', (raw, want) => {
    expect(classifyEmotion(raw).emotion).toBe(want);
    expect(classifyEmotion(raw).matched).toBe(true);
  });

  it('复合情绪按**强度优先**匹配,不被中性词吞掉', () => {
    expect(classifyEmotion('坚定与恐惧交织').emotion).toBe('fearful');
    expect(classifyEmotion('对峙中的悲凉').emotion).toBe('sad');
  });
});

describe('v12.363 区分「判定为中性」与「判不出」', () => {
  it('明确的中性词 → neutral 且 matched=true', () => {
    for (const w of ['平静', '冷静', '沉稳', '内敛']) {
      const r = classifyEmotion(w);
      expect(r.emotion).toBe('neutral');
      expect(r.matched).toBe(true);
    }
  });

  it('「决绝/坚定」是**判定出来的中性**,不是判不出', () => {
    const r = classifyEmotion('决绝');
    expect(r.emotion).toBe('neutral');
    expect(r.matched).toBe(true);
  });

  it('文学化描述判不出 → matched=false(**如实,不假装判出来了**)', () => {
    for (const w of ['暗涌', '毁灭与献祭交织的崇高感', '精密计算的狂热']) {
      expect(classifyEmotion(w).matched).toBe(false);
    }
  });

  it('空输入判不出', () => {
    expect(classifyEmotion('').matched).toBe(false);
    expect(classifyEmotion(null).matched).toBe(false);
  });

  it('英文枚举原样返回且算判得出', () => {
    expect(classifyEmotion('happy')).toEqual({ emotion: 'happy', matched: true });
  });

  it('旧接口行为不变(零回归)', () => {
    for (const w of ['悲伤', '愤怒', '平静', '暗涌', '']) {
      expect(emotionToMinimaxEmotion(w)).toBe(classifyEmotion(w).emotion);
    }
  });
});

describe('v12.363 判不出必须看得见(不能只加字段不接线)', () => {
  it.each(['services/minimax.service.ts', 'services/tts.service.ts'])('%s 用 classifyEmotion 并在判不出时告警', (rel) => {
    const s = read(rel);
    expect(s).toMatch(/function _resolveEmotion/);
    expect(s).toMatch(/if \(!r\.matched\) console\.warn/);
    expect(s).toContain('情感 TTS 对这一句不生效');
    // 调用点确实换成了新 helper
    expect(s).toMatch(/emotion: _resolveEmotion\(options\.emotion\)/);
  });

  it('告警要带上原词,否则排查时不知道该补哪个', () => {
    expect(read('services/tts.service.ts')).toMatch(/无法归类「\$\{String\(raw\)/);
  });
});
