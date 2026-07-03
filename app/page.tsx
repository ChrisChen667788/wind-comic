'use client';

import Link from 'next/link';
import Image from 'next/image';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SectionTitle } from '@/components/ui/section-title';
import { GlassCard } from '@/components/ui/glass-card';
import { heroStats, featureHighlights, agentCards, vibeShots } from '@/lib/home-data';
import { IMG_FEATURE_MAIN, IMG_LENS_MAIN, IMG_BG_TEXTURE } from '@/lib/placeholder-images';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Play } from '@phosphor-icons/react';
import { useLocale } from '@/hooks/use-locale';

export default function Home() {
  const { t } = useLocale();
  // v10.3.4 a11y: 系统「减少动态效果」时,英雄循环视频不自动播放(露静态封面),装饰预览同理
  const reduce = useReducedMotion();
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [cases, setCases] = useState<any[]>([]);
  const [playingCase, setPlayingCase] = useState<string | null>(null); // v9.5.4: 案例卡点击播放示意片段
  // 英雄封面资产探测:
  //   - /hero-loop.mp4  运行 `npm run generate:hero` 生成的循环动画
  //   - /hero-cover.jpg 同脚本生成的静态封面 (视频不可用时的 fallback)
  //   - 都没有则落回品牌渐变
  const [heroAssets, setHeroAssets] = useState<{ video: boolean; cover: boolean }>({ video: false, cover: false });

  useEffect(() => {
    fetch('/api/cases')
      .then((r) => r.json())
      .then((data) => setCases(data.slice(0, 4)))
      .catch(() => {});

    // HEAD 探测静态资产
    (async () => {
      const [v, c] = await Promise.all([
        fetch('/hero-loop.mp4', { method: 'HEAD' }).then(r => r.ok).catch(() => false),
        fetch('/hero-cover.jpg', { method: 'HEAD' }).then(r => r.ok).catch(() => false),
      ]);
      setHeroAssets({ video: v, cover: c });
    })();
  }, []);

  // 减少动效:视频可能在偏好确定前已开始播放(SSR/水合),主动暂停露静态封面
  useEffect(() => {
    if (reduce) heroVideoRef.current?.pause();
  }, [reduce, heroAssets.video]);

  return (
    <div className="min-h-screen">
      {/* ═══════════════════════════════════════════════════════
          英雄全屏区 (Work Rally-inspired cinematic full-bleed)
          - 视频循环底 > 静态封面 > 品牌渐变,三级降级
          - 顶部 header overlay 不占空间
          - 中央品牌 + 副标题 + CTA
          ═══════════════════════════════════════════════════════ */}
      <section className="relative w-full h-screen min-h-[720px] overflow-hidden">
        <SiteHeader variant="overlay" />

        {/* 背景层 - 三级降级 */}
        <div className="absolute inset-0 z-0">
          {heroAssets.video ? (
            <video
              ref={heroVideoRef}
              autoPlay={!reduce} muted loop playsInline
              className="absolute inset-0 w-full h-full object-cover"
              poster={heroAssets.cover ? '/hero-cover.jpg' : undefined}
            >
              <source src="/hero-loop.mp4" type="video/mp4" />
            </video>
          ) : heroAssets.cover ? (
            // v10.2.6: 首屏 hero 兜底图用 next/image(fill + priority)= 真正的 LCP 优化(srcset/尺寸/优先加载);
            // 其余 56 处动态生成 URL + 5 处 data: URI 不适用 next/image(data: 会报错、内容寻址 URL 多一跳),保留 lazy <img>。
            <Image src="/hero-cover.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
          ) : (
            // 品牌渐变兜底: 金雾 + 深蓝 + 墨绿,模拟山雾骑士氛围
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(ellipse at 50% 35%, rgba(232,197,71,0.35) 0%, transparent 55%),
                  radial-gradient(ellipse at 30% 80%, rgba(77,224,194,0.18) 0%, transparent 60%),
                  linear-gradient(180deg, #0A0F1C 0%, #1A1F2E 40%, #0C0C0C 100%)
                `,
              }}
            >
              <div
                className="absolute inset-0 opacity-[0.12]"
                suppressHydrationWarning
                style={{ backgroundImage: `url("${IMG_BG_TEXTURE}")` }}
              />
            </div>
          )}
          {/* 深色渐变压层 - 保证文字可读 */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/70" />
          {/* 顶部轻微暗角 */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55)_100%)]" />
        </div>

        {/* 前景层 - 居中品牌 */}
        <div className="relative z-10 flex flex-col items-center justify-center h-full px-[5vw] text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] tracking-[0.3em] uppercase mb-8 text-white/80">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E8C547] animate-pulse" />
            AI Animation Agent Studio
          </div>

          <h1
            className="text-[clamp(56px,10vw,140px)] font-bold leading-[0.9] mb-6 tracking-tight"
            style={{ textShadow: '0 4px 40px rgba(0,0,0,0.5)' }}
          >
            <span className="brand-gradient">青枫</span>
            <span className="text-white/95 ml-3">漫剧</span>
          </h1>

          <p
            className="text-white/85 text-[clamp(15px,1.6vw,20px)] max-w-[640px] leading-relaxed mb-2 font-light"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
          >
            {t.home.heroTagline1}
          </p>
          <p
            className="text-white/65 text-[clamp(13px,1.3vw,16px)] max-w-[640px] leading-relaxed mb-10 font-light"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
          >
            {t.home.heroTagline2}
          </p>

          <div className="flex gap-4 items-center flex-wrap justify-center">
            <Link
              href="/dashboard/create"
              className="btn-primary px-8 py-4 rounded-2xl text-sm inline-flex items-center gap-2 shadow-2xl shadow-[#E8C547]/20 hover:scale-[1.03] transition-transform"
            >
              {t.home.heroCtaCreate}
            </Link>
            <Link
              href="/cases"
              className="px-8 py-4 rounded-2xl text-sm inline-flex items-center gap-2 text-white/90 hover:text-white bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/15 hover:border-white/30 transition-all"
            >
              {t.home.heroCtaCases}
            </Link>
          </div>

          {/* v10.5.2 定位改版:制作台是主角,生成层 = BYO 当下最强引擎。
              ⭐ 常驻刷新位:每次 GitHub 同步联网核实并更新下列引擎阵容
              (与 README「vs. competitors」表 / MARKETING-zh|en / modelscope-profile 同步刷)。
              当前阵容联网核验于 2026-07-04:文生视频 Kling v3 守榜、**图生视频榜首易主 Seedance 2.0(Dreamina,双榜第一)**,
              Grok Imagine 1.5 次席、Veo 3.1 画质/物理王者、LTX-2 开源权重最强(可自托管);
              HappyHorse-1.1 回榜前列且已出官方公开 API(fal 伙伴,i2v/ref2v/t2v/video-edit)→ 入 chips。 */}
          <div className="mt-9 flex flex-col items-center gap-2.5">
            <span className="text-[10px] tracking-[0.25em] uppercase text-white/60" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              {t.home.heroEngines}
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              {['Seedance 2.0', 'Kling 3.0', 'Grok Imagine 1.5', 'Veo 3.1', 'HappyHorse-1.1', 'LTX-2'].map((e) => (
                <span
                  key={e}
                  className="px-3 py-1 rounded-full border border-white/15 bg-white/5 backdrop-blur-md text-[11px] text-white/80"
                  style={{ textShadow: '0 1px 6px rgba(0,0,0,0.4)' }}
                >
                  {e}
                </span>
              ))}
            </div>
          </div>

          {/* 数据条 - 放到底部,半透明 */}
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex gap-8 flex-wrap justify-center">
            {heroStats.map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center gap-0.5 px-4"
                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
              >
                <span className="text-xl font-bold text-white/95">{s.value}</span>
                <small className="text-[11px] text-white/60 tracking-wider uppercase">{s.label}</small>
              </div>
            ))}
          </div>

          {/* 滚动提示 */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/40 text-xs flex flex-col items-center gap-1 animate-bounce">
            <span>scroll</span>
            <span className="w-px h-6 bg-gradient-to-b from-white/40 to-transparent" />
          </div>
        </div>
      </section>

      {/* ═══ 下方保留原有 sections ═══ */}
      <main id="main-content" tabIndex={-1} className="relative overflow-hidden outline-none">
        <div className="absolute inset-0 bg-no-repeat bg-center opacity-[0.15] pointer-events-none z-0" suppressHydrationWarning style={{backgroundImage: `url("${IMG_BG_TEXTURE}")`}} />

        {/* Feature */}
        <section className="relative z-[1] px-[5vw] py-20">
          <SectionTitle title={t.home.featureTitle} subtitle={t.home.featureSubtitle} />
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(280px,700px)_280px] gap-8 items-center">
              <div className="relative rounded-[30px] overflow-hidden bg-[var(--foreground)] border border-[var(--border)] group">
                <img loading="lazy" decoding="async" src={IMG_FEATURE_MAIN} alt="Feature" className="w-full h-[380px] object-cover transition-transform duration-400 group-hover:scale-[1.03]" />
                <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(232,197,71,0.08),transparent_50%)] pointer-events-none" />
                <button aria-label="播放" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[rgba(255,255,255,0.16)] border border-[var(--border)] w-20 h-20 rounded-full grid place-items-center cursor-pointer hover:bg-[rgba(255,255,255,0.24)] transition-colors"><Play size={28} weight="fill" className="ml-1" /></button>
              </div>
              <div className="flex flex-col gap-4">
                {featureHighlights.map((item) => (
                  <div key={item.title} className="flex gap-3 p-3 rounded-[18px] bg-[var(--surface)] border border-[var(--border)]">
                    <img loading="lazy" decoding="async" src={item.image} alt={item.title} className="w-[72px] h-[72px] rounded-[14px] object-cover" />
                    <div>
                      <h4 className="text-sm font-semibold mb-1">{item.title}</h4>
                      <p className="text-xs text-[var(--soft)]">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Agents */}
        <section className="relative z-[1] px-[5vw] py-20">
          <SectionTitle title={t.home.agentsTitle} subtitle={t.home.agentsSubtitle} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {agentCards.map((agent) => (
              <GlassCard key={agent.title} className="group cursor-default">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold">{agent.title}</span>
                  <span className="w-2 h-2 bg-[#E8C547] rounded-full shadow-[0_0_8px_rgba(232,197,71,0.5)]" />
                </div>
                <p className="text-sm text-[var(--muted)] mb-3">{agent.desc}</p>
                <img loading="lazy" decoding="async" src={agent.image} alt={agent.title} className="rounded-[18px] h-[140px] w-full object-cover mt-auto" />
              </GlassCard>
            ))}
          </div>
        </section>

        {/* Lens */}
        <section className="relative z-[1] px-[5vw] py-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="border-[3px] border-[var(--primary)] rounded-[40px] p-[18px] bg-[var(--foreground)]">
                <img loading="lazy" decoding="async" src={IMG_LENS_MAIN} alt="Lens" className="rounded-[30px] h-[320px] w-full object-cover" />
              </div>
              <p className="mt-4 text-[var(--soft)] text-sm">{t.home.lensCaption}</p>
            </div>
            <div>
              <h2 className="text-[clamp(28px,3vw,46px)] font-bold mb-3 brand-gradient">{t.home.lensTitle}</h2>
              <p className="text-[var(--muted)] mb-5">{t.home.lensDesc}</p>
              <div className="flex gap-3 flex-wrap">
                <span className="px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.1)] text-xs">35mm / Dolly / Wide</span>
                <span className="px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.1)] text-xs">Low angle</span>
                <span className="px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.1)] text-xs">Soft grain</span>
              </div>
            </div>
          </div>
        </section>

        {/* Frame */}
        <section className="relative z-[1] px-[5vw] py-20 text-center">
          <SectionTitle title={t.home.frameTitle} subtitle={t.home.frameSubtitle} />
          <div className="flex gap-5 justify-center flex-wrap mb-8">
            {[
              { num: '01', tilt: '-rotate-6' },
              { num: '02', tilt: '' },
              { num: '03', tilt: 'rotate-6' },
            ].map((item, i) => (
              <GlassCard key={item.num} className={`w-[240px] text-center ${item.tilt}`}>
                <div className="w-12 h-12 rounded-2xl bg-[rgba(255,255,255,0.1)] grid place-items-center mx-auto mb-5 text-lg font-bold">{item.num}</div>
                <p className="font-semibold mb-1.5">{t.home.frameSteps[i].title}</p>
                <span className="text-[var(--soft)] text-[13px]">{t.home.frameSteps[i].desc}</span>
              </GlassCard>
            ))}
          </div>
          <Link href="/dashboard/create" className="btn-primary px-6 py-3 rounded-2xl text-sm inline-block">{t.home.frameCta}</Link>
        </section>

        {/* Vibe */}
        <section className="relative z-[1] px-[5vw] py-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="grid gap-3.5">
              {vibeShots.map((shot) => (
                <div key={shot.title} className="relative rounded-[26px] overflow-hidden border border-[var(--border)]">
                  <img loading="lazy" decoding="async" src={shot.image} alt={shot.title} className="h-[200px] w-full object-cover" />
                  <span className="absolute bottom-3 left-3 px-2.5 py-1.5 bg-[rgba(0,0,0,0.5)] rounded-xl text-xs">{shot.title}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[var(--soft)] uppercase tracking-[0.2em] text-xs mb-2">{t.home.vibeKicker}</p>
              <h2 className="text-[clamp(28px,3vw,46px)] font-bold mb-3 brand-gradient">{t.home.vibeTitle}</h2>
              <p className="text-[var(--muted)] mb-5">{t.home.vibeDesc}</p>
              <div className="flex gap-3 flex-wrap">
                <span className="px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.1)] text-xs">Ambient 75%</span>
                <span className="px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.1)] text-xs">Tempo 110</span>
                <span className="px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.1)] text-xs">Color Grade Film</span>
              </div>
            </div>
          </div>
        </section>

        {/* Cases */}
        <section className="relative z-[1] px-[5vw] py-20 text-center">
          <SectionTitle title={t.home.casesTitle} subtitle={t.home.casesSubtitle} />
          <div className="flex justify-between items-center gap-3 px-5 py-3 rounded-lg bg-[rgba(232,197,71,0.08)] border border-[rgba(232,197,71,0.2)] text-[rgba(232,197,71,0.9)] text-[13px] mb-6">
            <span>QingFeng Manju Studio · AI Animation Agent Team</span>
            <span className="font-bold text-[#E8C547] underline cursor-pointer">{t.home.casesTryNow}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
            {(cases.length ? cases : featureHighlights.map((f, i) => ({ id: String(i), title: f.title, coverUrl: f.image, category: 'AI Short' }))).map((item: any) => (
              <div key={item.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-[20px] overflow-hidden text-left group transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
                <div className="relative h-[180px] overflow-hidden">
                  {playingCase === item.id && item.videoUrl ? (
                    <video src={item.videoUrl} className="w-full h-full object-cover bg-black" autoPlay loop playsInline controls />
                  ) : (
                    <>
                      {/* v9.5.5 修复:有视频的卡片静音循环自动播放真片段,而非 gradient 占位 */}
                      {item.videoUrl ? (
                        <video src={item.videoUrl} className="w-full h-full object-cover bg-black transition-transform duration-300 group-hover:scale-105" autoPlay={!reduce} muted loop playsInline preload="metadata" />
                      ) : (
                        <img loading="lazy" decoding="async" src={item.coverUrl || item.image} alt={item.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      )}
                      {item.videoUrl && (
                        <>
                          <span className="absolute top-2.5 left-2.5 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white/80 border border-white/10 backdrop-blur-sm">示意片段</span>
                          <button
                            aria-label="有声播放"
                            onClick={() => setPlayingCase(item.id)}
                            className="absolute top-2.5 right-2.5 z-10 text-[10px] px-2 py-1 rounded-full bg-black/55 text-white/90 border border-white/15 backdrop-blur-sm inline-flex items-center gap-1 cursor-pointer hover:bg-black/75 transition-all"
                          >
                            <Play size={10} weight="fill" /> 有声播放
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                <div className="p-4">
                  <span className="text-xs text-[var(--soft)]">{item.category || 'AI Short'}</span>
                  <h4 className="font-semibold mt-2">{item.title}</h4>
                </div>
              </div>
            ))}
          </div>
          <Link href="/cases" className="btn-ghost px-5 py-2.5 rounded-2xl text-sm inline-block">{t.common.viewAll}</Link>
        </section>

        {/* CTA */}
        <section className="relative z-[1] px-[5vw] py-20 pb-[120px]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-5 p-10 rounded-[20px] bg-[linear-gradient(120deg,rgba(232,197,71,0.08),rgba(200,67,42,0.06))] border-[1.5px] border-[var(--border)]">
            <div>
              <h2 className="text-[clamp(28px,3vw,42px)] font-bold mb-2">{t.home.ctaTitle}</h2>
              <p className="text-[var(--muted)]">{t.home.ctaDesc}</p>
            </div>
            <Link href="/dashboard" className="btn-primary px-8 py-3.5 rounded-2xl text-sm shrink-0">{t.home.ctaButton}</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
