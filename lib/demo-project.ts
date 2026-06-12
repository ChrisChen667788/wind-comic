/**
 * lib/demo-project (v10.5.0) — 演示工程《雨夜信号》一键导入(阶段十八 B 激活专项)。
 *
 * 动机:0 key 的全新安装里一切产物都是占位 —— 新用户要配齐 LLM+图像+视频三把 key
 * 才能看到「完整成片工作台」长什么样(Time-to-Wow > 30 分钟)。本模块用仓库**已内置**
 * 的真实媒体(public/cases 片段 ×4、hero-loop 成片、风格画廊图)+ 手写剧本/审计 JSON,
 * 组装一部 4 镜悬疑短剧直接入库:分镜/视频/成片/时间线/审核/质量分全真,
 * 导出(EDL/AAF/平台)即刻可用。
 *
 * 幂等:固定 DEMO_PROJECT_ID,资产走 upsertAsset —— 重复导入 = 刷新还原,不翻倍。
 * 媒体 URL 全部 root-relative(/cases/…、/styles/…),随仓库走、零外部依赖。
 */
import { getProject, insertProjectFull, updateProjectById } from './repos/project-repo';
import { upsertAsset } from './repos/asset-repo';
import { insertQualityScore } from './quality-scores';
import { getDbDriver } from './db-driver';
import { auditScript } from './pacing-audit';
import { auditHooks } from './hook-audit';

export const DEMO_PROJECT_ID = 'qfmj-demo-showcase';

const TITLE = '雨夜信号(演示工程)';
const IDEA =
  '暮色城市霓虹雨夜:失忆的电台修理工程一帆,凭一段每晚 23:17 准时出现的加密电波,' +
  '追查三年前火灾的真相;天台对峙夜,发报者竟是他以为已经离开这座城市的人。';

const SHOTS = [
  {
    shotNumber: 1,
    shotSize: '全景',
    composition: '纵深构图:巷口透视线引向修理铺,人物居中偏左',
    lens: '广角 24mm,深景深',
    lightingIntent: '霓虹冷暖对撞:青蓝底 + 招牌洋红,湿地反光提亮下半区',
    editPattern: '开场长镜,无剪辑事件',
    scoreMood: '低频合成器铺底,雨声白噪叠加',
    soundDesign: '雨声 + 收音机沙沙声由远及近',
    storyBeat: '钩子:电波之谜',
    whyThisChoice: '全景交代世界观与孤独感,收音机声embeds悬念源',
    scene: '霓虹雨巷',
    character: '程一帆',
    description: '雨夜全景:霓虹倒映在湿漉漉的巷面,程一帆撑伞穿过雨幕,修理铺卷帘门半开,收音机沙沙作响',
    dialogue: '又是 23:17……三年了,这段电波从没迟到过一秒。',
    cameraMovement: '缓慢推近(dolly-in),从巷口全景推至修理铺门面',
    duration: 5,
    image: '/styles/cyberpunk.jpg',
    video: '/cases/clip-a.mp4',
  },
  {
    shotNumber: 2,
    shotSize: '近景',
    composition: '前景示波器绿光占 1/3,照片与频谱并置成对照',
    lens: '50mm,浅景深 rack focus',
    lightingIntent: '示波器绿光为主光源,人脸半明半暗',
    editPattern: '焦点转移即剪辑点',
    scoreMood: '心跳式低音脉冲渐入',
    soundDesign: '摩尔斯码嘀嗒声放大',
    storyBeat: '升级:摩尔斯码破译',
    whyThisChoice: '近景锁定信息揭示瞬间,瞳孔骤缩传递震动',
    scene: '霓虹雨巷',
    character: '程一帆',
    description: '近景:工作台上示波器绿光跳动,程一帆把电波频谱与一张烧焦的旧照片并排放置,瞳孔骤缩',
    dialogue: '这个节奏……是摩尔斯码。「别查了」?不,是「来天台」。',
    cameraMovement: '固定机位 + 焦点从示波器拉至照片(rack focus)',
    duration: 5,
    image: '/styles/seinen-dark.jpg',
    video: '/cases/clip-b.mp4',
  },
  {
    shotNumber: 3,
    shotSize: '中景',
    composition: '逆光剪影居右,城市灯海作底,伞收拢制造动势',
    lens: '85mm,压缩纵深',
    lightingIntent: '逆光金边 + 冷蓝天光,身份揭晓前的暧昧',
    editPattern: '环绕运镜内切至侧脸',
    scoreMood: '弦乐悬停,半终止',
    soundDesign: '雨声渐弱,风声起',
    storyBeat: '反转:发报者现身',
    whyThisChoice: '剪影到侧脸的揭示节奏,把"是谁"压到最后一拍',
    scene: '城市天台',
    character: '苏雨眠',
    description: '天台逆光剪影:苏雨眠背对镜头立于发报机旁,远处城市灯海,雨势渐小,她的伞缓缓收起',
    dialogue: '你终于肯来了。三年前那场火,烧掉的不只是档案馆。',
    cameraMovement: '环绕推移(orbit),从背影绕至侧脸',
    duration: 5,
    image: '/styles/makoto-shinkai.jpg',
    video: '/cases/clip-c.mp4',
  },
  {
    shotNumber: 4,
    shotSize: '双人全景',
    composition: '对峙轴线:两人各占画面三分线,发报机红灯居中',
    lens: '35mm,手持',
    lightingIntent: '红灯规律闪烁切割面部,警笛蓝光扫过',
    editPattern: '双人过肩正反打',
    scoreMood: '打击乐渐密,到顶后骤停',
    soundDesign: '警笛由远及近,发报机嘀嗒声同步红灯',
    storyBeat: '高潮:双重质问(cliffhanger)',
    whyThisChoice: '问题悬置 + 警笛逼近,双重压力推向下一集',
    scene: '城市天台',
    character: '程一帆',
    description: '对峙双人镜:两人相隔十步,发报机红灯规律闪烁,程一帆攥紧照片,远处警笛由远及近',
    dialogue: '那晚的火……是你放的,还是你救的我?',
    cameraMovement: '手持微晃(handheld),切换双人过肩',
    duration: 5,
    image: '/styles/ink-wash.jpg',
    video: '/cases/clip-d.mp4',
  },
];

