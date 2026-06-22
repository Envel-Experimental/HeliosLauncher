import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, ArrowLeft } from 'lucide-react';

const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Expose function for UI binder cancel button logic
  useEffect(() => {
    window.loginCancelEnabled = (enabled) => {
      // We can use this to disable the cancel button if needed, 
      // but in React we just handle it via the cancel button directly.
    };

    // Hide video controls while login screen is active
    const videoControls = document.getElementById('video-controls-overlay');
    if (videoControls) {
      videoControls.style.display = 'none';
    }

    return () => {
      if (videoControls) {
        videoControls.style.display = '';
      }
    };
  }, []);

  const handleAddAccount = async (e) => {
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

    setIsLoading(true);
    setError('');

    try {
      const ret = await window.AuthManager.addMojangAccount(username.trim(), '');
      window.ConfigManager.setSelectedAccount(ret.uuid);
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

  return createPortal(
    <div className="react-glass" style={{ width: '400px', margin: 'auto', borderRadius: 'var(--react-radius-lg)', padding: '30px', zIndex: 100 }}>
      <div style={{ textAlign: 'center', marginBottom: '25px' }}>
        <UserPlus size={48} color="var(--react-accent)" style={{ marginBottom: '15px' }} />
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>Придумай никнейм для входа</h2>
      </div>

      <form onSubmit={handleAddAccount} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
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

        <div style={{ fontSize: '11px', color: 'var(--react-text-dim)', textAlign: 'center', lineHeight: '1.4' }}>
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
