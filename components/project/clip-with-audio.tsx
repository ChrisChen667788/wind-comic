'use client';

/**
 * ClipWithAudio (v12.1.0 / v12.1.2) — 片段预览叠播配音 + 带声试听开关(阶段二十 B)。
 *
 * 痛点:AI 生成的裸片段没有音轨(音频只在成片合成阶段混入),逐镜预览自然没声。
 * 本组件给 `<video>`(静音裸片)叠一条同步的 `<audio>`(该镜 TTS 配音 shot-audio),
 * 播放片段即听到台词。
 *
 * v12.1.2 预览体验:
 *   · 三态音频就绪度徽章 —— **配音**(有 TTS 叠层)/ **原生音轨**(裸片自带,探测到才标)
 *     / **无独立音轨**(成片含配乐+配音)。诚实:原生音只在探测到证据时才标。
 *   · 每镜「带声试听」开关 —— 一键静音/恢复该镜音频(叠层配音 或 原生音轨)。
 *
 * 设计(经对抗式评审定稿):
 *   - `video.muted` **纯声明式** `audioUrl ? true : !audible` + useLayoutEffect 兜底,
 *     杜绝 React prop 与命令式 v.muted 抢写的一帧漏音。
 *   - 换片(videoUrl/audioUrl 变)**复位** hasNativeAudio/audioBlocked,不残留上个片判定。
 *   - 配音叠层用独立 `<audio>` 同步 play/pause/seek/变速;自动播放被拦 → 提示而非吞掉。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SpeakerHigh, SpeakerSlash, MusicNotes, WarningCircle } from '@phosphor-icons/react';

export function ClipWithAudio({
  videoUrl, audioUrl, className, overlay,
}: {
  videoUrl: string;
  audioUrl?: string | null;
  className?: string;
  overlay?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // v12.13.2:按视频真实比例显示(裸 <video> 默认拉伸进固定框 = 变形)。探测到比例则用 aspectRatio + object-contain。
  const [ratio, setRatio] = useState<number | null>(null);
  // v12.1.2 带声试听开关(默认开)+ 裸片原生音轨探测 + 自动播放被拦标记
  const [audible, setAudible] = useState(true);
  const [hasNativeAudio, setHasNativeAudio] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // video.muted 纯声明式拥有(消除 React prop vs 命令式抢写的一帧漏音)
  useLayoutEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = audioUrl ? true : !audible;
  }, [audioUrl, audible]);

  // 探测裸片是否自带音轨;换片先复位(不残留上个片的原生音判定),命中即摘 timeupdate
  useEffect(() => {
    setHasNativeAudio(false);
    setAudioBlocked(false);
    const v = videoRef.current;
    if (!v || audioUrl) return;
    const probe = () => {
      const native =
        (v as any).webkitAudioDecodedByteCount > 0 ||
        (v as any).mozHasAudio === true ||
        (((v as any).audioTracks?.length ?? 0) > 0);
      if (native) { setHasNativeAudio(true); v.removeEventListener('timeupdate', probe); }
    };
    v.addEventListener('loadeddata', probe);
    v.addEventListener('timeupdate', probe);
    return () => { v.removeEventListener('loadeddata', probe); v.removeEventListener('timeupdate', probe); };
  }, [audioUrl, videoUrl]);

  // 叠播配音同步(仅 audioUrl 存在):play/pause/seek/变速跟随 video
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const tryPlay = () => {
      if (!audible) return;
      try {
        a.currentTime = v.currentTime;
        if (a.duration && a.currentTime >= a.duration) return; // 配音比片短且已放完 → 不重启
        a.play().then(() => setAudioBlocked(false)).catch((e: any) => { if (e?.name === 'NotAllowedError') setAudioBlocked(true); });
      } catch { /* ignore */ }
    };
    const onPlay = tryPlay;
    const onPause = () => a.pause();
    const onSeek = () => { try { a.currentTime = v.currentTime; if (!v.paused) tryPlay(); } catch { /* ignore */ } }; // seek 后台词续播
    const onRate = () => { a.playbackRate = v.playbackRate; };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeking', onSeek);
    v.addEventListener('ratechange', onRate);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeking', onSeek);
      v.removeEventListener('ratechange', onRate);
      a.pause();
    };
  }, [audioUrl, audible]);

  // 带声试听开关 → 叠层 audio 跟随(video.muted 由 layout effect 管,这里不碰)
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    a.muted = !audible;
    if (!audible) { a.pause(); return; }
    if (v && !v.paused) {
      try {
        a.currentTime = v.currentTime;
        if (!(a.duration && a.currentTime >= a.duration)) {
          a.play().then(() => setAudioBlocked(false)).catch((e: any) => { if (e?.name === 'NotAllowedError') setAudioBlocked(true); });
        }
      } catch { /* ignore */ }
    }
  }, [audible, audioUrl]);

  const state: 'voiceover' | 'native' | 'none' = audioUrl ? 'voiceover' : hasNativeAudio ? 'native' : 'none';
  const canAudition = !!audioUrl || hasNativeAudio;

  return (
    <div className="relative">
      {/* video.muted 纯声明式:有叠层恒静音;无叠层跟 audible(layout effect 兜底同值) */}
      {/* v12.13.2:object-contain 不变形 + 探测到真实比例则按其显示(inline aspectRatio 覆盖外层固定框) */}
      <video
        ref={videoRef} src={videoUrl} controls playsInline crossOrigin="anonymous"
        muted={audioUrl ? true : !audible}
        onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }}
        className={`${className || ''} object-contain bg-black`}
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
      />
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />}
      {overlay}
      {/* 三态就绪度徽章 —— 反映 live 静音态,不在已静音时假称「带配音/有声」 */}
      <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px]" data-testid="clip-audio-badge" data-audio-state={state}>
        {state === 'voiceover' && (audible
          ? (<><SpeakerHigh className="w-3 h-3 text-emerald-300" /><span className="text-emerald-200">带配音</span></>)
          : (<><SpeakerSlash className="w-3 h-3 text-white/40" /><span className="text-white/40">配音已静音</span></>))}
        {state === 'native' && (audible
          ? (<><MusicNotes className="w-3 h-3 text-sky-300" /><span className="text-sky-200">原生音轨</span></>)
          : (<><SpeakerSlash className="w-3 h-3 text-white/40" /><span className="text-white/40">原生音已静音</span></>))}
        {state === 'none' && (<><SpeakerSlash className="w-3 h-3 text-white/40" /><span className="text-white/40">片段无独立音轨 · 成片含配乐+配音</span></>)}
      </div>
      {/* 自动播放被浏览器拦截 → 诚实提示(不假装有声) */}
      {audioBlocked && audible && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-100 text-[10px]" data-testid="clip-audio-blocked">
          <WarningCircle className="w-3 h-3" /><span>声音被浏览器拦截,点击画面后重试</span>
        </div>
      )}
      {/* 每镜「带声试听」开关(仅在有可听声源时显示;稳定 aria-label,aria-pressed 携带状态) */}
      {canAudition && (
        <button
          type="button"
          onClick={() => setAudible((x) => !x)}
          aria-pressed={audible}
          aria-label="带声试听"
          data-testid="clip-audio-toggle"
          title={audible ? '当前带声 · 点击静音' : '当前静音 · 点击带声试听'}
          className={`absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border transition-colors ${
            audible ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-black/60 border-white/15 text-white/50'
          }`}
        >
          {audible ? <SpeakerHigh className="w-3 h-3" /> : <SpeakerSlash className="w-3 h-3" />}
          <span>{audible ? '带声试听' : '静音'}</span>
        </button>
      )}
    </div>
  );
}
