# 下次大版本更新同步清单(GitHub + ModelScope)

> 用户指示(2026-06-04):**下一次大版本(major)更新后**,在 GitHub 与 ModelScope 同步时**必做**。
> 小版本(v9.4.x / v9.5.x 这类)不触发本清单;只有大版本号跳变(如 → v10.0)时执行。

## v10.0 收口执行情况(2026-06-04)

- [x] 更新 `README.md` / `README.zh-CN.md` —— 标题→v10.0、New in→v6→v10(加阶段十六)、版本注记加 v10 行(`v10.0` 提交)
- [x] 更新**产品推广文案** —— `✨ Why` 加 v10 三条护栏(口型/模板/成本)、总览表 v10 行、Tests 徽章→2103
- [x] 重跑 `node scripts/gen-modelscope-intro.mjs` → `docs/modelscope-intro.md` 已同步(0 残留相对图)
- [x] 保留 README 结尾「致谢 + Star History」(未动)
- [x] **首页(landing)新截图** —— `assets/v10/landing.png`(headless Chrome 真实捕获,公开页无需登录)
- [x] **其余模块界面截图**(v10.0.2,2026-06-07)—— 用户登录后:种子化演示数据(demo 项目 + 4 模板 + 质检/成本/对齐)→ 复用会话 token 用 puppeteer 无头截 `assets/v10/{create,templates,qc,cost}.png` → README(中英)New in 区换成 v10 模块 2×2 实拍,深层 v6–v8 图加「早期截图」横幅。
      - 注:demo 数据(项目「霓虹追缉」+ tpl_demo* 模板)留在 dev 库作演示内容,如需清理可删 `proj-demo-v10` 相关行 + `tpl_demo%`。
      - 未重拍的深层模块(导演台/长篇/角色工坊/Polish/团队/时间线 等)仍是 v6–v8 图、已如实标注「早期截图」,后续如需可同法补。

(✅ v10.0 大版本同步全部完成:文案 + 版本 + ModelScope + 首页 + 模块截图。)

---

## ⭐ 常驻规则:每次 GitHub 同步必做(用户指示 2026-06-08)

- [ ] **所有竞品提及(对比表 + 文案)必须刷新为「当下最强」的 AIGC 产品**。
      模型迭代极快——即便同品牌也常已迭代数代,旧版本号会显得过时。每次同步前**联网核实当前 SOTA**
      (`WebSearch` 当年最新榜单)再更新:**列名(产品+版本号)+ 每格能力评估都要按新产品重评**,不能只换名字。
      **覆盖范围**(别只改 README 表!):`README.md` / `README.zh-CN.md` 的「vs. competitors」表 +
      `docs/MARKETING-en.md` / `docs/MARKETING-zh.md` / `docs/modelscope-profile.md` 里的竞品文案 +
      重跑 `gen-modelscope-intro`(它从 README 生成)。`docs/COMPETITIVE-GAP-*.md` / `competitive-analysis-*.md`
      是**带日期的历史分析**,保持不动(代码里 Vidu/Kling 等是自家引擎集成,也不动)。
      > v10.2.3(2026-06-08)执行:`Sora 2 / Kling 2.0 / Vidu Q3 / Runway Gen-4 / Higgsfield`
      > → `Veo 3.1 / Kling 3.0 / Seedance 2.0 / Runway Gen-4.5 / Sora 2`(Sora 2 已宣布 2026 内停服;
      > 新一代已普遍具备多镜 + 一致性 + 原生音频,故重评了多镜/一致/画风/音频各格,并新增「原生对白+音效」行)。
      > 下次同步再核实一遍(Veo/Kling/Seedance 等很可能又出新版)。