const CHARACTERS = [
  {
    name: '程一帆',
    description: '32 岁电台修理工,三年前火灾幸存者,左手腕有烧伤疤痕;表面温和,执念极深',
    appearance: '黑色工装外套、深灰围巾,短发微乱,眼下常年青黑;习惯性摩挲手腕疤痕',
    image: '/styles/seinen-dark.jpg',
  },
  {
    name: '苏雨眠',
    description: '29 岁前档案馆管理员,火灾后「失踪」;掌握火灾真相的关键人,亦正亦邪',
    appearance: '米白风衣、长发束起,随身一把黑伞;语速极慢,从不直视对方眼睛',
    image: '/styles/makoto-shinkai.jpg',
  },
];

const SCENES = [
  {
    name: '霓虹雨巷',
    description: '老城区电器维修一条街,霓虹招牌层叠,雨水沿卷帘门滴落;程一帆的修理铺「帆声电台」在巷尾',
    image: '/styles/cyberpunk.jpg',
  },
  {
    name: '城市天台',
    description: '废弃广播大楼天台,锈蚀的发射塔与一台老式发报机;可俯瞰整座城市灯海,是全片真相揭晓地',
    image: '/styles/ink-wash.jpg',
  },
];

const REVIEW = {
  passed: true,
  score: 91,
  dimensions: { 叙事完整度: 92, 视觉一致性: 90, 节奏: 89, 悬念钩子: 94 },
  comments: [
    '开场 5 秒内建立「神秘电波」钩子,黄金 3 秒达标',
    '镜 2 的 rack focus 完成「线索揭示」的视觉语言,无需台词解释',
    '镜 4 以双重反问收束,留足第二集进入动机 —— 集尾悬念分高',
  ],
  reviewedAt: '2026-06-11T00:00:00.000Z',
  reviewer: 'AI 制片人(演示数据)',
};

const PACING_AUDIT = {
  hookSeconds: 4.2,
  beats: [
    { at: 0, label: '钩子:电波之谜' },
    { at: 5, label: '升级:摩尔斯码破译' },
    { at: 10, label: '反转:发报者现身' },
    { at: 15, label: '高潮:双重质问' },
  ],
  verdict: '四镜三转,节奏密度适配竖屏短剧;建议第二集开场直接接警笛声桥。',
};

/**
 * 导入(或刷新)演示工程。幂等:重复调用 = 还原为出厂内容。
 * 返回 projectId;调用方负责鉴权。
 */
