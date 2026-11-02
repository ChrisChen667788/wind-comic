/**
 * v13.6 · 自托管 / NAS 文档与它描述的东西必须一致。
 *
 * 起因是一个真实提问:「NAS 上容器部署,登录返回 500,有没有最低硬件要求?」
 * 当时的文档答不了:没有一处写硬件要求;README 的 docker run 不挂 /app/data、不给 DEMO_PASSWORD,
 * 还教人设一个代码里一处都不读的 NEXTAUTH_SECRET;首个账号是谁、注册要邀请码、免费档 ¥5 会拦首次创作,
 * 全都没写;HEALTHCHECK 只探首页,登录 500 时容器照样 healthy。
 *
 * 这里锁的是「文档说的 = 代码做的」:数字从代码里算,锚点按 GitHub 规则解析,配置文件真解析而不是 grep。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { execFileSync } from 'child_process';
import YAML from 'yaml';
import { estimatePipelineCostCny } from '@/lib/budget-estimate';
import { tierMonthlyCeilingCny } from '@/lib/usage-quota';

const read = (f: string) => fs.readFileSync(f, 'utf-8');
const README_EN = read('README.md');
const README_ZH = read('README.zh-CN.md');
const DEPLOY = read('docs/DEPLOYMENT.md');
const DOCKERFILE = read('Dockerfile');
const DEMO = read('docker-compose.demo.yml');
const SELFHOST = read('deploy/docker-compose.yml');
const SELFHOST_ENV = read('deploy/.env.example');
const WORKFLOW = read('.github/workflows/docker-image.yml');

/** GitHub 标题锚点:转小写、去掉字母数字空格连字符以外的字符、空格变连字符 */
const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchorsOf = (md: string) =>
  new Set(md.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => slug(l.replace(/^#+\s*/, ''))));

describe('v13.6 · 没有读者的设置不进文档', () => {
  it('NEXTAUTH_SECRET:代码一处都不读 → README / compose / 冒烟里都不再出现', () => {
    const files = execFileSync('git', ['ls-files', 'app', 'lib', 'services', 'instrumentation.ts'], { encoding: 'utf-8' })
      .split('\n').filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
    expect(files.length, '窗口自证:一个源码文件都没扫到').toBeGreaterThan(100);
    const readers = files.filter((f) => read(f).includes('NEXTAUTH_SECRET'));
    expect(readers, '有代码开始读 NEXTAUTH_SECRET 了 —— 那就把它写回部署文档').toEqual([]);
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docker-compose.demo.yml', DEMO], ['docker-image.yml', WORKFLOW]] as const) {
      const live = src.split('\n').filter((l) => l.includes('NEXTAUTH_SECRET') && !/^\s*#/.test(l));
      expect(live, `${name} 还在教人设 NEXTAUTH_SECRET`).toEqual([]);
    }
  });

  it('SEED_DEMO_PROJECT 不再作为 demo compose 的环境变量(镜像启动命令从不执行 seed 脚本)', () => {
    const env = YAML.parse(DEMO).services['wind-comic-demo'].environment as Record<string, string>;
    expect(Object.keys(env), '窗口自证').toContain('MOCK_ENGINES');
    expect(Object.keys(env)).not.toContain('SEED_DEMO_PROJECT');
    expect(read('package.json'), '如果 start 脚本开始跑 seed-demo,这条要改').not.toMatch(/"start":\s*"[^"]*seed-demo/);
  });
});

describe('v13.6 · 零 key 试用:打开就能登录', () => {
  it('两份 README 的 docker run 都挂数据卷、给固定演示密码,并写明登录账号', () => {
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH]] as const) {
      const block = src.slice(src.indexOf('docker run -p 3100:3100'), src.indexOf('ghcr.io/chrischen667788/wind-comic:latest', src.indexOf('docker run -p 3100:3100')));
      expect(block.length, `${name} 窗口自证:找不到 docker run 那一段`).toBeGreaterThan(40);
      expect(block, `${name} 没挂 /app/data`).toMatch(/-v \S+:\/app\/data/);
      expect(block, `${name} 没给 DEMO_PASSWORD`).toMatch(/-e DEMO_PASSWORD=(\S+)/);
      const pw = block.match(/-e DEMO_PASSWORD=(\S+)/)![1];
      expect(src, `${name} 没告诉读者用什么登录`).toContain('demo@qfmanju.ai');
      expect(src).toContain(pw);
    }
  });

  it('demo compose:固定演示密码、健康检查探 /api/health', () => {
    const svc = YAML.parse(DEMO).services['wind-comic-demo'];
    expect(String(svc.environment.DEMO_PASSWORD)).toMatch(/wind-comic-demo/);
    expect(svc.healthcheck.test.join(' ')).toContain('/api/health');
    expect(svc.healthcheck.test.join(' ')).not.toMatch(/localhost:3100\/ /);
  });
});

