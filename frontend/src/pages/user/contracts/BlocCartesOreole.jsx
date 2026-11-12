import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, CreditCard, Loader2 } from 'lucide-react';
import { oreoleApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { confirmer } from '../../../utils/dialogue';
import { aLeDroit } from '../../../utils/droits';
import { dateFr, fcfa, messageErreurApi } from '../../../utils/financeUtils';

/* =========================================================================
   Fiche contrat Oreole Santé : cartes d'assurance de chaque personne de la police. Une carte déjà facturée ne se facture de nouveau qu'avec le
   motif « Renouvellement pour perte » : l'avenant et sa quittance sortent aussitôt. Contrôle au serveur : sante/cartes.py.
   ========================================================================= */
const MOTIFS = [['PREMIERE', 'Première facturation'], ['PERTE', 'Renouvellement pour perte']];

const detailFacturation = (h) => [`le ${dateFr(h.Date)}`, `${fcfa(h.Montant)} F`, h.Utilisateur && `par ${h.Utilisateur}`, h.NumeroPolice && `police ${h.NumeroPolice}`].filter(Boolean).join(', ');

export default function BlocCartesOreole({ idContrat, idDevisPackage }) {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [ouvert, setOuvert] = useState(false);
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [motif, setMotif] = useState('PREMIERE');
  const [envoi, setEnvoi] = useState(false);
  const [emis, setEmis] = useState(null);
  const peutFacturer = aLeDroit('devis.validate');

  const charger = async () => {
    setChargement(true);
    try {
      setDonnees(await oreoleApi.cartesContrat(idContrat));
    } catch (err) {
      toastError(`Cartes non lues : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => { if (ouvert && !donnees) charger(); }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps

  const choisies = useMemo(() => (donnees?.Personnes || []).filter((p) => selection.has(p.Cle)), [donnees, selection]);
  const dejaFacturees = useMemo(() => choisies.filter((p) => p.Historique.length), [choisies]);
  const bloque = motif !== 'PERTE' && dejaFacturees.length > 0;
  const total = choisies.length * (donnees?.Montant || 0);

  const basculer = (cle) => setSelection((avant) => {
    const s = new Set(avant);
    if (s.has(cle)) s.delete(cle); else s.add(cle);
    return s;
  });

  const facturer = async () => {
    const libelleMotif = MOTIFS.find(([v]) => v === motif)[1];
    const ok = await confirmer({
      titre: `Facturer ${choisies.length} carte${choisies.length > 1 ? 's' : ''} : ${fcfa(total)} F`,
      message: `Motif : ${libelleMotif}.`,
      consequences: `${choisies.slice(0, 6).map((p) => p.Personne).join(', ')}${choisies.length > 6 ? '…' : ''}. Un avenant et sa quittance sont émis aussitôt, à encaisser à la caisse.`,
      confirmer: 'Facturer et émettre', ton: 'attention',
    });
    if (!ok) return;
    setEnvoi(true);
    try {
      const r = await oreoleApi.facturerCartes(idContrat, { Personnes: choisies.map((p) => p.Cle), Motif: motif });
      success(`Quittance ${r.Produits?.Sante?.NumeroQuittance || ''} émise : ${r.CartesFacturees} carte${r.CartesFacturees > 1 ? 's' : ''}, ${fcfa(r.Produits?.Sante?.PrimeTtc)} F.`);
      setEmis(r);
      setSelection(new Set());
      setMotif('PREMIERE');
      await charger();
    } catch (err) {
      toastError(`Carte non facturée : ${messageErreurApi(err)}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px dashed var(--border-medium)', paddingTop: '0.75rem' }}>
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.86rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        {ouvert ? <ChevronDown size={15} /> : <ChevronRight size={15} />} <CreditCard size={15} /> Cartes d'assurance
        {donnees && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>: {donnees.Facturees} facturée{donnees.Facturees > 1 ? 's' : ''} sur {donnees.Personnes.length}</span>}
      </button>

      {ouvert && chargement && !donnees && <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}><Loader2 size={14} className="spin" /> Lecture de l'historique…</div>}
      {ouvert && donnees && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div className="table-wrapper" style={{ maxHeight: 340, overflow: 'auto' }}>
            <table className="data-table" style={{ fontSize: '0.8rem' }}>
              <thead><tr>{peutFacturer && <th aria-label="Choisir" />}<th>Personne</th><th>Naissance</th><th>Famille</th><th>Historique des facturations</th></tr></thead>
              <tbody>
                {donnees.Personnes.map((p) => (
                  <tr key={p.Cle}>
                    {peutFacturer && <td><input type="checkbox" aria-label={`Choisir ${p.Personne}`} checked={selection.has(p.Cle)} onChange={() => basculer(p.Cle)} /></td>}
                    <td style={{ fontWeight: 600 }}>{p.Personne}</td>
                    <td>{dateFr(p.DateNaissance)}</td>
                    <td>{p.Famille}</td>
                    <td>
                      {!p.Historique.length && <span style={{ color: 'var(--text-muted)' }}>Non facturée</span>}
                      {p.Historique.map((h) => <div key={h.IdFacturation}><b>{h.LibelleMotif}</b> {detailFacturation(h)}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {peutFacturer && choisies.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ margin: 0, minWidth: 220 }}>
                <label className="form-label" htmlFor="carte-motif">Motif</label>
                <select id="carte-motif" className="form-control" value={motif} onChange={(e) => setMotif(e.target.value)}>
                  {MOTIFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-primary" disabled={bloque || envoi} onClick={facturer} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {envoi ? <Loader2 size={14} className="spin" /> : <CreditCard size={14} />} Facturer {fcfa(total)} F
              </button>
            </div>
          )}
          {bloque && (
            <p role="alert" style={{ margin: 0, display: 'flex', gap: '0.45rem', alignItems: 'flex-start', fontSize: '0.82rem', color: 'var(--accent-amber)' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {dejaFacturees.length === 1 ? dejaFacturees[0].Alerte : `Une facturation de carte existe déjà pour ${dejaFacturees.length} des personnes choisies. Un renouvellement pour perte est nécessaire pour poursuivre.`}
              </span>
            </p>
          )}
          {emis && aLeDroit('encaissements.create') && (
            <div>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => navigate(`/user/cash?oreole=${emis.IdDevis || idDevisPackage}`)}>Encaisser la quittance</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
