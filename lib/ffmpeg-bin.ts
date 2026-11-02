/**
 * lib/ffmpeg-bin — ffmpeg / ffprobe 可执行文件的**唯一**解析入口(v13.8)。
 *
 * ## 为什么要有它
 *
 * v13.8 之前,二十多处代码各自找二进制,五种口径:
 *   - services/video-composer.ts 的 resolveFFmpegPath():ffmpeg-static → `which ffmpeg`,
 *     并在模块加载时无条件 setFfmpegPath —— 把 fluent-ffmpeg 自己对 FFMPEG_PATH 的读取也盖掉了;
 *   - lib/lipsync-providers/local-2d.ts 的 ffmpegBin():只认 LIPSYNC_FFMPEG_PATH;
 *   - editor-score / scene-split / audio-silence / last-frame-extractor / audio-health 各自
 *     import ffmpeg-static 再 setFfmpegPath —— 而 fluent-ffmpeg 的路径是**进程级全局**的,谁最后加载谁说了算;
 *   - film-health / image-aspect-guard / video-anchor 按名字直调 `ffprobe` / `ffmpeg`,只认 PATH
 *     (只装了 npm 依赖、没有系统 ffmpeg 的机器上,成片体检永远是「未知」);
 *   - beat-detect / bgm-multi-act / video-transcode / frame-strip 什么都不设,用的是「之前碰巧谁设过」。
 *
 * 于是 README 许可证表里那句「改用系统 ffmpeg(设 FFMPEG_PATH)」从来不成立;Linux 上从源码装的用户
 * 拿到的是 ffmpeg-static 7.0.2(没有 drawtext、不认「变速 setpts 之后接 xfade」),没有任何官方途径换掉它。
 *
 * ## 解析顺序(先到先得)
 *
 * ffmpeg:
 *   1. `FFMPEG_PATH`         推荐。可执行文件路径(相对路径按 cwd),或 PATH 上的命令名;
 *   2. `LIPSYNC_FFMPEG_PATH` 兼容旧配置 —— 它原先只对本地 2D 口型生效,现在对所有 ffmpeg 调用生效;
 *   3. ffmpeg-static         npm 随包二进制(这个包自己也认 `FFMPEG_BIN`)。**包被删掉也不报错**,往下找;
 *   4. PATH 上的 `ffmpeg`;
 *   5. 常见安装位置 /opt/homebrew/bin、/usr/local/bin、/usr/bin(launchd 之类 PATH 很短的环境)。
 * ffprobe:`FFPROBE_PATH` → ffprobe-static → PATH → 常见安装位置。
 *
 * 环境变量设了却用不了(不存在 / 是目录 / 没有执行权限):**不静默**,打一条 warn 再往下找 ——
 * 退路和 fluent-ffmpeg 自己处理 FFMPEG_PATH 的方式一致,但要让人在日志里看见自己的配置没生效。
 *
 * ## 怎么用
 *
 *   - 自己起进程:`execFile(resolveFFmpegPath(), args)` / `resolveFFprobePath()`;
 *   - 用 fluent-ffmpeg:`import { ffmpeg } from '@/lib/ffmpeg-bin'` —— 这里导出的就是 fluent-ffmpeg 本体,
 *     本模块加载时已经按上面的顺序 setFfmpegPath / setFfprobePath。
 * 除本文件外,仓库里不许再 import ffmpeg-static / ffprobe-static / fluent-ffmpeg、不许 setFfmpegPath、
 * 不许按名字直调 —— lib/consumer-gate/contracts.ts 的 `ffmpeg-binary-must-use-ffmpeg-bin` 守着。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import fluentFfmpeg from 'fluent-ffmpeg';

export type BinarySource =
  | 'FFMPEG_PATH'
  | 'LIPSYNC_FFMPEG_PATH'
  | 'FFPROBE_PATH'
  | 'ffmpeg-static'
  | 'ffprobe-static'
  | 'PATH'
  | 'system';

export interface LocatedBinary {
  path: string;
  source: BinarySource;
}

type Tool = 'ffmpeg' | 'ffprobe';

const IS_WIN = process.platform === 'win32';
const SYSTEM_DIRS = IS_WIN ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

function exeName(tool: Tool): string {
  return IS_WIN ? `${tool}.exe` : tool;
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;   // statSync 跟随软链接(官方镜像里 ffmpeg-static 就是软链)
    if (!IS_WIN) fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(tool: Tool | string): string | null {
  const names = IS_WIN && !/\.exe$/i.test(tool) ? [`${tool}.exe`, tool] : [tool];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      if (isExecutableFile(p)) return p;
    }
  }
  return null;
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

/**
 * 读一个「指定二进制」的环境变量。没设 / 空串 → null;设了但用不了 → warn 后 null。
 * 值里带路径分隔符就当路径(相对路径按 cwd),否则当 PATH 上的命令名(`FFMPEG_PATH=ffmpeg8` 也行)。
 */
