/**
 * lib/mock-cost — 零 key 演示(MOCK_ENGINES=1)下主流水线的预估花费到底是不是 0。v13.6。
 *
 * 病象:`docker compose -f docker-compose.demo.yml up` 打开就点「开机」,第一次创作就被预算护栏拦下 ——
 * 「本次预估 ¥18.8 将越过硬上限 ¥5」。mock 三件套 estCostCny 全是 0,可 estimatePipelineCostCny
 * 按「未知引擎取最贵档」估价,免费档 ¥5 的月上限当场挡住。零 key 演示的第一分钟就是一个 402。
 *
 * 为什么不直接「MOCK_ENGINES=1 → 0」:mock provider 只是插件链里优先级最高的一档(priority 10),
 * 它失败了链会落到下一档 —— 如果部署者同时配了真 key,那一档就会真扣费;显式设了
 * PLUGIN_CHAIN_MODE=off/shadow 时 mock 根本不走。护栏是成本红线,这两种情况都不能放。
 * 所以只认最窄的那种:mock 确实在主路上,并且注册表里**没有任何一个可用的真引擎** ——
 * mock 就算挂了,也没有能花钱的下家。判不准(available() 抛错)一律当作「可能花钱」。
 */
import { getPluginChainMode } from './plugin-chain-mode';
import { estimatePipelineCostCny, type CostEstimateInput } from './budget-estimate';
import { listImageProviders } from './image-providers/registry';
import './image-providers/builtins'; // 副作用:注册内置图像 provider
import { listVideoProviders } from './video-providers/registry';
import './video-providers/builtins'; // 副作用:注册内置视频 provider
import { listTTSProviders } from './tts-providers/registry';
import './tts-providers/builtins'; // 副作用:注册内置 TTS provider

type ProviderLike = { id: string; available: () => boolean };

function registeredProviders(): ProviderLike[] {
  return [...listImageProviders(), ...listVideoProviders(), ...listTTSProviders()];
}

/** providers 参数只给测试注入用;线上一律读三个注册表。 */
export function mockPipelineIsFree(providers: ProviderLike[] = registeredProviders()): boolean {
  if (process.env.MOCK_ENGINES !== '1') return false;
  if (getPluginChainMode() !== 'primary') return false;
  return !providers.some((p) => {
    if (p.id.startsWith('mock-')) return false;
    try {
      return p.available();
    } catch {
      return true;
    }
  });
}

/**
 * 喂给预算护栏(assertBudget)的流水线预估 —— 所有「按 estimatePipelineCostCny 预检」的入口都走这里:
 * 主创作、队列 worker、分季批量生成、单镜重生(两条路由)、片段重拍。只在 mock 主路且无可用真引擎时为 0。
 * (只改了 create-stream 时,演示用户第一次创作能过,点「重生这一镜」或批量生成仍按 ¥18.8/集估价被拦。)
 */
export function pipelineCostForBudget(input: CostEstimateInput = {}): number {
  return mockPipelineIsFree() ? 0 : estimatePipelineCostCny(input);
}
