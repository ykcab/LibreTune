import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import './LoadingContext.css';

interface LoadingState {
  active: boolean;
  message: string;
}

interface LoadingContextType {
  isLoading: boolean;
  loadingMessage: string;
  showLoading: (message?: string) => void;
  hideLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [loadingState, setLoadingState] = useState<LoadingState>({
    active: false,
    message: 'Loading...',
  });

  const showLoading = useCallback((message = 'Loading...') => {
    setLoadingState({ active: true, message });
  }, []);

  const hideLoading = useCallback(() => {
    setLoadingState({ active: false, message: '' });
  }, []);

  return (
    <LoadingContext.Provider
      value={{
        isLoading: loadingState.active,
        loadingMessage: loadingState.message,
        showLoading,
        hideLoading,
      }}
    >
      {children}
      {loadingState.active && <LoadingOverlay message={loadingState.message} />}
    </LoadingContext.Provider>
  );
}

export function useLoading(): LoadingContextType {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
}

interface LoadingOverlayProps {
  message: string;
}

function LoadingOverlay({ message }: LoadingOverlayProps) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-skeleton">
        <div className="loading-skeleton__menubar" />
        <div className="loading-skeleton__body">
          <div className="loading-skeleton__sidebar" />
          <div className="loading-skeleton__content">
            <div className="loading-skeleton__bar loading-skeleton__bar--title" />
            <div className="loading-skeleton__bar" />
            <div className="loading-skeleton__bar loading-skeleton__bar--short" />
            <div className="loading-skeleton__bar loading-skeleton__bar--tiny" />
            <div className="loading-skeleton__message">{message}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoadingContext;
