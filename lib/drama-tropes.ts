/**
 * v2.20 P0.2 — 中国短剧/漫剧专用 hook tropes 库.
 *
 * 背景:
 *   现有 Writer prompt 是 McKee 三幕 + 戛纳气质. 这对长片好, 但对竖屏短剧致命 —
 *   短剧观众前 3 秒不上钩就划走, 6 个镜头讲不完一个完整三幕. 必须用 "钩子 + 反转
 *   + 强冲突" 的密集剧情结构, 每个镜头都要"事件 + 情绪转折".
 *
 * 这个 lib 提供:
 *   1. detectDramaGenre(genre/idea) — 检测是否属于短剧类型, 给出 trope key
 *   2. DRAMA_TROPES — 12 个最常见的中国短剧开场模板
 *   3. buildDramaTropeBlock(genre) — 拼一段 prompt 段落注入 Writer system prompt,
 *      告诉 LLM "如果剧本属于这类, 第 1 镜应该这么写"
 *   4. DRAMA_REVERSAL_DENSITY_RULES — 反转密度硬性约束
 *   5. shouldDefaultToVertical(genre) — 漫剧类应默认 9:16 竖屏
 */

export type DramaTropeKey =
  | 'reborn'        // 重生流: 醒来回到 N 年前 + 预知关键事件
  | 'system'        // 系统流: 突然听到系统提示音
  | 'reveal'        // 隐藏身份/战神归来: 平凡者亮出真实身份打脸
  | 'slap'          // 打脸/反差: 被瞧不起的人当场反杀
  | 'transmigrate'  // 穿越: 醒来发现自己在另一个世界/朝代
  | 'rich-vs-poor'  // 霸总: 灰姑娘遇到霸道总裁, 身份差距冲突
  | 'revenge'       // 复仇: 被害者抓住反派把柄
  | 'amnesia'       // 失忆: 醒来失去记忆, 周围人态度异常
  | 'cliffhanger'   // 危机起手: 主角已经处在危险中, 倒叙
  | 'mistaken'      // 误会: 关键对话被错位解读
  | 'pregnant'      // 隐孕: 女主未告知男方却已怀孕 (古装言情/都市常见)
  | 'family-feud';  // 家族斗争: 豪门 / 宫斗 / 江湖派系内部撕逼

export interface DramaTrope {
  key: DramaTropeKey;
  /** 触发的中文 genre 关键词 */
  genreKeywords: string[];
  /** Hook 的 1 句话核心 */
  hookCore: string;
  /** 第 1 镜的视觉模板 */
  shot1Visual: string;
  /** 第 1 镜的对白模板 (示例性, LLM 可改写) */
  shot1Dialogue: string;
  /** 后续 5 镜的节奏建议 */
  beatPlan: string;
}

