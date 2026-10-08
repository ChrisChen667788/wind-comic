/**
 * v12.462 · 导演台补全 —— 纯函数与弹窗真渲染。
 *
 * 用户问「2D/3D 导演台是不是都完成、真能用」。五个切面的代码审计(27 个 agent,每个缺口两票核实)
 * 加真浏览器走查,确认了这些「看起来做完了、用起来不对」的地方:
 *   ① 人物不能加、删、改名;重开存过的舞台后,剧本后来加进这一镜的角色就此消失;
 *   ② 焦距按钮包在 <label> 里 —— 点「焦距」二字或视角读数会触发 18mm,焦距被悄悄改掉;
 *   ③ 重开导演台,刚渲的草图不见了(库里明明有);
 *   ④ 遮挡判定不看遮挡者在不在画里:画外好几度远的人也被写成「partially occluded by X」;
 *   ⑤ 保存时焦距 / 机高不校验:`lens:"notALens"` 照存,几何层静默按 35mm 算;
 *   ⑥ 分镜卡「已摆位」只认本次会话保存过的镜,刷新就没了。
 * 接口与库那一半(站位变了标待重渲、导演台草图跟着重渲、分镜图重生带站位)在 v12-462-stage-route-db。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  validateStagePayload, projectScene, stageDirectiveForShot, describeStaging, stagedShotsFromAssets, STAGE_MAX_ACTORS,
  POSE_PRESETS, type StageScene,
} from '@/lib/stage-blocking';
import {
  DirectorStageModal, missingCastNames, nextActorId, nextActorName,
} from '@/components/project/director-stage-modal';

const isPose = (v: unknown) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(POSE_PRESETS, v);
const CAM = { x: 0, z: 0, yawDeg: 0, lens: '35' as const, heightM: 1.6 };
const A = (id: string, name: string, x = 0, z = 5) => ({ id, name, x, z });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('v12.462 · 保存校验(validateStagePayload)', () => {
  const ok = (over: Record<string, unknown> = {}) => validateStagePayload({ camera: CAM, actors: [A('a', '林晚')], ...over }, isPose);

  it('正常数据原样通过(正常侧)', () => {
    const r = ok();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scene).toEqual({ camera: CAM, actors: [A('a', '林晚')] });
  });

  it('**焦距不在档位里 → 400 并说出可选档位**(修前照存,几何层静默按 35mm 算)', () => {
    const r = ok({ camera: { ...CAM, lens: 'notALens' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/焦距不在档位里.*18/);
    expect(ok({ camera: { ...CAM, lens: 'anamorphic' } }).ok, '几何层认的档位都放行').toBe(true);
  });

  it('机位高度:非数字或越出 0.2–4 米 → 400;null 视同清除', () => {
    for (const h of ['tall', 9, 0.1, Number.NaN]) expect(ok({ camera: { ...CAM, heightM: h } }).ok, String(h)).toBe(false);
    const r = ok({ camera: { ...CAM, heightM: null } });
    expect(r.ok).toBe(true);
    if (r.ok) expect('heightM' in r.scene.camera).toBe(false);
  });

  it('人物 id 缺失或重复 → 400(重复 id 会让拖动、姿态都改到同一个人身上)', () => {
    expect(ok({ actors: [{ name: 'x', x: 0, z: 5 }] }).ok).toBe(false);
    const r = ok({ actors: [A('a', '甲'), A('a', '乙', 1)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('重复');
  });

  it(`人物超过 ${STAGE_MAX_ACTORS} 个 → 400`, () => {
    const many = Array.from({ length: STAGE_MAX_ACTORS + 1 }, (_, i) => A(`a${i}`, `人${i}`, i - 3));
    expect(ok({ actors: many }).ok).toBe(false);
    expect(ok({ actors: many.slice(0, STAGE_MAX_ACTORS) }).ok).toBe(true);
  });

  it('名字:去掉控制字符与首尾空白;空名视同未设;超长 → 400;非文字 → 400', () => {
    const r = ok({ actors: [{ ...A('a', ''), name: '  林\n晚 ' }, { ...A('b', '', 1), name: '   ' }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scene.actors[0].name, '换行会把提示词那句话截断').toBe('林晚');
      expect('name' in r.scene.actors[1]).toBe(false);
    }
    expect(ok({ actors: [{ ...A('a', ''), name: '长'.repeat(25) }] }).ok).toBe(false);
    expect(ok({ actors: [{ ...A('a', ''), name: 42 }] }).ok).toBe(false);
  });

  it('不改调用方传进来的对象(路由还要拿原 body 判 dryRun)', () => {
    const body = { camera: { ...CAM, heightM: null }, actors: [{ ...A('a', '林晚'), facingDeg: null }] };
    validateStagePayload(body, isPose);
    expect(body.camera.heightM).toBeNull();
    expect(body.actors[0].facingDeg).toBeNull();
  });
});

describe('v12.462 · 遮挡者身体得伸进画框才算', () => {
  // 机位原点朝 +z,35mm、16:9 → 水平半角约 27.2°。用方位角 + 距离摆人,一眼看得出谁在画框哪边
  const at = (relDeg: number, dist: number) => ({ x: dist * Math.sin((relDeg * Math.PI) / 180), z: dist * Math.cos((relDeg * Math.PI) / 180) });
  const scene = (b: { x: number; z: number }): StageScene => {
    const a = at(26, 10);   // A:画内靠右边缘,10 米
    return { aspect: '16:9', camera: CAM, actors: [A('a', '林晚', a.x, a.z), A('b', '陆沉', b.x, b.z)] };
  };
  const pa = (s: StageScene) => projectScene(s).find((p) => p.id === 'a')!;
  const pb = (s: StageScene) => projectScene(s).find((p) => p.id === 'b')!;

  it('窗口自证:A 在画内', () => {
    expect(pa(scene(at(0, 3))).inFrame).toBe(true);
  });

  it('**画外、身体够不着画框的人不算遮挡者**(修前方位差 < 4° 且更近就算,会被写进提示词)', () => {
    const s = scene(at(29.5, 7));   // 与 A 差 3.5°、更近;中心出画约 2.3°,7 米处身体半宽只占约 1.8°
    expect(pb(s).inFrame, '前提:B 中心在画外').toBe(false);
    expect(pa(s).occludedBy).toEqual([]);
    expect(stageDirectiveForShot(s)).not.toContain('陆沉');
  });

  it('**离机位很近、中心出画但肩膀伸进画面的人仍算**(过肩前景 —— 删掉它才是错的)', () => {
    const s = scene(at(29.5, 1.5));   // 同一方位,1.5 米:身体半宽约占 8°,肯定伸进画框
    expect(pb(s).inFrame, '前提:B 中心在画外').toBe(false);
    expect(pa(s).occludedBy).toEqual(['陆沉']);
    expect(stageDirectiveForShot(s)).toContain('partially occluded by 陆沉');
  });

  it('画内的遮挡者照旧(正常侧)', () => {
    expect(pa(scene(at(25, 5))).occludedBy).toEqual(['陆沉']);
  });
});

describe('v12.462 · 机位角进提示词(修前只进了界面上的中文描述)', () => {
  const scene = (heightM: number): StageScene => ({ aspect: '16:9', camera: { ...CAM, heightM }, actors: [A('a', '林晚', 0, 5)] });

  it('平视(默认 1.6 米)不写 —— 旧舞台的提示词逐字不变', () => {
    expect(stageDirectiveForShot(scene(1.6))).toBe('. Staging: 林晚 at frame center in full shot');
  });

  it('机高不同、镜头水平:照实说「高 / 低机位平视」,不说俯拍仰拍(v12.465 改)', () => {
    // v12.462 只按机高判,抬高 1 米就写 high-angle looking down —— 而 3D 预览与草图里画面是平的
    expect(stageDirectiveForShot(scene(2.6))).toBe('. Staging: camera raised above eye level, lens kept level; 林晚 at frame center in full shot');
    expect(stageDirectiveForShot(scene(0.6))).toContain('camera below eye level, lens kept level; ');
    expect(stageDirectiveForShot(scene(2.6))).not.toContain('looking down');
  });

  it('**俯拍 / 仰拍 / 顶视由俯仰决定**,中文描述同一判据并带出角度', () => {
    const tilt = (heightM: number, pitchDeg: number, z = 5): StageScene => ({ aspect: '16:9', camera: { ...CAM, heightM, pitchDeg }, actors: [A('a', '林晚', 0, z)] });
    expect(stageDirectiveForShot(tilt(2.6, -12))).toBe('. Staging: high-angle camera looking down; 林晚 at frame center in full shot');
    expect(describeStaging(tilt(2.6, -12)).startsWith('高角度俯拍机位(下压 12°),')).toBe(true);
    expect(stageDirectiveForShot(tilt(0.6, 15))).toContain('low-angle camera looking up; ');
    expect(describeStaging(tilt(0.6, 15)).startsWith('低角度仰拍机位(上抬 15°),')).toBe(true);
    expect(stageDirectiveForShot(tilt(4, -70, 1.5))).toContain('overhead top-down camera; ');
    // 几度的微调不改说法
    expect(stageDirectiveForShot(tilt(1.6, -5))).toBe('. Staging: 林晚 at frame center in full shot');
  });

  it('「. Staging:」标记不变 —— withStageDirective 靠它判断已带过站位句,不重复追加', () => {
    expect(stageDirectiveForShot(scene(2.6)).startsWith('. Staging: ')).toBe(true);
  });
});

describe('v12.462 · 竖直方向出画也算出画(舞台相机没有俯仰)', () => {
  // 真浏览器走查撞到的那一镜:9:16、85mm、机高 3.2 米、平视 —— 人整个在画框下方之外,
  // 3D 机位视角只看得见地面、布局草图一片空白,修前体检却说「在画内」,提示词照样写他站在画面右边
  const high: StageScene = {
    aspect: '9:16', camera: { x: 0, z: 0, yawDeg: 10, lens: '85', heightM: 3.2 },
    actors: [A('a', '林晚', 1, 5), A('b', '陆沉', 1.7, 6.22)],
  };

  it('窗口自证:水平方向两人都在画框内,但头顶已低于画框下沿', () => {
    for (const p of projectScene(high)) {
      expect(Math.abs(p.screenX)).toBeLessThanOrEqual(1);
      expect(p.screenTop).toBeLessThan(-1);
    }
  });

  it('**判为出画,体检说清是「在画面下方之外」并给出对应办法,提示词不再描述他们**', async () => {
    const { auditStaging } = await import('@/lib/stage-blocking');
    expect(projectScene(high).every((p) => !p.inFrame)).toBe(true);
    const msgs = auditStaging(high).map((i) => i.message).join('\n');
    expect(msgs).toContain('林晚 整个在画面下方之外');
    expect(msgs).toContain('降低机高');
    expect(stageDirectiveForShot(high)).toBe('');
  });

  it('把机位降回平视:回到画内(正常侧)', () => {
    const level = { ...high, camera: { ...high.camera, heightM: 1.6 } };
    expect(projectScene(level).every((p) => p.inFrame)).toBe(true);
  });

  it('离镜头很近、头顶在画内脚在画外的人仍算在画内(只要竖直方向有重叠)', () => {
    const close: StageScene = { aspect: '16:9', camera: CAM, actors: [A('a', '林晚', 0, 1)] };
    const p = projectScene(close)[0];
    expect(p.screenBottom).toBeLessThan(-1);
    expect(p.inFrame).toBe(true);
  });
});

describe('v12.462 · 小工具', () => {
  it('stagedShotsFromAssets:只认 stage-scene 且镜号是数字', () => {
    expect(stagedShotsFromAssets([
      { type: 'stage-scene', shotNumber: 3 }, { type: 'stage-scene', shotNumber: null },
      { type: 'storyboard', shotNumber: 1 }, { type: 'stage-scene', shotNumber: 7 },
    ])).toEqual({ 3: true, 7: true });
    expect(stagedShotsFromAssets(undefined)).toEqual({});
  });

  it('nextActorId 取最小的空位(删了再加不撞旧 id);nextActorName 跳过已占用的', () => {
    expect(nextActorId([A('a0', ''), A('a2', '')])).toBe('a1');
    expect(nextActorName([A('a0', '角色 A'), A('a1', '角色 C')])).toBe('角色 B');
  });

  it('missingCastNames:按剧本顺序、去重、去空白,已在台上的不算', () => {
    expect(missingCastNames([' 林晚', '陆沉', '老周', '陆沉', ''], [A('a', '林晚')])).toEqual(['陆沉', '老周']);
    expect(missingCastNames(undefined, [A('a', '林晚')])).toEqual([]);
  });
});

describe('v12.462 · 弹窗真渲染', () => {
  // 每次点击都重渲整个弹窗(俯视图 + 预览 + 体检);机器忙时单条可达十几秒,别让超时冒充失败
  vi.setConfig({ testTimeout: 30_000 });
  const open = (props: Partial<Parameters<typeof DirectorStageModal>[0]> = {}) => render(
    <DirectorStageModal projectId="p1" shotNumber={1} onClose={() => {}} aspect="16:9"
      initialScene={{ camera: CAM, actors: [A('a0', '林晚', -0.7)] }} {...props} />,
  );
  const directive = () => document.querySelector('details code')?.textContent ?? '';

  it('**弹窗的无障碍名称是它的标题**(修前所有弹窗一律叫「对话框」,读屏分不清是哪个)', () => {
    open({ shotTitle: '雨夜' });
    expect(screen.getByRole('dialog', { name: '导演台 · 第 1 镜 — 雨夜' })).toBeTruthy();
  });

  it('弹窗外层可滚动(弹窗比屏幕高时上下两头不再被裁掉);点弹窗外的空白处仍会关闭,点里面不会', () => {
    const onClose = vi.fn();
    open({ onClose });
    const dlg = screen.getByRole('dialog');
    const scroller = dlg.parentElement!.parentElement!;
    expect(scroller.className, '修前是 fixed + 居中、不能滚').toContain('overflow-y-auto');
    fireEvent.click(dlg);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dlg.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('**重开存过的舞台:剧本里这镜还有、台上没有的角色给出一键加入**', () => {
    open({ characterNames: ['林晚', '陆沉'] });
    expect(screen.getByText('剧本里这镜还有:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ 陆沉' }));
    expect(document.querySelectorAll('[data-pose-row]')).toHaveLength(2);
    expect(directive()).toContain('陆沉');
    expect(screen.queryByText('剧本里这镜还有:'), '加完提示就消失').toBeNull();
  });

  it('添加人物(默认名不撞)→ 移除;只剩一个人时不能再删', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /添加人物/ }));
    const rows = document.querySelectorAll('[data-pose-row]');
    expect(rows).toHaveLength(2);
    expect((screen.getByLabelText('角色 A 的名字') as HTMLInputElement).value).toBe('角色 A');
    fireEvent.click(screen.getByRole('button', { name: '移除 林晚' }));
    expect(document.querySelectorAll('[data-pose-row]')).toHaveLength(1);
    expect((screen.getByRole('button', { name: '移除 角色 A' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it(`加到 ${STAGE_MAX_ACTORS} 个人就不能再加`, () => {
    open();
    for (let i = 0; i < STAGE_MAX_ACTORS + 2; i++) fireEvent.click(screen.getByRole('button', { name: /添加人物/ }));
    expect(document.querySelectorAll('[data-pose-row]')).toHaveLength(STAGE_MAX_ACTORS);
    expect((screen.getByRole('button', { name: /添加人物/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('改名 → 俯视图、提示词跟着变', () => {
    open();
    fireEvent.change(screen.getByLabelText('林晚 的名字'), { target: { value: '苏晚' } });
    expect(directive()).toContain('苏晚');
    expect(directive()).not.toContain('林晚');
    expect([...document.querySelectorAll('svg text')].some((t) => t.textContent === '苏晚')).toBe(true);
  });

  it('**点「焦距」二字不再把焦距改成 18mm**(修前包在 label 里,label 激活第一个按钮)', () => {
    open();
    const pressed = () => document.querySelector('[role="group"][aria-label="焦距"] button[aria-pressed="true"]')?.textContent;
    expect(pressed()).toBe('35mm');
    fireEvent.click(screen.getByText('焦距'));
    fireEvent.click(screen.getByText(/° 视角$/));
    expect(pressed()).toBe('35mm');
    fireEvent.click(screen.getByRole('button', { name: '85mm' }));
    expect(pressed()).toBe('85mm');
  });

  it('**重开时显示这镜已有的草图,并说清它从哪来**', () => {
    open({ initialSketch: { url: '/api/serve-file?key=abc', mode: 'generate' } });
    const fig = document.querySelector('figure[data-sketch-mode]')!;
    expect(fig.getAttribute('data-sketch-mode')).toBe('generate');
    expect(fig.querySelector('img')!.getAttribute('src')).toBe('/api/serve-file?key=abc');
    expect(fig.textContent).toContain('AI 画的');
  });

  it('保存:站位变了 → 说清已出的画面标了待重渲、导演台草图已跟着重渲,并换成新草图', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ saved: true, changed: true, staleMarked: 2, sketchRerendered: true, sketch: { url: '/api/serve-file?key=new', mode: 'stage' } }),
    })));
    open({ initialSketch: { url: '/api/serve-file?key=old', mode: 'stage' } });
    fireEvent.click(screen.getByRole('button', { name: /保存站位/ }));
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeTruthy());
    const t = screen.getByText(/已保存/).textContent!;
    expect(t).toContain('已标记为待重渲');
    expect(t).toContain('布局草图已按新站位重渲');
    expect(document.querySelector('figure img')!.getAttribute('src')).toBe('/api/serve-file?key=new');
  });

  it('保存:草图是 AI 画的而站位变了 → 提醒核对(导演台不替换用户自己的草图)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ saved: true, changed: true, staleMarked: 0, sketchRerendered: false, sketch: { url: '/x', mode: 'generate' } }),
    })));
    open();
    fireEvent.click(screen.getByRole('button', { name: /保存站位/ }));
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeTruthy());
    expect(screen.getByText(/已保存/).textContent).toContain('不是导演台渲的');
  });

  it('保存:站位没变 → 只说已保存,不报虚惊', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ saved: true, changed: false, staleMarked: 0, sketchRerendered: false, sketch: null }),
    })));
    open();
    fireEvent.click(screen.getByRole('button', { name: /保存站位/ }));
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeTruthy());
    expect(screen.getByText(/已保存/).textContent).toBe('已保存 —— 该镜后续出片会带上这份站位');
  });

  it('渲布局草图也存了站位 → 回调父组件(分镜卡「已摆位」要跟着亮)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => ({
      ok: true, status: 200,
      json: async () => (String(u).includes('shot-sketch') ? { sketchUrl: '/api/serve-file?key=s' } : { saved: true, changed: true, sketch: null }),
    })));
    const onSaved = vi.fn();
    open({ onSaved });
    fireEvent.click(screen.getByRole('button', { name: /渲布局草图/ }));
    await waitFor(() => expect(document.querySelector('figure[data-sketch-mode="stage"]')).toBeTruthy());
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
