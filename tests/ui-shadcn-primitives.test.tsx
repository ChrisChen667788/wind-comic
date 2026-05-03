/**
 * Smoke tests for components/ui/{tabs,tooltip,popover}.tsx (v2.13.5)
 *
 * Radix-backed shadcn-style primitives. 主要锁:
 *   - 渲染 + 默认 ARIA 角色
 *   - active tab 切换
 *   - tooltip 触发后内容出现 (Radix 默认 delay 较长, 这里直接验静态)
 *   - popover 触发后 Portal 渲染
 *
 * Radix 在 jsdom 下 portal/animations 经常 flaky; 我们只做最基本的存在性断言,
 * 视觉细节交给 e2e。
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// jsdom 不实现 hasPointerCapture / pointer events, Radix Tooltip/Popover 会用到
beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe('Tabs (Radix)', () => {
  it('renders trigger list with role=tablist and shows the default panel', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">剧本</TabsTrigger>
          <TabsTrigger value="b">分镜</TabsTrigger>
        </TabsList>
        <TabsContent value="a">script panel</TabsContent>
        <TabsContent value="b">storyboard panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /剧本/ })).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('script panel')).toBeInTheDocument();
  });

  it('switches active tab when controlled value changes (Radix click in jsdom is flaky)', () => {
    const { rerender } = render(
      <Tabs value="a" onValueChange={() => {}}>
        <TabsList>
          <TabsTrigger value="a">剧本</TabsTrigger>
          <TabsTrigger value="b">分镜</TabsTrigger>
        </TabsList>
        <TabsContent value="a">script panel</TabsContent>
        <TabsContent value="b">storyboard panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('script panel')).toBeInTheDocument();
    rerender(
      <Tabs value="b" onValueChange={() => {}}>
        <TabsList>
          <TabsTrigger value="a">剧本</TabsTrigger>
          <TabsTrigger value="b">分镜</TabsTrigger>
        </TabsList>
        <TabsContent value="a">script panel</TabsContent>
        <TabsContent value="b">storyboard panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('storyboard panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /分镜/ })).toHaveAttribute('data-state', 'active');
  });

  it('respects disabled prop on a trigger', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b" disabled>B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">x</TabsContent>
      </Tabs>,
    );
    const b = screen.getByRole('tab', { name: 'B' });
    expect(b).toBeDisabled();
  });
});

describe('Tooltip (Radix)', () => {
  it('renders the trigger element (asChild透传 button)', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">SHOT 03</button>
          </TooltipTrigger>
          <TooltipContent>Cameo 92 · cut</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /SHOT 03/ })).toBeInTheDocument();
  });
});

describe('Popover (Radix)', () => {
  it('renders trigger button and opens portal content on click', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">详情</button>
        </PopoverTrigger>
        <PopoverContent>SHOT 03 · 92 score</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: '详情' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await act(async () => { fireEvent.click(trigger); });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Portal 内容 (jsdom 下也能 query 到 body 上的 portal 节点)
    expect(screen.getByText('SHOT 03 · 92 score')).toBeInTheDocument();
  });

  it('content closes on second trigger click', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">toggle</button>
        </PopoverTrigger>
        <PopoverContent>panel content</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'toggle' });
    await act(async () => { fireEvent.click(trigger); });
    expect(screen.getByText('panel content')).toBeInTheDocument();
    await act(async () => { fireEvent.click(trigger); });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
