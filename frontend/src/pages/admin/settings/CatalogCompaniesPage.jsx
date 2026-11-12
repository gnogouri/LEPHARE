import React, { useEffect, useMemo, useState } from 'react';
import { confirmer } from '../../../utils/dialogue';

// Fiche modifiée et non enregistrée : l'utilisateur choisit de continuer la saisie ou d'abandonner
const confirmerAbandon = (libelle) => confirmer({
  ton: 'attention',
  titre: 'Modifications non enregistrées',
  message: 'Les modifications apportées à cette fiche ne sont pas encore enregistrées.',
  consequences: 'Si vous continuez, elles seront perdues.',
  confirmer: libelle,
  annuler: 'Continuer la saisie',
});
import { useNavigate } from 'react-router-dom';
import {
  Building2, Plus, Search, Loader2, Save, IdCard, Printer, Plane, Calculator, ExternalLink, Eye, CheckCircle2,
  AlertTriangle, Image as ImageIcon, FileText, Send,
} from 'lucide-react';
import { EnTeteParametrage } from '../../../components/admin/EnTeteParametrage';
import { ChampImage } from '../../../components/admin/ChampImage';
import { Modal } from '../../../components/common/Modal';
import { parametrageApi } from '../../../api/endpoints';
import { messageErreurApi } from '../../../utils/financeUtils';
import { chargerParametrage } from '../../../utils/parametrage';
import { apercuAttestationVoyage } from '../../../utils/exportUtils';
import { useToast } from '../../../context/ToastContext';

// Compagnies d'assurance (stdcompagnie) et ce que les documents imprimés reprennent de chacune
// (lephare_compagnie_document) : configuration_api/parametrage.py

const CHAMPS_IDENTITE = [
  { cle: 'RaisonSociale', libelle: 'Raison sociale', requis: true, longueur: 100 },
  { cle: 'CodeAsaci', libelle: 'Code ASACI', longueur: 10, aide: 'Code de la compagnie auprès de l\'ASACI (attestations automobile).' },
  { cle: 'Adresse1', libelle: 'Adresse', longueur: 100 },
  { cle: 'Adresse2', libelle: 'Complément d\'adresse', longueur: 100 },
  { cle: 'Telephone', libelle: 'Téléphone', longueur: 20 },
  { cle: 'Mobile', libelle: 'Mobile', longueur: 20 },
  { cle: 'Fax', libelle: 'Fax', longueur: 20 },
];

const ONGLETS_FICHE = [
  { id: 'identite', libelle: 'Identité', icone: IdCard },
  { id: 'documents', libelle: 'Documents imprimés', icone: Printer },
  { id: 'attestation', libelle: 'Attestation voyage', icone: Plane },
  { id: 'reversements', libelle: 'Reversements et courriers', icone: Send },
  { id: 'baremes', libelle: 'Barèmes', icone: Calculator },
];

// Raccourcis vers les barèmes de la compagnie (écrans filtrés sur elle)
const BAREMES = [
  { libelle: 'Taux de commission', description: 'Commission du cabinet par produit.', chemin: '/admin/settings/commissions-baremes' },
  { libelle: 'Accessoires de la compagnie', description: 'Frais de dossier par tranche de prime.', chemin: '/admin/settings/tarifs' },
  { libelle: 'Accessoires du cabinet', description: 'Part des accessoires revenant au cabinet.', chemin: '/admin/settings/tarifs', extra: 'onglet=courtier' },
  { libelle: 'Réductions flotte', description: 'Remise selon le nombre de véhicules.', chemin: '/admin/settings/flotte' },
  { libelle: 'Sécurité routière', description: 'Formules des personnes transportées.', chemin: '/admin/settings/securite-routiere' },
  { libelle: 'Offres', description: 'Formules et garanties proposées.', chemin: '/admin/settings/offres' },
  { libelle: 'Grilles Voyage', description: 'Primes Voyage par zone, durée et âge.', chemin: '/admin/settings/grilles-voyage' },
];

const ATTESTATION_VIDE = { Actif: false, Convention: '', PaysResidence: "CÔTE D'IVOIRE", Signataire: '', Garanties: [], Telephone: '', Email: '', Whatsapp: '', PortailAssistance: '', VerificationVisa: '', Exemplaires: ['Exemplaire destiné aux Consulats', "Exemplaire de l'Assuré", 'Exemplaire de la Compagnie'] };

