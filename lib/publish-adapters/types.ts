/**
 * lib/publish-adapters/types (v12.3.3) — BYO 平台上传适配器统一契约(阶段二十二)。
 *
 * 设计哲学(承袭「复用不重建 + 确定性地板 + BYO 增强 + 诚实降级 + 安全」):
 *   · 确定性地板:每个平台都有适配器,manual 适配器恒可用 → 返回「导出包 + 手动上传指引」。
 *   · BYO 增强:用户自配 token 的平台(YouTube)走真 API 上传(参考实现)。
 *   · 诚实降级:无公开发布 API / 无 token → 返回 status='manual',**绝不假称 published**。
 *   · 安全:适配器只消费用户已配的 token,绝不代做 OAuth/登录;真上传是 outward-facing,路由层确认后才调。
 */
import type { PublishPackage } from '../publish-package';

/** 'api' = 有公开发布 API 的参考适配器;'manual' = 无公开 API,只能降级为手动上传。 */
export type AdapterMode = 'api' | 'manual';

/** 上传结果。published = 真传成功;manual = 降级(需用户手动上传),绝不混淆。 */
export interface UploadResult {
  status: 'published' | 'manual' | 'failed';
  /** 真传成功后的平台链接(manual/failed 时 null) */
  externalUrl: string | null;
  /** 平台侧资源 id,用于 status() 查询(manual/failed 时 null) */
  externalId: string | null;
  /** 给用户看的说明:成功提示 / 降级原因 / 失败原因 */
  message: string;
  /** 降级时的手动上传步骤 */
  instructions?: string[];
}

export interface UploadOptions {
  /** 已确认执行真上传(outward-facing,路由层拿到用户确认后置 true) */
  confirmed?: boolean;
}

export interface PublishAdapter {
  platform: string;
  label: string;
  mode: AdapterMode;
  /** 用户是否已配齐凭据(manual 适配器恒 false) */
  isConfigured(): boolean;
  /**
   * 上传可直发包。
   * 约束:!isConfigured() 或 mode='manual' → 返回 status='manual' 降级,绝不假称 published。
   * 真 API 上传需 opts.confirmed=true(否则也降级,避免误触外发)。
   */
  upload(pkg: PublishPackage, opts?: UploadOptions): Promise<UploadResult>;
  /** 查上传状态(api 适配器);manual → null */
  status(externalId: string): Promise<{ state: string; url?: string } | null>;
}
