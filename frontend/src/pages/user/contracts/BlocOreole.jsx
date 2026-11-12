import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Link2, Loader2, Plus, RefreshCw, UserPlus, Wallet } from 'lucide-react';
import { oreoleApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { aLeDroit } from '../../../utils/droits';
import { messageErreurApi } from '../../../utils/financeUtils';
import { imprimerOreole } from '../../../utils/impressionsOreole';
import { BarreRepartition, LegendeRepartition, PRODUITS, RESEAUX, RESEAU_PHARMACIES, dateFr, fcfa, ligneDetail } from '../quotes/oreole/oreoleCommun';
import BlocCartesOreole from './BlocCartesOreole';

/* =========================================================================
   Fiche contrat : bloc Oreole Santé (remplace le cadre MINENE pour cette branche). Les trois polices liées, ce qui reste
   à émettre (sans ressaisie), l'encaissement, la décomposition et les documents. onDetection : indique à la fiche
   que ce contrat relève d'Oreole Santé, pour masquer le renouvellement et les avenants génériques.
   ========================================================================= */
export default function BlocOreole({ idContrat, onDetection }) {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [emissionEnCours, setEmissionEnCours] = useState('');

  useEffect(() => {
    let actif = true;
    oreoleApi.contrat(idContrat)
      .then((d) => {
        if (!actif) return;
        setDonnees(d?.Oreole ? d : null);
        onDetection?.(Boolean(d?.Oreole), d?.IdDevis || 0);
      })
      .catch(() => { if (actif) { setDonnees(null); onDetection?.(false, 0); } });
    return () => { actif = false; };
  }, [idContrat]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!donnees) return null;

  const emettre = async (produit) => {
    setEmissionEnCours(produit);
    try {
      const r = await oreoleApi.emettreLie(idContrat, produit);
      setDonnees({ Oreole: true, ...r });
      success(`${PRODUITS[produit].long} émise sur la police Santé, sans ressaisie.`);
    } catch (err) {
      toastError(`${PRODUITS[produit].long} non émise : ${messageErreurApi(err)}`);
    } finally {
      setEmissionEnCours('');
    }
  };

  const { Produits: produits, Totaux: totaux } = donnees;
  const reseau = RESEAUX[donnees.Reseau] || RESEAUX.MCI_80;
  const encaisse = (produits.Sante?.Encaisse || 0) + (produits.IA?.Encaisse || 0) + (produits.AFA?.Encaisse || 0);
  const carteProduit = (cle) => {
    const p = PRODUITS[cle];
    const Icone = p.icone;
    const etat = produits[cle];
    const emise = Boolean(etat?.IdContrat);
    return (
      <div key={cle} style={{ padding: '0.8rem 0.9rem', borderRadius: 12, border: '1px solid var(--border-medium)', borderTop: `3px solid ${p.couleur}`, display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
          <b style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.88rem' }}><Icone size={15} color={p.couleur} /> {p.long}</b>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: emise ? 'var(--accent-emerald)' : etat ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{emise ? 'Émise' : etat ? 'En devis' : 'Non émise'}</span>
        </div>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{etat?.Compagnie || (cle === 'IA' ? 'NSIA ASSURANCES' : cle === 'AFA' ? 'ALLIANZ CI VIE' : '')}</span>
        <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{fcfa(etat?.PrimeTtc)} F</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{etat?.NumeroPolice || etat?.NumeroDevis || '-'}</span>
        <div style={{ marginTop: '0.3rem' }}>
          {emise && String(etat.IdContrat) !== String(idContrat) && (
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.25rem 0.6rem' }} onClick={() => navigate(`/user/contracts/${etat.IdContrat}`)}>Ouvrir le contrat</button>
          )}
          {!emise && cle !== 'Sante' && aLeDroit('devis.validate') && (
            <button type="button" className="btn btn-primary" disabled={Boolean(emissionEnCours)} style={{ fontSize: '0.76rem', padding: '0.25rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => emettre(cle)}>
              {emissionEnCours === cle ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Émettre sans ressaisie
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="glass-panel" style={{ padding: '1.15rem 1.25rem', marginBottom: '1.5rem', border: `1px solid color-mix(in srgb, ${PRODUITS.Sante.couleur} 35%, transparent)` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
        <div>
          <div style={{ fontWeight: 800, color: PRODUITS.Sante.couleur, display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Link2 size={16} /> Oreole Santé : le package, police par police</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {donnees.Adherents.length} famille{donnees.Adherents.length > 1 ? 's' : ''}, du {dateFr(donnees.DateEffet)} au {dateFr(donnees.DateExpiration)}. Client, période et adhérents viennent de la police Santé.
          </div>
        </div>
        {aLeDroit('contrats.avenant') && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={() => navigate(`/user/quotes/oreole-sante/nouveau?contrat=${idContrat}&acte=INC`)}><UserPlus size={15} /> Incorporer</button>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={() => navigate(`/user/quotes/oreole-sante/nouveau?contrat=${idContrat}&acte=REN`)}><RefreshCw size={15} /> Renouveler</button>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: '0.7rem' }}>{['Sante', 'IA', 'AFA'].map(carteProduit)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.85rem 0' }}>
        <BarreRepartition sante={totaux.PartSante} ia={totaux.PartIA} afa={totaux.PartAFA} />
        <LegendeRepartition sante={totaux.PartSante} ia={totaux.PartIA} afa={totaux.PartAFA} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1.1rem' }}>
        <div>
          <b style={{ fontSize: '0.86rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><Wallet size={15} /> Encaissement</b>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>Quittance</span><b style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{produits.Sante?.NumeroQuittance || '-'}</b></div>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>Cotisation des polices émises</span><b>{fcfa(totaux.Cotisation)} F</b></div>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>Déjà encaissé</span><b>{fcfa(encaisse)} F</b></div>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>Reste à encaisser</span><b style={{ color: totaux.ResteAEncaisser > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)' }}>{fcfa(totaux.ResteAEncaisser)} F</b></div>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>Part de MCI</span><b>{fcfa(totaux.PartMCI)} F</b></div>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>Chargement pour sinistres à payer</span><b>{fcfa(totaux.FraisCourtiers)} F</b></div>
          <div style={ligneDetail}><span style={{ color: 'var(--text-muted)' }}>{`Honoraires OREOLE ${donnees.TauxHonoraires.Cabinet} %, MCI ${donnees.TauxHonoraires.Gestionnaire} %`}</span><b>{fcfa(totaux.HonoraireCabinet)} F, {fcfa(totaux.HonoraireGestionnaire)} F</b></div>
          {aLeDroit('encaissements.create') && totaux.ResteAEncaisser > 0 && (
            <button type="button" className="btn btn-primary" style={{ marginTop: '0.6rem', fontSize: '0.8rem' }} onClick={() => navigate(`/user/cash?oreole=${donnees.IdDevis}`)}>Encaisser le package</button>
          )}
        </div>
        <div>
          <b style={{ fontSize: '0.86rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FileText size={15} /> Documents</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 165px), 1fr))', gap: '0.4rem', marginTop: '0.45rem' }}>
            {[['quittance', 'Quittance du package'], ['facture', 'Facture du package'], ['cp', 'Conditions particulières'], ['bareme', 'Barème de soins'], ['liste', 'Liste des adhérents'], ['cotisations', 'État des cotisations']].map(([type, libelle]) => (
              <button key={type} type="button" className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.3rem 0.5rem', whiteSpace: 'normal', lineHeight: 1.25 }} onClick={() => imprimerOreole(type, donnees.IdDevis)}>{libelle}</button>
            ))}
            {reseau && <a className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.3rem 0.5rem', whiteSpace: 'normal', lineHeight: 1.25 }} href={reseau.fichier} target="_blank" rel="noreferrer">{reseau.libelle}</a>}
            <a className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.3rem 0.5rem', whiteSpace: 'normal', lineHeight: 1.25 }} href={RESEAU_PHARMACIES.fichier} target="_blank" rel="noreferrer">{RESEAU_PHARMACIES.libelle}</a>
          </div>
        </div>
      </div>
      <BlocCartesOreole idContrat={idContrat} idDevisPackage={donnees.IdDevis} />
    </div>
  );
}
