import React from 'react';
import { Play, Tv, Sparkles, RefreshCw } from 'lucide-react';

export default function Navbar({
  currentView,
  onNavigate,
  backendStatus,
  onRetryHealth,
  isCheckingHealth,
}) {
  return (
    <header className="navbar-container">
      <div className="navbar-content">
        {/* Brand / Logo */}
        <div className="brand-section" onClick={() => onNavigate('home')} role="button" tabIndex={0}>
          <div className="brand-icon-box">
            <Play size={20} fill="currentColor" className="brand-play-icon" />
          </div>
          <div className="brand-text">
            <span className="brand-title">SyncPlay</span>
            <span className="brand-subtitle">YouTube Watch Party</span>
          </div>
        </div>

        {/* View Switcher Tabs (For Assessment Testing) */}
        <nav className="nav-tabs">
          <button
            onClick={() => onNavigate('home')}
            className={`nav-tab-btn ${currentView === 'home' ? 'active' : ''}`}
          >
            <Sparkles size={16} />
            <span>Lobby & Join</span>
          </button>
          <button
            onClick={() => onNavigate('room')}
            className={`nav-tab-btn ${currentView === 'room' ? 'active' : ''}`}
          >
            <Tv size={16} />
            <span>Watch Room Preview</span>
          </button>
        </nav>

        {/* Backend Status & Assessment Pill */}
        <div className="navbar-status-section">
          <button 
            className={`status-pill ${backendStatus.isOnline ? 'online' : 'offline'}`}
            onClick={onRetryHealth}
            title="Click to re-verify backend connectivity"
          >
            <span className="status-dot"></span>
            <span className="status-text">
              {backendStatus.isOnline
                ? `Backend: Online (${backendStatus.version || 'v1.0.0'})`
                : 'Backend: Connecting...'}
            </span>
            <RefreshCw size={12} className={isCheckingHealth ? 'spin-icon' : 'refresh-icon'} />
          </button>
        </div>
      </div>
    </header>
  );
}
