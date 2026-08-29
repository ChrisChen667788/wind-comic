/**
 * v12.381:「一键多语」翻译好了,成片却永远用中文台词。
 *
 * localize 会把翻译稿存成 `script-<lang>` 资产(原稿零破坏,可反复出多语版),
 * 备份存成 `script-original`。于是一个项目的 script 资产可以有好几条 ——
 * 实测 owner 那个汽车广告项目就有三条:「剧本」(中文)、script-ru、script-en。
 *
 * 但**三个消费方选剧本的方式各不相同**:
 *   · localize    —— 过滤掉 `script-*` 再取第一条(唯一正确的那个)
 *   · pull-sheet  —— 直接取 `scriptRows[0]`,不过滤
 *   · recompose   —— 直接取 `scriptAssets[0]`,不过滤
 * 而 `listAssetsByType` 是 `ORDER BY shot_number`,script 资产的 shot_number 全是 NULL,
 * 顺序实际由插入次序决定 —— 现在碰巧中文在前,但那不是任何保证。
 * 迁到 Postgres、重建索引、或只是先出了俄语版,pull-sheet 就会拿俄语剧本
 * 去导一份中文项目的场记表。
 *
 * 更要命的是 recompose 那条:v12.187 给它加了 `body.language`,让 TTS 按语种发音;
 * **但台词来源没跟着切**。传 `language: 'en'` 的结果是 ——
 * 用英语嗓念中文台词,烧上去的字幕也还是中文。多语版做到成片这一步就断了。
 *
 * 所以这里立一个唯一入口:选剧本这件事只有一份实现。
 */

export interface ScriptRowLike {
  name?: string | null;
  data?: string | null;
}

/** localize 写多语稿用的前缀。判据要认「script- + 已知语种码」,而不是笼统的 `script-` 前缀 —— */
/** `script-original` 是备份、`script-drafts` 之类将来也可能出现,它们都不是某个语种的稿子。 */
const LOCALIZED_RE = /^script-([a-z]{2})$/i;
const BACKUP_NAME = 'script-original';

/** 这一条是不是某语种的翻译稿?是就返回语种码。 */
export function localizedLangOf(name: string | null | undefined): string | null {
  const m = LOCALIZED_RE.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** 这一条是不是主稿(既非翻译稿也非备份)? */
export function isPrimaryScript(name: string | null | undefined): boolean {
  const n = String(name || '').trim();
  return n !== BACKUP_NAME && !LOCALIZED_RE.test(n);
}

/**
 * 从一组 script 资产里选出该用哪一条。
 *
 * @param language 目标语种(zh 或空 = 主稿)。有对应翻译稿就用它,没有就退回主稿 ——
 *                 **退回时要让调用方知道**(fellBack),否则「我选了英语却出了别的语种」
 *                 又会变成一次静默降级。注意主稿本身是什么语种**并不确定**,
 *                 所以退回时只说「回退到主稿」,不承诺它是中文。
 */
export function pickScriptAsset<T extends ScriptRowLike>(
  rows: T[] | null | undefined,
  language?: string | null | undefined,
): { row: T | null; usedLanguage: string | null; requested: string | null; fellBack: boolean } {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const want = String(language || '').trim().toLowerCase();
  const wantsTranslation = !!want && want !== 'zh';

  if (wantsTranslation) {
    const hit = list.find((r) => localizedLangOf(r.name) === want);
    if (hit) return { row: hit, usedLanguage: want, requested: want, fellBack: false };
  }

  // 主稿:排除备份与所有翻译稿。找不到主稿时**不要**退回随便一条翻译稿 ——
  // 拿俄语稿去出中文片,比没有剧本更糟。
  //
  // usedLanguage 对主稿一律是 null,**不要写死 'zh'**。我第一版就是这么写的,
  // 而实测 owner 那个汽车广告项目的主稿「剧本」里存的是**日语**台词
  // (created 与 updated 都是 09:53、从未被改过 —— 它一开始就是日语创作的,
  //  不是被 localize 覆盖的)。主稿是什么语种是**未知**,不是中文。
  const primary = list.find((r) => isPrimaryScript(r.name)) || null;
  return {
    row: primary,
    usedLanguage: null,
    requested: wantsTranslation ? want : null,
    fellBack: wantsTranslation && !!primary,
  };
}
