/**
 * AssetGrid 组件测试 (v2.0 Sprint 0 D6)
 *
 * 使用自定义 fetcher 避开真实 fetch。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssetGrid, fetchGlobalAssets } from '@/components/assets/AssetGrid';
import type { GlobalAsset } from '@/types/agents';

const now = new Date().toISOString();

const MOCK_ASSETS: GlobalAsset[] = [
  {
    id: 'a1',
    userId: 'u1',
    type: 'character',
    name: '青枫',
    description: '剑舞少女',
    tags: ['少女', '古风'],
    thumbnail: '',
    visualAnchors: [],
    metadata: {},
    referencedByProjects: ['p1', 'p2'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'a2',
    userId: 'u1',
    type: 'scene',
    name: '雾林',
    description: '',
    tags: [],
    thumbnail: '',
    visualAnchors: [],
    metadata: {},
    referencedByProjects: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'a3',
    userId: 'u1',
    type: 'prop',
    name: '古琴',
    description: '',
    tags: [],
    thumbnail: '',
    visualAnchors: [],
    metadata: {},
    referencedByProjects: [],
    createdAt: now,
    updatedAt: now,
  },
];

function makeFetcher(data: GlobalAsset[] = MOCK_ASSETS): typeof fetchGlobalAssets {
  return vi.fn(async () => data);
}

describe('AssetGrid', () => {
  it('fetcher 被调用并渲染资产', async () => {
    const fetcher = makeFetcher();
    render(<AssetGrid fetcher={fetcher} />);
    await waitFor(() => {
      expect(screen.getByTestId('asset-card-a1')).toBeInTheDocument();
    });
    // 卡片内的 fallback 占位 + 底部标题都会出现 name，用 getAllByText 校验至少 1 处
    expect(screen.getAllByText('青枫').length).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalled();
  });

  it('切换 tab 后 fetcher 带上 type 参数', async () => {
    const fetcher = vi.fn(async ({ type }) => {
      return type === 'character' ? [MOCK_ASSETS[0]] : MOCK_ASSETS;
    });
    render(<AssetGrid fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('asset-tab-character'));
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'character' }),
      );
    });
  });

  it('selectable 模式下点击卡片累加选中', async () => {
    const onChange = vi.fn();
    render(
      <AssetGrid
        fetcher={makeFetcher()}
        selectable
        selected={[]}
        onSelectionChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('asset-card-a1'));
    fireEvent.click(screen.getByTestId('asset-card-a1'));
    expect(onChange).toHaveBeenCalledWith(['a1']);
  });

  it('selectable 模式下点击已选卡片会移除', async () => {
    const onChange = vi.fn();
    render(
      <AssetGrid
        fetcher={makeFetcher()}
        selectable
        selected={['a1']}
        onSelectionChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('asset-card-a1'));
    fireEvent.click(screen.getByTestId('asset-card-a1'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('达到 maxSelection 时不能再加', async () => {
    const onChange = vi.fn();
    render(
      <AssetGrid
        fetcher={makeFetcher()}
        selectable
        maxSelection={1}
        selected={['a1']}
        onSelectionChange={onChange}
      />,
    );
    await waitFor(() => screen.getByTestId('asset-card-a2'));
    fireEvent.click(screen.getByTestId('asset-card-a2'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('空数据显示 EmptyState', async () => {
    render(<AssetGrid fetcher={makeFetcher([])} />);
    await waitFor(() => {
      expect(screen.getByTestId('asset-empty')).toBeInTheDocument();
    });
  });

  it('fetcher 抛错时显示错误信息', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom');
    });
    render(<AssetGrid fetcher={fetcher} />);
    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });

  it('被使用过的资产显示"用过 N"徽标', async () => {
    render(<AssetGrid fetcher={makeFetcher()} />);
    await waitFor(() => screen.getByTestId('asset-card-a1'));
    // a1 referencedByProjects 长度 = 2
    expect(screen.getByText('用过 2')).toBeInTheDocument();
  });
});
