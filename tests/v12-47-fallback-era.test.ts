/**
 * v12.47 — 兜底年代识别修复:LLM 失败走 fallback 时,古装检测不能用单字正则,
 * 否则现代(尤其护肤/电商)文案里的「修护/清爽/聪明/朝阳/武汉」等常用字会被误判成古装,
 * 把现代商业片跑偏成古装戏(headless 实测精华水广告 → 户部账房古装实锤)。
 */
import { describe, expect, it } from 'vitest';
import { inferFallbackEra } from '@/services/hybrid-orchestrator';

describe('inferFallbackEra — 现代商业文案不再误判古装', () => {
  it('护肤/电商常用字(修护/清爽)不算古装', () => {
    expect(inferFallbackEra('抗老精华水,熬夜肌救星,修护暗沉,上脸清爽快速吸收').isAncient).toBe(false);
    expect(inferFallbackEra('面膜修复屏障,温和清洁不紧绷').isAncient).toBe(false);
  });

  it('单字误伤词(聪明/朝阳/武汉/宫保/明天)不算古装', () => {
    expect(inferFallbackEra('聪明的朝阳产业,武汉团队主打宫保鸡丁,明天上线').isAncient).toBe(false);
  });

  it('纯电轿跑 SUV 新车宣传(未来科技)不算古装', () => {
    const r = inferFallbackEra('纯电轿跑 SUV,智能座舱,未来科技,城市夜景霓虹与公路飞驰');
    expect(r.isAncient).toBe(false);
  });

  it('真古装/武侠/穿越 仍判古装', () => {
    expect(inferFallbackEra('古装宫廷剧,皇帝与公主的权谋').isAncient).toBe(true);
    expect(inferFallbackEra('武侠江湖,大侠仗剑走天涯').isAncient).toBe(true);
    expect(inferFallbackEra('穿越回唐朝当书生').isAncient).toBe(true);
  });

  it('赛博/科幻 仍判 isCyber;现代/古装不误判 isCyber', () => {
    expect(inferFallbackEra('赛博朋克霓虹都市,机甲与末日废土').isCyber).toBe(true);
    expect(inferFallbackEra('抗老精华水电商广告').isCyber).toBe(false);
    expect(inferFallbackEra('古装宫廷剧').isCyber).toBe(false);
  });
});