describe('v13.6 · deploy/ 自托管配置', () => {
  const svc = YAML.parse(SELFHOST).services['wind-comic'];

  it('compose:官方镜像、3100、env_file、数据卷挂在 /app/data', () => {
    expect(svc.image).toBe('ghcr.io/chrischen667788/wind-comic:latest');
    expect(svc.ports).toContain('3100:3100');
    expect(svc.env_file).toBe('.env');
    expect(svc.volumes.some((v: string) => /:\/app\/data$/.test(v)), '不挂数据卷 = 删容器即丢数据').toBe(true);
    expect(svc.restart).toBe('unless-stopped');
    expect(svc.environment.NODE_ENV).toBe('production');
  });

  it('compose 里写的属主就是 Dockerfile 里建的容器用户', () => {
    expect(DOCKERFILE).toMatch(/addgroup -g 1001/);
    expect(DOCKERFILE).toMatch(/adduser -S -u 1001/);
    expect(DOCKERFILE).toContain('USER nextjs');
    for (const [name, src] of [['deploy/docker-compose.yml', SELFHOST], ['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docs/DEPLOYMENT.md', DEPLOY]] as const) {
      expect(src, `${name} 没写 chown 1001:1001`).toContain('chown -R 1001:1001');
    }
  });

  it('.env.example:必填项留空(不给可被照抄的占位串),也没有任何像真密钥的值', () => {
    const lines = SELFHOST_ENV.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
    const kv = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    expect(kv.JWT_SECRET, 'JWT_SECRET 必须留空 —— 填了占位串就会有人照抄进生产').toBe('');
    expect(kv.DEMO_PASSWORD).toBe('');
    expect(kv.PIPELINE_QUEUE).toBe('1');
    expect(SELFHOST_ENV).toContain('openssl rand -hex 32');
    expect(SELFHOST_ENV, '不该有看起来像真 key 的串').not.toMatch(/(sk-|ms-|ghp_)[A-Za-z0-9]{8,}/);
  });
});

