import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { dataStore } from '../../../api/dataStore';
import { quoteApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { FileText, Banknote, Building2, Save, Clock } from 'lucide-react';
import { AmountInput } from '../../../components/common/AmountInput';

export const EditQuoteModal = ({ isOpen, onClose, quote, onSuccess }) => {
  const { success, error: toastError } = useToast();
  const [formData, setFormData] = useState({
    prime_nette: 0,
    accessoires: 15000,
    taxes: 0,
    prime_totale: 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [taxRate, setTaxRate] = useState(0.145);

  useEffect(() => {
    if (quote) {
      const tarif = dataStore.getTarifForBranch(quote.branche);
      setTaxRate(tarif.taxRate || 0.145);

      const pNette = Number(quote.prime_nette || 0);
      const acc = Number(quote.accessoires ?? tarif.accessoires ?? 15000);
      const taxes = Number(quote.taxes ?? Math.round(pNette * (tarif.taxRate || 0.145)));
      const pTotale = Number(quote.prime_totale || pNette + acc + taxes);

      setFormData({ prime_nette: pNette, accessoires: acc, taxes, prime_totale: pTotale });
    }
  }, [quote]);

  if (!isOpen || !quote) return null;

  const handlePrimeNetteChange = (val) => {
    const pNette = Number(val) || 0;
    const taxes = Math.round(pNette * taxRate);
    const pTotale = pNette + formData.accessoires + taxes;
    setFormData({ ...formData, prime_nette: pNette, taxes, prime_totale: pTotale });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!quote.numerodevis) {
      toastError("Ce devis n'a pas de numéro : l'ajustement ne peut pas être enregistré.");
      return;
    }
    setIsSaving(true);
    try {
      // sp_maj_manuelle_primes recalcule la prime nette à partir de la prime annuelle
      // (proratisation selon la durée réelle de la police) : on ne touche donc pas à
      // la prime annuelle d'origine, seuls l'accessoire, la taxe et le TTC sont ajustés.
      await quoteApi.updateQuotePrimes({
        numero_devis: quote.numerodevis,
        prime_annuelle: quote.raw?.primeannuelle || formData.prime_nette,
        prime_nette: formData.prime_nette,
        accessoire: formData.accessoires,
        taxe: formData.taxes,
        fga: quote.fga || 0,
        cedeao: quote.cedeao || 0,
        prime_ttc: formData.prime_totale,
      });
      success(`Devis ${quote.numerodevis} modifié avec succès.`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toastError(err.response?.data?.message || err.response?.data?.detail || "L'ajustement n'a pas pu être enregistré.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Modifier le Devis [${quote.numerodevis}]`}
      size="medium"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Bandeau de traçabilité CIMA & Horodatage */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
            padding: '0.6rem 0.85rem',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '6px',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Clock size={14} color="#60a5fa" />
            <span>Émis le : <strong style={{ color: '#fff' }}>{quote.date_emission || quote.date_creation || '-'}</strong></span>
          </div>
          <div>
            <span>Dernière modification : <strong style={{ color: '#38bdf8' }}>{quote.date_derniere_modification || quote.DateMaj || quote.date_maj || 'Enregistrement initial'}</strong></span>
          </div>
        </div>

        {/* Souscripteur / compagnie / produit : identité du devis, non modifiable ici (le
            backend ne permet pas de réassigner un devis existant à un autre client, une
            autre compagnie ou un autre produit - seule la décomposition actuarielle l'est,
            via sp_maj_manuelle_primes). */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              <FileText size={13} style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
              Souscripteur / Assuré
            </label>
            <input type="text" className="form-control" value={quote.client_nom || ''} readOnly disabled />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              <Building2 size={13} style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
              Compagnie Partenaire
            </label>
            <input type="text" className="form-control" value={quote.compagnie || ''} readOnly disabled />
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--surface-sunken)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.6rem', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Banknote size={14} />
            Décomposition Actuarielle CIMA ({quote.branche || 'Général'})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Prime Nette</label>
              <AmountInput value={formData.prime_nette} onChange={handlePrimeNetteChange} required />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Accessoires</label>
              <AmountInput
                value={formData.accessoires}
                onChange={(acc) => {
                  setFormData({
                    ...formData,
                    accessoires: acc,
                    prime_totale: formData.prime_nette + acc + formData.taxes,
                  });
                }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>
                Taxes ({(taxRate * 100).toFixed(1)}%)
              </label>
              <input
                type="text"
                className="form-control"
                value={`${formData.taxes.toLocaleString('fr-FR')} FCFA`}
                readOnly
                disabled
              />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Prime TTC :</span>
            <strong style={{ fontSize: '1.1rem', color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
              {formData.prime_totale.toLocaleString('fr-FR')} FCFA
            </strong>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
            Annuler
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSaving}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#2563eb' }}
          >
            <Save size={15} />
            <span>{isSaving ? 'Enregistrement…' : 'Enregistrer les Primes'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
