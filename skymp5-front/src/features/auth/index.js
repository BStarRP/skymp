import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { SkyrimFrame } from '../../components/SkyrimFrame/SkyrimFrame';
import './styles.scss';

const Auth = () => {
  const [authState, setAuthState] = useState({
    authData: null,
    comment: '',
    loginFailedReason: '',
    isConnecting: false
  });
  const [isHidden, setIsHidden] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Listen for auth state updates from client
    const handleAuthUpdate = (event) => {
      setAuthState(event.detail);
      setIsInitialized(true);
    };

    // Listen for auth completion (successful login)
    const handleAuthCompleted = () => {
      setIsHidden(true);
    };

    // Listen for character list (means we're on character select, hide auth screen)
    const handleCharacterList = (event) => {
      if (event.detail) setIsHidden(true);
    };

    // Listen for back to login (reset and show auth screen)
    const handleBackToLogin = () => {
      setIsHidden(false);
      setAuthState({
        authData: window.skymp?.auth?.authData || null,
        comment: '',
        loginFailedReason: '',
        isConnecting: false
      });
    };

    window.addEventListener('skymp:authUpdate', handleAuthUpdate);
    window.addEventListener('skymp:authCompleted', handleAuthCompleted);
    window.addEventListener('skymp:characterList', handleCharacterList);
    window.addEventListener('skymp:backToLogin', handleBackToLogin);

    // Initialize with any existing auth data
    if (window.skymp?.auth) {
      setAuthState(window.skymp.auth);
      setIsInitialized(true);
    }

    // Request initial auth state from client
    setTimeout(() => {
      if (window.skyrimPlatform) {
        window.skyrimPlatform.sendMessage('requestAuthState');
      }
    }, 100);

    return () => {
      window.removeEventListener('skymp:authUpdate', handleAuthUpdate);
      window.removeEventListener('skymp:authCompleted', handleAuthCompleted);
      window.removeEventListener('skymp:characterList', handleCharacterList);
      window.removeEventListener('skymp:backToLogin', handleBackToLogin);
    };
  }, []);

  const handleLoginDiscord = () => {
    if (window.skyrimPlatform) {
      window.skyrimPlatform.sendMessage('openDiscordOauth');
    }
  };

  const handleConnect = () => {
    if (window.skyrimPlatform) {
      window.skyrimPlatform.sendMessage('authAttemptEvent');
    }
  };

  const handleOpenGithub = () => {
    if (window.skyrimPlatform) {
      window.skyrimPlatform.sendMessage('openGithub');
    }
  };

  const handleOpenPatreon = () => {
    if (window.skyrimPlatform) {
      window.skyrimPlatform.sendMessage('openPatreon');
    }
  };

  const handleJoinDiscord = () => {
    if (window.skyrimPlatform) {
      window.skyrimPlatform.sendMessage('joinDiscord');
    }
  };

  const handleClose = () => {
    if (window.skyrimPlatform) {
      window.skyrimPlatform.sendMessage('hideBrowser');
    }
  };

  const getUserDisplay = () => {
    if (!authState.authData) return 'NOT AUTHORIZED';
    if (authState.authData.discordUsername) {
      return authState.authData.discordUsername;
    }
    if (authState.authData.masterApiId) {
      return `ID: ${authState.authData.masterApiId}`;
    }
    return 'AUTHORIZED';
  };

  const getStatusMessage = () => {
    if (authState.loginFailedReason) {
      return authState.loginFailedReason.toUpperCase();
    }
    if (authState.comment) {
      return authState.comment.toUpperCase();
    }
    if (authState.isConnecting) {
      return 'CONNECTING...';
    }
    return '';
  };

  const isErrorStatus = () => {
    if (authState.loginFailedReason) return true;
    const c = (authState.comment || '').toLowerCase();
    return /server returned|fail:|could not|error/.test(c);
  };

  const statusRef = useRef(null);
  const statusMessage = getStatusMessage();

  useLayoutEffect(() => {
    const el = statusRef.current;
    if (!el || !statusMessage) return;
    let fontSize = 14;
    el.style.fontSize = '';
    el.style.fontSize = `${fontSize}px`;
    while (fontSize > 10 && el.scrollHeight > el.clientHeight) {
      fontSize -= 1;
      el.style.fontSize = `${fontSize}px`;
    }
  }, [statusMessage]);

  // Don't render if auth is completed (user logged in successfully)
  if (isHidden) {
    return null;
  }

  // Don't render until we have initial auth state from client
  if (!isInitialized) {
    return null;
  }

  return (
    <div className="auth-overlay">
      <div className="auth-wrapper">
        <SkyrimFrame width={420} height={560} header={true} />

        <button className="auth-close-button" onClick={handleClose}>
          ✕
        </button>

        <div className="auth-header-title">
          LOGIN
        </div>

        <div className="auth-content">
          {/* User Info Section */}
          <div className="auth-user-info">
            <div className="auth-user-label">ACCOUNT</div>
            <div className="auth-user-name">{getUserDisplay()}</div>
          </div>

          {/* Status Messages - fixed height; text shrinks so long messages don't push buttons */}
          {statusMessage && (
            <div className={`auth-status ${isErrorStatus() ? 'auth-status--error' : ''}`} ref={statusRef}>
              {statusMessage}
            </div>
          )}

          {/* Spacer to push buttons down */}
          <div className="auth-spacer"></div>

          {/* Action Buttons - Hide when connecting */}
          {!authState.isConnecting && (
            <div className="auth-buttons">
              <button
                className="skyrim-button"
                onClick={handleLoginDiscord}
              >
                {authState.authData ? 'Change Account' : 'Login via Discord'}
              </button>

              <button
                className="skyrim-button"
                onClick={handleConnect}
                disabled={!authState.authData}
              >
                Connect
              </button>
            </div>
          )}

          {/* Footer Links */}
          <div className="auth-footer">
            <div className="auth-footer-links">
              <button
                className="auth-link"
                onClick={handleOpenGithub}
                disabled={authState.isConnecting}
              >
                GitHub
              </button>
              <span className="auth-link-separator">•</span>
              <button
                className="auth-link"
                onClick={handleOpenPatreon}
                disabled={authState.isConnecting}
              >
                Patreon
              </button>
              <span className="auth-link-separator">•</span>
              <button
                className="auth-link"
                onClick={handleJoinDiscord}
                disabled={authState.isConnecting}
              >
                Discord
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