function fromEnv(name: 'FFMPEG_PATH' | 'LIPSYNC_FFMPEG_PATH' | 'FFPROBE_PATH', value: string | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const looksLikePath = raw.includes('/') || (IS_WIN && raw.includes('\\'));
  const hit = looksLikePath
    ? (isExecutableFile(path.resolve(raw)) ? path.resolve(raw) : null)
    : findOnPath(raw);
  if (!hit) {
    warnOnce(`[FFmpeg] ${name}=${raw} 不存在、不是文件或没有执行权限 —— 已忽略,按默认顺序继续找(见 lib/ffmpeg-bin.ts)`);
  }
  return hit;
}

/**
 * 找 npm 包目录。先用模块自己的 require(dev / vitest);被打包器改写或拿不到时,
 * 再从 cwd 的 package.json 起一个 require —— Next 生产服务的 cwd 就是项目根(镜像里是 /app)。
 * 包没装(用户为了不分发 GPL 二进制把它删了)→ null,不抛。
 */
function packageDir(pkg: 'ffmpeg-static' | 'ffprobe-static'): string | null {
  // require.resolve 的参数必须是字面量:写成模板串,打包器会把它当「表达式依赖」去扫整个 node_modules。
  const own = pkg === 'ffmpeg-static'
    ? () => require.resolve('ffmpeg-static/package.json')
    : () => require.resolve('ffprobe-static/package.json');
  const resolvers: Array<() => string> = [
    own,
    () => createRequire(path.join(process.cwd(), 'package.json')).resolve(`${pkg}/package.json`),
  ];
  for (const r of resolvers) {
    try {
      const p = r();
      if (typeof p === 'string' && fs.existsSync(p)) return path.dirname(p);
    } catch { /* 下一个 */ }
  }
  const guess = path.join(process.cwd(), 'node_modules', pkg);
  return fs.existsSync(path.join(guess, 'package.json')) ? guess : null;
}

function fromFfmpegStatic(): string | null {
  const candidates: string[] = [];
  // 包的导出值:它自己处理了 FFMPEG_BIN 覆盖和平台判断。
  // Turbopack 打包时可能把它重写成 "/ROOT/node_modules/..." 这样的虚拟路径 —— 所以下面还要按包目录重建。
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v = require('ffmpeg-static');
    const s = typeof v === 'string' ? v : v?.default;
    if (typeof s === 'string' && s) candidates.push(s);
  } catch { /* 包没装 */ }
  const dir = packageDir('ffmpeg-static');
  if (dir) candidates.push(path.join(dir, exeName('ffmpeg')));
  return candidates.find(isExecutableFile) ?? null;
}

function fromFfprobeStatic(): string | null {
  // 不 require('ffprobe-static') 本体:它在不支持的平台上会直接 process.exit(1)。按它的目录规则自己拼。
  const dir = packageDir('ffprobe-static');
  if (!dir) return null;
  const p = path.join(dir, 'bin', process.platform, process.arch, exeName('ffprobe'));
  return isExecutableFile(p) ? p : null;
}

function fromSystem(tool: Tool): LocatedBinary | null {
  const onPath = findOnPath(tool);
  if (onPath) return { path: onPath, source: 'PATH' };
  for (const dir of SYSTEM_DIRS) {
    const p = path.join(dir, exeName(tool));
    if (isExecutableFile(p)) return { path: p, source: 'system' };
  }
  return null;
}