// Reversements (production/views_bordereaux.py) : part du cabinet dans les accessoires (vide : barème « Accessoires du
// cabinet »), nom imprimé sur les bordereaux et destinataire des courriers de règlement de prime
const REVERSEMENT_VIDE = { PartAccessoiresCourtier: '', NomBordereau: '', Destinataire: '', Service: '', Ville: 'ABIDJAN', AttentionDe: '', Appellation: 'Monsieur' };
const avecReversement = (documents) => ({
  ...REVERSEMENT_VIDE,
  ...Object.fromEntries(Object.entries(documents?.Reversement || {}).map(([k, v]) => [k, v ?? ''])),
});

const lignesVersListe = (texte) => String(texte || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const Pastille = ({ actif, libelle, icone: Icone }) => (
  <span title={libelle} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', padding: '0.12rem 0.45rem', borderRadius: 999, background: actif ? 'rgba(16,185,129,0.12)' : 'var(--bg-surface-hover)', color: actif ? 'var(--accent-emerald)' : 'var(--text-muted)', opacity: actif ? 1 : 0.7 }}>
    <Icone size={11} /> {libelle}
  </span>
);

export const CatalogCompaniesPage = () => {
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [compagnies, setCompagnies] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [inactives, setInactives] = useState(false);
  const [fiche, setFiche] = useState(null); // { origine, saisie } de la compagnie ouverte
  const [onglet, setOnglet] = useState('identite');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [creation, setCreation] = useState(null);

  const charger = async () => {
    setChargement(true);
    try {
      setCompagnies(await parametrageApi.getCompagnies());
    } catch (err) {
      toastError(`Compagnies non chargées : ${messageErreurApi(err)}`);
    } finally {
      setChargement(false);
    }
  };
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return compagnies
      .filter((c) => inactives || c.Active)
      .filter((c) => !terme || [c.RaisonSociale, c.CodeAsaci, c.Telephone].some((v) => String(v || '').toLowerCase().includes(terme)))
      // Partenaires en activité d'abord (nombre de contrats), puis ordre alphabétique
      .sort((a, b) => Number(b.Active) - Number(a.Active) || b.Contrats - a.Contrats || a.RaisonSociale.localeCompare(b.RaisonSociale, 'fr'));
  }, [compagnies, recherche, inactives]);

  const ouvrir = async (id, ongletInitial = 'identite') => {
    setErreur('');
    setOnglet(ongletInitial);
    try {
      const c = await parametrageApi.getCompagnie(id);
      const saisie = {
        ...c,
        Documents: {
          ...c.Documents,
          PiedPageTexte: c.Documents.PiedPage || '',
          AttestationVoyage: { ...ATTESTATION_VIDE, ...(c.Documents.AttestationVoyage || {}) },
          Reversement: avecReversement(c.Documents),
        },
      };
      setFiche({ origine: JSON.stringify(saisie), saisie });
    } catch (err) {
      toastError(`Fiche non chargée : ${messageErreurApi(err)}`);
    }
  };

  const modifiee = fiche && JSON.stringify(fiche.saisie) !== fiche.origine;
  const changer = (cle, valeur) => setFiche((f) => ({ ...f, saisie: { ...f.saisie, [cle]: valeur } }));
  const changerDoc = (cle, valeur) => setFiche((f) => ({ ...f, saisie: { ...f.saisie, Documents: { ...f.saisie.Documents, [cle]: valeur } } }));
  const changerAttestation = (cle, valeur) => setFiche((f) => ({
    ...f,
    saisie: { ...f.saisie, Documents: { ...f.saisie.Documents, AttestationVoyage: { ...f.saisie.Documents.AttestationVoyage, [cle]: valeur } } },
  }));

  const changerReversement = (cle, valeur) => setFiche((f) => ({
    ...f,
    saisie: { ...f.saisie, Documents: { ...f.saisie.Documents, Reversement: { ...f.saisie.Documents.Reversement, [cle]: valeur } } },
  }));

  const corpsDocuments = (s) => ({
    Logo: s.Documents.Logo,
    Visa: s.Documents.Visa,
    PiedPage: s.Documents.PiedPageTexte,
    MentionLogo: s.Documents.MentionLogo,
    OrdreCheque: s.Documents.OrdreCheque || '',
    AttestationVoyage: s.Documents.AttestationVoyage,
    Reversement: s.Documents.Reversement,
  });

  const enregistrer = async () => {
    setErreur('');
    setEnvoi(true);
    const s = fiche.saisie;
    try {
      const c = await parametrageApi.modifierCompagnie(s.IdCompagnie, {
        ...Object.fromEntries(CHAMPS_IDENTITE.map((ch) => [ch.cle, s[ch.cle]])),
        Etranger: s.Etranger,
        Active: s.Active,
        Documents: corpsDocuments(s),
      });
      const saisie = { ...c, Documents: { ...c.Documents, PiedPageTexte: c.Documents.PiedPage || '', AttestationVoyage: { ...ATTESTATION_VIDE, ...(c.Documents.AttestationVoyage || {}) }, Reversement: avecReversement(c.Documents) } };
      setFiche({ origine: JSON.stringify(saisie), saisie });
      success(`${c.RaisonSociale} enregistrée : les prochains documents imprimés en tiennent compte.`);
      chargerParametrage(true);
      charger();
    } catch (err) {
      setErreur(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const fermer = async () => {
    if (modifiee && !(await confirmerAbandon('Fermer sans enregistrer'))) return;
    setFiche(null);
  };

  const creer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur('');
    try {
      const c = await parametrageApi.creerCompagnie(creation);
      success(`Compagnie « ${c.RaisonSociale} » créée.`);
      setCreation(null);
      await charger();
      ouvrir(c.IdCompagnie);
    } catch (err) {
      setErreur(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const s = fiche?.saisie;
  const att = s?.Documents.AttestationVoyage;
  const champTexte = (cle, libelle, { longueur = 120, aide, valeur, onChange, placeholder } = {}) => (
    <div className="form-group">
      <label className="form-label">{libelle}</label>
      <input className="form-control" maxLength={longueur} value={valeur ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {aide && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{aide}</span>}
    </div>
  );

  return (
    <div style={{ padding: '1.5rem' }}>
      <EnTeteParametrage
        icone={Building2}
        titre="Compagnies partenaires"
        description="Les assureurs avec qui le cabinet travaille : coordonnées, logo et mentions imprimées sur leurs documents, modèle d'attestation voyage, et accès à leurs barèmes."
        usage="Une compagnie inactive n'est plus proposée dans les nouveaux devis ; ses contrats existants ne changent pas."
        actions={<button type="button" className="btn btn-primary" onClick={() => { setErreur(''); setCreation({ RaisonSociale: '', CodeAsaci: '', Adresse1: 'ABIDJAN', Adresse2: '', Telephone: '', Mobile: '', Fax: '', Etranger: false }); }} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Plus size={15} /> Nouvelle compagnie</button>}
      />

      <div className="glass-panel" style={{ padding: '1.1rem 1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="form-control" style={{ paddingLeft: '1.9rem' }} placeholder="Rechercher une compagnie, un code ASACI…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={inactives} onChange={(e) => setInactives(e.target.checked)} /> Afficher les compagnies inactives ({compagnies.filter((c) => !c.Active).length})
          </label>
        </div>

        {chargement ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin" /> Chargement…</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '0.8rem' }}>
            {visibles.map((c) => (
              <button key={c.IdCompagnie} type="button" onClick={() => ouvrir(c.IdCompagnie)}
                style={{ textAlign: 'left', cursor: 'pointer', padding: '0.9rem 1rem', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', opacity: c.Active ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{c.RaisonSociale}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {c.CodeAsaci ? `ASACI ${c.CodeAsaci}` : 'Sans code ASACI'}{c.Telephone ? ` • ${c.Telephone}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${c.Active ? 'badge-emerald' : 'badge-slate'}`}>{c.Active ? 'Active' : 'Inactive'}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{c.Contrats.toLocaleString('fr-FR')} contrat{c.Contrats > 1 ? 's' : ''}</div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  <Pastille actif={c.Documents.Logo} libelle="Logo" icone={ImageIcon} />
                  <Pastille actif={c.Documents.PiedPage} libelle="Pied de page CP" icone={FileText} />
                  <Pastille actif={c.Documents.AttestationVoyage} libelle="Attestation voyage" icone={Plane} />
                </div>
              </button>
            ))}
            {!visibles.length && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Aucune compagnie ne correspond.</div>}
          </div>
        )}
      </div>

      {/* Fiche compagnie */}
      <Modal isOpen={!!fiche} onClose={fermer} title={s?.RaisonSociale || 'Compagnie'} subtitle={s ? `${s.Contrats.toLocaleString('fr-FR')} contrat(s) - ${s.Active ? 'active' : 'inactive'}` : ''} size="large">
        {s && (
          <div>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
              {ONGLETS_FICHE.map((o) => (
                <button key={o.id} type="button" onClick={() => setOnglet(o.id)} className={`btn ${onglet === o.id ? 'btn-primary' : 'btn-secondary'}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  <o.icone size={14} /> {o.libelle}
                </button>
              ))}
            </div>

            {onglet === 'identite' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', columnGap: '1rem' }}>
                  {CHAMPS_IDENTITE.map((c) => (
                    <div className="form-group" key={c.cle}>
                      <label className="form-label">{c.libelle}{c.requis ? ' *' : ''}</label>
                      <input className="form-control" maxLength={c.longueur} value={s[c.cle] ?? ''} onChange={(e) => changer(c.cle, c.cle === 'CodeAsaci' ? e.target.value.toUpperCase() : e.target.value)} />
                      {c.aide && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.aide}</span>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!s.Active} onChange={(e) => changer('Active', e.target.checked)} /> Compagnie active (proposée dans les nouveaux devis)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!s.Etranger} onChange={(e) => changer('Etranger', e.target.checked)} /> Compagnie étrangère
                  </label>
                </div>
              </div>
            )}

            {onglet === 'documents' && (
              <div>
                <ChampImage libelle="Logo de la compagnie" aide="Imprimé en haut à droite des devis, factures et conditions particulières de cette compagnie. Sans logo, son nom est imprimé." valeur={s.Documents.Logo} onChange={(v) => changerDoc('Logo', v)} />
                {champTexte('OrdreCheque', 'Chèque à l\'ordre de', { longueur: 100, valeur: s.Documents.OrdreCheque || '', onChange: (v) => changerDoc('OrdreCheque', v), placeholder: 'ex. NSIA CI', aide: 'Colonne « Compagnie / Chèque à l\'ordre de » du relevé de compte remis au client. Vide : la raison sociale de la compagnie.' })}
                {champTexte('Visa', 'Visa réglementaire', { longueur: 200, valeur: s.Documents.Visa, onChange: (v) => changerDoc('Visa', v), aide: 'Imprimé sous les mentions des Conditions Particulières Automobile (ex. « Visa: MEF/DGTCP/DA N°736 … »). Vide : rien n\'est imprimé.' })}
                <div className="form-group">
                  <label className="form-label">Pied de page des Conditions Particulières</label>
                  <textarea className="form-control" rows={5} maxLength={2000} value={s.Documents.PiedPageTexte} onChange={(e) => changerDoc('PiedPageTexte', e.target.value)}
                    placeholder={'NOM DE LA COMPAGNIE\nForme juridique, capital, agrément…\nSiège social, téléphone…'} />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Une ligne par ligne imprimée, la première en gras. Vide : pas de pied de page.</span>
                </div>
                {champTexte('MentionLogo', 'Mention sous le logo du pied de page', { longueur: 100, valeur: s.Documents.MentionLogo, onChange: (v) => changerDoc('MentionLogo', v), placeholder: 'ex. depuis 1995' })}
                {lignesVersListe(s.Documents.PiedPageTexte).length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div className="form-label" style={{ marginBottom: 4 }}>Aperçu du pied de page</div>
                    <div style={{ background: '#fff', color: '#111', borderRadius: 6, padding: '0.6rem 0.8rem', fontSize: '0.68rem', lineHeight: 1.35, fontFamily: 'Arial, sans-serif', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-end' }}>
                      <div>{lignesVersListe(s.Documents.PiedPageTexte).map((l, i) => <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>{l}</div>)}</div>
                      <div style={{ textAlign: 'center', flexShrink: 0 }}>
                        {s.Documents.Logo && <img src={s.Documents.Logo} alt="" style={{ height: 18, display: 'block', margin: '0 auto' }} />}
                        {s.Documents.MentionLogo && <div style={{ fontStyle: 'italic' }}>{s.Documents.MentionLogo}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {onglet === 'reversements' && (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
                  Repris par les bordereaux de reversement / de réclamation de commission et par les courriers de règlement de prime
                  (Finance &gt; Reversements aux compagnies).
                </p>
                <div className="form-group">
                  <label className="form-label">Part du cabinet dans les accessoires (%)</label>
                  <input type="number" min={0} max={100} step="0.01" className="form-control" style={{ maxWidth: 160 }} value={s.Documents.Reversement.PartAccessoiresCourtier}
                    onChange={(e) => changerReversement('PartAccessoiresCourtier', e.target.value)} placeholder="Barème" />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Le barème des accessoires de la compagnie est partagé selon cette part : devis (toutes branches), contrats enregistrés
                    et colonne « Acc. Courtier » des bordereaux (NSIA, SUNU et AMSA : 50, partage 50/50).
                    Vide : la compagnie garde son barème et le cabinet a le sien (« Accessoires du cabinet »).
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: '1rem' }}>
                  {champTexte('NomBordereau', 'Nom imprimé sur les bordereaux', { valeur: s.Documents.Reversement.NomBordereau, onChange: (v) => changerReversement('NomBordereau', v), placeholder: 'ex. NSIA CI', aide: 'Sous le titre du bordereau et dans « POUR … ». Vide : raison sociale.' })}
                  {champTexte('Destinataire', 'Destinataire du courrier', { valeur: s.Documents.Reversement.Destinataire, onChange: (v) => changerReversement('Destinataire', v), placeholder: 'ex. NSIA-CI' })}
                  {champTexte('Service', 'Service', { valeur: s.Documents.Reversement.Service, onChange: (v) => changerReversement('Service', v), placeholder: 'ex. DIRECTION COURTAGE' })}
                  {champTexte('Ville', 'Ville', { valeur: s.Documents.Reversement.Ville, onChange: (v) => changerReversement('Ville', v), placeholder: 'ABIDJAN' })}
                  {champTexte('AttentionDe', "À l'attention", { valeur: s.Documents.Reversement.AttentionDe, onChange: (v) => changerReversement('AttentionDe', v), placeholder: 'ex. du Directeur du Courtage', aide: "« du Directeur du Courtage » → « À l'attention du Directeur du Courtage » ; « Monsieur X » → « À l'attention de Monsieur X »." })}
                  {champTexte('Appellation', "Formule d'appel", { valeur: s.Documents.Reversement.Appellation, onChange: (v) => changerReversement('Appellation', v), placeholder: 'Monsieur', aide: '« Monsieur, » en tête du courrier et dans la formule de politesse.' })}
                </div>
              </div>
            )}

            {onglet === 'attestation' && (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
                  Attestation d'assurance et d'assistance voyage imprimée depuis la fiche d'un contrat Voyage de cette compagnie (demande de visa).
                  Nom, passeport, dates, destination et n° de certificat viennent du contrat ; le reste se règle ici.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '0.9rem' }}>
                  <input type="checkbox" checked={!!att.Actif} onChange={(e) => changerAttestation('Actif', e.target.checked)} /> Imprimer une attestation voyage pour cette compagnie
                </label>
                <fieldset disabled={!att.Actif} style={{ border: 'none', padding: 0, margin: 0, opacity: att.Actif ? 1 : 0.55 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', columnGap: '1rem' }}>
                    {champTexte('Signataire', 'Signataire (« Pour … »)', { valeur: att.Signataire, onChange: (v) => changerAttestation('Signataire', v), placeholder: "ex. AMSA ASSURANCES COTE D'IVOIRE" })}
                    {champTexte('Convention', 'N° de convention', { valeur: att.Convention, onChange: (v) => changerAttestation('Convention', v) })}
                    {champTexte('PaysResidence', 'Pays de résidence imprimé', { valeur: att.PaysResidence, onChange: (v) => changerAttestation('PaysResidence', v) })}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Principales garanties</label>
                    <textarea className="form-control" rows={5} value={(att.Garanties || []).join('\n')} onChange={(e) => changerAttestation('Garanties', e.target.value.split('\n'))}
                      placeholder={'Transport médicalisé : frais réels\nFrais médicaux d\'urgence : 30 000 euros maximum…'} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Une garantie par ligne (12 au plus), imprimées telles quelles.</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: '1rem' }}>
                    {champTexte('Telephone', 'Assistance - téléphone', { valeur: att.Telephone, onChange: (v) => changerAttestation('Telephone', v) })}
                    {champTexte('Email', 'Assistance - e-mail', { valeur: att.Email, onChange: (v) => changerAttestation('Email', v) })}
                    {champTexte('Whatsapp', 'Assistance - WhatsApp', { valeur: att.Whatsapp, onChange: (v) => changerAttestation('Whatsapp', v) })}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: '1rem' }}>
                    {champTexte('PortailAssistance', 'QR code du portail d’assistance (adresse)', { longueur: 250, valeur: att.PortailAssistance, onChange: (v) => changerAttestation('PortailAssistance', v), placeholder: 'https://claims.cover-edge.com/links/' })}
                    {champTexte('VerificationVisa', 'QR code de vérification du certificat (adresse)', { longueur: 250, valeur: att.VerificationVisa, onChange: (v) => changerAttestation('VerificationVisa', v), placeholder: 'https://…{certificat}' })}
                  </div>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    Le QR code de vérification n’est imprimé que si la compagnie fournit l’adresse de son service de vérification
                    ({'{certificat}'} y est remplacé par le n° de certificat) ; sans adresse, ni le QR code ni la phrase qui l’annonce ne sont imprimés.
                  </span>
                  <div className="form-group">
                    <label className="form-label">Exemplaires imprimés</label>
                    <textarea className="form-control" rows={3} value={(att.Exemplaires || []).join('\n')} onChange={(e) => changerAttestation('Exemplaires', e.target.value.split('\n'))} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Une page par ligne (5 au plus) : libellé imprimé sur le bord de la page.</span>
                  </div>
                </fieldset>
                <button type="button" className="btn btn-secondary" disabled={!att.Actif}
                  onClick={() => apercuAttestationVoyage({ RaisonSociale: s.RaisonSociale, Logo: s.Documents.Logo, AttestationVoyage: { ...att, Garanties: lignesVersListe((att.Garanties || []).join('\n')), Exemplaires: lignesVersListe((att.Exemplaires || []).join('\n')) } })}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Eye size={15} /> Aperçu sur un assuré fictif
                </button>
              </div>
            )}

            {onglet === 'baremes' && (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>Les barèmes de {s.RaisonSociale} se modifient dans leurs écrans, ouverts directement sur cette compagnie.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem' }}>
                  {BAREMES.map((b) => (
                    <button key={b.libelle} type="button" className="btn btn-secondary"
                      onClick={async () => { if (!modifiee || await confirmerAbandon('Quitter sans enregistrer')) navigate(`${b.chemin}?${b.extra ? `${b.extra}&` : ''}compagnie=${s.IdCompagnie}`); }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left', padding: '0.65rem 0.8rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>{b.libelle} <ExternalLink size={12} /></span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{b.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {erreur && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: 'var(--accent-rose)', fontSize: '0.82rem', marginTop: '0.9rem' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {erreur}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
              {modifiee
                ? <span style={{ fontSize: '0.78rem', color: 'var(--accent-amber)' }}>Modifications non enregistrées</span>
                : <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={14} /> À jour</span>}
              <button type="button" className="btn btn-secondary" onClick={fermer} disabled={envoi}>Fermer</button>
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifiee || envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {envoi ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Nouvelle compagnie */}
      <Modal isOpen={!!creation} onClose={() => !envoi && setCreation(null)} title="Nouvelle compagnie" subtitle="Le logo, les mentions et les barèmes se règlent ensuite dans sa fiche." size="medium">
        {creation && (
          <form onSubmit={creer}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', columnGap: '1rem' }}>
              {CHAMPS_IDENTITE.map((c) => (
                <div className="form-group" key={c.cle}>
                  <label className="form-label">{c.libelle}{c.requis ? ' *' : ''}</label>
                  <input className="form-control" required={c.requis} maxLength={c.longueur} value={creation[c.cle] ?? ''} onChange={(e) => setCreation((v) => ({ ...v, [c.cle]: c.cle === 'CodeAsaci' ? e.target.value.toUpperCase() : e.target.value }))} />
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.8rem' }}>
              <input type="checkbox" checked={creation.Etranger} onChange={(e) => setCreation((v) => ({ ...v, Etranger: e.target.checked }))} /> Compagnie étrangère
            </label>
            {erreur && <div style={{ color: 'var(--accent-rose)', fontSize: '0.82rem', marginBottom: '0.8rem' }}>{erreur}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCreation(null)} disabled={envoi}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={envoi} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {envoi ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Créer la compagnie
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default CatalogCompaniesPage;
