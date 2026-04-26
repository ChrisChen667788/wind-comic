/**
 * 插件体系骨架 v0 (占位)
 *
 * 未来扩展点:
 *   - 自定义风格(extends style-presets)
 *   - 自定义视频引擎(实现 VideoEngine 接口)
 *   - 自定义 workflow 节点(在 pipeline-canvas 扩展 NodeType)
 *   - 自定义 LLM 提示词模板
 *
 * 当前仅定义接口契约,不做动态加载;插件用 import 方式静态注册到下面 registry。
 */

export interface StylePlugin {
  id: string;
  name: string;
  promptFragment: string;
  negativePrompt?: string;
  thumbnail?: string;
}

export interface VideoEnginePlugin {
  id: string;
  name: string;
  /** 生成视频 - 返回 mp4 URL */
  generate(imageUrl: string, prompt: string, opts?: Record<string, unknown>): Promise<string>;
  /** 预估成本(美分) */
  estimateCost?(durationSec: number): number;
}

export interface WorkflowNodePlugin {
  id: string;
  type: string;
  label: string;
  /** 节点执行函数 - 接收上游输出,返回本节点输出 */
  run(input: unknown, context: { projectId: string }): Promise<unknown>;
}

class PluginRegistry {
  private styles: Map<string, StylePlugin> = new Map();
  private engines: Map<string, VideoEnginePlugin> = new Map();
  private nodes: Map<string, WorkflowNodePlugin> = new Map();

  registerStyle(p: StylePlugin) { this.styles.set(p.id, p); }
  registerEngine(p: VideoEnginePlugin) { this.engines.set(p.id, p); }
  registerNode(p: WorkflowNodePlugin) { this.nodes.set(p.id, p); }

  getStyle(id: string) { return this.styles.get(id); }
  getEngine(id: string) { return this.engines.get(id); }
  getNode(id: string) { return this.nodes.get(id); }

  listStyles() { return Array.from(this.styles.values()); }
  listEngines() { return Array.from(this.engines.values()); }
  listNodes() { return Array.from(this.nodes.values()); }
}

export const pluginRegistry = new PluginRegistry();

/**
 * 示例注册(注释掉,供后续参考):
 *
 *   pluginRegistry.registerStyle({
 *     id: 'custom-ink',
 *     name: '自定义水墨',
 *     promptFragment: 'monochrome ink painting, soft brush',
 *   });
 */