/** 按解析顺序找 ffmpeg;一个都没有 → null。每次调用都重新看 env 和文件系统(几次 stat,开销可忽略)。 */
export function locateFFmpeg(): LocatedBinary | null {
  const env = fromEnv('FFMPEG_PATH', process.env.FFMPEG_PATH);
  if (env) return { path: env, source: 'FFMPEG_PATH' };
  const legacy = fromEnv('LIPSYNC_FFMPEG_PATH', process.env.LIPSYNC_FFMPEG_PATH);
  if (legacy) return { path: legacy, source: 'LIPSYNC_FFMPEG_PATH' };
  const bundled = fromFfmpegStatic();
  if (bundled) return { path: bundled, source: 'ffmpeg-static' };
  return fromSystem('ffmpeg');
}

/** 按解析顺序找 ffprobe;一个都没有 → null。 */
export function locateFFprobe(): LocatedBinary | null {
  const env = fromEnv('FFPROBE_PATH', process.env.FFPROBE_PATH);
  if (env) return { path: env, source: 'FFPROBE_PATH' };
  const bundled = fromFfprobeStatic();
  if (bundled) return { path: bundled, source: 'ffprobe-static' };
  return fromSystem('ffprobe');
}

/**
 * 给 execFile / spawn 用的 ffmpeg 路径。找不到时返回裸名 `ffmpeg` 并 warn ——
 * 进程会以 ENOENT 失败,调用方原有的「ffmpeg 不可用」降级照常生效。
 */
export function resolveFFmpegPath(): string {
  const hit = locateFFmpeg();
  if (hit) return hit.path;
  warnOnce('[FFmpeg] 找不到 ffmpeg(FFMPEG_PATH / ffmpeg-static / PATH / 常见安装位置都没有),合成会失败');
  return 'ffmpeg';
}

/** 给 execFile / spawn 用的 ffprobe 路径;找不到时同上返回裸名 `ffprobe`。 */
export function resolveFFprobePath(): string {
  const hit = locateFFprobe();
  if (hit) return hit.path;
  warnOnce('[FFprobe] 找不到 ffprobe(FFPROBE_PATH / ffprobe-static / PATH / 常见安装位置都没有),成片体检会失败');
  return 'ffprobe';
}

/**
 * 直接跑一条 ffmpeg 命令(参数数组,不经 shell)。v13.8.1。
 *
 * 要用 `-f lavfi` 造输入(anullsrc 静音、color 纯色)的地方**不要走 fluent-ffmpeg**:它在执行前拿
 * `ffmpeg -formats` 校验每个输入的 `-f`,而 ffmpeg 7+ 的输出多了一列「是否设备」(` D d lavfi`),
 * fluent-ffmpeg 2.1.3 的正则把这行读成名叫 `d` 的格式 —— 于是报「Input format lavfi is not available」。
 * macOS 的 ffmpeg-static 6.0 只有两列,本机永远复现不了;Linux(CI 的 ffmpeg-static 7.0.2、官方镜像的
 * Alpine 8.0.1)上一律失败。`.inputFormat('lavfi')` 和 `.inputOptions(['-f', 'lavfi'])` 都会过这道校验。
 * 失败时 reject 的 Error 带上 stderr 末尾几行(去掉进度行),调用方原有的降级照常生效。
 */
export function runFfmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(resolveFFmpegPath(), ['-hide_banner', '-nostdin', ...args],
      { timeout: opts.timeoutMs ?? 600_000, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const tail = String(stderr || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(frame|size)=/.test(l)).slice(-4).join(' | ');
        reject(new Error(`ffmpeg 失败(${(err as NodeJS.ErrnoException).code ?? 'exit'}):${tail || err.message}`.slice(0, 800)));
      });
  });
}

// fluent-ffmpeg 的二进制路径是进程级全局的(模块里一个 cache 对象),在这里设一次,所有用它的模块都从这里拿。
fluentFfmpeg.setFfmpegPath(resolveFFmpegPath());
fluentFfmpeg.setFfprobePath(resolveFFprobePath());
if (process.env.NODE_ENV !== 'test') {
  const ff = locateFFmpeg();
  const fp = locateFFprobe();
  console.log(`[FFmpeg] Using binary: ${ff ? `${ff.path} (from ${ff.source})` : 'ffmpeg (not found)'}`);
  console.log(`[FFprobe] Using binary: ${fp ? `${fp.path} (from ${fp.source})` : 'ffprobe (not found)'}`);
}

export { fluentFfmpeg as ffmpeg };