export async function importDemoProject(userId: string): Promise<{ projectId: string; refreshed: boolean }> {
  const existing = await getProject(DEMO_PROJECT_ID);
  const scriptData = {
    title: TITLE,
    synopsis: IDEA,
    theme: 'noir-mystery',
    shots: SHOTS.map(({ image, video, ...s }) => s),
  };
  // v10.6.2: 对演示内容跑真节奏/钩子审计(demo 字段名 → ScriptShot 映射),
  // 节奏分析 tab 含钩子审计三指标即开即见。BGM 卡点:demo 无真 BGM → 诚实标不可测。
  const auditShots = SHOTS.map((s) => ({
    shotNumber: s.shotNumber,
    sceneDescription: s.description,
    action: s.description,
    emotion: '',
    characters: [s.character],
    dialogue: s.dialogue,
    duration: s.duration,
  }));
  const demoScript = { title: TITLE, synopsis: IDEA, shots: auditShots } as any;
  const pacingReport = auditScript(demoScript, { dramaMode: true });
  pacingReport.hooks = auditHooks(demoScript);
  (scriptData as any).pacingReport = pacingReport;

  if (!existing) {
    await insertProjectFull({
      id: DEMO_PROJECT_ID,
      userId,
      title: TITLE,
      description: IDEA,
      coverUrls: [SHOTS[0].image],
      status: 'completed',
      styleId: 'cyberpunk',
      primaryCharacterRef: null,
      lockedCharacters: [],
    });
  }
  await updateProjectById(DEMO_PROJECT_ID, {
    status: 'completed',
    cover_urls: JSON.stringify([SHOTS[0].image]),
    script_data: JSON.stringify(scriptData),
    director_notes: JSON.stringify(REVIEW),
  });

  // ── 资产(全部 upsert,重复导入零翻倍)──
  const put = (type: string, name: string, data: unknown, mediaUrls: string[] = [], shotNumber?: number) =>
    upsertAsset({ projectId: DEMO_PROJECT_ID, type, name, data, mediaUrls, shotNumber: shotNumber ?? null });

  await put('plan', '导演计划', {
    title: TITLE,
    theme: 'noir-mystery',
    characters: CHARACTERS.map((c) => ({ name: c.name, description: c.description })),
    scenes: SCENES.map((s) => ({ name: s.name, description: s.description })),
    tone: '悲情基调 / 紧张节奏',
  });
  await put('script', '剧本', scriptData);
  await put('styleBible', 'Style Bible Key Art', { url: SHOTS[0].image }, [SHOTS[0].image]);
  for (const c of CHARACTERS) {
    await put('character', c.name, { description: c.description, appearance: c.appearance }, [c.image]);
  }
  for (const s of SCENES) {
    await put('scene', s.name, { description: s.description, location: s.name }, [s.image]);
  }
  for (const s of SHOTS) {
    await put('storyboard', `镜头 ${s.shotNumber}`, {
      description: s.description,
      duration: s.duration,
      cameraMovement: s.cameraMovement,
      dialogue: s.dialogue,
      cameoScore: 88 + s.shotNumber, // 演示数据:一致性徽章有内容可看
    }, [s.image], s.shotNumber);
    await put('video', `视频 ${s.shotNumber}`, {
      duration: s.duration,
      status: 'completed',
      coverImageUrl: s.image,
    }, [s.video], s.shotNumber);
  }
  await put('final_video', '最终成片', { duration: SHOTS.length * 5 }, ['/hero-loop.mp4']);
  await put('timeline', '剪辑时间线', {
    totalDuration: SHOTS.length * 5,
    finalVideoUrl: '/hero-loop.mp4',
    pacingAudit: PACING_AUDIT,
    clips: SHOTS.map((s) => ({ shotNumber: s.shotNumber, start: (s.shotNumber - 1) * 5, duration: s.duration, videoUrl: s.video })),
  });

  // 质量分(质量 tab 有真数据;失败不阻断 —— 演示导入是体验增强,不是关键路径)
  try {
    await insertQualityScore({
      projectId: DEMO_PROJECT_ID,
      overall: 91, continuity: 90, lighting: 92, face: 89,
      narrative: '四镜三转完成「电波之谜→破译→现身→质问」闭环;镜 4 双重反问为续集留钩,叙事完成度高。',
      sampleFrames: SHOTS.map((s) => s.image),
      suggestions: {
        continuity: ['镜 3 与镜 4 之间可加 0.5s 黑场,强化对峙呼吸感'],
        lighting: ['雨夜霓虹色温建议统一 4800K,镜 2 示波器绿光可再压 10%'],
        face: ['苏雨眠侧脸镜(镜 3)建议补一帧正面特写入角色库锁脸'],
      },
    });
  } catch (e) {
    console.warn('[demo-project] quality score 写入失败(不阻断):', e instanceof Error ? e.message : e);
  }

  // v10.6.4: 「还原出厂」补全 —— upsert 不碰 stale 列,跨场景演示(台账标失效/
  // retake 标待重渲)会留下残留;重置时统一归零,让幂等导入名副其实。
  await getDbDriver().run('UPDATE project_assets SET stale = 0 WHERE project_id = ?', [DEMO_PROJECT_ID]);

  return { projectId: DEMO_PROJECT_ID, refreshed: !!existing };
}
