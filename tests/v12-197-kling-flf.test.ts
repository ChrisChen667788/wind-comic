/**
 * v12.197 — 可灵首尾帧接入主链:FLF base64 归一/orchestrator 注入/regen 贯通/UI 入口。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.197 · 首尾帧锁定', () => {
  it('kling.service:FLF 收 data: URI(剥前缀纯 base64),不再一刀切拒绝', () => {
    const s = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(s).toContain("const normFrame = (u: string) => (u.startsWith('data:image/') ? u.split(',')[1] : u);");
    expect(s).toContain('image: normFrame(firstFrameUrl)');
    expect(s).toContain('image_tail: normFrame(lastFrameUrl)');
    expect(s).not.toContain('Kling FLF: 不接受 data URI');
  });
  it('orchestrator:主管线 kling 分支尾帧优先 FLF,失败退单图;regen 链贯通 tailFrameUrl', () => {
    const s = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(s).toContain('generateFirstLastFrame(firstFrameUrl, tailImg, enhancedPrompt');
    expect(s).toContain('尾帧融合失败,退回单图 i2v');
    expect(s).toContain('tailFrameUrl?: string');
    // v12.440 迁移:单镜重生的提示词先过导演台站位注入口(withStageDirective),
    // 传给可灵的因此是 videoPrompt 而不是裸 storyboard.prompt —— 尾帧这条链本身没变。
    expect(s).toContain('generateFirstLastFrame(engineFrame, tailImg, videoPrompt');
  });
  it('regen 路由:body 显式 > 剧本 shot.tailFrameUrl;UI 有尾帧输入', () => {
    const r = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(r).toContain('bodyTailFrameUrl');
    expect(r).toContain("sh?.tailFrameUrl");
    const ui = fs.readFileSync('components/nodes/video-node.tsx', 'utf-8');
    expect(ui).toContain('shotTail');
    expect(ui).toContain('尾帧URL');
  });
});
