import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutState {
  sidebarOpen: boolean;
  panelOpen: boolean;
  darkMode: boolean;
  sidebarWidth: number;
  panelWidth: number;

  toggleSidebar: () => void;
  togglePanel: () => void;
  toggleDarkMode: () => void;
  setSidebarWidth: (width: number) => void;
  setPanelWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      panelOpen: true,
      darkMode: false,
      sidebarWidth: 280,
      panelWidth: 320,

      toggleSidebar: () => set((state) => ({
        sidebarOpen: !state.sidebarOpen
      })),
      togglePanel: () => set((state) => ({
        panelOpen: !state.panelOpen
      })),
      toggleDarkMode: () => set((state) => ({
        darkMode: !state.darkMode
      })),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setPanelWidth: (width) => set({ panelWidth: width }),
    }),
    {
      name: 'layout-storage',
    }
  )
);
