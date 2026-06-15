# 阶段二十一 · 全局资产记忆库 v2(角色/资产一致性升级)(v12.2.x)

> 触发:竞品分析锁定的最大同构威胁 —— **OiiOii(2026-04 全球首发,7 Agent,与本项目架构高度同构)**
> 的核心卖点是「**全局资产记忆库:每个角色高维特征向量,跨场景一致性**」。本项目一致性机制
> 已很厚(8 维 DNA / cref+sref / 连续性 / cameo 重生),但**跨集/跨项目的资产「记忆+复用」是空的**。
> 本阶段把它补上 —— 且优先**激活已有但未用的地基**,而非重建。

---

## 一、现状诊断(5 路并行 reader 实测 + 关键声明已逐条核验)

### 1.1 一致性机制已很厚(勿重复立项)
- **角色身份**:`lib/character-dna.ts` 8 维 DNA(vision LLM 抽,逐镜 `injectDnaIntoPrompt`)+ `lib/character-traits.ts`(剧本/人脸抽 8 字段)。
- **参考注入**:`lib/consistency-policy.ts` `pickConsistencyRefs()`——4 级 cref + 3 级 sref + 角色 cw(25–125);`lib/reference-elements.ts` `bindElements()` 多模态元素路由;Style Bible 帧 `prependStyleAnchor`。
- **连续性**:`lib/continuity.ts` seed 锁 / link mode / FaceID 强度 / 服装·光照锁 → `compileContinuityDirectives()`。
- **cameo 一致性 QA**:`lib/cameo-vision.ts` `scoreShotConsistency`(face/outfit/identity)+ `services/cameo-retry.ts` 低分(<75)单次自动重生(cw 提权 + sref 注入,回退保最优)。
- **报告**:`lib/consistency-report.ts` 多轮分维趋势 + 最弱维。
- **跨项目角色库**:`global_assets`(type='character')`upsertCharacterBible`(累积 ≤10 sampleFaces)+ `findCharacterBibleByName`(**精确名查**)。

### 1.2 真实缺口(本阶段要补的)
| 缺口 | 实测证据 | 影响 |
|---|---|---|
| **`embedding` 死列** | `global_assets.embedding TEXT`(SQLite `lib/db.ts:166` 注「JSON array 768 维向量 v2.1 启用」+ PG `db/schema.pg.sql:142`)—— 读时 parse,**写时恒 null**;`lib/global-assets.ts:11` 注「目前仅保留列」 | 有向量地基,但从未通电 → 无相似检索 |
| **跨集复用 = 精确名匹配** | `findCharacterBibleByName` 大小写敏感字符串相等;名变体/错字 → 建新角色 | 同一角色重复建、跨集漂移 |
| **`visual_anchors` 无检索路径** | 3–5 条人写描述符,只手动拼进 prompt,无相似匹配 | 描述有了但「找相似」用不上 |
| **per-run 易失态** | DNA map / lockedCharacters / Style Bible / SceneAnchorRegistry 全在 orchestrator 内存,run 间丢失;DNA 每次重抽 | 重复 vision 成本 + 早镜漏注入(DNA 抽完前已开拍) |
| **名称不归一** | dnaMap 以原始名为 key,「林小满」vs「小满」漏注入 | 身份注入静默丢失 |
| **身份 QA 是 LLM 文本判断** | `scoreShotConsistency` 走 vision LLM 文字比对,非 embedding 距离 | 非确定、量不准、抓不到渐进漂移 |

### 1.3 关键声明核验(linchpin,已直接看代码确认)
- ✅ `global_assets.embedding` 列在 SQLite + PG 都已存在、读时 parse、**从未写值**。
- ✅ `addColumnIfMissing`(`lib/db.ts:351`)可用 → 加列零迁移成本。
- ✅ `upsertCharacterBible` / `findCharacterBibleByName` 已在,扩它而非另起。

---

