/**
 * v12.360:MiniMax 的「假成功」—— HTTP 200 + status_code 0,却什么都没生成。
 *
 * 重生角色图时撞到:墨七连续两次失败,报的是
 *   `Minimax: no task_id in response: {"id":"…","data":{},"metadata":{"failed_count":"1","success_count":"0"},"base_resp":{"status_code":0,"status_msg":"success"}}`
 *
 * 接口自称 **success**,`base_resp.status_code` 是 0,却 `failed_count: 1 / success_count: 0`
 * 且不给 task_id。原来一律报「no task_id」+ 整个 JSON —— **看的人无从判断该改 prompt 还是重试**。
 *
 * **诚实记一笔:我对这次失败的归因是错的。** 当时看到该角色描述里有「无实体服饰,
 * 身体由数据流光纹缠绕」,判断「几乎肯定触发内容过滤」。但第三次重试**一字未改就成功了** ——
 * 说明它是非确定性的。改进的报错仍然有价值(真触发过滤时能说清该怎么办),
 * 但**不是它修好了这次**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'services/minimax.service.ts'), 'utf8');

describe('v12.360 假成功要说清楚', () => {
  it('识别 failed_count>0 且 success_count==0 的假成功', () => {
    expect(SRC).toMatch(/const failed = Number\(meta\?\.failed_count \|\| 0\)/);
    expect(SRC).toMatch(/const succeeded = Number\(meta\?\.success_count \|\| 0\)/);
    expect(SRC).toMatch(/if \(failed > 0 && succeeded === 0\)/);
  });

  it('报错要给出**下一步动作**,不是丢一整坨 JSON', () => {
    expect(SRC).toContain('内容过滤静默拒绝');
    expect(SRC).toContain('改写该处描述后重试');
  });

  it('两条通路(视频/图像)都要覆盖 —— 同一个假成功模式', () => {
    // 只数代码行:注释里也各提了一次,连注释一起数会得到 4(第一版就是这么红的)
    const code = SRC.split('\n')
      .filter((l) => { const t = l.trimStart(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
      .join('\n');
    expect(code.split('内容过滤静默拒绝').length - 1).toBe(2);
  });

  it('不是这个形态的仍按原样报,不把所有 no-task_id 都归成过滤', () => {
    expect(SRC).toMatch(/throw new Error\(`Minimax: no task_id in response: \$\{JSON\.stringify\(data\)\}`\)/);
  });

  it('把「归因错过一次」写进注释 —— 非确定性失败别硬扣因果', () => {
    expect(SRC).toMatch(/实测那是\*\*内容过滤静默拒绝\*\*|内容过滤静默拒绝/);
  });
});
