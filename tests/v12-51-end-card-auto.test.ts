/**
 * v12.51 — 主管线自动片尾卡:商业题材判定 + 文案派生(宁缺毋滥)。
 */
import { describe, it, expect } from 'vitest';
import { isCommercialIdea, deriveEndCard, commercialDirectorAnchor } from '@/lib/end-card';

describe('v12.51 · 自动片尾卡派生', () => {
  it('isCommercialIdea:广告/宣传片/promo/带货/种草 命中;短剧/纪录片不命中', () => {
    expect(isCommercialIdea('电商精华水广告片,熬夜肌救星')).toBe(true);
    expect(isCommercialIdea('车企新车宣传片,未来科技')).toBe(true);
    expect(isCommercialIdea('product promo for a new phone')).toBe(true);
    expect(isCommercialIdea('一条带货短视频')).toBe(true);
    expect(isCommercialIdea('古装宫廷短剧,皇帝与公主')).toBe(false);
    expect(isCommercialIdea('赛博朋克悬疑故事')).toBe(false);
  });

  it('商业题材 + 末镜干净 CTA → 出卡(title=CTA 台词)', () => {
    const ec = deriveEndCard('电商精华水广告片', '下一个发光的，会是你吗？');
    expect(ec).not.toBeNull();
    expect(ec!.title).toBe('下一个发光的，会是你吗？');
  });

  it('去掉台词开头的省略号/句号噪声', () => {
    expect(deriveEndCard('护肤广告片', '……来试试吧')!.title).toBe('来试试吧');
  });

  it('非商业题材 → null(不加卡)', () => {
    expect(deriveEndCard('武侠江湖短剧', '大侠请留步')).toBeNull();
  });

  it('CTA 太长(>24)/为空/含换行 → null(宁缺毋滥)', () => {
    expect(deriveEndCard('广告片', '这是一句非常非常非常非常非常非常非常长的根本不像标语的台词内容')).toBeNull();
    expect(deriveEndCard('广告片', '')).toBeNull();
    expect(deriveEndCard('广告片', undefined)).toBeNull();
    expect(deriveEndCard('广告片', '第一行\n第二行')).toBeNull();
  });

  it('productLine 短则带上作副标,过长则丢', () => {
    expect(deriveEndCard('广告片', '快来吧', '抗老精华水')!.slogan).toBe('抗老精华水');
    expect(deriveEndCard('广告片', '快来吧', '这是一个非常长的产品线描述超过二十字上限了的')!.slogan).toBeUndefined();
  });

  it('commercialDirectorAnchor:强制现代写实 + 明令禁古装/ancient(v12.57 修古装漂移)', () => {
    const a = commercialDirectorAnchor();
    expect(a).toContain('当代现实主义');
    expect(a).toContain('严禁古装');
    for (const w of ['古风', '历史剧', '汉服', '宫廷', '武侠', '玄幻', 'ancient', 'hanfu', 'costume']) {
      expect(a).toContain(w);
    }
  });

  it('commercialDirectorAnchor:强制仿真人实拍 + 明令禁 octane/3D/CGI(v12.58 修 3D 塑料感)', () => {
    const a = commercialDirectorAnchor();
    expect(a).toContain('photorealistic');
    expect(a).toMatch(/真人实拍|真实摄影/);
    for (const w of ['octane render', '3d render', 'CGI', 'cartoon', 'illustration', 'unreal engine']) {
      expect(a).toContain(w);
    }
  });
});
