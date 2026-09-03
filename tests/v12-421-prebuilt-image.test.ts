/**
 * v12.421 — 「一条命令」还得先本地构建;而那个镜像会把中文字幕烧成方框。
 *
 * ── 两件事,后面那件更难看 ────────────────────────────────────────────
 * ① v12.414 把上手压到了一条命令,但那条命令要 npm ci + next build ——
 *    几分钟起步、还得本机有构建环境。竞品复核 C8 的证伪条件写得很明白:
 *    「可直接 docker pull 并 docker run 一行拉起的**预构建镜像**(无需本地 build)」。
 *
 * ② 镜像里只装了 `ttf-dejavu` —— **它没有任何中日韩字形**。
 *    而 `lib/subtitle-burn.ts` 在 Linux 下给的字体名是 `Noto Sans CJK SC` /
 *    `Noto Sans JP` / `Noto Sans KR`,解析不到时 libass 回退 DejaVu,
 *    于是**每一个汉字都烧成方框**。这是一个中文短剧产品的官方镜像。
 *    而它不会报错:镜像构建成功、容器起得来、片子也出得来,只是字看不了 ——
 *    又一个「失败长得像成功」。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 本机没有 docker,我**无法实测**字体包提供哪些 family 名。与其猜,
 * 不如让构建本身来证明 —— 所以这里锁的是「构建期与运行期各有一道字体自证」,
 * 而不是「我觉得这个包应该有」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

/**
 * Dockerfile 也要剥 `#` 注释 —— 我在注释里写了那三个字体名的说明,
 * 于是「只验中文不验日韩」这个突变没被拦下:断言经由注释而不是经由那条
 * `for` 循环命中了。同一个坑本轮已在 YAML、TS 尾随注释、块注释里各栽一次。
 */
const stripHashComments = (src: string) =>
  src.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');

const DOCKERFILE_RAW = fs.readFileSync('Dockerfile', 'utf-8');
const DOCKERFILE = stripHashComments(DOCKERFILE_RAW);
/**
 * 剥 YAML 注释 —— 断言「某东西不存在」之前必须剥,否则命中的是我自己写在
 * 注释里的对比说明(「Docker Hub 要 DOCKERHUB_TOKEN,所以我们不用它」)。
 * 这个坑本项目栽过好几次,每次形态都略有不同:块注释、整行 //、尾随 //,
 * 这次是 YAML 的 #。
 */
const stripYamlComments = (src: string) =>
  src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1')).join('\n');

const WORKFLOW_RAW = fs.readFileSync('.github/workflows/docker-image.yml', 'utf-8');
const WORKFLOW = stripYamlComments(WORKFLOW_RAW);
const COMPOSE = fs.readFileSync('docker-compose.demo.yml', 'utf-8');

