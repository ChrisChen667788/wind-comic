/**
 * lib/stage-blocking — 导演台的**空间模型与投影**(纯函数,零依赖)。v12.316。
 *
 * ── 为什么做这个 ──────────────────────────────────────────────────
 * 竞品对比里差距最大的一项。脸和场景的一致性已经能靠多图参考解决,
 * **唯独「谁站哪、机位在哪、谁挡住谁」没法用提示词说准** —— 用户的真实体验是
 * 「生成五遍,这个人站的位置还是不对」,提示词越写越长,模型理解得越来越偏。
 *
 * ── 为什么先做纯逻辑,而不是先写 3D 编辑器 ────────────────────────
 * 导演台的价值**不在于能拖 3D**,而在于把空间关系变成模型能准确理解的东西。
 * 那件事有两个产物,都不需要渲染器:
 *   ① **精确站位描述** —— 人手写不出来的那种(「A 在左三分线中景、B 在其右后方
 *      被部分遮挡、机位低角 35mm」),直接进提示词;
 *   ② **确定性的构图检查** —— 谁出画了、谁被挡住了、机位是否穿到人身上。
 * 这两样**引擎无关**,与 BYO key 架构天然契合:换引擎不作废。
 * 3D 交互界面是这层之上的皮,晚一版做不影响能力本身。
 *
 * ── 坐标约定 ──────────────────────────────────────────────────────
 * 右手系俯视图:x 向右,z 向前(远离摄影机为正),y 为高度(米)。
 * 角度一律「度」,0° 面向 +z,顺时针为正。
 * 镜头焦距按 35mm 全画幅等效,水平视角 FOV = 2·atan(36 / (2f))。
 */

import type { ShotSize, CameraAngle, LensId } from './cinematography';
import { poseHeightFactor } from './pose-skeleton';

export interface StageActor {
  id: string;
  name?: string;
  /** 俯视位置(米) */
  x: number;
  z: number;
  /** 身高(米);缺省 1.7 */
  heightM?: number;
  /**
   * 身体朝向(度);0 = 面向 +z,顺时针为正(与机位 yaw 同一约定)。
   * **缺省 = 未设**:不判正侧背、不进提示词 —— 旧舞台数据的描述逐字不变。
   * v12.440 起参与几何(`facingOf`);此前字段存在但从未被读。
   */
  facingDeg?: number;
  /**
   * 姿态预设(v12.441);缺省 = 未设,不进提示词。
   *
   * 刻意只给**一份固定词表**而不是自由文本输入:提示词全链路是英文(v12.6.1 定的口径),
   * 用户填中文动作会被视频模型当画面文字渲染出来(v2.22 那次 CJK 乱码就是这么来的)。
   * 词表里的每一项都对应一句写死的英文短语,顺带保证同一动作在每一镜的说法一致。
   */
  posePreset?: PosePresetId;
}

/** 姿态预设 id —— 短剧里最常用的一批身体动作(不含朝向,朝向是 `facingDeg`) */
export type PosePresetId =
  | 'standing' | 'sitting' | 'kneeling' | 'crouching' | 'lying'
  | 'walking' | 'running' | 'leaning'
  | 'arms-crossed' | 'hands-on-hips' | 'arm-raised' | 'pointing' | 'reaching'
  | 'covering-face' | 'head-down';

interface PosePreset { cn: string; en: string }

/**
 * 词表:中文给界面,英文进提示词。
 * 英文刻意只描述**身体**,不含情绪与镜头语言 —— 情绪走剧本的 emotion,镜头走 cinema 那套,
 * 三者在提示词里各占一段,混着写会互相打架(v12.9.1 在角色外观上栽过同一类)。
 */
export const POSE_PRESETS: Record<PosePresetId, PosePreset> = {
  standing: { cn: '站立', en: 'standing upright' },
  sitting: { cn: '坐着', en: 'seated' },
  kneeling: { cn: '跪地', en: 'kneeling on one knee' },
  crouching: { cn: '蹲下', en: 'crouching low' },
  lying: { cn: '躺倒', en: 'lying on the ground' },
  walking: { cn: '走动', en: 'mid-stride walking' },
  running: { cn: '奔跑', en: 'running at full stride' },
  leaning: { cn: '倚靠', en: 'leaning against a surface' },
  'arms-crossed': { cn: '抱臂', en: 'arms crossed over the chest' },
  'hands-on-hips': { cn: '叉腰', en: 'hands on hips' },
  'arm-raised': { cn: '举手', en: 'one arm raised overhead' },
  pointing: { cn: '指向', en: 'pointing with one arm extended' },
  reaching: { cn: '伸手', en: 'reaching out with one hand' },
  'covering-face': { cn: '掩面', en: 'hands covering the face' },
  'head-down': { cn: '低头', en: 'head lowered, shoulders slumped' },
};

/** 取姿态预设;未设或不认识的 id 一律当未设(旧数据 / 手改库 / 前端传错都不该把出片打挂) */
export function poseOf(actor: Pick<StageActor, 'posePreset'>): PosePreset | null {
  const id = actor.posePreset;
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(POSE_PRESETS, id) ? POSE_PRESETS[id] : null;
}

export interface StageCamera {
  x: number;
  z: number;
  /** 机位高度(米);缺省 1.6(平视) */
  heightM?: number;
  /** 水平朝向(度) */
  yawDeg: number;
  /**
   * 俯仰(度,v12.465);正 = 抬头,负 = 低头。**缺省 = 0(平视)**,旧舞台的几何与提示词逐字不变。
   * 修前舞台相机只能平视:「高机位」只是把相机抬高,提示词却写成俯拍,3D 预览与草图看到的是平视画面。
   * 旋转顺序与 three.js 的 YXZ 相同:先按 yawDeg 转朝向,再绕相机自身横轴转俯仰。
   */
  pitchDeg?: number;
  /** 焦距档位;复用既有 LensId 词表 */
  lens?: LensId;
}