export const DRAMA_TROPES: DramaTrope[] = [
  {
    key: 'reborn',
    genreKeywords: ['重生', '回到', '前世', '醒来', 'reborn', 'rebirth'],
    hookCore: '主角带着前世记忆醒在过去某关键时间点, 第 1 镜要表达"我知道接下来会发生什么"的震撼',
    shot1Visual: '主角猛地睁眼, 镜头快推近, 背景模糊到失焦, 一个时间符号在画面里清晰出现 (日历 / 手机 / 报纸日期)',
    shot1Dialogue: '"...这是 X 年? 我重生了?" (心声, 不出声)',
    beatPlan: '镜 2: 印证日期 + 关键人物登场; 镜 3: 主角故意改变前世某个动作; 镜 4: 反派 / 关键人物的反应; 镜 5: 关键转折; 镜 6: 留下下一集钩子',
  },
  {
    key: 'system',
    genreKeywords: ['系统', '签到', '兑换', 'system', '游戏'],
    hookCore: '主角在平凡或危急时刻突然听到系统提示音, 拿到第一个外挂',
    shot1Visual: '主角处于劣势 (被欺负 / 落魄), 突然眼前浮现半透明系统面板',
    shot1Dialogue: '"叮 — 系统绑定成功, 宿主请选择初始 SSR 卡牌"',
    beatPlan: '镜 2: 主角懵 + 试用系统; 镜 3: 第一次小胜; 镜 4: 周围人不可思议反应; 镜 5: 更大的对手现身; 镜 6: 系统给关键提示, cliffhanger',
  },
  {
    key: 'reveal',
    genreKeywords: ['战神', '兵王', '归来', '扮猪', '隐藏', '废柴', 'reveal'],
    hookCore: '主角被当成废物, 但因某个刺激事件被迫亮出隐藏身份',
    shot1Visual: '主角在公开场合被羞辱 (扇耳光 / 当众下跪要求), 镜头给低位仰角强调屈辱',
    shot1Dialogue: '反派: "就你这种废物也配站在这里?" 主角: (沉默, 拳头紧握)',
    beatPlan: '镜 2: 第三方刺激事件 (家人受辱 / 重要人物伤亡); 镜 3: 主角眼神变, 接电话或拨电话; 镜 4: 顶级身份的人物或场景出现回应; 镜 5: 反派面色大变; 镜 6: 主角冷笑 cliffhanger',
  },
  {
    key: 'slap',
    genreKeywords: ['打脸', '反杀', '装逼', '逆袭', 'slap'],
    hookCore: '被瞧不起的主角当场反杀对方, 强烈反差感',
    shot1Visual: '反派得意洋洋的近景特写, 然后镜头切到主角面无表情正面',
    shot1Dialogue: '反派: "你这种人也敢顶嘴?" 主角: "你确定要继续?"',
    beatPlan: '镜 2: 主角亮证据 / 出手; 镜 3: 反派懵; 镜 4: 围观者倒抽冷气; 镜 5: 反派求饶; 镜 6: 主角转身离开, 留下名场面台词',
  },
  {
    key: 'transmigrate',
    genreKeywords: ['穿越', '魂穿', '异世界', 'transmigrate', '时空'],
    hookCore: '现代人灵魂穿到古代/异世界, 第 1 镜要把"环境陌生 + 身份陌生"双重冲击拍出来',
    shot1Visual: '主角缓缓睁眼, 视野所及是完全不同的环境 (古代闺房 / 异世大殿), 配以华美但陌生的服饰',
    shot1Dialogue: '"这是哪? 我...怎么穿着古装?" (一只手摸到陌生的发髻)',
    beatPlan: '镜 2: NPC 称呼揭穿身份 ("XX 小姐, 您醒了?"); 镜 3: 主角试探接受设定; 镜 4: 第一个具体冲突 (婚约 / 处境); 镜 5: 主角用现代知识破局; 镜 6: 旁观者反应 + 钩子',
  },
  {
    key: 'rich-vs-poor',
    genreKeywords: ['霸总', '总裁', '灰姑娘', '豪门', '言情'],
    hookCore: '强烈身份悬殊的两人在第 1 镜以冲突方式相遇',
    shot1Visual: '主角女 (灰姑娘): 落魄 / 在街边. 切到豪车里走出的男主, 用低角度仰拍突出气势',
    shot1Dialogue: '男: "把车划痕擦干净, 否则 — 嗯?" (停顿, 看到女主) "...你?"',
    beatPlan: '镜 2: 女主认出 / 不认出男主造成误会; 镜 3: 第三方介入 (秘书 / 闺蜜); 镜 4: 关键身份揭露; 镜 5: 女主面色大变; 镜 6: 男主撂下决定性话 cliffhanger',
  },
  {
    key: 'revenge',
    genreKeywords: ['复仇', '黑化', '反派', 'revenge'],
    hookCore: '主角曾被伤害过, 第 1 镜要展现 ta 在执行复仇计划的关键瞬间',
    shot1Visual: '黑暗中的主角眼睛特写, 紧接画面切回过去某个伤痛瞬间的闪回 (≤1s)',
    shot1Dialogue: '"五年了, 我等的就是今天" (心声 / 低语)',
    beatPlan: '镜 2: 复仇对象登场 + 不知情; 镜 3: 主角主动接近; 镜 4: 关键证据/把柄揭开; 镜 5: 对方崩溃; 镜 6: 主角说出最后通牒 cliffhanger',
  },
  {
    key: 'amnesia',
    genreKeywords: ['失忆', '记忆', 'amnesia'],
    hookCore: '主角醒来不记得过去, 周围人态度异常带出最大悬念',
    shot1Visual: '主角睁眼在医院 / 陌生家中, 周围有人小心翼翼盯着',
    shot1Dialogue: '"...你们...是谁?" (周围人面色微妙)',
    beatPlan: '镜 2: 镜中看见自己 + 不认识; 镜 3: 第一个揭示者讲故事 (但版本可疑); 镜 4: 一个细节让主角觉得不对; 镜 5: 关键真相浮现; 镜 6: 主角眼神变 cliffhanger',
  },
  {
    key: 'cliffhanger',
    genreKeywords: ['危机', '生死', '绑架', '追杀', '逃亡'],
    hookCore: '第 1 镜直接进入主角处于极端危险的瞬间, 然后倒叙',
    shot1Visual: '主角被压在地面 / 被枪指着头 / 落水挣扎, 紧张特写',
    shot1Dialogue: '反派: "最后一次机会, 说不说?" 主角: (面无表情)',
    beatPlan: '镜 2: "六小时前" 字幕 + 平静日常; 镜 3: 关键事件触发危机; 镜 4: 主角追溯到真相; 镜 5: 回到现在危机重演但有反转; 镜 6: 主角破局 cliffhanger',
  },
  {
    key: 'mistaken',
    genreKeywords: ['误会', '错位', '认错'],
    hookCore: '一个关键对话或动作被错误解读, 引发连锁反应',
    shot1Visual: '两人对话, 第三方从某个角度只看到/听到部分内容, 表情骤变',
    shot1Dialogue: 'A: "我跟她说清楚就好" 第三方 (旁白): "...原来他真的喜欢她"',
    beatPlan: '镜 2: 第三方做出基于误会的决定; 镜 3: 主角发现被误会但不解释; 镜 4: 误会升级; 镜 5: 真相意外被揭穿; 镜 6: 三方反应 + 关系裂痕',
  },
  {
    key: 'pregnant',
    genreKeywords: ['隐孕', '怀孕', '孩子', '父亲是谁'],
    hookCore: '女主已怀孕未告知男方, 即将面对真相揭穿的关键时刻',
    shot1Visual: '女主独自一人在镜前侧身看肚子, 然后接到一通电话, 表情骤变',
    shot1Dialogue: '电话那头: "他要订婚了, 你看新闻了吗?" 女主: (沉默, 手扶腹部)',
    beatPlan: '镜 2: 男主订婚现场 (女主未到); 镜 3: 女主带孩子相关物件出现在意外场合; 镜 4: 男主发现关键证据; 镜 5: 摊牌; 镜 6: 三方关系决裂或重连 cliffhanger',
  },
  {
    key: 'family-feud',
    genreKeywords: ['豪门', '宫斗', '家族', '继承', '权力'],
    hookCore: '一个看似平静的家族聚会下暗流涌动, 第 1 镜要拍出权力博弈',
    shot1Visual: '家族大餐桌长镜头, 镜头慢推, 每个人面色都不太对, 中央摆着某个意味深长的物件 (遗嘱 / 印鉴 / 老照片)',
    shot1Dialogue: '家主: "今天叫大家来, 是有件事要宣布..." (镜头切到几个特写, 表情各异)',
    beatPlan: '镜 2: 关键决定宣布 (继承人 / 联姻); 镜 3: 不服的派系当场反对; 镜 4: 暗中递眼神 / 短信; 镜 5: 第一个出招者动作; 镜 6: 主角 (沉默到现在) 终于开口 cliffhanger',
  },
];

