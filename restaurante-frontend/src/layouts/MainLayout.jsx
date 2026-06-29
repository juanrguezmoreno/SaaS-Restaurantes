import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';

const MainLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  return (
    <div className="app-layout">
      <Sidebar show={sidebarOpen} onClose={closeSidebar} />

      <div className="main-content">
        <Navbar onToggleSidebar={toggleSidebar} />

        <main className="content-wrapper">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