describe('v12.421 · 预构建镜像', () => {
  it('镜像装了 CJK 字体 —— 否则中文短剧的字幕全是方框', () => {
    expect(DOCKERFILE, '窗口自证:这不是那个 Dockerfile?').toContain('apk add');
    expect(DOCKERFILE).toContain('font-noto-cjk');
  });

  it('**构建期自证**:字体解析不到就让镜像构建失败,而不是静默发方框镜像', () => {
    // fc-match 找不到时会静默回退,所以必须检查它解析到的确实是 Noto
    expect(DOCKERFILE).toContain('fc-match');
    // 锁行为不锁写法:只要「解析结果里必须出现 Noto」这件事还在做就行 ——
    // 第一版这里写死 `grep -qi noto`,我把判定换成 case 匹配后它就红了,而行为没变。
    expect(DOCKERFILE, '没有任何一处校验解析结果是不是 Noto').toMatch(/[Nn]oto\*?\)|grep -qi noto/);
    const i = DOCKERFILE.indexOf('fc-match');
    const block = DOCKERFILE.slice(i, i + 600);
    expect(block, '解析不到必须 exit 1,不能只打印一句就过').toContain('exit 1');
    // 三种语言的字体都要验 —— 只验中文,日韩照样是方框
    for (const f of ['Noto Sans CJK SC', 'Noto Sans JP', 'Noto Sans KR']) {
      expect(DOCKERFILE, `没验 ${f}`).toContain(f);
    }
  });

  it('泛 CJK 字体不提供独立的 JP/KR 家族 —— 必须有别名映射把代码要的名字接过去', () => {
    // 这条不是我推理出来的:Docker workflow 第一次跑时,Dockerfile 的构建期自证
    // 当场报「字体「Noto Sans JP」解析不到 Noto(回退到了 DejaVu Sans)」。
    // 本机没有 docker,我验不了字体包提供哪些 family 名 —— 是那道自证替我验的。
    const alias = fs.readFileSync('docker/font-aliases.conf', 'utf-8');
    expect(alias, '窗口自证:这不是 fontconfig 配置?').toContain('<fontconfig>');
    for (const [want, target] of [['Noto Sans JP', 'Noto Sans CJK JP'], ['Noto Sans KR', 'Noto Sans CJK KR']]) {
      expect(alias, `没把 ${want} 映射过去`).toContain(want);
      expect(alias, `${want} 的映射目标不对`).toContain(target);
    }
    // 别名文件必须真被装进镜像,否则写了等于没写
    expect(DOCKERFILE).toContain('docker/font-aliases.conf');
    expect(DOCKERFILE).toContain('/etc/fonts/conf.d/');
    // 装完还要重建缓存,否则 fontconfig 读不到
    const i = DOCKERFILE.indexOf('font-aliases.conf');
    expect(DOCKERFILE.slice(i), '装了别名却没 fc-cache,等于没生效').toContain('fc-cache');
  });

  it('这些字体名必须与 subtitle-burn 在 Linux 下真正要的那几个一致', () => {
    const burn = fs.readFileSync('lib/subtitle-burn.ts', 'utf-8');
    expect(burn, '窗口自证').toContain('fontForLanguage');
    // 字幕代码要什么,镜像就得装什么 —— 两边对不上就是白装
    for (const f of ['Noto Sans CJK SC', 'Noto Sans JP', 'Noto Sans KR']) {
      expect(burn, `subtitle-burn 不再用 ${f} 了?那 Dockerfile 该同步`).toContain(f);
      expect(DOCKERFILE).toContain(f);
    }
  });

  it('发布走 GHCR + 内置令牌 —— 不需要 owner 录任何密钥', () => {
    expect(WORKFLOW).toContain('ghcr.io');
    expect(WORKFLOW).toContain('secrets.GITHUB_TOKEN');
    expect(WORKFLOW).toMatch(/packages:\s*write/);
    // 引入一个要人转交的密钥就多一个泄露面;能不引入就不引入
    expect(WORKFLOW.includes('DOCKERHUB_TOKEN'), '又引入了需要人工录入的密钥').toBe(false);
  });

  it('多架构 —— 只出一个架构总有一半人跑不了', () => {
    expect(WORKFLOW).toContain('linux/amd64');
    expect(WORKFLOW).toContain('linux/arm64');
    expect(WORKFLOW, 'arm64 交叉构建要 QEMU').toContain('setup-qemu-action');
  });

  it('**构建成功 ≠ 镜像能用**:发布后必须真拉起来打一次首页', () => {
    expect(WORKFLOW).toContain('docker run');
    expect(WORKFLOW).toMatch(/curl .*localhost:3100/);
    // 运行期再验一次字体 —— 构建期过了不代表没被后续层弄丢
    const i = WORKFLOW.indexOf('Smoke test');
    expect(i, '找不到冒烟步骤').toBeGreaterThan(0);
    expect(WORKFLOW.slice(i)).toContain('fc-match');
  });

  it('demo compose 默认拉镜像,本地 build 退为兜底', () => {
    expect(COMPOSE).toContain('ghcr.io/chrischen667788/wind-comic');
    expect(COMPOSE).toContain('pull_policy: missing');
    // build 段保留 —— 改了本地代码想试、或镜像还没发出来时仍要能用
    expect(COMPOSE).toContain('build:');
  });

  it('两份 README 都给出不需要 clone 的一行命令', () => {
    for (const f of ['README.md', 'README.zh-CN.md']) {
      const src = fs.readFileSync(f, 'utf-8');
      expect(src, `${f} 没给 docker run 一行`).toContain('docker run -p 3100:3100');
      expect(src).toContain('ghcr.io/chrischen667788/wind-comic');
    }
  });
});