export interface StageScene {
  actors: StageActor[];
  camera: StageCamera;
  /**
   * 项目画幅(v12.439),如 '9:16' / '16:9' / '1:1' / '2.35:1'。
   *
   * 修前整个空间模型**完全不看画幅**,永远按 36×24(3:2 横幅)算视角。库里 84% 的项目是 9:16,
   * 35mm 下真实水平视角约 32°,模型却按 54° 算 —— 把画面宽度高估约 68%:构图体检漏报出画的人,
   * 提示词把已裁出画外的人说成「在右三分线」。
   *
   * **不存进舞台数据**:画幅以 projects.aspect 为准,由 stage-scene-store 在读取时注入,
   * 项目改了画幅,几何自动跟着变。缺省按 3:2,与修前完全一致(向后兼容)。
   */
  aspect?: string;
}

export interface ProjectedActor {
  id: string;
  name?: string;
  /** 是否在画面内 */
  inFrame: boolean;
  /** 归一化横向位置:-1 = 左边缘,0 = 画面中心,+1 = 右边缘 */
  screenX: number;
  /** 与摄影机的水平距离(米) */
  distanceM: number;
  /** 该距离/焦距下这个人实际是什么景别 —— 复用既有 ShotSize 词表 */
  shotSize: ShotSize;
  /** 被谁遮挡(同向且更近的人);无则空数组 */
  occludedBy: string[];
  /** 三分法位置描述(给提示词用) */
  thirds: 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'off-frame';
  /**
   * 纵向投影(v12.317):归一化,+1 = 画面顶,-1 = 画面底。
   * `screenTop` 是头顶,`screenBottom` 是脚底。
   *
   * 放在这里而不是让草图层自己算 —— 草图要画得对就必须**与提示词描述同一套几何**,
   * 两边各算一套就是「同一语义两套口径」(本仓已栽过五次)。
   */
  screenTop: number;
  screenBottom: number;
  /** 朝向在镜头里的样子(v12.440);人物没设 `facingDeg` 时不存在该字段 */
  facing?: FacingInFrame;
  /** 姿态预设(v12.443);未设或词表外时不存在该字段 —— 草图据此决定画骨架还是退回矩形 */
  posePreset?: PosePresetId;
}

/** 镜头看到的身体朝向:正面 → 3/4 侧 → 侧面 → 3/4 背 → 背面 */
export type FacingView = 'front' | 'three-quarter' | 'profile' | 'three-quarter-back' | 'back';

export interface FacingInFrame {
  view: FacingView;
  /**
   * 身体朝画面哪一侧转;正面/背面时不存在。
   * 按朝向在「机位→人」视线右法向上的分量判,不是按人物自己的左右手 —— 提示词要的是画面方向。
   */
  screenSide?: 'left' | 'right';
  /** 朝向正对着的另一个人(±25° 内取角度偏差最小的,再比距离);没有则不存在 */
  towardId?: string;
  towardName?: string;
  /** 人物朝向与「人→机位」方向的夹角,0 = 正对镜头,180 = 背对 */
  offCameraDeg: number;
}

const LENS_MM: Record<string, number> = {
  '18': 18, '24': 24, '35': 35, '50': 50, '85': 85, '100': 100, anamorphic: 40,
};

/**
 * 舞台存储类型(v12.462 从 stage-scene-store 挪来):项目页要用它从资产里认出「这一镜摆过位」,
 * 而 stage-scene-store 会连带引入数据库驱动 —— 客户端一引就整页 500(v12.318 栽过)。纯常量放纯几何层。
 */
export const STAGE_SCENE_TYPE = 'stage-scene';
/** 一镜最多几个人物:与弹窗从剧本建人时的上限一致 */
export const STAGE_MAX_ACTORS = 6;
/** 人物名字最长多少字(名字会原样进英文提示词,太长的只会把句子撑乱) */
export const STAGE_NAME_MAX = 24;
/** 机位高度的有效范围(米),与俯视图机高滑杆一致 */
export const STAGE_CAM_HEIGHT_RANGE: [number, number] = [0.2, 4];

/**
 * 资产里哪些镜摆过位(v12.462)。项目页分镜卡的「已摆位」以它为准 ——
 * 修前只认本次会话里点过保存的镜,刷新页面后全部变回「导演台 · 摆位」,与库里的事实不符。
 */
export function stagedShotsFromAssets(assets: ReadonlyArray<{ type?: string; shotNumber?: number | null }> | null | undefined): Record<number, true> {
  const out: Record<number, true> = {};
  for (const a of assets || []) {
    if (a?.type === STAGE_SCENE_TYPE && typeof a.shotNumber === 'number' && Number.isFinite(a.shotNumber)) out[a.shotNumber] = true;
  }
  return out;
}

/** 这一镜当前那张构图草图(v12.462):导演台重开时显示,并标出它从哪来 */
export interface StageSketchInfo {
  url: string;
  /** 'stage' = 导演台渲的;'generate' = AI 画的;'set' = 用户上传的 */
  mode: string;
}

/**
 * 校验 POST /stage 的请求体(v12.462 从路由里收进来,并补上机位字段)。纯函数。
 *
 * 修前只查 `camera.yawDeg` 是数字:`lens:"notALens"` 照存,几何层 `LENS_MM[...] ?? 35` 静默按 35mm 算,
 * 用户选的焦距下次打开就「没了」,全程零报错 —— 与 v12.440 修掉的 facingDeg 是同一类毛病。
 * 这里一律拒 400 并说出是哪个字段;null / 空串视同清除(与朝向、姿态一致)。
 */
