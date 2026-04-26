// 性能监控和分析工具

export interface PerformanceMetrics {
  pageLoadTime: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  timeToInteractive: number;
  totalBlockingTime: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.collectMetrics();
    }
  }

  private collectMetrics() {
    // 使用 Performance API 收集指标
    if ('performance' in window) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          const paintEntries = performance.getEntriesByType('paint');

          this.metrics = {
            pageLoadTime: perfData.loadEventEnd - perfData.fetchStart,
            firstContentfulPaint: this.getPaintMetric(paintEntries, 'first-contentful-paint'),
            largestContentfulPaint: this.getLCP(),
            timeToInteractive: this.getTTI(),
            totalBlockingTime: this.getTBT(),
          };

          this.logMetrics();
        }, 0);
      });
    }
  }

  private getPaintMetric(entries: PerformanceEntryList, name: string): number {
    const entry = entries.find(e => e.name === name);
    return entry ? entry.startTime : 0;
  }

  private getLCP(): number {
    // 简化的 LCP 实现
    let lcp = 0;
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      lcp = lastEntry.startTime;
    });

    try {
      observer.observe({ entryTypes: ['largest-contentful-paint'] });
    } catch (e) {
      // LCP not supported
    }

    return lcp;
  }

  private getTTI(): number {
    // 简化的 TTI 实现
    const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return perfData.domInteractive - perfData.fetchStart;
  }

  private getTBT(): number {
    // 简化的 TBT 实现
    let tbt = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          tbt += entry.duration - 50;
        }
      }
    });

    try {
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      // Long tasks not supported
    }

    return tbt;
  }

  private logMetrics() {
    if (this.metrics) {
      console.log('Performance Metrics:', {
        'Page Load Time': `${this.metrics.pageLoadTime.toFixed(2)}ms`,
        'First Contentful Paint': `${this.metrics.firstContentfulPaint.toFixed(2)}ms`,
        'Largest Contentful Paint': `${this.metrics.largestContentfulPaint.toFixed(2)}ms`,
        'Time to Interactive': `${this.metrics.timeToInteractive.toFixed(2)}ms`,
        'Total Blocking Time': `${this.metrics.totalBlockingTime.toFixed(2)}ms`,
      });
    }
  }

  public getMetrics(): PerformanceMetrics | null {
    return this.metrics;
  }

  public reportToAnalytics() {
    // TODO: 发送到分析服务
    if (this.metrics) {
      // 示例：发送到 Google Analytics
      // gtag('event', 'performance', this.metrics);
    }
  }
}

// 初始化性能监控
export function initPerformanceMonitoring() {
  if (typeof window !== 'undefined') {
    new PerformanceMonitor();
  }
}

// 测量函数执行时间
export function measureExecutionTime<T>(
  fn: () => T,
  label: string
): T {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  console.log(`[Performance] ${label}: ${(end - start).toFixed(2)}ms`);
  return result;
}

// 测量异步函数执行时间
export async function measureAsyncExecutionTime<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  console.log(`[Performance] ${label}: ${(end - start).toFixed(2)}ms`);
  return result;
}
