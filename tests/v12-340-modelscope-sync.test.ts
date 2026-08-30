/**
 * v12.340 — ModelScope 同步固化成脚本。
 *
 * ## 为什么"记着"不够
 * 这套同步有三个漏一步就出事的动作,此前全靠人记 —— 而我**已经各漏过一次**:
 *   · `--sync` 删掉「远端有、本地无」的文件 → v12.336 把平台自带的 configuration.json
 *     删了,而 ModelScope 没有可用的提交历史 API,内容找不回来。
 *   · 文件夹上传会用**仓库根的 README.md** 覆盖模型卡,而 GitHub 版里是相对路径图片,
 *     在 ModelScope 上一张都渲染不出来 → v12.339 同步后卡上留下 30 处相对图。
 *   · 直接传工作目录会把 .env.local / node_modules / 未提交草稿一起送出去。
 * 记忆里写着「传完必须重刷模型卡」,**这次仍然发生了** —— 说明该写成会失败的步骤,
 * 而不是写成需要记住的注意事项。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { cardLooksClobbered } from '@/scripts/modelscope-sync.mjs';

const SRC = fs.readFileSync('scripts/modelscope-sync.mjs', 'utf-8');

describe('v12.340 · 模型卡被覆盖能被自动认出来', () => {
  it('GitHub 版特征(相对路径图片)→ 判为已覆盖', () => {
    const r = cardLooksClobbered('<img src="assets/banner.jpg" />');
    expect(r.clobbered).toBe(true);
    expect(r.rel).toBe(1);
  });

  it('ModelScope 版(自托管绝对链)→ 判为正常', () => {
    const ok = '<img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/banner.jpg" />';
    const r = cardLooksClobbered(ok);
    expect(r.clobbered).toBe(false);
    expect(r.ms).toBe(1);
  });

  it('srcset 也算(<picture> 的暗色图走 srcset,v12.336 漏过这个)', () => {
    expect(cardLooksClobbered('<source srcset="assets/star-history-dark.svg" />').clobbered).toBe(true);
  });
});

describe('v12.340 · 三条规矩写进了脚本,不是写进注意事项', () => {
  it('只传 git 跟踪的内容(git archive),不传工作目录', () => {
    expect(SRC).toContain("'archive', 'HEAD'");
    expect(SRC, '导出里出现 .env.local 必须中止').toContain(".env.local");
  });

  it('**默认不带 --sync** —— 它会删远端独有文件', () => {
    const _at = SRC.indexOf("sh('modelscope', ['upload', REPO, '.'");
    expect(_at, '找不到上传命令').toBeGreaterThan(0);
    const up = SRC.slice(_at, _at + 200);
    expect(up, '窗口自证').toContain('upload');
    expect(up, '默认上传命令里不该有 --sync').not.toContain('--sync');
    expect(SRC, '要提供只读预览删除清单的方式').toContain('--preview-deletes');
  });

  it('上传后**必定**重刷模型卡,且刷完要校验', () => {
    const iUpload = SRC.indexOf("['upload', REPO, '.'");
    const iCard = SRC.indexOf("CARD_SRC, 'README.md'");
    expect(iUpload).toBeGreaterThan(0);
    expect(iCard, '重刷必须排在文件夹上传之后').toBeGreaterThan(iUpload);
    expect(SRC).toContain('cardLooksClobbered');
  });

  it('校验不通过要**退出码 1**,不能只打印一句提示', () => {
    const i = SRC.indexOf('if (clobbered)');
    expect(i).toBeGreaterThan(0);
    expect(SRC.slice(i, i + 200)).toContain('process.exit(1)');
  });
});

describe('v12.340 · 令牌不落盘不外泄', () => {
  it('从环境变量读,不写任何配置文件', () => {
    expect(SRC).toContain('process.env.MODELSCOPE_API_TOKEN');
    expect(SRC, '不该调用 modelscope login(那会把令牌写进 ~/.modelscope)').not.toMatch(/'login'/);
  });

  it('输出做掩码 —— 失败信息里会带 oauth2:<令牌>@ 的远端地址', () => {
    expect(SRC).toContain('oauth2:');
    const m = SRC.match(/const redact[\s\S]{0,260}/);
    expect(m).toBeTruthy();
    expect(m![0]).toMatch(/ms-\[0-9a-f-\]/);
  });

  it('已注册为 npm script(不进流程的脚本等于没有)', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['ms:sync']).toBeTruthy();
  });
});
