# 自托管视频端点(v12.420)

`services/selfhost-video.service.ts`(v12.411)接通了「自托管开源生成端点」,
但当时只给了一份 **HTTP 契约** —— 想用 Wan 2.7 / LTX-2.5,还得自己写一个服务
把推理脚本包成那个契约。竞品复核把这条记成 **C14「接了但没到位」**:
接口有了,离用户真能用还差一层,而那一层的门槛不低。

`server.mjs` 就是那一层。

## 它不做什么(先说清楚)

**不含模型权重,不替你装推理环境。** 权重几十 GB、显存要求实打实,那些必须你自己准备。
声称「一键跑起 Wan 2.7」会是谎话。这个适配器消灭的只是「还得自己写一个 HTTP 服务」这一步。

## 跑起来

零依赖(只用 Node 内置模块):

```bash
VIDEO_CMD='python /models/wan2.7/infer.py --prompt {prompt} --out {out} --seconds {duration}' \
  node selfhost/video/server.mjs
```

或用 compose(把 `VIDEO_CMD` 换成你自己的命令):

```bash
docker compose -f selfhost/video/docker-compose.yml up
```

然后在 Wind Comic 侧:

```bash
SELFHOST_VIDEO_URL=http://localhost:8188/generate
SELFHOST_VIDEO_MODEL=wan2.7
```

配上它之后,自托管端点会**优先于所有闭源引擎**被调度(零边际成本)。

## 占位符

`VIDEO_CMD` 里这些会被替换:`{prompt}` `{out}` `{duration}` `{aspect}` `{image}` `{model}`。

命令跑完后 `{out}` 那个文件**必须存在且非空** —— 否则本服务如实报错。
退出码 0 不代表出片了:「成功了但没有产物」是最难查的一类失败,所以这里逐个确认。

## 几处刻意的设计

- **命令用参数数组起,不进 shell**(`shell: false`)。`prompt` 是外部输入,拼进 shell 就是命令注入。
- **异步**:视频推理动辄几分钟,同步返回会让上游 HTTP 超时先到,而那时任务还在跑 —— 白烧一次算力。
- **并发默认 1**:显存是硬约束,并发跑只会一起 OOM。
- **单任务超时后 SIGKILL**:挂死的推理会一直占着显存,后面的任务全部排不进来。

## 关于 SSRF

Wind Comic 的出站请求都过 `lib/ssrf-guard`,而它**默认拒绝 localhost / 内网地址**——
这是对的(防的是「URL 来自不可信内容」)。

v12.420 为此加了一条**极窄**的例外:只有 origin **逐字出现在
`SELFHOST_VIDEO_URL` / `MUSIC_SELFHOST_URL` / `LIPSYNC_API_URL` / `COMFYUI_URL`**
这几个 env 里,才允许指向内网。

判据落在 env 上,是因为这些是**部署者自己填的**,与从请求内容里冒出来的 URL 性质不同。
而且例外精确到 origin:同主机不同端口仍会被拒。
**不要**改用 `SSRF_ALLOW_PRIVATE=1` —— 那是全局开关,为一条端点把整道防线撤掉不划算。