describe('v13.6 · 文档里的数字从代码里来', () => {
  it('免费档月预算 = tierMonthlyCeilingCny("free")', () => {
    const cap = tierMonthlyCeilingCny('free');
    expect(cap).toBe(5);
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docs/DEPLOYMENT.md', DEPLOY]] as const) {
      expect(src, `${name} 的免费档数字`).toContain(`¥${cap}`);
      expect(src, `${name} 没写去哪调预算`).toContain('/dashboard/usage');
    }
  });

  it('首次创作的预检估价区间 = estimatePipelineCostCny 对各视频引擎的最小/最大值', () => {
    const vals = ['minimax', 'kling', 'vidu', 'seedance', 'veo'].map((p) => estimatePipelineCostCny({ videoProvider: p }));
    const lo = Math.min(...vals).toFixed(1);
    const hi = Math.max(...vals).toFixed(1);
    expect(estimatePipelineCostCny({ videoProvider: 'no-such-engine' }).toFixed(1), '未知引擎按最贵档').toBe(hi);
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docs/DEPLOYMENT.md', DEPLOY]] as const) {
      expect(src, `${name} 的估价区间与代码对不上(代码:¥${lo}–${hi})`).toContain(`¥${lo}–${hi}`);
    }
  });

  it('硬件要求三处一致(镜像体积 / 内存峰值 / 建议给容器的内存)', () => {
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docs/DEPLOYMENT.md', DEPLOY], ['deploy/docker-compose.yml', SELFHOST]] as const) {
      expect(src, `${name}:镜像下载体积`).toContain('830 MB');
      expect(src, `${name}:解压体积`).toMatch(/3 GB/);
      expect(src, `${name}:720p 峰值`).toContain('0.95 GB');
      expect(src, `${name}:竖屏峰值`).toContain('1.75 GB');
      expect(src, `${name}:OOM 门槛`).toContain('768 MB');
      expect(src, `${name}:空闲内存`).toContain('70–120 MB');
    }
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docs/DEPLOYMENT.md', DEPLOY]] as const) {
      expect(src, `${name}:没写不支持 32 位 ARM`).toMatch(/32-bit ARM|32 位 ARM/);
    }
  });
});

describe('v13.6 · 健康检查探的是能不能登录,不是首页', () => {
  it('Dockerfile HEALTHCHECK 探 /api/health,start-period 放宽到 60s', () => {
    const hc = DOCKERFILE.slice(DOCKERFILE.indexOf('HEALTHCHECK'));
    expect(hc.split('\n').slice(0, 2).join(' ')).toContain('http://localhost:3100/api/health');
    expect(hc).toMatch(/--start-period=60s/);
    expect(fs.existsSync('app/api/health/route.ts'), 'HEALTHCHECK 指向的路由不存在').toBe(true);
  });

  it('镜像冒烟:除了首页,还要过 /api/health 和端到端出片脚本', () => {
    const i = WORKFLOW.indexOf('Smoke test');
    expect(i, '找不到冒烟步骤').toBeGreaterThan(0);
    const smoke = WORKFLOW.slice(i);
    expect(smoke).toContain('scripts/docker-demo-smoke.sh');
    expect(smoke).toContain('DEMO_PASSWORD=');
    const script = read('scripts/docker-demo-smoke.sh');
    expect(script).toContain('/api/health');
    expect(script, '必须识别 concat 兜底 —— v13.1 的病就是它').toContain('concat');
    expect(script).toContain('ffprobe');
    expect(script, '必须查合成报错日志').toMatch(/Composer\\\\?\] FFmpeg error/);
    // 开着 pipefail 时 `… | grep -q` 会因 SIGPIPE 返回 141 —— 命中了反而判假(真有报错照样放行)
    expect(script, '窗口自证:脚本没开 pipefail?').toMatch(/set -[a-z]*o pipefail/);
    const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code, '冒烟脚本里不许把输出管道进 grep -q(pipefail + SIGPIPE = 假绿);先落盘再 grep').not.toMatch(/\|\s*grep\s+-[a-zA-Z]*q/);
    expect(code, '合成报错检查要读落盘的日志').toMatch(/docker logs "\$CONTAINER" > "\$WORK\/container\.log"/);
  });
});

