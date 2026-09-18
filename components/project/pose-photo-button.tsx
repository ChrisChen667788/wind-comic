'use client';

/**
 * components/project/pose-photo-button (v12.444) — 上传一张参考照片,自动认出姿态与朝向。
 *
 * 推理**全在浏览器里**:模型与 wasm 都自托管在 /vendor/mediapipe(不走外网 CDN),
 * 照片不上传服务器 —— 用户拿自己拍的参考照来摆位,不该把它传到任何地方去。
 *
 * 一切失败都要说人话:设备不支持、模型没部署、照片里没认出人 —— 各有各的提示,
 * 而不是一个转圈的按钮(本仓对「静默失效」零容忍)。
 * MediaPipe 约 600KB JS + 12MB wasm,只在点按钮时才动态加载,不进项目页首包。
 */
import { useRef, useState } from 'react';
import { UserFocus, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { readPoseFromLandmarks } from '@/lib/pose-from-photo';
import { POSE_PRESETS, type PosePresetId } from '@/lib/stage-blocking';

/**
 * 置信度到这个数(含)就算「不确定」,界面必须要用户自己核对 —— 猜错会直接影响出片。
 * 0.45 正是「侧身但看不到脸」那一档:方向只能靠肩线猜,左右各一半概率。
 */
const LOW_CONFIDENCE = 0.45;

export function PosePhotoButton({ actorName, onRead }: {
  actorName: string;
  onRead: (v: { posePreset: PosePresetId; facingDeg?: number }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';                       // 选同一张图也要能再识别一次
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe');
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/vendor/mediapipe/pose_landmarker_lite.task' },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
      try {
        const bitmap = await createImageBitmap(file);
        const res = landmarker.detect(bitmap);
        bitmap.close?.();
        const lm = res.landmarks?.[0];
        // 背面照常认不出(模型靠脸与正面关节找人)—— 真机实测:同一角色的正/侧/3-4 都认得出,唯独背面认不出。
        // 与其让用户反复换图,不如直说这一条,并提示朝向可以手动设。
        if (!lm || lm.length === 0) { setMsg('照片里没认出人 —— 背面照通常认不出(可直接手动选朝向为「背对镜头」);其余情况换一张全身、单人的照片试试'); return; }
        const guess = readPoseFromLandmarks(lm);
        if (!guess) { setMsg('人认出来了,但关键部位被挡住,判不准姿态 —— 请手动选'); return; }
        onRead({ posePreset: guess.posePreset, facingDeg: guess.facingDeg });
        const low = guess.confidence <= LOW_CONFIDENCE;
        setMsg(`${low ? '⚠ 不太确定:' : '已识别:'}${POSE_PRESETS[guess.posePreset].cn}${guess.facingDeg !== undefined ? ' · 朝向已填' : ''}(${guess.why})${low ? ',请自己核对' : ''}`);
      } finally {
        landmarker.close?.();
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      // 分清「这台设备跑不了」与「这份部署没带模型」——两者的解决办法完全不同
      setMsg(/wasm|WebAssembly|SIMD/i.test(text) ? '这台设备/浏览器跑不了姿态识别,请手动选姿态'
        : /404|fetch|Failed to load|model/i.test(text) ? '这份部署没带姿态模型文件(public/vendor/mediapipe),请手动选姿态'
          : `识别失败:${text.slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" data-pose-photo={actorName} onClick={() => fileRef.current?.click()} disabled={busy}
        title="上传一张参考照片,在本机认出姿态与朝向(照片不会上传)"
        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--cinema-border)] text-[10px] hover:border-[var(--cinema-amber)] disabled:opacity-50">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <UserFocus size={11} />} 照片识别
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={`${actorName} 的姿态参考照片`} onChange={onPick} />
      {msg && <span data-pose-photo-msg className="text-[10px] opacity-75 basis-full">{msg}</span>}
    </>
  );
}
