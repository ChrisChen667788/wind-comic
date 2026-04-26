import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CharacterManager, CharacterProfile } from '@/components/character-manager';

describe('CharacterManager', () => {
  const mockCharacters: CharacterProfile[] = [
    { id: 'c1', name: '小明', description: '勇敢的少年', appearance: '黑发，蓝色外套', avatarUrl: '', tags: ['主角', '少年'] },
  ];

  it('renders character list', () => {
    render(<CharacterManager characters={mockCharacters} onChange={() => {}} />);
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('角色一致性管理')).toBeInTheDocument();
  });

  it('shows empty state when no characters', () => {
    render(<CharacterManager characters={[]} onChange={() => {}} />);
    expect(screen.getByText('还没有角色，点击上方按钮添加')).toBeInTheDocument();
  });

  it('adds a new character', () => {
    let chars: CharacterProfile[] = [];
    const onChange = (c: CharacterProfile[]) => { chars = c; };
    render(<CharacterManager characters={chars} onChange={onChange} />);
    fireEvent.click(screen.getByText('+ 添加角色'));
    expect(chars.length).toBe(1);
    expect(chars[0].name).toBe('新角色');
  });

  it('removes a character', () => {
    let chars = [...mockCharacters];
    const onChange = (c: CharacterProfile[]) => { chars = c; };
    render(<CharacterManager characters={chars} onChange={onChange} />);
    fireEvent.click(screen.getByText('删除'));
    expect(chars.length).toBe(0);
  });

  it('enters edit mode on click', () => {
    render(<CharacterManager characters={mockCharacters} onChange={() => {}} />);
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByDisplayValue('小明')).toBeInTheDocument();
    expect(screen.getByText('保存')).toBeInTheDocument();
  });

  it('displays character tags', () => {
    render(<CharacterManager characters={mockCharacters} onChange={() => {}} />);
    expect(screen.getByText('主角')).toBeInTheDocument();
    expect(screen.getByText('少年')).toBeInTheDocument();
  });
});