describe('v13.6 · 镜像里的合成用系统 ffmpeg,且构建期自证', () => {
  // v13.8:机制从「把 ffmpeg-static 换成软链接」改成「FFMPEG_PATH / FFPROBE_PATH 指向系统版 + 随包二进制不进镜像」
  //(那时代码才开始读这两个变量,见 lib/ffmpeg-bin.ts 与 tests/v13-8-ffmpeg-bin.test.ts)。锁的东西没变:用的是系统版、构建期自证。
  it('运行时镜像设 FFMPEG_PATH / FFPROBE_PATH 指向 apk 装的系统版', () => {
    const runner = DOCKERFILE.slice(DOCKERFILE.indexOf('FROM node:${NODE_VERSION} AS runner'));
    expect(runner.length, '窗口自证').toBeGreaterThan(200);
    expect(runner).toMatch(/FFMPEG_PATH=\/usr\/bin\/ffmpeg/);
    expect(runner).toMatch(/FFPROBE_PATH=\/usr\/bin\/ffprobe/);
    expect(runner).toMatch(/apk add --no-cache ffmpeg /);
  });

  it('随包二进制在 builder 阶段删掉(在 runner 里删,文件仍在 COPY 那一层里随镜像分发)', () => {
    const builder = DOCKERFILE.slice(DOCKERFILE.indexOf('AS builder'), DOCKERFILE.indexOf('AS runner'));
    expect(builder, '窗口自证').toContain('RUN npm run build');
    expect(builder).toContain('rm -f node_modules/ffmpeg-static/ffmpeg');
    expect(builder).toContain('rm -rf node_modules/ffprobe-static/bin');
  });

  it('自证三件事:随包二进制不在、$FFMPEG_PATH 有 drawtext、能跑「变速 → xfade」;不过就 exit 1;在切换非 root 用户之前', () => {
    const start = DOCKERFILE.indexOf('RUN set -e; \\\n    for f in /app/node_modules/ffmpeg-static/ffmpeg');
    const block = DOCKERFILE.slice(start, DOCKERFILE.indexOf('自证通过', start));
    expect(start, '窗口自证:找不到自证那段 RUN').toBeGreaterThan(0);
    expect(block.length, '窗口自证').toBeGreaterThan(100);
    expect(block).toContain('ff="$FFMPEG_PATH"');
    expect(block).toContain('grep -qw drawtext');
    expect(block).toMatch(/setpts=[^,]+,fps=24\[b\];\[a\]\[b\]xfade/);
    expect((block.match(/exit 1/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(DOCKERFILE.indexOf('USER nextjs')).toBeGreaterThan(start);
  });
});

describe('v13.6 · 局域网 HTTP 的说法跟着 v13.5 的真实行为走', () => {
  it('README 两份都写明 http://<NAS-IP>:3100 直连可用、默认 COOKIE_SECURE=auto,并提醒公网走 HTTPS', () => {
    const lib = read('app/api/auth/lib.ts');
    expect(lib, '窗口自证:代码里没有 COOKIE_SECURE 了?那这几句文案要改').toContain('COOKIE_SECURE');
    for (const [name, src] of [['README.md', README_EN], ['README.zh-CN.md', README_ZH], ['docs/DEPLOYMENT.md', DEPLOY]] as const) {
      expect(src, `${name} 没写默认值`).toMatch(/COOKIE_SECURE[`=]*\s*(=|默认)?\s*`?auto/);
      expect(src, `${name} 没提醒公网走 HTTPS`).toMatch(/Internet, put it behind HTTPS|公网访问请(放到|走) ?HTTPS/);
    }
  });
});

describe('v13.6 · 文档里的跨文件锚点都能解析', () => {
  it('README → DEPLOYMENT.md 的锚点在 DEPLOYMENT.md 里真有对应标题', () => {
    const anchors = anchorsOf(DEPLOY);
    const links = [...`${README_EN}\n${README_ZH}`.matchAll(/docs\/DEPLOYMENT\.md#([^)\s]+)/g)].map((m) => decodeURIComponent(m[1]));
    expect(links.length, '窗口自证:README 里一条锚点链接都没有').toBeGreaterThanOrEqual(4);
    for (const a of links) expect(anchors.has(a), `DEPLOYMENT.md 里没有 #${a}`).toBe(true);
  });

  it('DEPLOYMENT.md 内部的锚点也能解析', () => {
    const anchors = anchorsOf(DEPLOY);
    const links = [...DEPLOY.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => decodeURIComponent(m[1]));
    for (const a of links) expect(anchors.has(a), `DEPLOYMENT.md 里没有 #${a}`).toBe(true);
  });
});
