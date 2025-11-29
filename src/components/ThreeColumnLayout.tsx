import { ReactNode } from 'react';

interface ThreeColumnLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
  rightSidebar: ReactNode;
  leftWidth?: string;
  rightWidth?: string;
}

export function ThreeColumnLayout({
  leftSidebar,
  mainContent,
  rightSidebar,
  leftWidth = 'w-64',
  rightWidth = 'w-80'
}: ThreeColumnLayoutProps) {
  return (
    <div className="flex flex-1 overflow-hidden h-[calc(100vh-64px)]">
      {/* Left Sidebar */}
      <div className={`${leftWidth} flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto`}>
        {leftSidebar}
      </div>
      
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto w-full">
          {mainContent}
        </div>
      </div>
      
      {/* Right Sidebar */}
      <div className={`${rightWidth} flex-shrink-0 bg-white border-l border-gray-200 overflow-y-auto`}>
        {rightSidebar}
      </div>
    </div>
  );
}
