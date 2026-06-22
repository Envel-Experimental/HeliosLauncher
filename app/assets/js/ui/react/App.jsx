import React from 'react';
import UserProfile from './components/UserProfile';
import EventBanner from './components/EventBanner';
import BottomBar from './components/BottomBar';
import LoginScreen from './components/LoginScreen';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[React ErrorBoundary] Caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, top: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', color: 'white', flexDirection: 'column', gap: '12px', zIndex: 9999
        }}>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>Что-то пошло не так в интерфейсе</div>
          <div style={{ fontSize: '13px', opacity: 0.6 }}>Перезапустите лаунчер. Если ошибка повторяется — сообщите в поддержку.</div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.15)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
          >Попробовать снова</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = () => {
  return (
    <div className="react-ui-container">
      <style>{`
        [data-tooltip] {
          position: relative;
        }
        [data-tooltip]:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: calc(100% + 15px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15,15,15,0.95);
          backdrop-filter: blur(10px);
          padding: 10px 16px;
          border-radius: 12px;
          white-space: nowrap;
          font-size: 16px;
          font-weight: 600;
          color: white;
          pointer-events: none;
          animation: fadeInUp 0.2s ease-out forwards;
          z-index: 1000;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .bottom-bar-right .icon-button:last-child[data-tooltip]:hover::after {
          left: auto;
          right: 0;
          transform: none;
        }

        .server-item-title {
          font-weight: 600;
          white-space: normal;
          word-break: break-word;
          line-height: 1.2;
        }
        .server-item-desc {
          opacity: 0.6;
          font-size: 0.85em;
          white-space: normal;
          word-break: break-word;
          line-height: 1.3;
          margin-top: 2px;
        }

        .version-dropdown-container::-webkit-scrollbar {
          width: 6px;
        }
        .version-dropdown-container::-webkit-scrollbar-track {
          background: transparent;
          margin: 16px 0;
        }
        .version-dropdown-container::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
          border-radius: 10px;
        }
        .version-dropdown-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.3);
        }
      `}</style>
      <header className="react-ui-header">
        <div className="react-ui-logo" style={{ marginLeft: '40px', marginTop: '15px' }}>
          <img src="assets/images/full-icon.png" alt="Helios Logo" style={{ height: '80px', objectFit: 'contain' }} draggable="false" />
        </div>
        <ErrorBoundary><UserProfile /></ErrorBoundary>
      </header>

      <main className="react-ui-main">
        <ErrorBoundary><EventBanner /></ErrorBoundary>
      </main>

      <footer className="react-ui-footer">
        <ErrorBoundary><BottomBar /></ErrorBoundary>
      </footer>
      <ErrorBoundary><LoginScreen /></ErrorBoundary>
    </div>
  );
};

export default App;
