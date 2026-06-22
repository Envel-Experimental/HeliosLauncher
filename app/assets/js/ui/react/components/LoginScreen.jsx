import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, ArrowLeft, ChevronDown } from 'lucide-react';

const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [step, setStep] = useState(1);

  const hasNoAccounts = window.ConfigManager && typeof window.ConfigManager.getAuthAccounts === 'function'
    ? Object.keys(window.ConfigManager.getAuthAccounts() || {}).length === 0
    : true;

  // Expose function for UI binder cancel button logic
  useEffect(() => {
    window.loginCancelEnabled = (enabled) => {
      // We can use this to disable the cancel button if needed, 
      // but in React we just handle it via the cancel button directly.
    };

    // Hide video controls only while login screen container is visible
    const videoControls = document.getElementById('video-controls-overlay');
    const loginContainer = document.getElementById('loginContainer');

    let observer = null;
    if (loginContainer) {
      const checkVisibility = () => {
        if (loginContainer.style.display !== 'none') {
          if (videoControls) videoControls.style.display = 'none';
          setUsername('');
          setError('');
          setStep(1);
        } else {
          if (videoControls) videoControls.style.display = '';
        }
      };

      checkVisibility();

      observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            checkVisibility();
          }
        });
      });
      observer.observe(loginContainer, { attributes: true, attributeFilter: ['style'] });
    }

    // Fetch servers for selector
    if (window.DistroAPI) {
      window.DistroAPI.getDistribution().then((distro) => {
        if (distro && distro.servers) {
          setServers(distro.servers);
          let currentServ = null;
          if (window.ConfigManager && typeof window.ConfigManager.getSelectedServer === 'function') {
            currentServ = window.ConfigManager.getSelectedServer();
          }
          if (currentServ && distro.servers.some(s => s.rawServer.id === currentServ)) {
            setSelectedServer(currentServ);
          } else if (distro.servers.length > 0) {
            setSelectedServer(distro.servers[0].rawServer.id);
          }
        }
      }).catch(err => console.error("Failed to load distros in LoginScreen", err));
    }

    return () => {
      if (observer) {
        observer.disconnect();
      }
      if (videoControls) {
        videoControls.style.display = '';
      }
    };
  }, []);

  const handleNextStep = (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Имя пользователя не может быть пустым');
      return;
    }

    const validUsernameRegex = /^[a-zA-Z0-9_]{4,16}$/;
    if (!validUsernameRegex.test(username.trim())) {
      setError('Некорректный никнейм (только английские буквы, от 4 до 16 символов)');
      return;
    }

    setError('');
    if (hasNoAccounts && servers.length > 0) {
      setStep(2);
    } else {
      executeLogin();
    }
  };

  const executeLogin = async () => {
    setIsLoading(true);
    setError('');

    try {
      const ret = await window.AuthManager.addMojangAccount(username.trim(), '');
      window.ConfigManager.setSelectedAccount(ret.uuid);

      if (hasNoAccounts && selectedServer) {
        window.ConfigManager.setSelectedServer(selectedServer);
        window.CURRENT_SELECTED_SERVER_ID = selectedServer;
        if (window.updateSelectedServer && window.DistroAPI) {
          const distro = await window.DistroAPI.getDistribution();
          if (distro) {
            await window.updateSelectedServer(distro.getServerById(selectedServer));
          }
        }
      }

      await window.ConfigManager.save();

      // Notify React UI components about the new account
      const authUser = window.ConfigManager.getSelectedAccount();
      window.dispatchEvent(new CustomEvent('account-changed', { detail: authUser }));

      // Update vanilla JS UI variables if needed
      if (typeof window.prepareSettings === 'function') {
        window.prepareSettings();
      }

      // Navigate to success view
      if (window.loginViewOnSuccess) {
        window.switchView(window.getCurrentView(), window.loginViewOnSuccess);
      }
    } catch (err) {
      console.error('Error adding offline account:', err);
      setError('Ошибка при добавлении аккаунта. Попробуйте еще раз.');
      setStep(1);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (window.loginViewCancelHandler) {
      window.loginViewCancelHandler();
    } else if (window.loginViewOnCancel) {
      window.switchView(window.getCurrentView(), window.loginViewOnCancel);
    } else {
      window.switchView(window.getCurrentView(), window.VIEWS.settings);
    }
  };

  const portalTarget = document.getElementById('loginContainer');
  if (!portalTarget) return null;

  // Step 2: Course selection view
  if (step === 2) {
    return createPortal(
      <div className="react-light-modal fade-in" style={{ width: '440px', margin: 'auto', borderRadius: 'var(--react-radius-lg)', padding: '24px 28px', zIndex: 100 }}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <UserPlus size={44} color="var(--react-accent)" style={{ marginBottom: '8px' }} />
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>Выбери свой курс</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '14px', opacity: 0.7 }}>Выбери программу обучения для настройки лаунчера:</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '210px', overflowY: 'auto', paddingRight: '4px', marginBottom: '16px' }} className="version-dropdown-container">
          {servers.map((serv) => (
            <div
              key={serv.rawServer.id}
              onClick={() => setSelectedServer(serv.rawServer.id)}
              className={`course-card ${selectedServer === serv.rawServer.id ? 'selected' : ''}`}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                borderRadius: 'var(--react-radius-md)',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left', overflow: 'hidden' }}>
                <span className="course-title" style={{ fontWeight: 700, fontSize: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>{serv.rawServer.name}</span>
                {serv.rawServer.description && (
                  <span className="course-desc" style={{ fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>
                    {serv.rawServer.description}
                  </span>
                )}
              </div>
              <span className={`course-badge ${selectedServer === serv.rawServer.id ? 'selected' : ''}`} style={{
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 'bold',
                flexShrink: 0
              }}>
                {serv.rawServer.minecraftVersion}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ color: '#ff5e5e', fontSize: '13px', textAlign: 'center', background: 'rgba(255, 94, 94, 0.1)', padding: '8px', borderRadius: 'var(--react-radius-sm)', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="icon-button"
            style={{ width: '50px', height: '50px', flexShrink: 0 }}
            onClick={() => setStep(1)}
            disabled={isLoading}
            title="Назад"
          >
            <ArrowLeft size={20} />
          </button>

          <button
            type="button"
            className="play-button"
            style={{ flex: 1, padding: '10px', fontSize: '16px', fontWeight: 700, height: '50px' }}
            onClick={executeLogin}
            disabled={isLoading || !selectedServer}
          >
            {isLoading ? 'Запуск...' : 'Войти и начать'}
          </button>
        </div>
      </div>,
      portalTarget
    );
  }

  // Step 1: Nickname input view
  return createPortal(
    <div className="react-light-modal fade-in" style={{ width: '400px', margin: 'auto', borderRadius: 'var(--react-radius-lg)', padding: '30px', zIndex: 100 }}>
      <div style={{ textAlign: 'center', marginBottom: '25px' }}>
        <UserPlus size={48} color="var(--react-accent)" style={{ marginBottom: '15px' }} />
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>Придумай никнейм для входа</h2>
      </div>

      <form onSubmit={handleNextStep} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <input
            type="text"
            className="react-input"
            placeholder="Никнейм"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError('');
            }}
            disabled={isLoading}
            autoFocus
          />
        </div>


        <div className="disclaimer-text" style={{ fontSize: '11px', textAlign: 'center', lineHeight: '1.4' }}>
          {window.Lang?.queryEJS('login.loginPasswordDisclaimer1') || ''}
          <br /><br />
          {window.Lang?.queryEJS('login.loginPasswordDisclaimer2') || ''}
        </div>

        {error && (
          <div style={{ color: '#ff5e5e', fontSize: '13px', textAlign: 'center', background: 'rgba(255, 94, 94, 0.1)', padding: '8px', borderRadius: 'var(--react-radius-sm)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          {!hasNoAccounts && (
            <button
              type="button"
              className="icon-button"
              style={{ width: '48px', flexShrink: 0 }}
              onClick={handleCancel}
              disabled={isLoading}
              title="Отмена"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          <button
            type="submit"
            className="play-button"
            style={{ flex: 1, padding: '12px', fontSize: '15px', fontWeight: 700 }}
            disabled={isLoading || !username.trim()}
          >
            {isLoading ? 'Добавление...' : 'Продолжить'}
          </button>
        </div>
      </form>
    </div>,
    portalTarget
  );
};

export default LoginScreen;
