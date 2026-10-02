import React from 'react';

const colorMap = {
  emerald: 'badge-emerald',
  green: 'badge-emerald',
  validé: 'badge-emerald',
  soldé: 'badge-emerald',
  actif: 'badge-emerald',
  payé: 'badge-emerald',
  approuvée: 'badge-emerald',
  approved: 'badge-emerald',

  amber: 'badge-amber',
  yellow: 'badge-amber',
  'en cours': 'badge-amber',
  partiel: 'badge-amber',
  'en attente': 'badge-amber',
  pending: 'badge-amber',

  rose: 'badge-rose',
  red: 'badge-rose',
  annulé: 'badge-rose',
  rejetée: 'badge-rose',
  rejected: 'badge-rose',
  inactif: 'badge-rose',

  blue: 'badge-blue',
  consolidé: 'badge-blue',
  nouveau: 'badge-blue',

  purple: 'badge-purple',
  admin: 'badge-purple',

  slate: 'badge-slate',
  gray: 'badge-slate',
};

export const StatusBadge = ({ label, color }) => {
  const normalizedKey = (color || label || '').toString().toLowerCase().trim();
  const badgeClass = colorMap[normalizedKey] || 'badge-blue';

  return (
    <span className={`badge ${badgeClass}`}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }}></span>
      {label}
    </span>
  );
};

export default StatusBadge;
