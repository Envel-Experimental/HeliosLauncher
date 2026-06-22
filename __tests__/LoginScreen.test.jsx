import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginScreen from '../app/assets/js/ui/react/components/LoginScreen';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  UserPlus: () => <div data-testid="userplus-icon" />,
  ArrowLeft: () => <div data-testid="arrowleft-icon" />
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
      save: jest.fn().mockResolvedValue(true)
    };

    window.switchView = jest.fn();
    window.getCurrentView = jest.fn().mockReturnValue('#loginContainer');
    window.VIEWS = { settings: '#settingsContainer' };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<LoginScreen />);
    expect(screen.getByText('Придумай никнейм для входа')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Никнейм')).toBeInTheDocument();
    expect(screen.getByText(/Disclaimer 1/)).toBeInTheDocument();
  });

  it('validates empty username disables submit button', () => {
    render(<LoginScreen />);

    const submitBtn = screen.getByText('Продолжить');
    expect(submitBtn).toBeDisabled();

    const input = screen.getByPlaceholderText('Никнейм');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(submitBtn).toBeDisabled();
  });

  it('validates invalid username format', async () => {
    render(<LoginScreen />);

    const input = screen.getByPlaceholderText('Никнейм');
    fireEvent.change(input, { target: { value: 'Никита' } }); // Russian letters are invalid

    const submitBtn = screen.getByText('Продолжить');
    fireEvent.click(submitBtn);

    expect(await screen.findByText('Некорректный никнейм (только английские буквы, от 4 до 16 символов)')).toBeInTheDocument();
    expect(window.AuthManager.addMojangAccount).not.toHaveBeenCalled();
  });

  it('successfully adds an offline account', async () => {
    render(<LoginScreen />);

    const input = screen.getByPlaceholderText('Никнейм');
    fireEvent.change(input, { target: { value: 'ValidPlayer' } });

    const submitBtn = screen.getByText('Продолжить');
    fireEvent.click(submitBtn);

    expect(submitBtn).toHaveTextContent('Добавление...');

    await waitFor(() => {
      expect(window.AuthManager.addMojangAccount).toHaveBeenCalledWith('ValidPlayer', '');
      expect(window.ConfigManager.setSelectedAccount).toHaveBeenCalledWith('test-uuid');
      expect(window.ConfigManager.save).toHaveBeenCalled();
    });
  });

  it('hides video controls on mount and restores on unmount', () => {
    const videoControls = document.getElementById('video-controls-overlay');

    const { unmount } = render(<LoginScreen />);
    expect(videoControls.style.display).toBe('none');

    unmount();
    expect(videoControls.style.display).toBe('');
  });
});
