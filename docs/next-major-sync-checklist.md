# 下次大版本更新同步清单(GitHub + ModelScope)

> 用户指示(2026-06-04):**下一次大版本(major)更新后**,在 GitHub 与 ModelScope 同步时**必做**。
> 小版本(v9.4.x / v9.5.x 这类)不触发本清单;只有大版本号跳变(如 → v10.0)时执行。

## v10.0 收口执行情况(2026-06-04)

- [x] 更新 `README.md` / `README.zh-CN.md` —— 标题→v10.0、New in→v6→v10(加阶段十六)、版本注记加 v10 行(`v10.0` 提交)
- [x] 更新**产品推广文案** —— `✨ Why` 加 v10 三条护栏(口型/模板/成本)、总览表 v10 行、Tests 徽章→2103
- [x] 重跑 `node scripts/gen-modelscope-intro.mjs` → `docs/modelscope-intro.md` 已同步(0 残留相对图)
- [x] 保留 README 结尾「致谢 + Star History」(未动)
- [x] **首页(landing)新截图** —— `assets/v10/landing.png`(headless Chrome 真实捕获,公开页无需登录)
- [ ] **其余模块界面截图**(创作工坊 / 模板市场 / 配音口型 / 成本-技术监看 / 成片质检 等)—— **仍待补**
      - 阻塞:① dashboard/项目页需**登录**(我不代填密码,需用户在已连接浏览器点「登录」,演示号 `demo@qfmanju.ai` 已预填);
        ② 新模块需**演示数据**才好看(模板市场空、配音口型/成本需带分镜+成本+对齐分的项目)。
      - 路径:用户登录后 → 我种子化演示数据(几个模板 + 一个带 script/shot-audio/cost_log/lipsync-align 的 demo 项目)→ 逐页截图 → 替换 `assets/v6`·`assets/v8` 旧图。

(首页 + 文案 + 版本 + ModelScope 已随 v10.0 完成;仅「其余模块截图」待用户登录后补。)