export function validateStagePayload(body: unknown, isPose: (v: unknown) => boolean):
  { ok: true; scene: StageScene } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const camera = b.camera && typeof b.camera === 'object' ? { ...b.camera } : null;
  const actorsIn = b.actors;
  if (!camera || !Number.isFinite(camera.yawDeg) || !Array.isArray(actorsIn)) {
    return { ok: false, error: '舞台数据不完整:需要 camera(含 yawDeg)与 actors 数组' };
  }
  for (const k of ['x', 'z'] as const) {
    if (camera[k] === undefined || camera[k] === null) camera[k] = 0;
    else if (!Number.isFinite(camera[k])) return { ok: false, error: `机位 ${k} 必须是数字(米)` };
  }
  if (camera.lens === null || camera.lens === '') delete camera.lens;
  else if (camera.lens !== undefined && !(typeof camera.lens === 'string' && Object.prototype.hasOwnProperty.call(LENS_MM, camera.lens))) {
    return { ok: false, error: `焦距不在档位里:${JSON.stringify(camera.lens).slice(0, 20)}(可选 ${Object.keys(LENS_MM).join(' / ')})` };
  }
  if (camera.pitchDeg === null) delete camera.pitchDeg;
  else if (camera.pitchDeg !== undefined && (!Number.isFinite(camera.pitchDeg) || Math.abs(camera.pitchDeg) > 89)) {
    return { ok: false, error: `机位俯仰必须在 −89°–89° 之间,收到 ${JSON.stringify(camera.pitchDeg).slice(0, 20)}` };
  }
  if (camera.heightM === null) delete camera.heightM;
  else if (camera.heightM !== undefined) {
    const [lo, hi] = STAGE_CAM_HEIGHT_RANGE;
    if (!Number.isFinite(camera.heightM) || camera.heightM < lo || camera.heightM > hi) {
      return { ok: false, error: `机位高度必须在 ${lo}–${hi} 米之间,收到 ${JSON.stringify(camera.heightM).slice(0, 20)}` };
    }
  }
  if (actorsIn.length > STAGE_MAX_ACTORS) return { ok: false, error: `一镜最多 ${STAGE_MAX_ACTORS} 个人物,收到 ${actorsIn.length} 个` };
  const ids = new Set<string>();
  const actors: StageActor[] = [];
  for (const [i, raw] of (actorsIn as any[]).entries()) {
    if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.x) || !Number.isFinite(raw.z)) {
      return { ok: false, error: `第 ${i + 1} 个人物缺少有效的 x / z(米)` };
    }
    const a = { ...raw };
    if (typeof a.id !== 'string' || !a.id.trim() || a.id.length > 40) return { ok: false, error: `第 ${i + 1} 个人物缺少有效的 id` };
    if (ids.has(a.id)) return { ok: false, error: `人物 id 重复:${a.id.slice(0, 20)}` };
    ids.add(a.id);
    if (a.name === null || a.name === undefined) delete a.name;
    else if (typeof a.name !== 'string') return { ok: false, error: `第 ${i + 1} 个人物的名字必须是文字` };
    else {
      // 控制字符会把提示词那句话截断/换行;首尾空白去掉,空名视同未设(显示 id)
      const name = a.name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (name.length > STAGE_NAME_MAX) return { ok: false, error: `第 ${i + 1} 个人物的名字超过 ${STAGE_NAME_MAX} 个字` };
      if (name) a.name = name; else delete a.name;
    }
    if (a.posePreset === null || a.posePreset === '') delete a.posePreset;
    else if (a.posePreset !== undefined && !isPose(a.posePreset)) {
      return { ok: false, error: `第 ${i + 1} 个人物的 posePreset 不在词表里:${JSON.stringify(a.posePreset).slice(0, 20)}` };
    }
    if (a.facingDeg === null) delete a.facingDeg;
    else if (a.facingDeg !== undefined && !Number.isFinite(a.facingDeg)) {
      return { ok: false, error: `第 ${i + 1} 个人物的 facingDeg 必须是数字(度),收到 ${JSON.stringify(a.facingDeg).slice(0, 20)}` };
    }
    actors.push(a);
  }
  return { ok: true, scene: { actors, camera } };
}

/** 35mm 全画幅的长边(毫米) */
export const SENSOR_LONG_MM = 36;

/**
 * 按画幅算等效传感器尺寸(v12.439)——**长边固定 36mm**。
 *
 * 为什么是长边而不是对角线:16:9 是对全画幅的上下裁切,宽度仍是 36mm(与 3:2 同一个水平视角);
 * 竖拍就是把机身转 90°,长边变成了高。于是同一支 35mm 镜头,16:9 水平 54.4°,9:16 水平 32.3°。
 * 按对角线固定会得出 9:16 水平 33.7°、1:1 边长 30.6mm(比 3:2 的短边还窄),都与直觉和实拍不符。
 *
 * 缺省(无画幅)返回 36×24,与修前一致。
 */
export function sensorDims(aspect?: string | null): { sW: number; sH: number } {
  const m = typeof aspect === 'string' ? aspect.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/) : null;
  const r = m ? Number(m[1]) / Number(m[2]) : NaN;
  if (!(r > 0) || !Number.isFinite(r)) return { sW: 36, sH: 24 };
  return r >= 1 ? { sW: SENSOR_LONG_MM, sH: SENSOR_LONG_MM / r } : { sW: SENSOR_LONG_MM * r, sH: SENSOR_LONG_MM };
}

