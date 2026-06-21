import React, { useState } from 'react';
import LauncherTab from './LauncherTab';
import { Settings as SettingsIcon, Monitor, Box, Wrench, Package, FileCode } from 'lucide-react';

const TABS = [
  { id: 'launcher', label: 'Настройки лаунчера', icon: <Monitor size={18} /> },
  { id: 'java', label: 'Настройки Java', icon: <Box size={18} /> },
  { id: 'mods', label: 'Моды', icon: <Wrench size={18} /> },
  { id: 'dropins', label: 'Доп. Моды', icon: <Package size={18} /> },
  { id: 'shaders', label: 'Шейдеры', icon: <FileCode size={18} /> }
];

const Settings = () => {
  const [activeTab, setActiveTab] = useState('launcher');

  return (
    <div className="react-settings-container" style={{
      display: 'flex',
      height: '100%',
      width: '100%',
      background: 'rgba(10, 10, 10, 0.8)',
      backdropFilter: 'blur(20px)',
      color: 'white',
      fontFamily: 'var(--react-font, Inter)'
    }}>
      <div className="settings-sidebar" style={{
        width: '250px',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ padding: '0 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 'bold', fontSize: '1.2em' }}>
          <SettingsIcon size={24} /> Настройки
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '0 10px' }}>
          {TABS.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '12px 15px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: activeTab === tab.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: activeTab === tab.id ? 'var(--react-accent)' : 'rgba(255,255,255,0.7)',
                transition: 'all 0.2s',
                fontWeight: activeTab === tab.id ? '600' : '400'
              }}
              onMouseOver={(e) => { if (activeTab !== tab.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseOut={(e) => { if (activeTab !== tab.id) e.currentTarget.style.background = 'transparent' }}
            >
              {tab.icon}
              {tab.label}
            </div>
          ))}
        </div>
      </div>
      
      <div className="settings-content" style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
        {activeTab === 'launcher' && <LauncherTab />}
        {activeTab !== 'launcher' && (
          <div style={{ opacity: 0.5 }}>
            <h2>{TABS.find(t => t.id === activeTab)?.label}</h2>
            <p>Эта вкладка пока не портирована на новый React-интерфейс.</p>
            <p>Пожалуйста, используйте старый интерфейс для этих настроек, пока мы полностью не избавимся от спагетти-кода!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
