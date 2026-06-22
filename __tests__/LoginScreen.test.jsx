import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LoginScreen from '../app/assets/js/ui/react/components/LoginScreen';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  UserPlus: () => <div data-testid="userplus-icon" />,
  ArrowLeft: () => <div data-testid="arrowleft-icon" />,
  ChevronDown: () => <div data-testid="chevrondown-icon" />
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    // Setup DOM for createPortal
    document.body.innerHTML = '<div id="loginContainer"></div><div id="video-controls-overlay"></div>';

    // Mock globals
    window.Lang = {
      queryEJS: jest.fn().mockImplementation((key) => {
        if (key === 'login.loginPasswordDisclaimer1') return 'Disclaimer 1';
        if (key === 'login.loginPasswordDisclaimer2') return 'Disclaimer 2';
        return key;
      })
    };

    window.AuthManager = {
      addMojangAccount: jest.fn().mockResolvedValue({ uuid: 'test-uuid' })
    };

    window.ConfigManager = {
      setSelectedAccount: jest.fn(),
      getSelectedAccount: jest.fn().mockReturnValue({ uuid: 'test-uuid', displayName: 'ValidPlayer' }),
      getAuthAccounts: jest.fn().mockReturnValue({}),
      getSelectedServer: jest.fn().mockReturnValue('server-1'),
      setSelectedServer: jest.fn(),
      save: jest.fn().mockResolvedValue(true)
    };

    window.DistroAPI = {
      getDistribution: jest.fn().mockResolvedValue({
        servers: [
          {
            rawServer: {
              id: 'server-1',
              name: 'Вокруг света',
              description: 'Minecraft 1.20.1',
              minecraftVersion: '1.20.1'
            }
          },
          {
            rawServer: {
              id: 'server-2',
              name: 'Программирование',
              description: 'Minecraft 1.20.1',
              minecraftVersion: '1.20.1'
            }
          }
        ],
        getServerById: jest.fn().mockImplementation((id) => {
          if (id === 'server-1') return { rawServer: { id: 'server-1', name: 'Вокруг света' } };
          if (id === 'server-2') return { rawServer: { id: 'server-2', name: 'Программирование' } };
          return null;
        })
      })
    };

    window.updateSelectedServer = jest.fn().mockResolvedValue(true);
    window.switchView = jest.fn();
    window.getCurrentView = jest.fn().mockReturnValue('#loginContainer');
    window.VIEWS = { settings: '#settingsContainer', landing: '#landingContainer' };
    window.loginViewOnSuccess = '#landingContainer';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', async () => {
    await act(async () => {
      render(<LoginScreen />);
    });
    expect(screen.getByText('Придумай никнейм для входа')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Никнейм')).toBeInTheDocument();
    expect(screen.getByText(/Disclaimer 1/)).toBeInTheDocument();
  });

  it('validates empty username disables submit button', async () => {
    await act(async () => {
      render(<LoginScreen />);
    });

    const submitBtn = screen.getByText('Продолжить');
    expect(submitBtn).toBeDisabled();

    const input = screen.getByPlaceholderText('Никнейм');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(submitBtn).toBeDisabled();
  });

  it('validates invalid username format', async () => {
    await act(async () => {
      render(<LoginScreen />);
    });

    const input = screen.getByPlaceholderText('Никнейм');
    fireEvent.change(input, { target: { value: 'Никита' } }); // Russian letters are invalid

    const submitBtn = screen.getByText('Продолжить');
    fireEvent.click(submitBtn);

    expect(await screen.findByText('Некорректный никнейм (только английские буквы, от 4 до 16 символов)')).toBeInTheDocument();
    expect(window.AuthManager.addMojangAccount).not.toHaveBeenCalled();
  });

  it('transitions to server/course selection if hasNoAccounts is true, and successfully logs in', async () => {
    await act(async () => {
      render(<LoginScreen />);
    });

    const input = screen.getByPlaceholderText('Никнейм');
    fireEvent.change(input, { target: { value: 'ValidPlayer' } });

    const submitBtn = screen.getByText('Продолжить');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify it transitioned to step 2: "Выбери свой курс"
    expect(screen.getByText('Выбери свой курс')).toBeInTheDocument();
    expect(screen.getByText('Вокруг света')).toBeInTheDocument();
    expect(screen.getByText('Программирование')).toBeInTheDocument();

    // Select "Программирование" (server-2)
    const courseCard = screen.getByText('Программирование').closest('.course-card');
    fireEvent.click(courseCard);

    // Click "Войти и начать"
    const loginBtn = screen.getByText('Войти и начать');
    await act(async () => {
      fireEvent.click(loginBtn);
    });

    await waitFor(() => {
      expect(window.AuthManager.addMojangAccount).toHaveBeenCalledWith('ValidPlayer', '');
      expect(window.ConfigManager.setSelectedAccount).toHaveBeenCalledWith('test-uuid');
      expect(window.ConfigManager.setSelectedServer).toHaveBeenCalledWith('server-2');
      expect(window.updateSelectedServer).toHaveBeenCalled();
      expect(window.ConfigManager.save).toHaveBeenCalled();
      expect(window.switchView).toHaveBeenCalledWith('#loginContainer', '#landingContainer');
    });
  });

  it('hides video controls on mount and restores on unmount', async () => {
    const videoControls = document.getElementById('video-controls-overlay');

    let unmount;
    await act(async () => {
      const rendered = render(<LoginScreen />);
      unmount = rendered.unmount;
    });
    expect(videoControls.style.display).toBe('none');

    unmount();
    expect(videoControls.style.display).toBe('');
  });
});