/**
 * v12.439:按画幅给出画面像素尺寸 —— 草图 PNG 与导演台预览共用。
 *
 * 宽高比取自 `sensorDims`(同一个解析器),**不另解析一次画幅字符串**:
 * 若草图按 16:9 出图而几何按 36×24 投影,人会被横向拉宽,和提示词里的景别对不上。
 * 面积固定(默认 960×540),于是 16:9→960×540、9:16→540×960、1:1→720×720,与修前三档完全一致。
 */
export function frameSize(aspect?: string | null, area = 960 * 540): { width: number; height: number } {
  const { sW, sH } = sensorDims(aspect);
  const r = sW / sH;
  return { width: Math.round(Math.sqrt(area * r)), height: Math.round(Math.sqrt(area / r)) };
}

/** 水平视角(度) */
export function horizontalFovDeg(lens: LensId | undefined, aspect?: string | null): number {
  const f = LENS_MM[String(lens || '35')] ?? 35;
  return (2 * Math.atan(sensorDims(aspect).sW / (2 * f)) * 180) / Math.PI;
}

/** 垂直视角(度)—— 画幅高 24mm。v12.317 草图要按真实透视画,故须分开算。 */
export function verticalFovDeg(lens: LensId | undefined, aspect?: string | null): number {
  const f = LENS_MM[String(lens || '35')] ?? 35;
  return (2 * Math.atan(sensorDims(aspect).sH / (2 * f)) * 180) / Math.PI;
}

const norm180 = (deg: number) => {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
};

/**
 * 由「主体在画面里占多高」反推景别 —— 而不是让用户填一个与实际不符的标签。
 * 这正是导演台该解决的:**镜头参数与景别不再是两套各说各话的东西**。
 */
export function inferShotSize(distanceM: number, lens: LensId | undefined, subjectHeightM = 1.7, aspect?: string | null): ShotSize {
  const f = LENS_MM[String(lens || '35')] ?? 35;
  if (!(distanceM > 0)) return 'ECU';
  // 主体在传感器上的成像高度占画幅高度的比例。v12.439:画幅高度随画幅走(修前写死 24mm)。
  // distanceM 应是**沿光轴的深度**(projectScene 传的就是它),直线透视下成像大小由深度决定。
  const frac = (subjectHeightM * f) / (distanceM * sensorDims(aspect).sH);
  if (frac >= 3.5) return 'ECU';
  if (frac >= 1.6) return 'CU';
  if (frac >= 0.85) return 'MS';
  if (frac >= 0.45) return 'LS';
  if (frac >= 0.22) return 'WS';
  return 'ELS';
}

/** 由机位高度与主体高度推垂直机位角 —— 同样是「算出来」而不是「填一个」 */
export function inferCameraAngle(camHeightM: number, subjectHeightM = 1.7): CameraAngle {
  const eye = subjectHeightM * 0.94;   // 眼高约身高的 94%
  const d = camHeightM - eye;
  if (camHeightM >= subjectHeightM * 1.8) return 'overhead';
  if (d > 0.35) return 'high';
  if (d < -0.35) return 'low';
  return 'eye';
}

function thirdsOf(screenX: number, inFrame: boolean): ProjectedActor['thirds'] {
  if (!inFrame) return 'off-frame';
  if (screenX <= -0.55) return 'left';
  if (screenX <= -0.18) return 'center-left';
  if (screenX < 0.18) return 'center';
  if (screenX < 0.55) return 'center-right';
  return 'right';
}

const isFacingSet = (a: StageActor) => typeof a.facingDeg === 'number' && Number.isFinite(a.facingDeg);

/** 望向某人的容差(度):朝向与「A→B」方位角之差在此以内才算「朝着 B」 */
export const TOWARD_TOLERANCE_DEG = 25;

/**
 * 人物朝向在镜头里的样子(v12.440)。未设朝向返回 null。
 *
 * **参照是「人→机位」而不是机位光轴**:画面边缘的人,镜头是斜着看他的 ——
 * 同样朝 +z 转身,站在画面正中和站在画面边上,镜头看到的侧转程度不一样。
 * 分档(与 `offCameraDeg` 对应):≤30 正面、≤70 3/4 侧、≤110 侧面、≤150 3/4 背、其余背面。
 */
export function facingOf(actor: StageActor, camera: StageCamera, others: StageActor[] = []): FacingInFrame | null {
  if (!isFacingSet(actor)) return null;
  const f = norm180(actor.facingDeg as number);
  const toCam = (Math.atan2(camera.x - actor.x, camera.z - actor.z) * 180) / Math.PI;
  const off = Math.abs(norm180(f - toCam));
  const view: FacingView =
    off <= 30 ? 'front' : off <= 70 ? 'three-quarter' : off <= 110 ? 'profile' : off <= 150 ? 'three-quarter-back' : 'back';

  const out: FacingInFrame = { view, offCameraDeg: Number(off.toFixed(1)) };
  if (view !== 'front' && view !== 'back') {
    // 朝画面哪边:看朝向在「机位→人」这条视线的**右法向**上的分量 = sin(f − 视线方位角)。
    // 不能用机位光轴的右方向 —— 广角镜头画面边上的人,视线偏光轴可超过 30°,
    // 朝向夹在光轴与视线之间时两种算法给出相反的左右(对照 three.js 投影验证过)。
    const lineOfSight = norm180(toCam + 180);
    out.screenSide = Math.sin(((f - lineOfSight) * Math.PI) / 180) >= 0 ? 'right' : 'left';
  }

  // 选「最正对着的」那个人,而不是最近的:A 正看着 6 米外的 C,3 米外偏 20° 站着 B,
  // 按距离选会说 A 在看 B。角度相同再比距离,仍相同按数组顺序(同一份数据结果恒定)。
  let best: { a: StageActor; off: number; d: number } | null = null;
  for (const o of others) {
    if (o.id === actor.id) continue;
    const d = Math.hypot(o.x - actor.x, o.z - actor.z);
    if (d < 1e-6) continue;
    const bearing = (Math.atan2(o.x - actor.x, o.z - actor.z) * 180) / Math.PI;
    const offBy = Math.abs(norm180(bearing - f));
    if (offBy > TOWARD_TOLERANCE_DEG) continue;
    if (!best || offBy < best.off - 1e-9 || (Math.abs(offBy - best.off) <= 1e-9 && d < best.d)) best = { a: o, off: offBy, d };
  }
  if (best) {
    out.towardId = best.a.id;
    if (best.a.name) out.towardName = best.a.name;
  }
  return out;
}