const DRAMA_GENRE_REGEX = /(短剧|漫剧|霸总|重生|战神|穿越|宫斗|逆袭|爽剧|甜宠|虐恋|系统流|vertical|drama|reborn|transmigrate)/i;

/**
 * 检测 idea + genre 字段是否属于 "短剧" 范畴.
 * 命中 → 应启用 漫剧 Mode (短剧 tropes + 9:16 默认 + 反转密度规则).
 */
export function isDramaContext(genre: string | undefined, idea?: string): boolean {
  const text = `${genre || ''} ${idea || ''}`.toLowerCase();
  return DRAMA_GENRE_REGEX.test(text);
}

/**
 * 根据 genre + idea 识别最匹配的 trope (可能多个 — 返回第一个命中的, 按 DRAMA_TROPES 顺序).
 * 没命中返回 null — 让 LLM 自由发挥.
 */
export function detectTrope(genre: string | undefined, idea?: string): DramaTrope | null {
  const text = `${genre || ''} ${idea || ''}`.toLowerCase();
  for (const trope of DRAMA_TROPES) {
    for (const kw of trope.genreKeywords) {
      if (text.includes(kw.toLowerCase())) return trope;
    }
  }
  return null;
}

/**
 * 应该默认竖屏 9:16 吗? 短剧/漫剧默认 yes, 其他 no.
 */
