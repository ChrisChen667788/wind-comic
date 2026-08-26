/**
 * v12.337 — 自然语言改单镜:竞品对标清单的最后一项。
 *
 * ## 背景
 * v12.248 已能把「第 3 镜改成夜景」解析成 `regenShot` 意图,v12.251 把**组合级**编辑
 * 接到了 `recompose`。唯独单镜这支**解析了却不执行** —— 界面只显示「第 3 镜需重生画面」,
 * 让用户自己跑去项目页手动重来。这一版把它接上。
 *
 * ## 这个文件锁的是那条**会静默出错**的
 * `regenerate-shot` 里 `prompt: [description, cameraPrompt].join('. ')` —— description
 * **就是整条视频提示词**。若把 note(「改成夜景」)当 description 传进去,原镜的人物、
 * 场景、动作会被整个抹掉,生成一个毫不相干的镜头,**而且会「成功」返回、不报任何错**。
 * 所以核心不变式是:**原描述非空时,绝不允许只拿 note 出门。**
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mergeShotEdit, describeMerge } from '@/lib/shot-edit-merge';

// 取自库里真实的一条 storyboard.data.description(含时间/色调线索,才测得出冲突判定)
const ORIG = '大远景缓慢推镜入中景。李长安靠在左侧门框,目光紧盯瓷勺。柳如烟长发轮廓被斜射的橙金晚霞镶边。光线自左上西窗斜射,色温偏暖橘黄。';

describe('v12.337 · 合并而不是替换(核心不变式)', () => {
  it('**原描述非空时,结果必须仍包含原描述** —— 这是整个模块存在的理由', () => {
    const m = mergeShotEdit(ORIG, '改成夜景');
    expect(m.mode).toBe('merged');
    expect(m.prompt).toContain('李长安');
    expect(m.prompt).toContain('瓷勺');
    expect(m.prompt).toContain('夜景');
    expect(m.prompt.length).toBeGreaterThan(ORIG.length);
  });

  it('修改说明放在**最后**(同属性后出现的表述压过先出现的)', () => {
    const m = mergeShotEdit(ORIG, '改成夜景');
    expect(m.prompt.indexOf('夜景')).toBeGreaterThan(m.prompt.indexOf('李长安'));
  });

  it('两段关系写明,免得模型把指令读成画面里的字', () => {
    expect(mergeShotEdit(ORIG, '让她转过身来').prompt).toContain('在此基础上修改');
  });

  it('没给修改说明 → 原样重生,不凭空加东西', () => {
    const m = mergeShotEdit(ORIG, '');
    expect(m.mode).toBe('originalOnly');
    expect(m.prompt).toBe(ORIG);
  });

  it('原描述缺失(老项目/资产被清)才允许只用 note,且必须标记出来', () => {
    const m = mergeShotEdit('', '改成夜景');
    expect(m.mode).toBe('noteOnly');
    expect(m.prompt).toBe('改成夜景');
    expect(describeMerge(m), '这种情况必须警告用户画面会差很多').toMatch(/⚠️|仅按/);
  });

  it('两边都空 → empty,不返回半截提示词', () => {
    const m = mergeShotEdit('', '');
    expect(m.mode).toBe('empty');
    expect(m.prompt).toBe('');
  });

  it('null / undefined 不炸', () => {
    expect(mergeShotEdit(null, undefined).mode).toBe('empty');
    expect(mergeShotEdit(undefined, '改成夜景').mode).toBe('noteOnly');
  });
});

describe('v12.337 · 冲突只报不判(不替用户悄悄选)', () => {
  it('时间冲突:原描述写着暖橘晚霞,note 要夜景', () => {
    expect(mergeShotEdit(ORIG, '改成夜景').conflicts).toContain('时间');
  });

  it('色调冲突:原有色温,note 要冷色', () => {
    expect(mergeShotEdit(ORIG, '色调改冷一点').conflicts).toContain('色调');
  });

  it('景别冲突:原是大远景,note 要特写', () => {
    expect(mergeShotEdit(ORIG, '改成特写').conflicts).toContain('景别');
  });

  it('note 只加细节、不碰同名属性 → 不报冲突(免得警告变噪音)', () => {
    expect(mergeShotEdit(ORIG, '让她把勺子放下').conflicts).toEqual([]);
  });

  it('原描述没提到该属性 → 不算冲突(是补充不是覆盖)', () => {
    expect(mergeShotEdit('两人对坐。', '改成雨天').conflicts).toEqual([]);
  });

  it('冲突会写进给用户看的说明里', () => {
    const d = describeMerge(mergeShotEdit(ORIG, '改成夜景'));
    expect(d).toContain('时间');
    expect(d).toMatch(/以你的说法为准/);
  });
});

describe('v12.337 · 接线:端点与界面都真的接上了', () => {
  const ROUTE = fs.readFileSync('app/api/projects/[id]/regenerate-shot/route.ts', 'utf-8');
  const PAGE = fs.readFileSync('app/dashboard/edit-chat/page.tsx', 'utf-8');

  it('端点收 editNote,并在服务端合并(不让前端自己拼 description)', () => {
    expect(ROUTE).toMatch(/editNote/);
    expect(ROUTE).toContain('mergeShotEdit');
    expect(ROUTE, '原描述要从库里读,不能只信前端传的').toContain('getStoryboardDescription');
  });

  it('**老调用方零回归**:没传 editNote 时仍按 description 走', () => {
    const i = ROUTE.indexOf('let baseDescription = description');
    expect(i, '找不到合并分支').toBeGreaterThan(0);
    expect(ROUTE.slice(i, i + 260)).toMatch(/if \(typeof editNote === 'string' && editNote\.trim\(\)\)/);
  });

  it('界面把 note 作为 editNote 送出 —— 不是当 description 送', () => {
    expect(PAGE).toMatch(/editNote:\s*rs\.note/);
    const call = PAGE.slice(PAGE.indexOf('regenerate-shot'), PAGE.indexOf('regenerate-shot') + 320);
    expect(call, '把 note 当 description 传会抹掉原镜内容').not.toMatch(/description:\s*rs\.note/);
  });

  it('单镜重生保留两步确认(每镜都是真金白银)', () => {
    expect(PAGE).toContain('shotArmed');
    expect(PAGE).toMatch(/要花钱/);
  });

  it('逐镜**串行**,不并行烧预算', () => {
    const fn = PAGE.slice(PAGE.indexOf('const executeShots'), PAGE.indexOf('const executeShots') + 900);
    expect(fn).toMatch(/for \(const rs of plan\.regenShots\)/);
    expect(fn, '并行会同时烧 N 份预算').not.toMatch(/Promise\.all/);
  });

  it('一镜失败不静默跳过,如实记进日志', () => {
    expect(PAGE).toMatch(/status: 'fail'/);
  });

  it('界面不再只是「指路」 —— 那句话必须消失', () => {
    expect(PAGE, 'v12.337 之前这里让用户自己去项目页手动重生').not.toMatch(/请自行|自己去项目页/);
  });
});

describe('v12.339 修:上游报错不许被当成成功(v12.337 埋的静默失败)', () => {
  const PAGE = fs.readFileSync('app/dashboard/edit-chat/page.tsx', 'utf-8');

  it('**解析失败与上游错误分开处理** —— 同一个 catch 吞两者会把失败报成成功', () => {
    // 病灶:`if (ev.type==='error') throw ...` 写在 try 里,被「忽略非 JSON 行」的 catch 吞掉,
    // 循环照常走完 → 这一镜被标成 status:'ok'「已重生 ✓」。
    expect(PAGE, 'catch 只该吞解析失败').toMatch(/try \{ ev = JSON\.parse\(.+\); \} catch \{ continue; \}/);
    expect(PAGE, '上游错误要存下来而不是就地 throw 进 catch').toContain('upstreamErr =');
  });

  it('上游报错必须真的抛出去,不能落进 ok 分支', () => {
    // 断言窗口要按**语义**界定:顶部 shotLog 的类型声明里也有 status: 'ok',
    // 直接 indexOf 会量到那一处(这正是第一版写错的地方)。
    const iThrow = PAGE.indexOf('if (upstreamErr) throw upstreamErr');
    const iOk = PAGE.indexOf("{ ...x, status: 'ok'");
    expect(iThrow, '缺少抛出').toBeGreaterThan(0);
    expect(iOk, '找不到标记成功的赋值点').toBeGreaterThan(0);
    expect(iThrow, '必须在标记 ok 之前').toBeLessThan(iOk);
  });

  it('收到 error 事件后立刻跳出,不再继续读流', () => {
    expect(PAGE).toMatch(/upstreamErr = new Error[\s\S]{0,60}break;/);
  });
});