/** 把任意角度归一到 (−180, 180](键盘转朝向用;界面不自己做角度运算) */
export function normalizeFacingDeg(deg: number): number {
  return norm180(deg);
}

/**
 * 由俯视图上的指针位置算人物朝向(度),吸附到 `snapDeg` 的整数倍,范围 (−180, 180]。
 * 指针离人太近(方向无定义)返回 null。放在几何层而不是界面里:界面不自己算几何(v12.318 的分工)。
 */
export function facingFromPoint(actor: Pick<StageActor, 'x' | 'z'>, x: number, z: number, snapDeg = 5): number | null {
  if (Math.hypot(x - actor.x, z - actor.z) < 0.15) return null;
  const deg = (Math.atan2(x - actor.x, z - actor.z) * 180) / Math.PI;
  const snapped = snapDeg > 0 ? Math.round(deg / snapDeg) * snapDeg : deg;
  return norm180(snapped);   // norm180 已把 −180 归成 180
}

/** 把舞台投影到画面 —— 导演台的核心计算 */
export function projectScene(scene: StageScene): ProjectedActor[] {
  const cam = scene.camera;
  const aspect = scene.aspect;
  const fov = horizontalFovDeg(cam.lens, aspect);
  const half = fov / 2;
  const tanHalfH = Math.tan((half * Math.PI) / 180);
  const tanHalfV = Math.tan((verticalFovDeg(cam.lens, aspect) * Math.PI) / 360);

  // v12.465:俯仰。先按朝向转、再绕相机横轴转(three.js 的 YXZ 顺序)。对一个高 y 的点(u = y − 机高,f = 水平前向距离):
  //   沿光轴的深度 f' = f·cosP + u·sinP,上下 u' = u·cosP − f·sinP(P > 0 抬头)。
  // P = 0 时 f' = f、u' = u,下面每个量都与修前逐项相同 —— 旧舞台的投影一个数字都不变。
  const pitch = ((Number.isFinite(cam.pitchDeg) ? (cam.pitchDeg as number) : 0) * Math.PI) / 180;
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const camH = cam.heightM ?? 1.6;

  const raw = (scene.actors || []).map((a) => {
    const dx = a.x - cam.x;
    const dz = a.z - cam.z;
    const distanceM = Math.hypot(dx, dz);
    // 相对机位朝向的水平偏角
    const bearing = (Math.atan2(dx, dz) * 180) / Math.PI;
    const rel = norm180(bearing - cam.yawDeg);
    const relRad = (rel * Math.PI) / 180;
    const right = distanceM * Math.sin(relRad);
    const fwd = distanceM * Math.cos(relRad);
    // v12.443:姿态改变头顶高度 —— 坐着的人头顶只到站立的 0.72,画面里更矮。
    // v12.445 修正:**景别不跟着姿态变**。景别说的是「这个人在画面里占多大」,
    // 由他的身量与距离决定;躺下的人没有变远变小,把他判成「大远景」是错的(浏览器实测撞到)。
    // 所以:轮廓(screenTop/Bottom)用姿态压过的高度,景别用站立身量。
    const standH = a.heightM ?? 1.7;
    const h = standH * poseHeightFactor(a.posePreset);
    const along = (y: number) => fwd * cosP + (y - camH) * sinP;
    const upOf = (y: number) => (y - camH) * cosP - fwd * sinP;
    // 左右位置与景别按**身体中段**算(有俯仰时头脚的左右会因透视略有不同)
    const midAlong = along(h / 2);
    // 主体在像平面背后 → 一定不在画面里(P = 0 时等价于修前的 |rel| ≥ 90°)
    const behind = midAlong <= 1e-6;
    // v12.439:**直线透视**。修前是 rel / half(按角度线性),真实镜头与 three.js 都是 tan(rel)/tan(half),
    // 两者只在画面正中与边缘重合,中间错开 —— 18mm 下错 4.3% 画幅,35mm 1.5%。
    // 没有 3D 画面对照时看不出来;一加 3D 视口,人物位置就和提示词、体检、草图对不上。
    const screenX = behind ? (rel > 0 ? 2 : -2) : right / (midAlong * tanHalfH);
    // 纵向:直线透视下的成像高度由**沿光轴的深度**决定,不是水平距离。
    // 修前用水平距离 —— 人物偏离画面中心 20° 时纵向位置差约 6%(已对照 three.js 验证)。
    const depth = Math.max(midAlong, 1e-6);
    const screenY = (y: number) => upOf(y) / (Math.max(along(y), 1e-6) * tanHalfV);
    const screenBottom = screenY(0);
    const screenTop = screenY(h);
    // v12.462:竖直方向也得有一部分落在画框里。修前只看左右 —— 舞台相机没有俯仰,机高拉到 3 米配长焦,
    // 人整个落在画框下方之外(3D 机位视角里只看得见地面、布局草图一片空白),
    // 体检却说「在画内」,提示词照样描述他站在画面哪边(真浏览器走查撞到)。
    const inFrame = !behind && Math.abs(screenX) <= 1 && screenTop >= -1 && screenBottom <= 1;
    return {
      id: a.id, name: a.name, distanceM, depth, rel, screenX, inFrame,
      heightM: h, standHeightM: standH, screenTop, screenBottom,
    };
  });

  /** 身体(按半宽)有没有伸进画框 —— 中心出画但离镜头很近的人,肩膀仍可能挡在画面边上 */
  const bodyReachesFrame = (o: (typeof raw)[number]) => {
    if (o.inFrame) return true;
    if (Math.abs(o.rel) >= 90) return false;
    if (o.screenTop < -1 || o.screenBottom > 1) return false;   // 整个在画框上方/下方之外,挡不到画里的人
    const halfW = (o.standHeightM * 0.13) / (o.depth * tanHalfH);
    return Math.abs(o.screenX) - halfW <= 1;
  };

  // 「望向谁」只在**画内**的人里找:锥内最近的若是画外的人,提示词不能说他(会诱导模型把他画进来),
  // 而真正被望向、也在画内的那个人就被挤掉了。先筛画内,再取最近。
  const actors = scene.actors || [];
  const visible = actors.filter((_, i) => raw[i].inFrame);

  return raw.map((r, i) => {
    const facing = facingOf(actors[i], cam, visible);
    // 遮挡:角度接近(投影重叠)且更近的人。
    // v12.462:遮挡者**身体得有一部分在画框里**才算。修前不看这一条 —— 远处画外、离画框还差好几度的人
    // 也会被写成「partially occluded by X」,提示词里出现一个本不在画面里的人,模型会把他画进来。
    // 但也不能简单要求遮挡者 inFrame(中心在画内):离机位很近、中心刚出画的人,肩膀正挡在画面边上 ——
    // 那正是过肩前景,删掉它才是错的。所以按身体半宽(站高 × 0.13,与草图的人形宽度同一比例)在画面上的投影算。
    const occludedBy = raw
      .filter((o) => o.id !== r.id && o.distanceM < r.distanceM && Math.abs(o.rel - r.rel) < 4 && bodyReachesFrame(o))
      .map((o) => o.name || o.id);
    const out: ProjectedActor = {
      id: r.id,
      name: r.name,
      inFrame: r.inFrame,
      screenX: Number(r.screenX.toFixed(4)),
      distanceM: Number(r.distanceM.toFixed(3)),
      shotSize: inferShotSize(r.depth, cam.lens, r.standHeightM, aspect),
      occludedBy,
      thirds: thirdsOf(r.screenX, r.inFrame),
      screenTop: Number(r.screenTop.toFixed(4)),
      screenBottom: Number(r.screenBottom.toFixed(4)),
    };
    // 未设朝向/姿态就不带这些键 —— 旧数据的投影结果与修前结构完全相同
    if (facing) out.facing = facing;
    if (poseOf(actors[i])) out.posePreset = actors[i].posePreset;
    return out;
  });
}

