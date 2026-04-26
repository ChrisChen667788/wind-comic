'use client';

/**
 * 剧本润色 · Polish Studio (v2.11 #5 行业级升级)
 *
 * 独立于完整 Agent 管线的轻量工具。用户可以:
 *   1. 从项目自动导入现有剧本(带 ?projectId=xxx 跳转进来),
 *      或直接在左侧贴文本
 *   2. 选择 Basic (快) / Pro (行业级) 两档模式
 *   3. 选择目标风格 (文艺/商业/悬疑/喜剧/纪实/诗意) + 润色力度(轻/中/重)
 *   4. 点"开始润色" → 右侧渲染结果 + 改动点列表 + Pro 模式额外出行业诊断
 *
 * 两档模式:
 *   Basic → 快而便宜 (15-40s), 只打磨文字
 *   Pro   → 行业级 (60-180s), 按 McKee/Field/Seger + 漫剧节奏 + AIGC 管线就绪度
 *           标准改写, 并给出一份完整行业诊断体检单
 *
 * 用于什么场景:
 *   - 用户有手写大纲/散文段, 想一键提升画面感再送入 Writer
 *   - 已有剧本但节奏/语气偏, 想切到另一个风格试试
 *   - Pro: 想对完整剧本做一次"上管线前的 QA 体检"
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, Copy, Check, RotateCcw, ArrowRightLeft, Wand2,
  FileText, AlertCircle, Loader2, Download, Stethoscope, Gauge,
  Save, X, FileDiff, AlignJustify, FileDown, History, StopCircle,
  Library,
} from 'lucide-react';
import IndustryAuditCard, { type PolishAudit } from '@/components/polish/IndustryAuditCard';
import DiffPanel from '@/components/polish/DiffPanel';
import PolishHistoryPanel, { type PolishHistoryEntry } from '@/components/polish/PolishHistoryPanel';
import { auditToMarkdown } from '@/lib/audit-markdown';
import { buildPolishDocxHtml } from '@/lib/polish-docx';

type Style = 'literary' | 'commercial' | 'thriller' | 'comedy' | 'documentary' | 'poetic';
type Intensity = 'light' | 'moderate' | 'heavy';
type Mode = 'basic' | 'pro';

const STYLES: { value: Style; label: string; hint: string }[] = [
  { value: 'literary',    label: '文艺',   hint: '意象 · 留白' },
  { value: 'commercial',  label: '商业',   hint: '爽点 · 节奏' },
  { value: 'thriller',    label: '悬疑',   hint: '信息差 · 压抑' },
  { value: 'comedy',      label: '喜剧',   hint: '反差 · 轻盈' },
  { value: 'documentary', label: '纪实',   hint: '客观 · 克制' },
  { value: 'poetic',      label: '诗意',   hint: '韵律 · 象征' },
];

const INTENSITIES: { value: Intensity; label: string; hint: string }[] = [
  { value: 'light',    label: '轻度', hint: '只改词句' },
  { value: 'moderate', label: '中度', hint: '调整语序' },
  { value: 'heavy',    label: '重度', hint: '可重写段落' },
];

interface PolishResult {
  polished: string;
  summary?: string;
  notes?: string[];
  audit?: PolishAudit | null;
  mode?: Mode;
  elapsedMs?: number;
  model?: string;
  /** true 时代表模型输出的 JSON 结构有瑕疵,后端做了正则/修复兜底 */
  degraded?: boolean;
}

