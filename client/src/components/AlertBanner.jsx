import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export default function AlertBanner({ type = 'info', message, onDismiss }) {
  if (!message) return null;

  const icons = {
    error: <AlertCircle size={18} className="alert-icon error" />,
    success: <CheckCircle2 size={18} className="alert-icon success" />,
    info: <Info size={18} className="alert-icon info" />,
  };

  return (
    <div className={`alert-banner alert-${type} animate-fade-in`}>
      <div className="alert-content">
        {icons[type] || icons.info}
        <span className="alert-text">{message}</span>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="alert-dismiss" aria-label="Dismiss alert">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
