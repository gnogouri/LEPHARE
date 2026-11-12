import React, { useState, useEffect } from 'react';

// Formate en direct pendant la saisie : "30000000" -> "30 000 000". La valeur
// numérique brute (sans espaces) est ce qui est transmis à onChange, jamais
// la chaîne affichée - pour rester lisible sans casser les montants stockés.
const groupThousands = (digits) => {
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const toDisplay = (raw, allowNegative) => {
  const str = String(raw ?? '');
  const isNegative = allowNegative && str.trim().startsWith('-');
  const digits = str.replace(/\D/g, '');
  return (isNegative && digits ? '-' : '') + groupThousands(digits);
};

// allowNegative : pour les montants qui peuvent être des ristournes/avoirs (signe moins autorisé)
export const AmountInput = ({ value, onChange, suffix = 'FCFA', className = 'form-control', placeholder, disabled, id, required, allowNegative = false }) => {
  const [display, setDisplay] = useState(() => toDisplay(value, allowNegative));

  // Resynchronise l'affichage si la valeur change depuis l'extérieur (ex: chargement
  // d'un devis existant), sans écraser ce que l'utilisateur est en train de taper.
  useEffect(() => {
    const propDigits = toDisplay(value, allowNegative).replace(/[^0-9-]/g, '');
    const displayDigits = display.replace(/[^0-9-]/g, '');
    if (propDigits !== displayDigits) {
      setDisplay(toDisplay(value, allowNegative));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e) => {
    const raw = e.target.value;
    const isNegative = allowNegative && raw.trim().startsWith('-');
    const digits = raw.replace(/\D/g, '');
    setDisplay((isNegative && digits ? '-' : '') + groupThousands(digits));
    if (digits === '') {
      onChange(0);
    } else {
      onChange((isNegative ? -1 : 1) * Number(digits));
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type="text"
        inputMode={allowNegative ? 'text' : 'numeric'}
        className={className}
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        style={suffix ? { paddingRight: '3.2rem' } : undefined}
      />
      {suffix && (
        <span
          style={{
            position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
            fontSize: '0.78rem', color: 'var(--text-muted)', pointerEvents: 'none',
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
};

export default AmountInput;
