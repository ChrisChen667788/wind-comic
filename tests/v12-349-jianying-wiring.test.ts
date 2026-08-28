/**
 * v12.349:剪映草稿导出 —— 端点从 v12.38 就在,两个多月**没有任何前端调它**。
 *
 * 不接线的原因很实在,不是忘了:POST 版要调用方自己拼 `clips[{path,durationSec}]`,
 * 而**前端手里只有 `/api/serve-file?key=…`** —— 那是 HTTP URL,剪映打不开。
 * 前端根本没有能力提供「剪映打得开的路径」。
 *
 * 破局点是想清楚这个应用是**本机跑的**:素材就在 `data/storage/assets/` 下,
 * 剪映和本应用在同一台机器上,所以**绝对路径直接可用** —— 而这一步只有服务端做得了。
 *
 * 于是新增 GET:服务端从项目资产组装,`?file=content|meta` 两次下载
 * (与既有 EDL/AAF 的 Content-Disposition 模式一致,不引入打包依赖)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const ROUTE = read('app/api/projects/[id]/export-jianying/route.ts');
const UI = read('components/project/monitor-tab.tsx');

describe('v12.349 服务端组装草稿', () => {
  it('有 GET 处理器(原来只有 POST,前端调不动)', () => {
    expect(ROUTE).toMatch(/export async function GET\(/);
  });

  it('把 serve-file key 解析成**绝对本地路径** —— 剪映不认 HTTP URL', () => {
    expect(ROUTE).toMatch(/resolveByKey/);
    expect(ROUTE).toMatch(/\.absPath/);
  });

  it('拿不到本地路径的素材要**跳过并记账**,不能塞个打不开的路径进去', () => {
    expect(ROUTE).toMatch(/skipped\.push/);
    expect(ROUTE).toMatch(/已跳过缺本地文件/);
  });

  it('一个片段都没有时明确报错,不返回空草稿骗人', () => {
    expect(ROUTE).toMatch(/if \(clips\.length === 0\)/);
    expect(ROUTE).toMatch(/没有可导出的成片片段/);
    expect(ROUTE).toMatch(/status: 409/);
  });

  it('鉴权:未登录 401、非属主 403', () => {
    const win = ROUTE.slice(ROUTE.indexOf('export async function GET('));
    expect(win).toMatch(/status: 401/);
    expect(win).toMatch(/status: 403/);
  });

  it('两个文件分别可下,文件名是剪映认的那两个', () => {
    expect(ROUTE).toMatch(/draft_meta_info\.json/);
    expect(ROUTE).toMatch(/draft_content\.json/);
    expect(ROUTE).toMatch(/Content-Disposition/);
  });

  it('**限制随文件一起交出去**,而不是只写在代码注释里', () => {
    expect(ROUTE).toMatch(/X-JianYing-Notes/);
    expect(ROUTE).toMatch(/剪映 ≤5\.9/);
    expect(ROUTE).toMatch(/社区逆向/);
  });
});

describe('v12.349 前端接线', () => {
  it('有导出按钮', () => {
    expect(UI).toMatch(/data-testid="export-jianying"/);
  });

  it('连下两个文件 —— 剪映要两个放同一目录', () => {
    const win = UI.slice(UI.indexOf('async function downloadJianYing'), UI.indexOf('async function downloadJianYing') + 1400);
    expect(win).toMatch(/\['content', 'meta'\]/);
    expect(win).toMatch(/draft_meta_info\.json/);
    expect(win).toMatch(/draft_content\.json/);
  });

  it('把服务端的诚实说明显示给用户', () => {
    expect(UI).toMatch(/X-JianYing-Notes/);
    expect(UI).toMatch(/setJyNote/);
    expect(UI).toMatch(/role="status"/);
  });

  it('失败要有用户可见反馈,不能只 console(既有护栏同款要求)', () => {
    const win = UI.slice(UI.indexOf('async function downloadJianYing'), UI.indexOf('async function downloadJianYing') + 1400);
    expect(win).toMatch(/setJyNote\(j\?\.error/);
    expect(win).toMatch(/catch \(e\)[\s\S]{0,80}setJyNote/);
  });

  it('进行中禁用按钮,避免重复触发', () => {
    expect(UI).toMatch(/disabled=\{jyBusy\}/);
    expect(UI).toMatch(/setJyBusy\(true\)/);
    expect(UI).toMatch(/finally \{[\s\S]{0,60}setJyBusy\(false\)/);
  });

  it('blob URL 用完释放,不泄漏', () => {
    expect(UI).toMatch(/URL\.revokeObjectURL\(url\)/);
  });
});