export function shouldDefaultToVertical(genre?: string, idea?: string): boolean {
  return isDramaContext(genre, idea);
}

/**
 * 给 Writer system prompt 注入一段"如果这是短剧, 这么写"的强约束.
 * 内容包括: 命中 trope 的 shot1 模板 + 反转密度规则 + cliffhanger 收尾要求.
 *
 * 调用方应在 Writer prompt 里追加这块, 让 LLM 在生成第 1 镜时遵守.
 */
export function buildDramaTropeBlock(genre: string | undefined, idea?: string): string {
  if (!isDramaContext(genre, idea)) return '';

  const trope = detectTrope(genre, idea);
  const parts: string[] = [];

  parts.push('## ⚡ 漫剧模式 (Vertical Drama Mode)');
  parts.push('');
  parts.push('你正在写的是中国竖屏短剧 — 观众**前 3 秒不上钩就划走**. 不是文艺片, 是 Douyin/快手/红果级别的 "上头" 短剧.');
  parts.push('');
  parts.push('### 硬性规则 (违反就废稿):');
  parts.push('1. **第 1 镜必须是钩子**, 不能是 "介绍主角名字 / 介绍世界观 / 主角今天天气真好". 必须是: 危机 / 反转 / 强冲突 / 突发事件 / 关键悬念之一.');
  parts.push('2. **每个镜头都要有事件 + 情绪转折**, 不能有 "纯过场" 镜头. 哪怕只有 5 秒, 也要有"翻 1 张牌"的效果.');
  parts.push('3. **反转密度**: 6 镜里至少 2 次明显反转 (15s 一次), 否则节奏崩.');
  parts.push('4. **对白节奏强**: 短促有力, 一句不超过 25 字; 对白 70%+, 旁白 ≤30%.');
  parts.push('5. **最后 1 镜必须 cliffhanger**, 留下"下一集会发生什么"的明确钩子, 不能用"完美收尾"的电影结构.');
  parts.push('6. **画面竖屏**: 构图要把主体往中下偏置 (9:16 看手机, 顶部 1/4 通常是状态栏 / 字幕安全区).');
  parts.push('');

  if (trope) {
    parts.push(`### 检测到 trope: **${trope.key}**`);
    parts.push(`- **核心钩子**: ${trope.hookCore}`);
    parts.push(`- **第 1 镜画面**: ${trope.shot1Visual}`);
    parts.push(`- **第 1 镜对白模板** (可改写, 但情绪等价): ${trope.shot1Dialogue}`);
    parts.push(`- **节奏建议**: ${trope.beatPlan}`);
    parts.push('');
  } else {
    parts.push('### 未命中具体 trope, 但仍按短剧节奏:');
    parts.push('参考下列模板任选 1 种作为第 1 镜钩子结构:');
    for (const t of DRAMA_TROPES.slice(0, 4)) {
      parts.push(`- ${t.key}: ${t.hookCore}`);
    }
    parts.push('');
  }

  parts.push('### 反例 (绝不要这么写):');
  parts.push('- ❌ "晨曦初露, XX 漫步在小巷, 思考着人生" (没事件, 没冲突, 划走)');
  parts.push('- ❌ "(画外音介绍) 在那遥远的国度, 有一个名叫 XX 的少年..." (旁白堆设定, 划走)');
  parts.push('- ❌ "结束: 主角看着远方微笑, 一切都过去了" (没钩子, 没下集预期)');
  parts.push('');
  parts.push('### 正例参考:');
  parts.push('- ✅ 镜 1: 主角被当街扇耳光, 围观者议论, 主角冷笑 → 镜 2: 主角拨电话, 接通后只说 "你过来"');
  parts.push('- ✅ 镜 6 (结尾): 反派得意"你完蛋了" → 主角递出一份文件 → 反派表情冻结 → BLACK');
  parts.push('');

  return parts.join('\n');
}
