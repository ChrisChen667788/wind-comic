import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryboardEditor, StoryboardShot } from '@/components/storyboard-editor';

describe('StoryboardEditor', () => {
  const mockShots: StoryboardShot[] = [
    { id: 's1', shotNumber: 1, description: '城市远景', dialogue: '旁白：夜幕降临', duration: 5, cameraAngle: '远景' },
    { id: 's2', shotNumber: 2, description: '角色特写', dialogue: '', duration: 3, cameraAngle: '特写' },
  ];

  it('renders shot list', () => {
    render(<StoryboardEditor shots={mockShots} onChange={() => {}} />);
    expect(screen.getByText('城市远景')).toBeInTheDocument();
    expect(screen.getByText('角色特写')).toBeInTheDocument();
    expect(screen.getByText('分镜编辑器')).toBeInTheDocument();
  });

  it('shows total duration', () => {
    render(<StoryboardEditor shots={mockShots} onChange={() => {}} />);
    expect(screen.getByText('2 个镜头 · 总时长 8s')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    render(<StoryboardEditor shots={[]} onChange={() => {}} />);
    expect(screen.getByText(/还没有分镜/)).toBeInTheDocument();
  });

  it('adds a new shot', () => {
    let shots: StoryboardShot[] = [];
    const onChange = (s: StoryboardShot[]) => { shots = s; };
    render(<StoryboardEditor shots={shots} onChange={onChange} />);
    fireEvent.click(screen.getByText('+ 添加镜头'));
    expect(shots.length).toBe(1);
    expect(shots[0].shotNumber).toBe(1);
  });

  it('removes a shot and renumbers', () => {
    let shots = [...mockShots];
    const onChange = (s: StoryboardShot[]) => { shots = s; };
    const { getAllByTitle } = render(<StoryboardEditor shots={shots} onChange={onChange} />);
    const deleteButtons = getAllByTitle('删除');
    fireEvent.click(deleteButtons[0]);
    expect(shots.length).toBe(1);
    expect(shots[0].shotNumber).toBe(1);
    expect(shots[0].description).toBe('角色特写');
  });

  it('duplicates a shot', () => {
    let shots = [...mockShots];
    const onChange = (s: StoryboardShot[]) => { shots = s; };
    const { getAllByTitle } = render(<StoryboardEditor shots={shots} onChange={onChange} />);
    const dupButtons = getAllByTitle('复制');
    fireEvent.click(dupButtons[0]);
    expect(shots.length).toBe(3);
    expect(shots[1].description).toBe('城市远景');
    expect(shots[1].shotNumber).toBe(2);
    expect(shots[2].shotNumber).toBe(3);
  });

  it('enters edit mode on click', () => {
    render(<StoryboardEditor shots={mockShots} onChange={() => {}} />);
    fireEvent.click(screen.getByText('城市远景'));
    expect(screen.getByText('完成')).toBeInTheDocument();
  });

  it('displays dialogue', () => {
    render(<StoryboardEditor shots={mockShots} onChange={() => {}} />);
    expect(screen.getByText('「旁白：夜幕降临」')).toBeInTheDocument();
  });

  it('displays camera angle tags', () => {
    render(<StoryboardEditor shots={mockShots} onChange={() => {}} />);
    expect(screen.getByText('远景')).toBeInTheDocument();
    expect(screen.getByText('特写')).toBeInTheDocument();
  });
});
