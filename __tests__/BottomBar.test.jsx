import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BottomBar from '../app/assets/js/ui/react/components/BottomBar';
import { AppProvider } from '../app/assets/js/ui/react/AppContext';

// Simple mock for lucide-react icons
jest.mock('lucide-react', () => ({
  Settings: () => <div data-testid="settings-icon" />,
  Image: () => <div data-testid="image-icon" />,
  Globe: () => <div data-testid="globe-icon" />,
  Folder: () => <div data-testid="folder-icon" />,
  ChevronDown: () => <div data-testid="chevron-down-icon" />
}));

describe('BottomBar', () => {
  it('renders correctly', async () => {
    render(
      <AppProvider>
        <BottomBar />
      </AppProvider>
    );

    // Play button should be present
    expect(screen.getByText('Играть')).toBeInTheDocument();
  });

  it('calls openPath when Folder icon is clicked', async () => {
    render(
      <AppProvider>
        <BottomBar />
      </AppProvider>
    );

    // Find the button with tooltip "Папка игры"
    const folderButton = screen.getByTestId('folder-icon').closest('button');
    fireEvent.click(folderButton);

    expect(window.HeliosAPI.shell.openPath).toHaveBeenCalledWith('/mock/data/dir');
  });

  it('loads servers and displays the default selected version', async () => {
    render(
      <AppProvider>
        <BottomBar />
      </AppProvider>
    );

    // Wait for the servers to load from mocked DistroAPI
    await waitFor(() => {
      expect(screen.getByText('Test Server (1.20.1)')).toBeInTheDocument();
    });
  });

  it('toggles the custom version dropdown on click', async () => {
    render(
      <AppProvider>
        <BottomBar />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Server (1.20.1)')).toBeInTheDocument();
    });

    // The dropdown header contains the title
    const dropdownHeader = screen.getByText('Test Server (1.20.1)');
    fireEvent.click(dropdownHeader);

    // We should see the option inside the dropdown menu (it's rendered dynamically)
    // The name 'Test Server' will be rendered again inside the dropdown menu list
    const options = screen.getAllByText('Test Server');
    expect(options.length).toBeGreaterThan(0);
  });
});