## 二、设计哲学(承袭本项目「确定性启发式 + BYO + 诚实降级 + 复用不重建」)
- **复用不重建**:`embedding` 列、DNA、cref/sref、cameo 重生全已建成 —— v2 = **给死列通电 + 把易失态落库 + 加检索**,不另造系统。
- **确定性地板 + BYO 增强**:跨集复用的**确定性地板** = 精确名 + `visual_anchors` 文本匹配(永远可跑);**向量相似**是 BYO 增强(配 embedding key 才激活),无 key → 列保持 null、退回现状,**诚实降级**。
- **轻依赖**:不引 Python/CLIP 运行时;文本 embedding 走现有 LLM 网关(text-embedding-3-small 类)对 `visual_anchors + DNA promptBlock` 嵌入;图像 embedding(漂移检测用)走 BYO 托管端点,缺则退回现有 LLM 评分。
- **资产量级小** → 内存余弦相似即可,不上 pgvector(避免重依赖;量级大了再议)。

---

## 三、版本拆解 · 阶段二十一 A · 全局资产记忆库 v2(v12.2.x)

### v12.2.0 — 名称归一 + DNA 命中匹配修复(确定性,先堵漏)【S】✅ 已交付(commit 8194e2d)
- **名称归一**:`normalizeCharacterName()`(同源 `consistency-policy` normalizeKey + 扩 CJK 角括号「」『』)导出。
- **DNA 命中匹配**:`matchDnaForName()` 复用 `matchLockedCharactersInShot` 策略(原样精确 → 归一精确 → 子串双向 ≥2 字符);`injectDnaIntoPrompt` 改走它 + 同 DNA 去重 → 修「林小满(镜头)vs 小满(dnaMap)」静默漏注入。orchestrator 透明受益(已调 injectDnaIntoPrompt,无需改)。
- 纯函数、零依赖、零 BYO。**单测**:归一 + 归一精确 + 子串命中 + 单字不误匹配 + 去重(6 例)。

### v12.2.1 — 记忆持久化地基(DNA/场景锚落库,确定性)【S】✅ 已交付(commit 8c541f1)
- **DNA 落库(项目级)**:抽出即 upsert 到 `project_assets`(type='character-dna',按归一名 key,data={name,dna});orchestrator 分镜前 `preloadCharacterDnaFromDb()` 预载 → rerun/重启不重抽 vision + 早镜(异步抽取未完成前)补注入。DNA 改**合并不替换**,与预载共存。
  > 实现取 **project_assets 而非 character_library.dna 列**:orchestrator 只有 projectId 无 userId(跨项目 bible 落 DNA 留 v12.2.3 复用刀,届时 API 路由有 userId);且 bible 本就存 `metadata.bible` JSON,无需新列。
- **场景锚落库**:`SceneAnchorRegistry` 加 `toEntries()`/`seed()`;分镜前从 `project_assets`(type='scene-anchor')seed,登记后持久化 → rerun/重启复用上次场景锚(首张基线优先,不覆盖)。
- 纯确定性、复用 `upsertAsset`/`listAssetsByType`。**验证**:tsc 0 + vitest 2329(+4 SceneAnchor round-trip/seed 容错/共存)+ journey e2e 通(DB 实证 scene-anchor 落库、新路径零报错)。

### v12.2.2 — 资产向量化(BYO embedding,把死列通电)【M】✅ 已交付(commit ffc124c)
- `lib/asset-embedding.ts`:`cosineSimilarity`/`topKByCosine`/`buildEmbedSource`(纯函数)+ `embedText`(BYO,走 OpenAI 兼容网关 `OPENAI_EMBED_MODEL`,无 key/MOCK/失败 → null 诚实降级)。
- `global-asset-repo`:`embedAsset(id)`(buildEmbedSource → embedText → 写 `embedding` 列 bare number[] + metadata 记 model/dim);`findSimilarGlobalAssets(userId, {vector,model}, opts)`(拉非空 embedding 行 → **按 model+dim 过滤异构** → 内存余弦 topK);`setGlobalAssetEmbedding`。
- `upsertCharacterBible` 新建/更新后机会主义 `void embedAsset(id)`(fire-and-forget,失败不阻塞)。
- **验证**:tsc 0 + vitest 2342(+13:余弦同/正交/反向/异维 0、topK 降序/minScore/无向量剔除、嵌入源拼接/两 DNA 落点/截断、embedText MOCK 零调用/空文本/模型 env)。检索接 UI+管线在 v12.2.3。

