/**
 * v12.466 · 格式条的「安全框」真的开关项目页的安全区叠层了 —— 修前它存进库,没有任何代码读。
 *
 * 修前两个开关各管各的:
 *   - 格式条「安全框 ON/OFF」(v7.4):存进 project-format 资产的 `safeArea`,全仓没有读者;默认还是 ON;
 *   - 视频页「字幕安全区」按钮(v10.6.0):页面里的临时状态,叠层只认它 —— 而分镜页也按它显示叠层,
 *     分镜页上却看不到这个按钮。
 * 用户选 A:格式条的安全框驱动叠层。现在两个开关改的是同一个值:没点过就按保存的格式(默认关),
 * 在格式条「保存格式」后记住。叠层只画了 9:16,其它画幅格式条上禁用并说明。
 *
 * 锁什么:
 *   1. 格式条受控:显示页面给的值、点了通知页面、保存写的是页面那个值;
 *   2. 非 9:16:开关禁用、写明「仅竖屏」,点了没反应,保存不改动库里原值;
 *   3. 色彩下拉的第一项是「不指定」,没保存过格式时选中它;悬停说明写清进的是哪里;
 *   4. 项目页接线(按 TypeScript AST):每个安全区叠层都按同一个 `showSafeArea` 显示,它来自「这次点过的值 ?? 保存的格式」,
 *      格式条与视频页按钮改的是同一个 setter;
 *   5. 格式资产的两个写入方(格式条、参数联动)保存后都更新页面里那份,另一方不会拿加载时的旧格式整份写回;
 *   6. 对外文档不再说色彩空间与安全框「只记录、不进生成」。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.unstubAllGlobals();
});

type BarProps = { aspect: string; initialFormat?: object; safeArea?: boolean; onSafeAreaChange?: (on: boolean) => void };
async function renderBar(props: BarProps) {
  const { render } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { ProjectFormatBar } = await import('@/components/project/project-format-bar');
  const el = (p: BarProps) => React.createElement(ProjectFormatBar, { projectId: 'p1', ...p });
  const r = render(el(props));
  const safeBtn = () => [...r.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('安全框'))!;
  const saveBtn = () => [...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes('保存格式'))!;
  const colorLabel = () => [...r.container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('色彩'))!;
  return { ...r, safeBtn, saveBtn, colorLabel, rerenderWith: (p: BarProps) => r.rerender(el(p)) };
}
function stubSave() {
  const bodies: Array<{ format: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  }));
  return bodies;
}

describe('v12.466 · 格式条的安全框受页面控制', () => {
  it('**显示页面给的值;点击通知页面而不是只改自己**', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const onChange = vi.fn();
    const bar = await renderBar({ aspect: '9:16', initialFormat: { safeArea: false }, safeArea: true, onSafeAreaChange: onChange });
    expect(bar.safeBtn().textContent).toContain('ON');   // 跟页面,不跟 initialFormat
    fireEvent.click(bar.safeBtn());
    expect(onChange).toHaveBeenCalledWith(false);
    bar.rerenderWith({ aspect: '9:16', initialFormat: { safeArea: false }, safeArea: false, onSafeAreaChange: onChange });
    expect(bar.safeBtn().textContent).toContain('OFF');
    expect(bar.safeBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('**保存写的是页面那个值**(视频页按钮改过的也算)', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const bodies = stubSave();
    const bar = await renderBar({ aspect: '9:16', initialFormat: { colorSpaceId: 'p3', fps: 30, safeArea: false }, safeArea: true, onSafeAreaChange: () => {} });
    fireEvent.click(bar.saveBtn());
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].format).toEqual({ colorSpaceId: 'p3', fps: 30, safeArea: true });
  });

  it('**非 9:16 项目:禁用、写明仅竖屏,点了没反应;保存不改库里原值**', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const bodies = stubSave();
    const onChange = vi.fn();
    const bar = await renderBar({ aspect: '16:9', initialFormat: { safeArea: true }, safeArea: true, onSafeAreaChange: onChange });
    expect(bar.safeBtn().disabled).toBe(true);
    expect(bar.safeBtn().textContent).toContain('仅竖屏');
    expect(bar.safeBtn().title).toContain('9:16');
    fireEvent.click(bar.safeBtn());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(bar.saveBtn());
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].format.safeArea).toBe(true);
  });

  it('9:16 项目:开关可用(正常侧)', async () => {
    const bar = await renderBar({ aspect: '9:16', safeArea: false, onSafeAreaChange: () => {} });
    expect(bar.safeBtn().disabled).toBe(false);
    expect(bar.safeBtn().textContent).toContain('OFF');
  });
});

describe('v12.466 · 色彩下拉', () => {
  it('**没保存过格式:选中的是「不指定」**(修前默认 ACES —— 色彩接进出图后,默认值会悄悄改掉出图)', async () => {
    const bar = await renderBar({ aspect: '9:16' });
    const select = bar.colorLabel().querySelector('select')!;
    expect(select.value).toBe('none');
    expect(select.options[0].value).toBe('none');
    expect(select.options[0].textContent).toBe('不指定');
  });

  it('悬停说明写清进的是哪里、已出的图不变', async () => {
    const bar = await renderBar({ aspect: '9:16' });
    const title = bar.colorLabel().title;
    expect(title).toContain('分镜图提示词');
    expect(title).toContain('已出的图不会变');
  });

  it('旧资产存的 ACES 原样显示(那是用户看着 ACES 点的保存)', async () => {
    const bar = await renderBar({ aspect: '9:16', initialFormat: { colorSpaceId: 'aces', fps: 24, safeArea: true } });
    expect(bar.colorLabel().querySelector('select')!.value).toBe('aces');
  });
});

describe('v12.466 · 项目页接线(按 AST)', () => {
  const file = 'app/projects/[id]/page.tsx';
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const all: ts.Node[] = [];
  const walk = (n: ts.Node) => { all.push(n); ts.forEachChild(n, walk); };
  walk(sf);
  const jsx = (tag: string) => all.filter((n): n is ts.JsxSelfClosingElement | ts.JsxOpeningElement =>
    (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === tag);
  const attr = (el: ts.JsxSelfClosingElement | ts.JsxOpeningElement, name: string) => {
    const a = el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
    return a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression?.getText(sf) : undefined;
  };

  it('**每个安全区叠层都按 showSafeArea 显示**(修前分镜页也按一个只在视频页能点的开关显示)', () => {
    const overlays = jsx('SafeAreaOverlay');
    expect(overlays.length, '扫描器自证:分镜卡与视频卡两处叠层都扫到了').toBeGreaterThanOrEqual(2);
    for (const o of overlays) {
      // 往上找到包住它的条件(`a && <X/>` 或 `a ? <X/> : b`),条件里必须有 showSafeArea
      let p: ts.Node | undefined = o.parent;
      let cond = '';
      while (p && p !== sf) {
        if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { cond = p.left.getText(sf); break; }
        if (ts.isConditionalExpression(p)) { cond = p.condition.getText(sf); break; }
        p = p.parent;
      }
      expect(cond.split(/[^\w$]+/), `第 ${sf.getLineAndCharacterOfPosition(o.getStart(sf)).line + 1} 行的叠层`).toContain('showSafeArea');
    }
  });

  it('**showSafeArea = 这次点过的值 ?? 保存的格式**', () => {
    const decl = all.find((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(sf) === 'showSafeArea');
    expect(decl, 'showSafeArea 是一个派生值,不是第二份 state').toBeTruthy();
    const init = decl!.initializer!;
    expect(ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken).toBe(true);
    const bin = init as ts.BinaryExpression;
    expect(bin.left.getText(sf)).toBe('safeAreaPref');
    // 右边:normalizeProjectFormat(<保存的格式>).safeArea
    expect(ts.isPropertyAccessExpression(bin.right) && bin.right.name.text === 'safeArea').toBe(true);
    const call = (bin.right as ts.PropertyAccessExpression).expression;
    expect(ts.isCallExpression(call) && call.expression.getText(sf) === 'normalizeProjectFormat').toBe(true);
    // 保存的格式就是递给格式条的那一份
    const bar = jsx('ProjectFormatBar');
    expect(bar.length).toBe(1);
    expect((call as ts.CallExpression).arguments[0].getText(sf)).toBe(attr(bar[0], 'initialFormat'));
  });

  it('**格式条与视频页按钮改的是同一个值**', () => {
    const [bar] = jsx('ProjectFormatBar');
    expect(attr(bar, 'safeArea')).toBe('showSafeArea');
    expect(attr(bar, 'onSafeAreaChange')).toBe('setSafeAreaPref');
    // 视频页「字幕安全区」按钮
    const buttons = all.filter((n): n is ts.JsxElement => ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'button'
      && n.children.some((c) => c.getText(sf).includes('字幕安全区')));
    expect(buttons.length).toBe(1);
    expect(attr(buttons[0].openingElement, 'onClick')).toMatch(/^\(\) => setSafeAreaPref\(!showSafeArea\)$/);
    // 没有第二份叠层开关
    const ids = all.filter(ts.isIdentifier).map((n) => n.text);
    expect(ids).not.toContain('setShowSafeArea');
  });
});

describe('v12.466 · 格式条与参数联动不互相冲掉', () => {
  const P3 = { colorSpaceId: 'p3', fps: 30, safeArea: true };

  it('**格式条存了 P3 → 之后打开的参数联动面板,初始文档里就是 P3**(修前是加载时的「不指定」,一同步就写回去)', async () => {
    const { withFormatAsset } = await import('@/lib/project-format');
    const { buildParamDoc } = await import('@/lib/param-linkage');
    const loaded = [{ id: 's1', type: 'storyboard', data: {} }];            // 加载时还没有格式资产
    const after = withFormatAsset(loaded, P3);                                // 格式条保存后
    const formatForPanel = after.find((a) => a.type === 'project-format')?.data;   // 页面递给面板的就是这一份
    expect(buildParamDoc({ shots: [], format: formatForPanel }).format).toEqual(P3);
  });

  it('已有格式资产:只换它的 data,其它资产原样;规范化后再放进去', async () => {
    const { withFormatAsset } = await import('@/lib/project-format');
    const sb = { id: 's1', type: 'storyboard', data: { x: 1 } };
    const out = withFormatAsset([sb, { id: 'f1', type: 'project-format', data: { colorSpaceId: 'aces' } }], { ...P3, colorSpaceId: 'NOPE' } as never);
    expect(out[0]).toBe(sb);
    expect(out[1]).toMatchObject({ id: 'f1', data: { colorSpaceId: 'none', fps: 30, safeArea: true } });
    expect(out.length).toBe(2);
  });

  it('**项目页:格式条 onSaved 与参数联动 onSynced 都走同一个更新;面板拿的是同一份格式**', () => {
    const file = 'app/projects/[id]/page.tsx';
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const els: Array<ts.JsxSelfClosingElement | ts.JsxOpeningElement> = [];
    let helperBody = '';
    const walk = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) els.push(n);
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'applySavedFormat') helperBody = n.initializer?.getText(sf) || '';
      ts.forEachChild(n, walk);
    };
    walk(sf);
    const attrOf = (tag: string, name: string) => {
      const el = els.find((e) => e.tagName.getText(sf) === tag)!;
      const a = el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
      return a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
    };
    expect(helperBody, 'applySavedFormat 用 withFormatAsset 换页面里的格式资产').toMatch(/withFormatAsset\(/);
    expect(attrOf('ProjectFormatBar', 'onSaved')?.getText(sf)).toBe('applySavedFormat');
    // onSynced 的函数体里调用 applySavedFormat(doc.format)
    const synced = attrOf('ParamLinkagePanel', 'onSynced');
    const calls: string[] = [];
    const findCalls = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n.getText(sf)); ts.forEachChild(n, findCalls); };
    if (synced) findCalls(synced);
    expect(calls).toContain('applySavedFormat(doc.format)');
    expect(attrOf('ParamLinkagePanel', 'format')?.getText(sf)).toBe('projectFormatData');
    expect(attrOf('ProjectFormatBar', 'initialFormat')?.getText(sf)).toBe('projectFormatData');
  });
});

describe('v12.466 · 对外文档不再说色彩空间与安全框「只记录」', () => {
  for (const file of ['README.md', 'README.zh-CN.md', 'docs/modelscope-intro.md', 'docs/SCREENSHOTS-v12.425.md']) {
    it(file, () => {
      const src = fs.readFileSync(file, 'utf-8');
      const i = src.indexOf('13-storyboard-specs.jpg');
      expect(i, '分镜规格那张截图的说明还在').toBeGreaterThan(0);
      const caption = src.slice(i, i + 1200);
      expect(caption).not.toContain('只记录');
      expect(caption).toContain('分镜图提示词');
      expect(caption).toContain('安全区');
    });
  }
});
