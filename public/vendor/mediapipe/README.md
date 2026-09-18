# MediaPipe 姿态识别资产(v12.444)

导演台「从照片识别姿态」用的第三方资产,**全部自托管**:运行时不向外网请求任何东西
(国内网络下 CDN 常慢到超时,而运行时外链等于给产品加一个不受控的依赖)。

| 文件 | 来源 | 许可 | 是否入库 |
|---|---|---|---|
| `pose_landmarker_lite.task`(5.8 MB) | Google MediaPipe Models — `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/` | Apache-2.0 | **入库**(构建期不联网下载) |
| `vision_wasm_internal.{js,wasm}`(12 MB) | npm 包 `@mediapipe/tasks-vision` | Apache-2.0 | 不入库,由 `npm run prebuild` 从 `node_modules` 拷 |

换模型(例如想用精度更高的 full/heavy)只需替换 `.task` 并改
`components/project/pose-photo-button.tsx` 里的 `modelAssetPath`;体积会从 5.8 MB 涨到 ~26/30 MB,
镜像也会跟着大,按需取舍。

推理全在用户浏览器里完成,**照片不上传服务器**。
