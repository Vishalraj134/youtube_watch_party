import React, { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';

export default function RoomBadge({ roomCode }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="room-badge-container">
      <div className="room-badge-pill">
        <span className="room-badge-label">ROOM CODE</span>
        <span className="room-badge-code">{roomCode}</span>
      </div>
      <button 
        onClick={handleCopyLink} 
        className={`room-copy-btn ${copied ? 'copied' : ''}`}
        title="Copy shareable room link"
      >
        {copied ? (
          <>
            <Check size={14} />
            <span>Copied!</span>
          </>
        ) : (
          <>
            <Share2 size={14} />
            <span>Share Link</span>
          </>
        )}
      </button>
    </div>
  );
}