export interface StagingIssue {
  kind: 'off-frame' | 'occluded' | 'camera-inside-actor' | 'empty-frame' | 'no-face-to-camera';
  actorId?: string;
  message: string;
}

/**
 * 构图体检 —— **确定性**地指出问题,而不是等生成完了才发现。
 * 这是导演台相对「反复抽卡」的核心价值:出问题在生成**之前**就说。
 */
export function auditStaging(scene: StageScene): StagingIssue[] {
  const issues: StagingIssue[] = [];
  const projected = projectScene(scene);

  for (const p of projected) {
    if (!p.inFrame) {
      // v12.462:左右出画与上下出画是两回事,办法也不同 —— 上下出画多半是机位太高/太低(舞台相机没有俯仰)
      const vertical = Math.abs(p.screenX) <= 1 && (p.screenTop < -1 || p.screenBottom > 1);
      issues.push({
        kind: 'off-frame', actorId: p.id,
        message: vertical
          ? `${p.name || p.id} 整个在画面${p.screenTop < -1 ? '下方' : '上方'}之外 —— 把俯仰${p.screenTop < -1 ? '往下压' : '往上抬'}(或点「对准人物」)、${p.screenTop < -1 ? '降低机高' : '抬高机位'},或换更广的镜头`
          : `${p.name || p.id} 不在画面内(偏离画面中心 ${Math.abs(p.screenX).toFixed(2)},>1 即出画)——请转机位或换更广的镜头`,
      });
    } else if (p.occludedBy.length > 0) {
      issues.push({
        kind: 'occluded', actorId: p.id,
        message: `${p.name || p.id} 被 ${p.occludedBy.join('、')} 挡住 —— 错开站位或换机位`,
      });
    }
  }

  for (const a of scene.actors || []) {
    if (Math.hypot(a.x - scene.camera.x, a.z - scene.camera.z) < 0.35) {
      issues.push({
        kind: 'camera-inside-actor', actorId: a.id,
        message: `机位几乎与 ${a.name || a.id} 重合(<0.35m)—— 会穿模,请后撤机位`,
      });
    }
  }

  if (projected.length > 0 && projected.every((p) => !p.inFrame)) {
    issues.push({ kind: 'empty-frame', message: '画面里一个人都没有 —— 机位朝向可能反了' });
  }

  // v12.440:画内每个人都设了朝向,却没有一张脸朝镜头(全是侧面/背面)。
  // 只在「全都设了」时报 —— 有人没设就不知道他朝哪,不能替他下结论;过肩/背影镜头是正当用法,所以只报不拦。
  const shown = projected.filter((p) => p.inFrame);
  if (shown.length > 0 && shown.every((p) => p.facing)
      && !shown.some((p) => p.facing!.view === 'front' || p.facing!.view === 'three-quarter')) {
    issues.push({
      kind: 'no-face-to-camera',
      message: '画面里没有一张脸朝向镜头(都是侧面或背面)—— 如非刻意的过肩/背影镜头,转一下人物朝向',
    });
  }
  return issues;
}

