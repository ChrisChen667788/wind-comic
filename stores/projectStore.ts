import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProjectState {
  currentProject: {
    id: string;
    name: string;
    lastSaved: Date | null;
    autoSaveEnabled: boolean;
  } | null;

  scenes: Array<{
    id: string;
    title: string;
    thumbnail?: string;
    content: any;
  }>;

  setCurrentProject: (project: ProjectState['currentProject']) => void;
  updateProjectName: (name: string) => void;
  addScene: (scene: ProjectState['scenes'][0]) => void;
  removeScene: (id: string) => void;
  updateScene: (id: string, updates: Partial<ProjectState['scenes'][0]>) => void;
  reorderScenes: (startIndex: number, endIndex: number) => void;

  // 自动保存
  lastAutoSave: Date | null;
  setLastAutoSave: (date: Date) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentProject: null,
      scenes: [],
      lastAutoSave: null,

      setCurrentProject: (project) => set({ currentProject: project }),

      updateProjectName: (name) => set((state) => ({
        currentProject: state.currentProject
          ? { ...state.currentProject, name }
          : null
      })),

      addScene: (scene) => set((state) => ({
        scenes: [...state.scenes, scene]
      })),

      removeScene: (id) => set((state) => ({
        scenes: state.scenes.filter(s => s.id !== id)
      })),

      updateScene: (id, updates) => set((state) => ({
        scenes: state.scenes.map(s =>
          s.id === id ? { ...s, ...updates } : s
        )
      })),

      reorderScenes: (startIndex, endIndex) => set((state) => {
        const result = Array.from(state.scenes);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        return { scenes: result };
      }),

      setLastAutoSave: (date) => set({ lastAutoSave: date }),
    }),
    {
      name: 'project-storage',
    }
  )
);
