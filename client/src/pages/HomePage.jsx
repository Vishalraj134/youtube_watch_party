import React, { useState, useEffect } from 'react';
import { 
  Users, 
  PlusCircle, 
  LogIn, 
  ShieldCheck, 
  Zap, 
  Crown, 
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import YouTubeIcon from '../components/YouTubeIcon';
import AlertBanner from '../components/AlertBanner';

export default function HomePage({ onCreateRoom, onJoinRoom, initialRoomCode = '' }) {
  // Create Room Form State
  const [createHostName, setCreateHostName] = useState('');
  const [createVideoUrl, setCreateVideoUrl] = useState('');
  const [roomPolicy, setRoomPolicy] = useState('host_only'); // 'host_only' or 'collaborative'
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Join Room Form State
  const [joinName, setJoinName] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState(initialRoomCode);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (initialRoomCode) {
      setJoinRoomCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setCreateError('');

    if (!createHostName.trim()) {
      setCreateError('Please enter a display name to host the party.');
      return;
    }

    setIsCreating(true);
    try {
      await onCreateRoom({
        username: createHostName.trim(),
        initialVideoUrl: createVideoUrl.trim() || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        policy: roomPolicy,
      });
    } catch (err) {
      setCreateError(err.message || 'Failed to create room. Please verify backend is running.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    setJoinError('');

    if (!joinName.trim()) {
      setJoinError('Please enter your nickname.');
      return;
    }
    if (!joinRoomCode.trim()) {
      setJoinError('Please enter a valid room code.');
      return;
    }

    setIsJoining(true);
    try {
      await onJoinRoom({
        username: joinName.trim(),
        roomCode: joinRoomCode.trim().toUpperCase(),
      });
    } catch (err) {
      setJoinError(err.message || 'Failed to join room.');
    } finally {
      setIsJoining(false);
    }
  };

  const sampleVideos = [
    { label: 'Lo-Fi Chill Beats', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
    { label: 'Blender Open Movie', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  ];

  return (
    <div className="home-container animate-fade-in">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-badge">
          <Zap size={14} className="hero-badge-icon" />
          <span>Real-Time YouTube Party System</span>
        </div>
        <h1 className="hero-heading">
          Watch YouTube Together <br />
          <span className="gradient-text">In Frame-Accurate Sync</span>
        </h1>
        <p className="hero-description">
          Host private watch party rooms with synchronized playback, host & moderator controls, 
          and permission-gated playback requests.
        </p>
      </section>

      {/* Main Dual Card Interaction Grid */}
      <section className="cards-grid">
        {/* Card 1: Create a Watch Party */}
        <div className="party-card glass-panel">
          <div className="card-header">
            <div className="card-icon-bubble create">
              <PlusCircle size={24} />
            </div>
            <div>
              <h2 className="card-title">Host a Watch Party</h2>
              <p className="card-subtitle">You become the Host with full administrative privileges</p>
            </div>
          </div>

          <AlertBanner 
            type="error" 
            message={createError} 
            onDismiss={() => setCreateError('')} 
          />

          <form onSubmit={handleCreateSubmit} className="card-form">
            <div className="form-group">
              <label htmlFor="host-name" className="form-label">
                Your Host Nickname <span className="required-star">*</span>
              </label>
              <input
                id="host-name"
                type="text"
                className="form-input"
                placeholder="e.g. Alex"
                value={createHostName}
                onChange={(e) => setCreateHostName(e.target.value)}
                maxLength={25}
                disabled={isCreating}
              />
            </div>

            <div className="form-group">
              <div className="label-with-hint">
                <label htmlFor="initial-video" className="form-label">
                  YouTube Video Link <span className="optional-tag">(Optional)</span>
                </label>
              </div>
              <div className="input-with-icon">
                <YouTubeIcon size={18} className="input-icon yt" />
                <input
                  id="initial-video"
                  type="url"
                  className="form-input with-icon"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={createVideoUrl}
                  onChange={(e) => setCreateVideoUrl(e.target.value)}
                  disabled={isCreating}
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="sample-chips">
                <span className="chips-label">Quick samples:</span>
                {sampleVideos.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="chip-btn"
                    onClick={() => setCreateVideoUrl(item.url)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Playback Permission Mode</label>
              <div className="radio-tile-group">
                <label className={`radio-tile ${roomPolicy === 'host_only' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="roomPolicy"
                    value="host_only"
                    checked={roomPolicy === 'host_only'}
                    onChange={() => setRoomPolicy('host_only')}
                  />
                  <div className="radio-tile-content">
                    <Crown size={16} className="radio-icon host" />
                    <div>
                      <div className="radio-tile-title">Host & Moderator Only</div>
                      <div className="radio-tile-desc">Participants must request approval to seek or pause</div>
                    </div>
                  </div>
                </label>

                <label className={`radio-tile ${roomPolicy === 'collaborative' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="roomPolicy"
                    value="collaborative"
                    checked={roomPolicy === 'collaborative'}
                    onChange={() => setRoomPolicy('collaborative')}
                  />
                  <div className="radio-tile-content">
                    <Users size={16} className="radio-icon collab" />
                    <div>
                      <div className="radio-tile-title">Open Collaboration</div>
                      <div className="radio-tile-desc">Anyone in the party can control playback directly</div>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="submit-btn primary"
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <div className="spinner-sm" />
                  <span>Creating Room...</span>
                </>
              ) : (
                <>
                  <PlusCircle size={18} />
                  <span>Create Watch Room</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Card 2: Join an Existing Party */}
        <div className="party-card glass-panel">
          <div className="card-header">
            <div className="card-icon-bubble join">
              <LogIn size={24} />
            </div>
            <div>
              <h2 className="card-title">Join a Watch Party</h2>
              <p className="card-subtitle">Enter a 6-digit room code or shareable invite link</p>
            </div>
          </div>

          <AlertBanner 
            type="error" 
            message={joinError} 
            onDismiss={() => setJoinError('')} 
          />

          <form onSubmit={handleJoinSubmit} className="card-form">
            <div className="form-group">
              <label htmlFor="join-name" className="form-label">
                Your Nickname <span className="required-star">*</span>
              </label>
              <input
                id="join-name"
                type="text"
                className="form-input"
                placeholder="e.g. Sam"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                maxLength={25}
                disabled={isJoining}
              />
            </div>

            <div className="form-group">
              <label htmlFor="room-code" className="form-label">
                Room Code or URL <span className="required-star">*</span>
              </label>
              <input
                id="room-code"
                type="text"
                className="form-input code-input"
                placeholder="e.g. WP-4892"
                value={joinRoomCode}
                onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                maxLength={20}
                disabled={isJoining}
              />
              <p className="field-hint">
                Joining automatically assigns you the <strong>Participant</strong> role.
              </p>
            </div>

            <div className="join-info-callout">
              <ShieldCheck size={18} className="callout-icon" />
              <div>
                <span className="callout-title">Synchronized Experience</span>
                <p className="callout-text">
                  Your video player will automatically lock to the host's current time and play state upon joining.
                </p>
              </div>
            </div>

            <button
              type="submit"
              className="submit-btn secondary"
              disabled={isJoining}
            >
              {isJoining ? (
                <>
                  <div className="spinner-sm" />
                  <span>Joining Party...</span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span>Join Watch Party</span>
                </>
              )}
            </button>
          </form>
        </div>
      </section>

      {/* Feature Architecture Highlights Grid */}
      <section className="features-section">
        <h3 className="features-title">Core System Architecture</h3>
        <div className="features-grid">
          <div className="feature-item">
            <div className="feature-icon-wrapper">
              <Zap size={20} />
            </div>
            <h4>Low-Latency Sync</h4>
            <p>Socket.IO bidirectional broadcast synchronizes YouTube iframe player events with delta seeking.</p>
          </div>
          <div className="feature-item">
            <div className="feature-icon-wrapper">
              <Crown size={20} />
            </div>
            <h4>Role Hierarchy</h4>
            <p>Distinct permissions for Host, Moderator, and Participant enforced on both frontend and server.</p>
          </div>
          <div className="feature-item">
            <div className="feature-icon-wrapper">
              <ShieldCheck size={20} />
            </div>
            <h4>Approval Queue</h4>
            <p>Participants request playback privileges; Hosts can approve, decline, or promote members.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
