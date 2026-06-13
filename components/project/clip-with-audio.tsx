'use client';

/**
 * ClipWithAudio (v12.1.0) — 片段预览叠播配音(阶段二十 B)。
 *
 * 痛点:AI 生成的裸片段没有音轨(音频只在成片合成阶段混入),逐镜预览自然没声。
 * 本组件给 `<video>`(静音裸片)叠一条同步的 `<audio>`(该镜 TTS 配音 shot-audio),
 * 播放片段即听到台词;无配音的镜明确标注「片段无独立音轨,成片含配乐+配音」。
 *
 * 同步:video play/pause/seek → audio 跟随(从 video.currentTime 对齐)。
 */
import { useEffect, useRef } from 'react';
import { SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';

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

  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const onPlay = () => { try { a.currentTime = v.currentTime; a.play().catch(() => {}); } catch { /* ignore */ } };
    const onPause = () => a.pause();
    const onSeek = () => { try { a.currentTime = v.currentTime; } catch { /* ignore */ } };
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
  }, [audioUrl]);

  return (
    <div className="relative">
      {/* 有配音叠层 → 静音视频用配音作声源(避免与片段原生音轨双重);无叠层 → 放片段自带音轨 */}
      <video ref={videoRef} src={videoUrl} controls playsInline crossOrigin="anonymous" muted={!!audioUrl} className={className} />
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />}
      {overlay}
      {/* 音频状态徽章 */}
      <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px]" data-testid="clip-audio-badge">
        {audioUrl ? (
          <><SpeakerHigh className="w-3 h-3 text-emerald-300" /><span className="text-emerald-200">带配音</span></>
        ) : (
          <><SpeakerSlash className="w-3 h-3 text-white/40" /><span className="text-white/40">片段无独立音轨 · 成片含配乐+配音</span></>
        )}
      </div>
    </div>
  );
}
