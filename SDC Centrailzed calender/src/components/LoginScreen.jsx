import React, { useState, useEffect } from 'react';
import { API_URL } from '../constants.jsx';

function LoginScreen({ onAuthReady }) {
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('token=')) {
      const token = new URLSearchParams(hash.slice(1)).get('token');
      if (token) {
        localStorage.setItem('sdc_auth_token', token);
        window.history.replaceState(null, '', window.location.pathname);
        onAuthReady(token);
        return;
      }
    }
    if (hash.includes('error=')) {
      const errMsg = decodeURIComponent(new URLSearchParams(hash.slice(1)).get('error') || '');
      setError(errMsg || 'Sign-in failed. Please try again.');
      window.history.replaceState(null, '', window.location.pathname);
    }
    setChecking(false);
  }, []);

  if (checking) return (
    <div className="login-screen">
      <div className="login-spinner"></div>
    </div>
  );

  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="assets/sdc-logo.png" alt="SDC" className="login-logo" />
        <h1 className="login-title">Centralized Calendar</h1>
        <p className="login-sub">Sign in with your SDC Microsoft account to continue</p>
        {error && <div className="login-error">{error}</div>}
        <a href={`${API_URL}/auth/login`} className="btn-microsoft">
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          Sign in with Microsoft
        </a>
        <p className="login-footer">SDC Automation · Internal use only</p>
      </div>
    </div>
  );
}

export default LoginScreen;
