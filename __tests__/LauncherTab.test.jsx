import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LauncherTab from '../app/assets/js/ui/react/components/Settings/LauncherTab';

describe('LauncherTab React UI', () => {
  beforeEach(() => {
    window.ConfigManager = {
      getDataDirectory: jest.fn().mockReturnValue('/mock/data/dir'),
      setDataDirectory: jest.fn(),
      getAllowPrerelease: jest.fn().mockReturnValue(false),
      setAllowPrerelease: jest.fn(),
      save: jest.fn()
    };
  });

  afterEach(() => {
    delete window.ConfigManager;
  });

  it('renders with initial values from ConfigManager', () => {
    render(<LauncherTab />);
    
    // Check data directory input
    const input = screen.getByDisplayValue('/mock/data/dir');
    expect(input).toBeInTheDocument();
  });

  it('updates ConfigManager when prerelease toggle is clicked', () => {
    const { container } = render(<LauncherTab />);
    
    // The toggle is a div since it doesn't have a specific role or label for the click target.
    // We can find it by looking for the prerelease text and getting the parent's next sibling or similar,
    // but the easiest way here is to grab the toggle button by relying on its styling or adding a test-id.
    // Since we didn't add a test-id, we'll click the div that has the background transition.
    // It's the div with width '50px' and height '26px'.
    // A better approach is to find it relative to the text.
    const prereleaseHeader = screen.getByText('Плавающий релиз');
    const toggleContainer = prereleaseHeader.parentElement.nextElementSibling;
    
    fireEvent.click(toggleContainer);

    expect(window.ConfigManager.setAllowPrerelease).toHaveBeenCalledWith(true);
    expect(window.ConfigManager.save).toHaveBeenCalled();
  });

  it('updates ConfigManager when data directory is changed', () => {
    render(<LauncherTab />);
    
    const input = screen.getByDisplayValue('/mock/data/dir');
    
    fireEvent.change(input, { target: { value: '/new/mock/dir' } });

    expect(window.ConfigManager.setDataDirectory).toHaveBeenCalledWith('/new/mock/dir');
    expect(window.ConfigManager.save).toHaveBeenCalled();
  });
});