/** 镜头里每个人的姿态(按 id);没设姿态的人不在表里 —— 描述与提示词都据此决定加不加那一段 */
function poseMap(scene: StageScene): Map<string, PosePreset> {
  const m = new Map<string, PosePreset>();
  for (const a of scene.actors || []) {
    const p = poseOf(a);
    if (p) m.set(a.id, p);
  }
  return m;
}

const SIDE_CN = { left: '左', right: '右' } as const;

/** 朝向的中文说明(界面用);`inFrameIds` 用来只提画面里看得到的对象 */
export function facingTextCn(f: FacingInFrame | undefined, inFrameIds: Set<string>): string {
  if (!f) return '';
  const side = f.screenSide ? SIDE_CN[f.screenSide] : '';
  const base =
    f.view === 'front' ? '正面朝镜头'
      : f.view === 'three-quarter' ? `3/4 侧身朝画面${side}`
        : f.view === 'profile' ? `侧身朝画面${side}`
          : f.view === 'three-quarter-back' ? `3/4 背身朝画面${side}`
            : '背对镜头';
  const toward = f.towardId && inFrameIds.has(f.towardId) ? `,望向${f.towardName || f.towardId}` : '';
  return base + toward;
}

/**
 * 朝向的英文短语(进提示词)。
 * 「朝着谁」只在对方也在画内时说 —— 说「toward 画外的人」会诱导模型把那个人也画进来。
 */
export function facingPhraseEn(f: FacingInFrame | undefined, inFrameIds: Set<string>): string {
  if (!f) return '';
  const side = f.screenSide ? `screen ${f.screenSide}` : '';
  const target = f.towardId && inFrameIds.has(f.towardId) ? (f.towardName || f.towardId) : '';
  switch (f.view) {
    case 'front': return target ? `facing camera, turned toward ${target}` : 'facing camera';
    case 'three-quarter': return `in three-quarter view, turned ${target ? `${side} toward ${target}` : `toward ${side}`}`;
    case 'profile': return `in profile, facing ${target ? `${side} toward ${target}` : side}`;
    case 'three-quarter-back': return `turned three-quarters away, facing ${target ? `${side} toward ${target}` : side}`;
    default: return target ? `with back to camera, facing ${target}` : 'with back to camera';
  }
}

/**
 * 生成**精确站位描述**,直接进提示词。
 *
 * 这段文字是人手写不出来的:它同时包含每个人的三分位、景别、朝向关系与遮挡,
 * 且**与 3D 场景严格一致** —— 用户改一下站位,描述跟着变,不用重新组织语言。
 */
export function describeStaging(scene: StageScene): string {
  const projected = projectScene(scene);
  const cam = scene.camera;
  const inFrame = projected.filter((p) => p.inFrame);
  if (inFrame.length === 0) return '';

  const THIRDS_CN: Record<string, string> = {
    left: '画面左侧', 'center-left': '中偏左', center: '画面中央',
    'center-right': '中偏右', right: '画面右侧', 'off-frame': '画外',
  };
  const SIZE_CN: Record<ShotSize, string> = {
    ECU: '大特写', CU: '特写', MS: '中景', LS: '全景', WS: '远景', ELS: '大远景',
  };
  // v12.465:机位角按相机**实际朝向**说(俯仰 + 高度),与提示词、3D 预览、草图同一个判据
  const view = cameraViewOf(cam);
  const tilt = Math.abs(view.tiltDeg) >= 1 ? `(${view.tiltDeg < 0 ? '下压' : '上抬'} ${Math.abs(Math.round(view.tiltDeg))}°)` : '';
  const ids = new Set(inFrame.map((p) => p.id));
  const poseById = poseMap(scene);
  const parts = inFrame
    .slice()
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((p) => {
      const who = p.name || p.id;
      const occ = p.occludedBy.length ? `,被${p.occludedBy.join('、')}部分遮挡` : '';
      const face = p.facing ? `,${facingTextCn(p.facing, ids)}` : '';
      const pose = poseById.get(p.id);
      const act = pose ? `,${pose.cn}` : '';
      return `${who}位于${THIRDS_CN[p.thirds]}(${SIZE_CN[p.shotSize]},距机位约 ${p.distanceM.toFixed(1)} 米${face}${act}${occ})`;
    });

  return `${view.cn}${tilt},${horizontalFovDeg(cam.lens, scene.aspect).toFixed(0)}° 水平视角;${parts.join(';')}。`;
}

/**
 * 该镜的**站位指令** —— 唯一注入口径。
 *
 * 刻意返回英文:`visualPrompt` 全链路是英文(v12.6.1 定的口径,中文只锁台词/旁白/TTS/口型),
 * 混中文进去会让非中文引擎把它当画面文字渲染 —— 与 v2.22 那次 CJK 乱码同一类坑。
 */
