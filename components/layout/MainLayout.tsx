'use client';

import { useLayoutStore } from '@/stores/layoutStore';
import Sidebar from './Sidebar';
import Canvas from './Canvas';
import ParameterPanel from './ParameterPanel';
import Header from './Header';
import Timeline from './Timeline';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, panelOpen, darkMode, sidebarWidth, panelWidth } = useLayoutStore();

  return (
    <div className={`h-screen flex flex-col ${darkMode ? 'dark' : ''}`}>
      {/* Header */}
      <Header />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <Sidebar width={sidebarWidth} />
        )}

        {/* Canvas Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
          <Canvas>{children}</Canvas>
          <Timeline />
        </div>

        {/* Parameter Panel */}
        {panelOpen && (
          <ParameterPanel width={panelWidth} />
        )}
      </div>
    </div>
  );
}
