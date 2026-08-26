/**
 * v12.339 — DropZone:声明了却不执行的校验,以及零消费方。
 *
 * ## 两个问题,后者才是更糟的那个
 * ① 组件自 v12.300 起就**零生产消费方**(全仓只有它自己引用自己)——「造好没接线」。
 * ② 更糟的是:`accept` 与 `maxSize` 两个 prop **只存在于接口声明与解构默认值里,
 *    从未被用来校验任何文件**,而界面上还硬编码写着「支持图片和视频,最大 50MB」。
 *    等于向用户与调用方**承诺了一个不存在的校验** —— 500MB 的文件、.exe 都会照样交上去。
 *    声明了却不执行,比没有这个 prop 更糟:调用方会以为自己已经受保护。
 *    **照原样接线就会把这个 bug 一起发布出去。**
 *
 * ## 接线方式是刻意选的
 * 没有把 DropZone 整个塞进页面:本仓多数上传位(u2v 首/尾帧)**本来就长得像拖放区**,
 * 只是不支持拖放;而 DropZone 自带一套通用灰色样式,塞进影院主题会突兀。
 * 所以抽出 `useFileDrop` 复用**行为**,外观各自保留;DropZone 自身也走同一个 hook。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { filterFiles, acceptToTokens, DEFAULT_ACCEPT, DEFAULT_MAX_SIZE } from '@/components/ui/DropZone';

const mk = (name: string, size: number, type = ''): File =>
  ({ name, size, type } as File);

describe('v12.339 · maxSize 真的会拦(此前是摆设)', () => {
  it('超限的被拒,并说明是哪个文件、为什么', () => {
    const r = filterFiles([mk('big.png', 60 * 1048576, 'image/png')], DEFAULT_ACCEPT, DEFAULT_MAX_SIZE);
    expect(r.ok).toEqual([]);
    expect(r.rejected[0].name).toBe('big.png');
    expect(r.rejected[0].reason).toMatch(/超过 50MB/);
  });

  it('未超限的放行', () => {
    const f = mk('ok.png', 1024, 'image/png');
    expect(filterFiles([f], DEFAULT_ACCEPT, DEFAULT_MAX_SIZE).ok).toEqual([f]);
  });

  it('maxSize=0 视为不限(不要把「没设上限」变成「全拒」)', () => {
    expect(filterFiles([mk('x.png', 9e9, 'image/png')], DEFAULT_ACCEPT, 0).ok).toHaveLength(1);
  });

  it('调用方传自己的上限时按它算,而不是永远 50MB', () => {
    const r = filterFiles([mk('a.png', 2 * 1048576, 'image/png')], DEFAULT_ACCEPT, 1048576);
    expect(r.rejected[0].reason).toMatch(/超过 1MB/);
  });
});

describe('v12.339 · accept 真的会拦', () => {
  it('扩展名不在名单里 → 拒', () => {
    const r = filterFiles([mk('virus.exe', 10, 'application/octet-stream')], DEFAULT_ACCEPT, DEFAULT_MAX_SIZE);
    expect(r.ok).toEqual([]);
    expect(r.rejected[0].reason).toBe('格式不支持');
  });

  it('MIME 通配(image/*)命中', () => {
    expect(filterFiles([mk('无扩展名', 10, 'image/heic')], DEFAULT_ACCEPT, DEFAULT_MAX_SIZE).ok).toHaveLength(1);
  });

  it('大小写扩展名都认(用户的文件常是 .JPG)', () => {
    expect(filterFiles([mk('A.JPG', 10, '')], DEFAULT_ACCEPT, DEFAULT_MAX_SIZE).ok).toHaveLength(1);
  });

  it('部分通过时:放行合格的,同时报出被拒的(不要一个坏文件毁掉整批)', () => {
    const good = mk('ok.png', 10, 'image/png');
    const r = filterFiles([good, mk('bad.exe', 10, '')], DEFAULT_ACCEPT, DEFAULT_MAX_SIZE);
    expect(r.ok).toEqual([good]);
    expect(r.rejected).toHaveLength(1);
  });

  it('accept 为空 → 不做格式限制', () => {
    expect(filterFiles([mk('x.exe', 10, '')], {}, DEFAULT_MAX_SIZE).ok).toHaveLength(1);
  });
});

describe('v12.339 · acceptToTokens', () => {
  it('MIME 与扩展名都摊出来,且去重', () => {
    const t = acceptToTokens({ 'image/*': ['.png', '.PNG'] });
    expect(t).toContain('image/*');
    expect(t.filter((x) => x === '.png')).toHaveLength(1);
  });
});

describe('v12.339 · 接线与单一出处', () => {
  const DZ = fs.readFileSync('components/ui/DropZone.tsx', 'utf-8');
  const U2V = fs.readFileSync('app/dashboard/u2v/page.tsx', 'utf-8');

  it('组件不再有零消费方 —— u2v 真的用上了', () => {
    expect(U2V).toContain("useFileDrop");
    expect(U2V).toContain('firstDrop.dropProps');
    expect(U2V).toContain('tailDrop.dropProps');
  });

  it('**组件自身也走 hook** —— 两边各写一套拖放/校验就是漂移的开始', () => {
    expect(DZ).toContain('useFileDrop({');
    expect(DZ, '组件里不该再留一份独立的 dragOver 处理').not.toMatch(/const handleDragOver\s*=/);
  });

  it('input 带上了 accept 属性(此前只有 prop,选择器根本不过滤)', () => {
    expect(DZ).toMatch(/accept=\{inputAccept/);
  });

  it('id 不再写死 —— 同页两个实例的 label 会互相抢 input', () => {
    expect(DZ, 'id="file-upload" 写死会让第二个区域点出第一个的选择器').not.toContain('id="file-upload"');
    expect(DZ).toContain('useId()');
  });

  it('提示文案由 props 推导,不再硬编码「最大 50MB」', () => {
    expect(DZ, '调用方把上限改成 5MB,界面却还写 50MB,就是在骗人').not.toContain('支持图片和视频，最大 50MB');
    expect(DZ).toContain('hintText');
  });

  it('u2v 的上传限制只有一处定义(hook 与 uploadFile 共用)', () => {
    expect(U2V).toContain('const U2V_MAX');
    expect(U2V, '两处各写一个数字就会漂').not.toMatch(/file\.size > 10 \* 1024 \* 1024/);
  });

  it('拖拽时有视觉反馈,不是默默接收', () => {
    expect(U2V).toContain('firstDrop.isDragging');
    expect(U2V).toContain('tailDrop.isDragging');
  });
});