export function stageDirectiveForShot(scene: StageScene | null | undefined): string {
  if (!scene?.camera || !Array.isArray(scene.actors) || scene.actors.length === 0) return '';
  const projected = projectScene(scene);
  const inFrame = projected.filter((p) => p.inFrame);
  if (inFrame.length === 0) return '';

  const POS: Record<string, string> = {
    left: 'at frame left', 'center-left': 'left of center', center: 'at frame center',
    'center-right': 'right of center', right: 'at frame right', 'off-frame': '',
  };
  const SIZE: Record<string, string> = {
    ECU: 'extreme close-up', CU: 'close-up', MS: 'medium shot',
    LS: 'full shot', WS: 'wide shot', ELS: 'extreme wide shot',
  };
  const ids = new Set(inFrame.map((p) => p.id));
  const poseById = poseMap(scene);
  const parts = inFrame
    .slice()
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((p) => {
      const occ = p.occludedBy.length ? `, partially occluded by ${p.occludedBy.join(' and ')}` : '';
      const face = p.facing ? `, ${facingPhraseEn(p.facing, ids)}` : '';
      const pose = poseById.get(p.id);
      const act = pose ? `, ${pose.en}` : '';
      return `${p.name || p.id} ${POS[p.thirds]} in ${SIZE[p.shotSize]}${face}${act}${occ}`;
    });
  // v12.462 起机位角进提示词;v12.465 起按相机**实际朝向**说(cameraViewOf)—— 修前只看机高,
  // 「抬高但平视」也写成 looking down,与 3D 预览、草图对不上。正常高度平视不写:旧舞台这句话逐字不变。
  // 「. Staging:」标记保持原样,withStageDirective 靠它判断「已经带过站位句」。
  const angle = cameraViewOf(scene.camera).en;
  return `. Staging: ${angle ? `${angle}; ` : ''}${parts.join('; ')}`;
}

export interface CameraView {
  /** 归到既有 CameraAngle 词表(草图元数据、镜头规格用) */
  angle: CameraAngle;
  /** 俯仰(度),负 = 低头 */
  tiltDeg: number;
  /** 进提示词的英文;正常高度平视为空串(不改变旧数据) */
  en: string;
  /** 界面中文(完整说法,如「平视机位」「高机位平视」) */
  cn: string;
}

/** 低于这个俯仰角算平视 —— 几度的微调不该把镜头说成俯拍/仰拍 */
export const LEVEL_TILT_DEG = 8;

/**
 * 机位角(v12.465):先看相机**往哪看**(俯仰),平视时再看相机**在哪**(高度)。
 * 修前只按高度判:相机抬高 1 米、镜头仍水平,就被说成「高角度俯拍 / looking down」——
 * 而 3D 预览与草图里画面是平的,人还落到画框下方。「抬高的平视」就照实说。
 */
export function cameraViewOf(camera: Pick<StageCamera, 'heightM' | 'pitchDeg'>, subjectHeightM = 1.7): CameraView {
  const tilt = Number.isFinite(camera.pitchDeg) ? (camera.pitchDeg as number) : 0;
  if (tilt <= -60) return { angle: 'overhead', tiltDeg: tilt, en: 'overhead top-down camera', cn: '顶视机位' };
  if (tilt <= -LEVEL_TILT_DEG) return { angle: 'high', tiltDeg: tilt, en: 'high-angle camera looking down', cn: '高角度俯拍机位' };
  if (tilt >= LEVEL_TILT_DEG) return { angle: 'low', tiltDeg: tilt, en: 'low-angle camera looking up', cn: '低角度仰拍机位' };
  const d = (camera.heightM ?? 1.6) - subjectHeightM * 0.94;   // 与 inferCameraAngle 同一个眼高
  if (d > 0.35) return { angle: 'eye', tiltDeg: tilt, en: 'camera raised above eye level, lens kept level', cn: '高机位平视' };
  if (d < -0.35) return { angle: 'eye', tiltDeg: tilt, en: 'camera below eye level, lens kept level', cn: '低机位平视' };
  return { angle: 'eye', tiltDeg: tilt, en: '', cn: '平视机位' };
}

/** 地平线在画面上的纵向位置(+1 顶 / −1 底);P = 0 时在正中。超出 ±1 即不在画面里 */
export function horizonScreenY(scene: StageScene): number {
  const tilt = ((Number.isFinite(scene.camera.pitchDeg) ? (scene.camera.pitchDeg as number) : 0) * Math.PI) / 180;
  const tanHalfV = Math.tan((verticalFovDeg(scene.camera.lens, scene.aspect) * Math.PI) / 360);
  return -Math.tan(tilt) / tanHalfV;
}

/**
 * 「对准人物」(v12.465):让镜头上下对准人物身体中段 —— 抬高机位后一键压下镜头,不用自己试角度。
 * 取左右方向在画内的人(都不在就取机位前方所有人),按身体中段的仰角取平均;没人就保持平视。
 */
export function aimPitchDeg(scene: StageScene): number {
  const cam = scene.camera;
  const camH = cam.heightM ?? 1.6;
  const tanHalfH = Math.tan((horizontalFovDeg(cam.lens, scene.aspect) * Math.PI) / 360);
  const items = (scene.actors || []).map((a) => {
    const d = Math.hypot(a.x - cam.x, a.z - cam.z);
    const rel = ((norm180((Math.atan2(a.x - cam.x, a.z - cam.z) * 180) / Math.PI - cam.yawDeg)) * Math.PI) / 180;
    const fwd = d * Math.cos(rel);
    const h = (a.heightM ?? 1.7) * poseHeightFactor(a.posePreset);
    return { fwd, side: fwd > 1e-6 ? Math.abs(d * Math.sin(rel)) / (fwd * tanHalfH) : Infinity, up: h / 2 - camH };
  }).filter((q) => q.fwd > 1e-6);
  const pick = items.filter((q) => q.side <= 1);
  const use = pick.length ? pick : items;
  if (!use.length) return 0;
  const deg = use.reduce((sum, q) => sum + (Math.atan2(q.up, q.fwd) * 180) / Math.PI, 0) / use.length;
  return Math.max(-80, Math.min(60, Math.round(deg)));
}
