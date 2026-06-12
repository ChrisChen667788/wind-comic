/**
 * v11.1.0 — 拉片表单测(纯函数,零 IO)。
 *
 * 覆盖:五栏字段映射(权威 ScriptShot v2.8 全字段)、演示工程字段形兼容
 * (单数 character / description / cameraWork·beat 回退)、时间轴累计、
 * 缺字段如实留空、媒体引用挂接、CSV 转义/BOM/行数。
 */
import { describe, expect, it } from 'vitest';
import { buildPullSheetFromScript, toPullSheetCsv, PULL_SHEET_COLUMNS } from '@/lib/pull-sheet';

const FULL_SHOT = {
  shotNumber: 1,
  sceneDescription: '雨夜巷口全景',
  action: '程一帆撑伞穿过雨幕',
  scene: '霓虹雨巷',
  characters: ['程一帆', ' 苏雨眠 '],
  dialogue: '又是 23:17……',
  duration: 3.5,
  shotSize: '全景',
  composition: '纵深构图',
  cameraAngle: '平视',
  cameraMovement: '缓慢推近',
  lens: '24mm 深景深',
  lightingIntent: '霓虹冷暖对撞',
  editPattern: '长镜无剪辑',
  scoreMood: '低频合成器',
  soundDesign: '雨声白噪',
  diegeticSound: '收音机沙沙声',
  storyBeat: '钩子',
  whyThisChoice: '全景交代世界观',
};

describe('v11.1.0 · buildPullSheetFromScript', () => {
  it('权威 ScriptShot 全字段 → 五栏一一映射;时间轴按 duration 累计', () => {
    const sheet = buildPullSheetFromScript({
      title: '测试片',
      shots: [FULL_SHOT, { ...FULL_SHOT, shotNumber: 2, duration: 5 }],
    });
    expect(sheet.title).toBe('测试片');
    expect(sheet.shotCount).toBe(2);
    expect(sheet.totalDurationSec).toBe(8.5);
    expect(sheet.source).toBe('factory');

    const s1 = sheet.shots[0];
    expect(s1.description).toBe('雨夜巷口全景');     // sceneDescription 优先于 action
    expect(s1.characters).toEqual(['程一帆', '苏雨眠']); // trim
    expect(s1.startSec).toBe(0);
    expect(s1.endSec).toBe(3.5);
    expect(sheet.shots[1].startSec).toBe(3.5);
    expect(sheet.shots[1].endSec).toBe(8.5);
    expect(s1.shotSize).toBe('全景');
    expect(s1.lightingIntent).toBe('霓虹冷暖对撞');
    expect(s1.whyThisChoice).toBe('全景交代世界观');
  });

  it('演示工程字段形兼容:单数 character / description / cameraWork·beat 回退;缺字段留空', () => {
    const sheet = buildPullSheetFromScript({
      shots: [{
        shotNumber: 1,
        description: '天台逆光剪影',
        character: '苏雨眠',
        cameraWork: '环绕推移',
        beat: '反转',
        dialogue: '你终于肯来了。',
      }],
    });
    const s = sheet.shots[0];
    expect(s.description).toBe('天台逆光剪影');
    expect(s.characters).toEqual(['苏雨眠']);
    expect(s.cameraMovement).toBe('环绕推移');
    expect(s.storyBeat).toBe('反转');
    expect(s.durationSec).toBe(5);     // 默认 5s
    expect(s.shotSize).toBe('');       // 缺字段如实留空,不编造
    expect(s.lightingIntent).toBe('');
  });

  it('媒体引用按镜号挂接;无镜号的行被过滤', () => {
    const sheet = buildPullSheetFromScript(
      { shots: [{ shotNumber: 1 }, { foo: 'bar' }] },
      {
        storyboards: [{ shotNumber: 1, url: '/sb-1.png' }],
        videos: [{ shotNumber: 1, url: '/v-1.mp4' }],
      },
    );
    expect(sheet.shotCount).toBe(1);
    expect(sheet.shots[0].thumbnail).toBe('/sb-1.png');
    expect(sheet.shots[0].videoUrl).toBe('/v-1.mp4');
  });

  it('空剧本 → 空表不抛', () => {
    const sheet = buildPullSheetFromScript({});
    expect(sheet.shotCount).toBe(0);
    expect(sheet.totalDurationSec).toBe(0);
  });
});

describe('v11.1.0 · toPullSheetCsv', () => {
  it('BOM + 表头 + 行数;逗号/引号/换行正确转义;数组列顿号连接', () => {
    const sheet = buildPullSheetFromScript({
      title: 'csv',
      shots: [{
        shotNumber: 1,
        sceneDescription: '含,逗号 和 "引号"\n还有换行',
        characters: ['甲', '乙'],
      }],
    });
    const csv = toPullSheetCsv(sheet);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.length).toBe(2); // 表头 + 1 行(单元格内换行被引号包裹,不产生新行)
    expect(lines[0].split(',').length).toBe(PULL_SHEET_COLUMNS.length);
    expect(lines[1]).toContain('"含,逗号 和 ""引号""\n还有换行"');
    expect(lines[1]).toContain('甲、乙');
  });
});