### v12.2.3 — 跨集/跨项目复用(检索接 UI)【M】✅ 已交付(commit 5a20b79)
- `/api/global-assets/similar?q=&type=&k=`:向量优先(`embedText` 嵌入 query → `findSimilarGlobalAssets`),无 key/MOCK/向量库空 → 退回 `findSimilarGlobalAssetsByText`(确定性 `textMatchScore`:名归一精确 1 / 子串 0.7 / CJK 2-gram+latin 词覆盖 ≤0.6)。按 user 隔离,返回 {mode,results[{id,name,thumbnail,score,bible}]}。
- `CharacterLockSection`:精确名(已有 bibleHit)未命中 → 查 similar 路由,展示「🔁 你库里有相似角色」推荐(头像+相似度%+带DNA标),**一键复用形象**(防重复建 + 跨集漂移)。
- **验证**:tsc 0 + vitest 2348(+6 textMatchScore:精确/子串/词覆盖/无关/优先级单调)+ e2e(种带头像库角色 → 路由近似名命中 → 工坊填近似名出推荐 + 复用按钮 → 清理)。
- 注:管线 `injectDnaIntoPrompt` 跨库 DNA 回退需 orchestrator userId(同 v12.2.1 约束),留作 B 项;本刀聚焦建角色入口的复用 surface。

### v12.2.4 — 身份漂移检测(成片级一致性体检,embedding 距离)【M】✅ 已交付(commit 159e483)
- `lib/drift-detect.ts` `detectDriftOutliers`(纯函数):逐镜「到其余镜的平均余弦距离」= 离群程度 → 相对(mean+z·std)+ 绝对地板(minDrift 0.15)双判 → 标漂移最大的 outlier 镜,降序截断。
- `lib/asset-embedding.ts` `embedImage`(BYO,需配 `IMAGE_EMBED_MODEL` 多模态嵌入端点;未配/无 key/MOCK/失败 → null 诚实降级)。
- `/api/projects/[id]/drift-check`:嵌全部 storyboard 图(并发 2)→ detectDriftOutliers → 返回 outlier 镜(可喂 v9.4.2 最弱镜重生);无图像嵌入能力 → `{available:false, reason}`,前端退回现有 `scoreShotConsistency` LLM 评分。
- **验证**:tsc 0 + vitest 2353(+5:跑偏标记/高一致不误报/<2 不可判/截断降序/minDrift 地板)+ e2e(路由契约 + 诚实降级)。

> **阶段二十一 A 收官** = 全局资产记忆库通电(名称归一 → 记忆持久化 → 向量化 → 跨集检索复用 → 漂移体检),正面对标 OiiOii「角色高维特征向量 + 跨场景一致性」,且全程**无 key 可用(确定性地板)、有 key 增强(向量)**。

---

## 四、阶段二十一 B · 收尾(v12.2.5–.8,全部交付)
- ✅ **v12.2.5 lockedCharacters 归一表**:`project_locked_characters` 表(SQLite+PG)+ `upsertLockedCharacters`/`getLockedCharactersByName`,双写(JSON 仍读源)+ 级联删。
- ✅ **v12.2.6 turnaround 派发**:核实派发早已接通(v6.0.1 studio 路由 dispatchImageGenerate),计划「stub」是误判;本刀只做 `TurnaroundView.imageUrl` 类型收口。
- ✅ **v12.2.7 IP 反向同步**:`character_library.stale` 列 + `fanOutTokenInvalidation`(撤销 → 导入行标 stale + 发通知),接进 `revokeIpToken`。
- ✅ **v12.2.8 cameo 重生升级**:`CAMEO_RETRY_MAX_ATTEMPTS` 1→2 + keep-best 多次重生循环(逐次升 cw+sref)+ `needsHumanReview` 待人审标记,透传到 Storyboard/落库/单镜重拍。

---

## 五、风险与非目标
- **非目标**:不上 pgvector / 向量数据库(资产量级小,内存余弦够);不引 CLIP/ArcFace Python 运行时(图像 embedding 走 BYO 托管端点)。
- **风险**:embedding 维度/模型不一致 → 余弦无意义。对策:`embedAsset` 记录 model+dim,检索时只比同 model 行;混维跳过。
- **诚实降级**:无 embedding key → `embedding` 列保持 null、退回精确名 + visual_anchors 文本匹配(= 现状),UI 不假称「向量记忆已开」。
- **隐私**:跨项目复用限同一 user(`findSimilarGlobalAssets(userId, …)` 按 user 隔离);不跨用户检索资产。
