import React from 'react';
import { Eye, Edit2, Archive, CheckCircle, Printer, RefreshCw, Trash2 } from 'lucide-react';

const baseBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '30px',
  height: '28px',
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};

const IconButton = ({ icon: Icon, title, onClick, disabled, hoverColor, hoverBg, color }) => {
  const [hover, setHover] = React.useState(false);
  const active = hover && !disabled;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...baseBtn,
        color: active ? hoverColor : (color || baseBtn.color),
        background: active ? hoverBg : 'transparent',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Icon size={15} />
    </button>
  );
};

const Divider = () => (
  <span style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
);

/**
 * Actions de ligne compactes.
 * - Action principale (Confirmer) : toujours visible, un clic.
 * - Actions secondaires : groupe d'icônes avec infobulle, séparateurs fins.
 * - Archiver : icône rouge au survol, isolée à droite ; la confirmation est gérée par le parent (onArchive ouvre une modale).
 * - Imprimer (facultatif, showPrint) : documents de la ligne, en tête du groupe d'icônes.
 * - Supprimer (facultatif, showDelete) : suppression définitive, par habilitation ; la confirmation est gérée par le parent.
 * Chaque action se masque avec `show*={false}` ou se désactive avec `*Disabled` + `*Title`.
 */
export const RowActions = ({
  onView, viewTitle = 'Consulter', showView = true,
  onConfirm, confirmLabel = 'Confirmer', confirmTitle = 'Confirmer', confirmDisabled = false, showConfirm = true,
  onEdit, editTitle = 'Modifier', editDisabled = false, showEdit = true,
  onArchive, archiveTitle = 'Archiver', archiveDisabled = false, showArchive = true,
  onRestore, restoreTitle = 'Désarchiver', showRestore = false,
  onPrint, printTitle = 'Imprimer', showPrint = false,
  onDelete, deleteTitle = 'Supprimer', showDelete = false,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
    {showConfirm && (
      <button
        type="button"
        title={confirmTitle}
        disabled={confirmDisabled}
        onClick={onConfirm}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0.3rem 0.6rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          borderRadius: 'var(--radius-sm, 6px)',
          border: 'none',
          color: '#fff',
          background: confirmDisabled ? '#475569' : '#059669',
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        <CheckCircle size={13} />
        <span>{confirmLabel}</span>
      </button>
    )}

    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm, 6px)',
        overflow: 'hidden',
      }}
    >
      {showPrint && (
        <IconButton icon={Printer} title={printTitle} onClick={onPrint} hoverColor="#c084fc" hoverBg="rgba(192,132,252,0.12)" />
      )}
      {showPrint && (showView || showEdit) && <Divider />}
      {showView && (
        <IconButton icon={Eye} title={viewTitle} onClick={onView} hoverColor="#60a5fa" hoverBg="rgba(96,165,250,0.12)" />
      )}
      {showView && showEdit && <Divider />}
      {showEdit && (
        <IconButton icon={Edit2} title={editTitle} onClick={onEdit} disabled={editDisabled} hoverColor="#60a5fa" hoverBg="rgba(96,165,250,0.12)" />
      )}
      {showRestore && (
        <>
          <Divider />
          <IconButton icon={RefreshCw} title={restoreTitle} onClick={onRestore} hoverColor="#34d399" hoverBg="rgba(52,211,153,0.12)" />
        </>
      )}
      {showArchive && (
        <>
          <Divider />
          <IconButton
            icon={Archive}
            title={archiveTitle}
            onClick={onArchive}
            disabled={archiveDisabled}
            color="#f87171"
            hoverColor="#fff"
            hoverBg="rgba(239,68,68,0.7)"
          />
        </>
      )}
      {showDelete && (
        <>
          <Divider />
          <IconButton icon={Trash2} title={deleteTitle} onClick={onDelete} color="#f87171" hoverColor="#fff" hoverBg="rgba(239,68,68,0.7)" />
        </>
      )}
    </div>
  </div>
);

export default RowActions;