export default function PolishPage() {
  const search = useSearchParams();
  const projectId = search.get('projectId') || '';

  const [source, setSource] = useState('');
  const [mode, setMode] = useState<Mode>('basic');
  const [style, setStyle] = useState<Style | ''>('');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [focus, setFocus] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PolishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [projectScriptName, setProjectScriptName] = useState<string | null>(null);
  // 回写项目(Pro/Basic 都可用)
  const [projectScriptAssetId, setProjectScriptAssetId] = useState<string | null>(null);
  const [projectScriptAssetData, setProjectScriptAssetData] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<'ok' | 'err' | null>(null);
  const [saveMsg, setSaveMsg] = useState<string>('');
  // 正文视图切换: full (整块) / diff (左右对比)
  // v2.11 #1a: 默认 'diff', 让用户一打开就看到改动 — 用户反馈 "应该高亮改动的部分"
  const [resultView, setResultView] = useState<'full' | 'diff'>('diff');
  // 中途取消: AbortController 引用, 当前请求实例
  const abortRef = useRef<AbortController | null>(null);
  // 保存到素材库
  const [savingToLib, setSavingToLib] = useState(false);
  const [savedToLib, setSavedToLib] = useState<'ok' | 'err' | null>(null);
  const [savedToLibMsg, setSavedToLibMsg] = useState<string>('');
  // 历史面板开关
  const [showHistory, setShowHistory] = useState(false);
  // "从历史载入的版本"标记, 提示用户当前看到的是旧版本而非刚跑出来的
  const [viewingHistoryAt, setViewingHistoryAt] = useState<string | null>(null);
  // 从 audit 卡片里点"查找"时的关键词, 会把 polished 正文中的匹配段 <mark> 高亮
  const [highlightKeyword, setHighlightKeyword] = useState<string>('');

  // 若带了 ?projectId= ,尝试拉该项目的剧本原文
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const res = await fetch(`/api/assets?projectId=${encodeURIComponent(projectId)}&type=script`);
        const arr = await res.json();
        if (!Array.isArray(arr) || arr.length === 0) return;
        const scriptAsset = arr[0];
        const seed = assembleScript(scriptAsset.data);
        if (seed) {
          setSource(seed);
          setProjectScriptName(scriptAsset.name || scriptAsset.data?.title || '项目剧本');
          setProjectScriptAssetId(scriptAsset.id);
          setProjectScriptAssetData(scriptAsset.data || {});
        }
      } catch {
        // 静默失败 — 不影响手工输入
      }
    })();
  }, [projectId]);

  const charCount = source.length;
  const overLimit = charCount > 32000;

  const canRun = useMemo(
    () => source.trim().length >= 20 && !loading && !overLimit,
    [source, loading, overLimit],
  );

  const handlePolish = async () => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setViewingHistoryAt(null);
    setHighlightKeyword('');
    // v2.11 #1a: 用 AbortController 让用户能中途停止, 改设置后再跑
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/polish-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: source,
          mode,
          style: style || undefined,
          intensity,
          focus: focus.trim() || undefined,
        }),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `润色失败 (${res.status})`);
        return;
      }
      setResult(data);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setError('已停止 · 你可以改设置后再点"开始润色"');
      } else {
        setError(e?.message || '网络异常');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  /** 中途停止当前润色请求, 不影响已选好的参数 */
  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  const handleCopy = () => {
    if (!result?.polished) return;
    navigator.clipboard.writeText(result.polished).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleReplace = () => {
    if (!result?.polished) return;
    setSource(result.polished);
    setResult(null);
  };

  const handleDownload = () => {
    if (!result?.polished) return;
    const blob = new Blob([result.polished], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polished-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * 导出为 Word (.doc) — 用 Word 原生的 HTML+namespace 格式, Word/WPS/Pages/Google Docs 都能直接打开。
   * 不引入新 npm 依赖, 体积接近 markdown 但保留排版样式 (标题层级 / 表格 / 列表 / 块引用)。
   */
  const handleExportDocx = () => {
    if (!result?.polished) return;
    const html = buildPolishDocxHtml({
      projectTitle: projectScriptName || undefined,
      mode: result.mode,
      style: style || null,
      intensity,
      focus: focus.trim() || null,
      model: result.model,
      at: new Date().toISOString(),
      polished: result.polished,
      summary: result.summary,
      notes: result.notes,
      audit: result.audit,
    });
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suffix = result.mode === 'pro' ? 'audit' : 'polished';
    const titleSlug = projectScriptName ? `-${projectScriptName.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}` : '';
    a.href = url;
    a.download = `${suffix}${titleSlug}-${Date.now()}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * 保存到全局素材库 — 把这次润色作为可跨项目复用的"剧本素材"。
   * 写入到 global_assets, type='style' (没有 'script' type, 用 'style' 当通用槽);
   * 实际取决于现有 type 枚举, 这里保守用 metadata 区分。
   */
  const handleSaveToLibrary = async () => {
    if (!result?.polished || savingToLib) return;
    setSavingToLib(true);
    setSavedToLib(null);
    setSavedToLibMsg('');
    try {
      const name = projectScriptName
        ? `${projectScriptName} · ${result.mode === 'pro' ? 'Pro 体检' : '润色'}`
        : `润色稿 ${new Date().toLocaleDateString('zh-CN')}`;
      const res = await fetch('/api/global-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'style',
          name: name.slice(0, 80),
          description: (result.summary || '').slice(0, 300),
          tags: [
            'polish',
            result.mode || 'basic',
            ...(style ? [String(style)] : []),
          ],
          metadata: {
            kind: 'polish-script',
            polished: result.polished,
            audit: result.audit,
            notes: result.notes,
            model: result.model,
            mode: result.mode,
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || `保存失败 (${res.status})`);
      }
      setSavedToLib('ok');
      setSavedToLibMsg(`已存到素材库 · 之后可在新项目里直接引用`);
      setTimeout(() => setSavedToLib(null), 3500);
    } catch (e: any) {
      setSavedToLib('err');
      setSavedToLibMsg(e?.message || '保存失败');
      setTimeout(() => setSavedToLib(null), 5000);
    } finally {
      setSavingToLib(false);
    }
  };

  /** 把本次润色(及可选的 audit)导出为 Markdown 体检报告 —— 可直接发飞书/Notion/GitHub */
  const handleExportMarkdown = () => {
    if (!result?.polished) return;
    const md = auditToMarkdown({
      projectTitle: projectScriptName || undefined,
      mode: result.mode,
      style: style || null,
      intensity,
      focus: focus.trim() || null,
      model: result.model,
      at: new Date().toISOString(),
      polished: result.polished,
      summary: result.summary,
      notes: result.notes,
      audit: result.audit,
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suffix = result.mode === 'pro' ? 'audit' : 'polished';
    const titleSlug = projectScriptName ? `-${projectScriptName.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}` : '';
    a.href = url;
    a.download = `${suffix}${titleSlug}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setSource('');
    setResult(null);
    setError(null);
    setMode('basic');
    setStyle('');
    setIntensity('moderate');
    setFocus('');
    setSaved(null);
    setSaveMsg('');
    setViewingHistoryAt(null);
    setHighlightKeyword('');
  };

  /**
   * 把润色结果(+ Pro audit)作为 sidecar 写回项目 script asset。
   *
   * 策略: 绝不改 data.shots[] (shots 上挂着镜头资产, 改动会破坏链接),
   * 只把本次润色塞进 data.polishHistory[] (最多保留 10 条), 并把
   * 最新一条指到 data.latestPolish, 项目详情页可按需消费。
   */
  const handleSaveToProject = async () => {
    if (!result?.polished || !projectId || !projectScriptAssetId) return;
    setSaving(true);
    setSaved(null);
    setSaveMsg('');
    try {
      const entry = {
        at: new Date().toISOString(),
        mode: result.mode || mode,
        style: style || null,
        intensity,
        focus: focus.trim() || null,
        polished: result.polished,
        summary: result.summary || '',
        notes: result.notes || [],
        audit: result.audit || null,
        elapsedMs: result.elapsedMs,
        model: result.model,
      };

      const prev = projectScriptAssetData || {};
      const history = Array.isArray(prev.polishHistory) ? prev.polishHistory : [];
      const newData = {
        ...prev,
        latestPolish: entry,
        // 倒序 — 最新在前, 超过 10 条截断 (避免 asset.data 无限膨胀)
        polishHistory: [entry, ...history].slice(0, 10),
      };

      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: projectScriptAssetId, data: newData }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `写入失败 (${res.status})`);
      }

      setProjectScriptAssetData(newData);
      setSaved('ok');
      setSaveMsg(
        entry.mode === 'pro' && entry.audit?.aigcReadiness?.score != null
          ? `已写回项目 · AIGC 就绪度 ${entry.audit.aigcReadiness.score}`
          : '已写回项目 · 下次打开还能看到'
      );
      setTimeout(() => setSaved(null), 3500);
    } catch (e: any) {
      setSaved('err');
      setSaveMsg(e?.message || '写入失败');
      setTimeout(() => setSaved(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  /**
   * audit 卡里点"🔍 查找" — 把关键词存到 state, 结果区会给 <pre> / DiffPanel 注入 <mark> 高亮,
   * 并且自动切到"整块"视图, 因为 DiffPanel 按行显示可能把一句对白切到不同行, 不好看出匹配。
   */
  const handleAuditSearch = (keyword: string) => {
    const kw = (keyword || '').trim();
    if (!kw) return;
    setHighlightKeyword(kw);
    setResultView('full');
    // 滚动到结果区(如果用户不在视口里)
    if (typeof document !== 'undefined') {
      const target = document.getElementById('polish-result-body');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  /** audit 卡里点"＋" — 把关键词追加到"特别要求"输入框, 用 "; " 分隔且去重 */
  const handleAuditAddToFocus = (keyword: string) => {
    const kw = (keyword || '').trim();
    if (!kw) return;
    setFocus((prev) => {
      const parts = (prev || '')
        .split(/[；;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.includes(kw)) return prev; // 已存在不重复添加
      const next = [...parts, kw].join('; ');
      // 300 字上限防溢出
      return next.length > 300 ? next.slice(0, 300) : next;
    });
  };

  /**
   * 把一条历史记录"加载"回右侧结果区 —— 纯前端切换, 不触发任何保存。
   * 用户可以在这里看完旧版本后决定要不要再润一次, 或者替换原文继续迭代。
   */
  const handleViewHistory = (entry: PolishHistoryEntry) => {
    if (!entry.polished) return;
    setResult({
      polished: entry.polished,
      summary: entry.summary,
      notes: entry.notes,
      audit: entry.audit,
      mode: entry.mode,
      model: entry.model,
      elapsedMs: entry.elapsedMs,
    });
    // 同步风格/力度/focus, 让用户一眼知道那次是什么参数
    if (entry.style !== undefined) setStyle((entry.style as Style) || '');
    if (entry.intensity) setIntensity(entry.intensity as Intensity);
    if (entry.focus !== undefined && entry.focus !== null) setFocus(entry.focus);
    if (entry.mode) setMode(entry.mode);
    setViewingHistoryAt(entry.at || null);
    setError(null);
  };

  /**
   * 把历史版本的 polished 作为新原文, 让用户在它基础上继续润色。
   * 原本"原文→润色"变成"某次润色→下一次润色", 支持迭代工作流。
   */
  const handleRestoreHistoryAsSource = (entry: PolishHistoryEntry) => {
    if (!entry.polished) return;
    setSource(entry.polished);
    setResult(null);
    setViewingHistoryAt(null);
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* 标题区 */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-[#E8C547]" />
            剧本润色
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            保结构不动情节 · Basic 轻打磨 / Pro 附行业级诊断
            {projectScriptName ? (
              <span className="ml-2 text-[#E8C547]">· 已从项目《{projectScriptName}》导入</span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 历史: 有历史且在项目语境下才显示 */}
          {projectId && (projectScriptAssetData?.polishHistory?.length || 0) > 0 ? (
            <button
              onClick={() => setShowHistory(true)}
              className="px-3 py-1.5 rounded-lg text-xs text-violet-200 hover:text-violet-100 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/25 transition-colors flex items-center gap-1.5"
              title="查看此项目最近 10 次润色记录, 支持恢复到任意版本"
            >
              <History className="w-3.5 h-3.5" />
              历史 ({projectScriptAssetData.polishHistory.length})
            </button>
          ) : null}
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1.5"
            title="清空所有输入"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置
          </button>
        </div>
      </div>

      {/* 控制面板 */}
      <div className="mb-5 p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-4">
        {/* 模式切换: Basic / Pro */}
        <div>
          <label className="text-[11px] text-[var(--muted)] tracking-wider uppercase block mb-2">
            润色档位
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => setMode('basic')}
              className={`text-left p-3 rounded-xl border transition-all ${
                mode === 'basic'
                  ? 'bg-[#E8C547]/10 border-[#E8C547]/40 shadow-[0_0_0_1px_rgba(232,197,71,0.2)]'
                  : 'bg-white/3 border-white/10 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Gauge className={`w-4 h-4 ${mode === 'basic' ? 'text-[#E8C547]' : 'text-white/50'}`} />
                <span className={`text-sm font-semibold ${mode === 'basic' ? 'text-[#E8C547]' : 'text-white/80'}`}>
                  Basic
                </span>
                <span className="ml-auto text-[10px] text-white/40 tabular-nums">15-40s</span>
              </div>
              <p className="text-[11px] text-white/55 leading-relaxed">
                快速打磨词句 · 不改结构 · 适合小改和风格切换
              </p>
            </button>
            <button
              onClick={() => setMode('pro')}
              className={`text-left p-3 rounded-xl border transition-all relative overflow-hidden ${
                mode === 'pro'
                  ? 'bg-gradient-to-br from-violet-500/15 to-rose-500/10 border-violet-400/40 shadow-[0_0_0_1px_rgba(167,139,250,0.25)]'
                  : 'bg-white/3 border-white/10 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Stethoscope className={`w-4 h-4 ${mode === 'pro' ? 'text-violet-300' : 'text-white/50'}`} />
                <span className={`text-sm font-semibold ${mode === 'pro' ? 'text-violet-200' : 'text-white/80'}`}>
                  Pro · 行业级
                </span>
                <span className="ml-auto text-[10px] text-white/40 tabular-nums">60-180s</span>
              </div>
              <p className="text-[11px] text-white/55 leading-relaxed">
                McKee 三幕 + 漫剧节奏 + AIGC 管线就绪度 · 附完整诊断体检单
              </p>
            </button>
          </div>
        </div>

        {/* 风格 */}
        <div>
          <label className="text-[11px] text-[var(--muted)] tracking-wider uppercase block mb-2">
            目标风格 <span className="text-[#E8C547]/60 normal-case">(可选, 不选则保持原风格)</span>
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setStyle('')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                style === ''
                  ? 'bg-[#E8C547]/20 text-[#E8C547] border-[#E8C547]/30'
                  : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'
              }`}
            >
              保持原风格
            </button>
            {STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => setStyle(s.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                  style === s.value
                    ? 'bg-[#E8C547]/20 text-[#E8C547] border-[#E8C547]/30'
                    : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'
                }`}
                title={s.hint}
              >
                {s.label}
                <span className="ml-1.5 opacity-50 text-[10px]">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 力度 */}
        <div>
          <label className="text-[11px] text-[var(--muted)] tracking-wider uppercase block mb-2">
            润色力度
          </label>
          <div className="flex gap-2 flex-wrap">
            {INTENSITIES.map((it) => (
              <button
                key={it.value}
                onClick={() => setIntensity(it.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                  intensity === it.value
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                    : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'
                }`}
                title={it.hint}
              >
                {it.label}
                <span className="ml-1.5 opacity-50 text-[10px]">{it.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 特别要求 */}
        <div>
          <label className="text-[11px] text-[var(--muted)] tracking-wider uppercase block mb-2">
            特别要求 <span className="text-[#E8C547]/60 normal-case">(可选)</span>
          </label>
          <input
            type="text"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder='例: "强化视觉感" / "把第三人称改成第一人称" / "多加潜台词"'
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-[var(--border)] text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#E8C547]/50"
            maxLength={300}
          />
        </div>
      </div>

      {/* 对比面板 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 左:原文 */}
        <div className="flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden min-h-[520px]">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-300" />
              <span className="text-sm font-medium text-white">原文</span>
              <span className={`text-[11px] font-mono ${overLimit ? 'text-red-400' : 'text-[var(--muted)]'}`}>
                {charCount} / 32000
              </span>
            </div>
            {source ? (
              <button
                onClick={() => setSource('')}
                className="text-[11px] text-[var(--muted)] hover:text-white transition-colors"
              >
                清空
              </button>
            ) : null}
          </div>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={`在此粘贴剧本原文 (至少 20 字)…\n\n支持:\n  · 纯文本故事/大纲\n  · 带 "Shot N / 场景 / 对白" 等标签的分镜格式\n  · McKee 三幕结构\n\n润色会保留所有结构标签,只优化内文。`}
            className="flex-1 w-full resize-none p-4 bg-transparent text-sm text-white/90 placeholder:text-white/25 leading-relaxed focus:outline-none font-[ui-monospace,SFMono-Regular,Menlo,monospace]"
            spellCheck={false}
          />
          <div className="px-4 py-3 border-t border-[var(--border)] bg-black/20 flex justify-between items-center">
            <span className="text-[11px] text-[var(--muted)]">
              {projectId ? '来源: 项目导入' : '来源: 手工输入'}
            </span>
            {loading ? (
              // v2.11 #1a: 跑动中显示"停止"红按钮 — 用户可中途取消改设置
              <button
                onClick={handleStop}
                className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-br from-rose-500 to-red-600 text-white hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-rose-500/25"
                title="中途停止本次润色 (改设置后可重新开始)"
              >
                <StopCircle className="w-4 h-4" />
                停止 · {mode === 'pro' ? '跑诊断中…' : '润色中…'}
              </button>
            ) : (
              <button
                onClick={handlePolish}
                disabled={!canRun}
                className={`px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all flex items-center gap-2 shadow-lg ${
                  mode === 'pro'
                    ? 'bg-gradient-to-br from-violet-500 to-rose-500 text-white shadow-violet-500/25'
                    : 'bg-gradient-to-br from-[#E8C547] to-[#D4A830] text-black shadow-[#E8C547]/20'
                }`}
              >
                {mode === 'pro' ? (
                  <>
                    <Stethoscope className="w-4 h-4" />
                    Pro 润色 + 诊断
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    开始润色
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 右:结果 */}
        <div className="flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden min-h-[520px]">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#E8C547]" />
              <span className="text-sm font-medium text-white">润色结果</span>
              {result?.elapsedMs ? (
                <span className="text-[11px] font-mono text-[var(--muted)]">
                  {(result.elapsedMs / 1000).toFixed(1)}s · {result.model?.slice(0, 24)}
                </span>
              ) : null}
            </div>
            {result ? (
              <div className="flex items-center gap-1 flex-wrap">
                {/* 回写项目 — 仅当从项目导入时可见 */}
                {projectId && projectScriptAssetId ? (
                  <button
                    onClick={handleSaveToProject}
                    disabled={saving}
                    className={`px-2.5 py-1 rounded-md transition-colors text-[11px] flex items-center gap-1 border ${
                      saved === 'ok'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : saved === 'err'
                          ? 'bg-red-500/15 text-red-300 border-red-500/30'
                          : 'bg-violet-500/10 text-violet-200 border-violet-500/30 hover:bg-violet-500/20'
                    } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
                    title={`回写到项目《${projectScriptName}》的 script asset (追加到 polishHistory, 不会覆盖 shots)`}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        写入中
                      </>
                    ) : saved === 'ok' ? (
                      <>
                        <Check className="w-3 h-3" />
                        已写回
                      </>
                    ) : saved === 'err' ? (
                      <>
                        <X className="w-3 h-3" />
                        失败
                      </>
                    ) : (
                      <>
                        <Save className="w-3 h-3" />
                        回写项目
                      </>
                    )}
                  </button>
                ) : null}
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] text-white/70 flex items-center gap-1"
                  title="复制全文"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? '已复制' : '复制'}
                </button>
                <button
                  onClick={handleDownload}
                  className="px-2.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] text-white/70 flex items-center gap-1"
                  title="下载润色后剧本 .txt"
                >
                  <Download className="w-3 h-3" />
                  .txt
                </button>
                <button
                  onClick={handleExportMarkdown}
                  className="px-2.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] text-white/70 flex items-center gap-1"
                  title="导出为 Markdown 体检报告(含 Pro 诊断), 可直接发飞书/Notion"
                >
                  <FileDown className="w-3 h-3" />
                  .md
                </button>
                <button
                  onClick={handleExportDocx}
                  className="px-2.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] text-white/70 flex items-center gap-1"
                  title="导出为 Word .doc (Word / WPS / Pages 都能直接打开)"
                >
                  <FileDown className="w-3 h-3" />
                  .doc
                </button>
                <button
                  onClick={handleSaveToLibrary}
                  disabled={savingToLib}
                  className={`px-2.5 py-1 rounded-md transition-colors text-[11px] flex items-center gap-1 border ${
                    savedToLib === 'ok'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : savedToLib === 'err'
                        ? 'bg-red-500/15 text-red-300 border-red-500/30'
                        : 'bg-white/5 text-white/70 border-transparent hover:bg-white/10'
                  } ${savingToLib ? 'opacity-60 cursor-not-allowed' : ''}`}
                  title="保存到我的全局素材库, 之后在新项目可作为参考剧本复用"
                >
                  {savingToLib ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : savedToLib === 'ok' ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Library className="w-3 h-3" />
                  )}
                  {savingToLib ? '存中…' : savedToLib === 'ok' ? '已存' : '存素材库'}
                </button>
                <button
                  onClick={handleReplace}
                  className="px-2.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] text-white/70 flex items-center gap-1"
                  title="把润色结果回填到左侧原文框"
                >
                  <ArrowRightLeft className="w-3 h-3" />
                  替换原文
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto">
            {error ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400/60" />
                <p className="text-sm text-red-300">{error}</p>
                <p className="text-[11px] text-[var(--muted)]">请检查 OPENAI_API_KEY 配置, 或稍后重试</p>
              </div>
            ) : loading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
                <Loader2 className={`w-8 h-8 animate-spin ${mode === 'pro' ? 'text-violet-300' : 'text-[#E8C547]'}`} />
                <p className="text-sm text-white/70">
                  {mode === 'pro'
                    ? '正在跑行业级诊断, 一般需要 60-180 秒…'
                    : '正在润色中, 一般需要 15-40 秒…'}
                </p>
                {mode === 'pro' ? (
                  <p className="text-[11px] text-white/40 max-w-[300px] text-center">
                    Pro 模式会同时出 Hook/三幕/对白/角色锚/光影/AIGC 就绪度 6 项体检报告
                  </p>
                ) : null}
              </div>
            ) : result ? (
              <div className="p-4 flex flex-col gap-4">
                {/* 如果当前结果来自历史载入, 顶部显著提示, 避免用户误以为是刚跑出来的 */}
                {viewingHistoryAt ? (
                  <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/25 flex gap-2 items-center text-[12px] leading-relaxed text-violet-100">
                    <History className="w-4 h-4 shrink-0" />
                    <span className="flex-1">
                      正在查看历史版本 ·{' '}
                      <span className="font-mono text-violet-200/80">
                        {(() => {
                          try { return new Date(viewingHistoryAt).toLocaleString('zh-CN'); }
                          catch { return viewingHistoryAt; }
                        })()}
                      </span>
                    </span>
                    <button
                      onClick={() => setViewingHistoryAt(null)}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                      title="消除此提示, 但保留当前视图"
                    >
                      知道了
                    </button>
                  </div>
                ) : null}

                {/* 回写反馈 toast */}
                {saved && saveMsg ? (
                  <div
                    className={`p-2.5 rounded-xl flex gap-2 items-start text-[12px] leading-relaxed ${
                      saved === 'ok'
                        ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-200'
                        : 'bg-red-500/10 border border-red-500/25 text-red-200'
                    }`}
                  >
                    {saved === 'ok' ? (
                      <Check className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <span>{saveMsg}</span>
                  </div>
                ) : null}

                {result.degraded ? (
                  <div className="p-3 rounded-xl bg-orange-500/8 border border-orange-500/20 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-orange-200/85 leading-relaxed">
                      模型返回的 JSON 格式有瑕疵(常见于剧本换行未转义),已做兜底提取。
                      若正文错位,建议点"开始润色"重试,或把原文拆成更短的段落。
                    </p>
                  </div>
                ) : null}
                {result.summary ? (
                  <div className="p-3 rounded-xl bg-[#E8C547]/8 border border-[#E8C547]/20">
                    <p className="text-[10px] text-[#E8C547] tracking-wider uppercase mb-1">改动要点</p>
                    <p className="text-sm text-white/90 leading-relaxed">{result.summary}</p>
                  </div>
                ) : null}

                {result.notes && result.notes.length > 0 ? (
                  <div>
                    <p className="text-[10px] text-[var(--muted)] tracking-wider uppercase mb-2">
                      具体调整 ({result.notes.length})
                    </p>
                    <ul className="space-y-1.5">
                      {result.notes.map((n, i) => (
                        <li key={i} className="text-[12px] text-white/75 flex gap-2 leading-relaxed">
                          <span className="text-[#E8C547]/60 font-mono shrink-0">{String(i + 1).padStart(2, '0')}</span>
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-[var(--muted)] tracking-wider uppercase">
                      {resultView === 'diff' ? '原文 vs 润色 · 对比视图' : '润色后全文'}
                    </p>
                    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-black/30 border border-white/5">
                      <button
                        onClick={() => setResultView('full')}
                        className={`px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 transition-colors ${
                          resultView === 'full'
                            ? 'bg-white/10 text-white'
                            : 'text-white/50 hover:text-white/80'
                        }`}
                        title="整块展示润色后全文"
                      >
                        <AlignJustify className="w-3 h-3" />
                        整块
                      </button>
                      <button
                        onClick={() => setResultView('diff')}
                        className={`px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 transition-colors ${
                          resultView === 'diff'
                            ? 'bg-white/10 text-white'
                            : 'text-white/50 hover:text-white/80'
                        }`}
                        title="左右并排对比原文 / 润色, 高亮改动行"
                      >
                        <FileDiff className="w-3 h-3" />
                        对比
                      </button>
                    </div>
                  </div>
                  {highlightKeyword ? (
                    <div className="mb-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center gap-2 text-[11.5px] text-amber-100">
                      <span>正在查找:</span>
                      <code className="px-1.5 py-0.5 rounded bg-black/30 text-amber-200 font-mono">{highlightKeyword}</code>
                      <span className="text-amber-300/60 text-[10.5px] ml-auto tabular-nums">
                        {countMatches(result.polished, highlightKeyword)} 处匹配
                      </span>
                      <button
                        onClick={() => setHighlightKeyword('')}
                        className="text-[10.5px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-white/80"
                      >
                        清除
                      </button>
                    </div>
                  ) : null}
                  {resultView === 'diff' ? (
                    <DiffPanel before={source} after={result.polished} maxHeight="55vh" />
                  ) : (
                    <pre
                      id="polish-result-body"
                      className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap font-[ui-monospace,SFMono-Regular,Menlo,monospace] p-3 rounded-lg bg-black/30 border border-[var(--border)]"
                    >
                      {highlightKeyword
                        ? renderHighlighted(result.polished, highlightKeyword)
                        : result.polished}
                    </pre>
                  )}
                </div>

                {/* Pro 模式: 行业诊断体检单 */}
                {result.mode === 'pro' && result.audit ? (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-3">
                      <Stethoscope className="w-4 h-4 text-violet-300" />
                      <p className="text-[11px] text-violet-300 tracking-widest uppercase">
                        行业级诊断 · Industry Audit
                      </p>
                      <span className="ml-auto text-[10px] text-white/30">
                        McKee · Save the Cat · AIGC pipeline
                      </span>
                    </div>
                    <IndustryAuditCard
                      audit={result.audit}
                      actions={{
                        onSearch: handleAuditSearch,
                        onAddToFocus: handleAuditAddToFocus,
                      }}
                    />
                  </div>
                ) : result.mode === 'pro' && !result.audit && !result.degraded ? (
                  <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-amber-200/85 leading-relaxed">
                      本次未拿到完整诊断结构, 可再跑一次 Pro 模式, 或切到 Basic 先快速打磨。
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Wand2 className="w-10 h-10 text-white/15" />
                <p className="text-sm text-[var(--muted)]">
                  在左侧输入原文 → 选择风格/力度 → 点"开始润色"
                </p>
                <p className="text-[11px] text-white/40 max-w-[280px]">
                  结果会保留段落与分镜结构, 只对文字进行打磨。适合做"先打磨再进管线"的两阶段流程。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 历史面板 modal */}
      {showHistory ? (
        <PolishHistoryPanel
          history={(projectScriptAssetData?.polishHistory || []) as PolishHistoryEntry[]}
          onClose={() => setShowHistory(false)}
          onView={handleViewHistory}
          onRestoreSource={handleRestoreHistoryAsSource}
        />
      ) : null}

      {/* 底部提示 */}
      <div className="mt-6 text-[11px] text-[var(--muted)] flex items-center justify-between flex-wrap gap-2">
        <span>
          Tips: 润色不会改动情节和角色名。Pro 模式额外出一份行业诊断,
          覆盖 Hook / 三幕结构 / 对白问题 / 角色 identity 锚 / 场景光影 / AIGC 就绪度。
          若想对已生成的项目剧本做润色,
          <Link href="/dashboard/projects" className="text-[#E8C547] hover:underline mx-1">去项目页</Link>
          点"润色"按钮跳转回来即可。
        </span>
        <span className="font-mono">max 32,000 chars · {mode === 'pro' ? 'pro: claude-sonnet@0.5°' : 'basic: claude-sonnet@0.7°'}</span>
      </div>
    </div>
  );
}

/**
 * 把 raw text 拆成 [plain, match, plain, match, ...] 的片段, match 用 <mark> 包裹。
 * 用于在润色正文里高亮 audit 点击"🔍 查找"时的关键词。
 *
 * 纯文本匹配 (不开正则), 先做 escapeRegExp 保证像 "." / "?" 这类字符按字面处理。
 * 大小写敏感 —— 因为剧本/对白本身大小写有意义。
 */
function renderHighlighted(text: string, keyword: string): ReactNode {
  const kw = (keyword || '').trim();
  if (!kw) return text;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(
      <mark
        key={`h-${i++}`}
        className="rounded px-0.5 bg-amber-300/40 text-amber-50 ring-1 ring-amber-300/40"
      >
        {m[0]}
      </mark>
    );
    lastIdx = m.index + m[0].length;
    // 防止零宽匹配造成死循环
    if (m[0].length === 0) re.lastIndex++;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}

function countMatches(text: string, keyword: string): number {
  const kw = (keyword || '').trim();
  if (!kw) return 0;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(escaped, 'g'));
  return matches ? matches.length : 0;
}

/**
 * 把项目里持久化的 ScriptData (title/synopsis/shots[]) 组装回一份
 * 人类可读的分镜剧本字符串, 好让 LLM 继续润色。
 */
function assembleScript(data: any): string {
  if (!data) return '';
  const lines: string[] = [];
  if (data.title) lines.push(`《${data.title}》`);
  if (data.synopsis) lines.push(`\n梗概: ${data.synopsis}`);
  if (data.genre || data.style) {
    lines.push(`类型: ${[data.genre, data.style].filter(Boolean).join(' · ')}`);
  }
  const shots = Array.isArray(data.shots) ? data.shots : [];
  shots.forEach((s: any) => {
    lines.push(`\n── Shot ${s.shotNumber ?? '?'}${s.act ? ` · 第${s.act}幕` : ''} ──`);
    if (s.sceneDescription) lines.push(`[场景] ${s.sceneDescription}`);
    if (s.characters?.length) lines.push(`[人物] ${s.characters.join('、')}`);
    if (s.action) lines.push(`[动作] ${s.action}`);
    if (s.emotion) lines.push(`[情绪] ${s.emotion}`);
    if (s.dialogue) lines.push(`[对白] ${s.dialogue}`);
  });
  return lines.join('\n');
}
