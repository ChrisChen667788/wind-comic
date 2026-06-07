# 下次大版本更新同步清单(GitHub + ModelScope)

> 用户指示(2026-06-04):**下一次大版本(major)更新后**,在 GitHub 与 ModelScope 同步时**必做**。
> 小版本(v9.4.x / v9.5.x 这类)不触发本清单;只有大版本号跳变(如 → v10.0)时执行。

- [ ] 更新 `README.md` / `README.zh-CN.md` —— 随大版本新能力刷新功能说明、版本注记(按大版本合并)
- [ ] 更新**产品推广文案** —— 卖点 / 亮点段(`✨ Why` · `🚀 Highlights` 等)贴合新版本,突出新增护城河
- [ ] **用新一批界面截图替换旧的**(用户 2026-06-04 再次强调)—— 跑当前 app 重新截 **最新版首页(landing)** + 各核心模块界面(创作工坊 / 控片台 / 成片质检 / 一致性 / 灵感库 / **模板市场** / **配音口型** / 技术监看-成本 等),替换 `README` 与 `assets/` 下旧图(旧的 v6/v8 截图已过时);**首页截图务必更新**
- [ ] 保留 README 结尾「致谢 + Star History」
- [ ] 重跑 `node scripts/gen-modelscope-intro.mjs` → 同步 `docs/modelscope-intro.md`(图走 raw/PNG,ModelScope 可靠渲染)

(本清单为待办备忘;做完即勾,或随大版本提交一并清理。)
