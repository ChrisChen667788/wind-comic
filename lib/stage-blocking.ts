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

export interface StageActor {
  id: string;
  name?: string;
  /** 俯视位置(米) */
  x: number;
  z: number;
  /** 身高(米);缺省 1.7 */
  heightM?: number;
  /** 朝向(度);0 = 面向 +z */
  facingDeg?: number;
}

export interface StageCamera {
  x: number;
  z: number;
  /** 机位高度(米);缺省 1.6(平视) */
  heightM?: number;
  /** 水平朝向(度) */
  yawDeg: number;
  /** 焦距档位;复用既有 LensId 词表 */
  lens?: LensId;
}

export interface StageScene {
  actors: StageActor[];
  camera: StageCamera;
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
}

const LENS_MM: Record<string, number> = {
  '18': 18, '24': 24, '35': 35, '50': 50, '85': 85, '100': 100, anamorphic: 40,
};

const SENSOR_W = 36;   // 35mm 全画幅

/** 水平视角(度) */
export function horizontalFovDeg(lens: LensId | undefined): number {
  const f = LENS_MM[String(lens || '35')] ?? 35;
  return (2 * Math.atan(SENSOR_W / (2 * f)) * 180) / Math.PI;
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
export function inferShotSize(distanceM: number, lens: LensId | undefined, subjectHeightM = 1.7): ShotSize {
  const f = LENS_MM[String(lens || '35')] ?? 35;
  if (!(distanceM > 0)) return 'ECU';
  // 主体在传感器上的成像高度占画幅高度(24mm)的比例
  const frac = (subjectHeightM * f) / (distanceM * 24);
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

/** 把舞台投影到画面 —— 导演台的核心计算 */
export function projectScene(scene: StageScene): ProjectedActor[] {
  const cam = scene.camera;
  const fov = horizontalFovDeg(cam.lens);
  const half = fov / 2;

  const raw = (scene.actors || []).map((a) => {
    const dx = a.x - cam.x;
    const dz = a.z - cam.z;
    const distanceM = Math.hypot(dx, dz);
    // 相对机位朝向的水平偏角
    const bearing = (Math.atan2(dx, dz) * 180) / Math.PI;
    const rel = norm180(bearing - cam.yawDeg);
    // 主体在机位背后 → 一定不在画面里
    const behind = Math.abs(rel) > 90;
    const screenX = behind ? (rel > 0 ? 2 : -2) : rel / half;
    const inFrame = !behind && Math.abs(screenX) <= 1;
    return {
      id: a.id, name: a.name, distanceM, rel, screenX, inFrame,
      heightM: a.heightM ?? 1.7,
    };
  });

  return raw.map((r) => {
    // 遮挡:角度接近(投影重叠)且更近的人
    const occludedBy = raw
      .filter((o) => o.id !== r.id && o.distanceM < r.distanceM && Math.abs(o.rel - r.rel) < 4)
      .map((o) => o.name || o.id);
    return {
      id: r.id,
      name: r.name,
      inFrame: r.inFrame,
      screenX: Number(r.screenX.toFixed(4)),
      distanceM: Number(r.distanceM.toFixed(3)),
      shotSize: inferShotSize(r.distanceM, cam.lens, r.heightM),
      occludedBy,
      thirds: thirdsOf(r.screenX, r.inFrame),
    };
  });
}

export interface StagingIssue {
  kind: 'off-frame' | 'occluded' | 'camera-inside-actor' | 'empty-frame';
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
      issues.push({
        kind: 'off-frame', actorId: p.id,
        message: `${p.name || p.id} 不在画面内(偏离画面中心 ${Math.abs(p.screenX).toFixed(2)},>1 即出画)——请转机位或换更广的镜头`,
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
  return issues;
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
  const ANGLE_CN: Record<CameraAngle, string> = {
    eye: '平视', low: '低角度仰拍', high: '高角度俯拍', dutch: '荷兰角', overhead: '顶视',
  };

  const angle = inferCameraAngle(cam.heightM ?? 1.6);
  const parts = inFrame
    .slice()
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((p) => {
      const who = p.name || p.id;
      const occ = p.occludedBy.length ? `,被${p.occludedBy.join('、')}部分遮挡` : '';
      return `${who}位于${THIRDS_CN[p.thirds]}(${SIZE_CN[p.shotSize]},距机位约 ${p.distanceM.toFixed(1)} 米${occ})`;
    });

  return `${ANGLE_CN[angle]}机位,${horizontalFovDeg(cam.lens).toFixed(0)}° 水平视角;${parts.join(';')}。`;
}
