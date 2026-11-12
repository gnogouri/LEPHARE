import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aLeDroit } from '../../../utils/droits';
import { ArrowRight, FilePlus2, PencilLine, Plus, Repeat, Trash2, UserPlus, Users } from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { santeApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { fcfa, messageErreurApi } from '../../../utils/financeUtils';
import { formatDate } from '../../../utils/dateUtils';
import { reglagesMinene } from '../../../utils/parametrage';

const aujourdhui = () => new Date().toISOString().split('T')[0];
const jours = (debut, fin) => (debut && fin ? Math.round((new Date(fin) - new Date(debut)) / 86400000) + 1 : 0);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// Formule d'une famille dans les listes (sans parenthèses) : option MINENE et sa taille, sinon libellé de l'offre
const libelleFormule = (o) => (o.Option
  ? `${o.Option} - ${o.PersonnesMin === o.PersonnesMax ? pluriel(o.PersonnesMax, 'personne') : `${o.PersonnesMin} à ${o.PersonnesMax} personnes`}`
  : String(o.Formule || '').replace(/\s*\(([^)]*)\)/g, ' - $1'));

// Âge révolu à une date (AAAA-MM-JJ), comme la base
const ageAu = (naissance, date) => {
  const n = new Date(naissance);
  const d = new Date(date);
  if (!naissance || !date || Number.isNaN(n.getTime()) || Number.isNaN(d.getTime())) return null;
  const anniversairePasse = d.getMonth() > n.getMonth() || (d.getMonth() === n.getMonth() && d.getDate() >= n.getDate());
  return d.getFullYear() - n.getFullYear() - (anniversairePasse ? 0 : 1);
};

// Formule d'une famille après l'arrivée d'une personne (sp_saisie_affilie_sante v6) : la sienne tant qu'elle n'est pas
// complète, sinon celle de sa nouvelle taille dans la même offre commerciale (FAMILLE de 3 personnes + 1 : FAMILLE PLUS) ;
// null si aucune formule ne l'accueille
const formuleApresIncorporation = (f) => {
  const taille = Number(f.Personnes) + 1;
  if (!f.PersonnesMax || taille <= Number(f.PersonnesMax)) return f.Formules.find((o) => o.IdOffre === f.IdOffre) || f;
  return f.Formules.find((o) => o.PersonnesMin && o.PersonnesMin <= taille && taille <= o.PersonnesMax) || null;
};

const MEMBRE_VIDE = { Lien: 'E', Nom: '', Prenom: '', DateNaissance: '', Sexe: '', Certificat: false, NombrePathologie: 0 };
const ADHERENT_VIDE = { Nom: '', Prenom: '', DateNaissance: '', Sexe: '', NombrePathologie: 0, Matricule: '', Mobile: '' };
const FAMILLE_VIDE = { IdOffre: 0, Adherent: ADHERENT_VIDE, Membres: [] };

// Formule d'une nouvelle famille (sante/avenant.py formule_a_la_taille) : celle choisie, ou pour une formule à nombre de
// personnes (MINENE) celle de la même offre commerciale qui accueille toute la famille ; null si aucune
const formuleALaTaille = (formules, idOffre, taille) => {
  const choisie = formules.find((o) => o.IdOffre === Number(idOffre));
  if (!choisie || !choisie.PersonnesMax) return choisie || null;
  if ((choisie.PersonnesMin || 1) <= taille && taille <= choisie.PersonnesMax) return choisie;
  return formules.filter((o) => o.PersonnesMax && (o.PersonnesMin || 1) <= taille && taille <= o.PersonnesMax)
    .sort((a, b) => a.PersonnesMax - b.PersonnesMax || a.IdOffre - b.IdOffre)[0] || null;
};

const MODES = [
  ['incorporation', UserPlus, 'Incorporer un membre'],
  ['famille', Users, 'Incorporer une famille'],
  ['formule', Repeat, 'Changer de formule'],
  ['ecran', PencilLine, 'Autre modification'],
];

const champ = (libelle, controle, aide) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
    <span style={{ fontWeight: 600 }}>{libelle}</span>
    {controle}
    {aide && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{aide}</span>}
  </label>
);

/**
 * Avenant de modification d'un contrat Santé en cours, sous la même police (sante/avenant.py) :
 * - incorporation d'un membre dans une famille (demande du 2026-11-02) : la famille complète passe d'office dans la
 *   formule de sa nouvelle taille (FAMILLE de 3 personnes + 1 : FAMILLE PLUS) et la prime de la nouvelle personne est
 *   l'écart entre les deux formules : dû en entier pour une police MINENE (tarif forfaitaire, 800 000 - 600 000 F TTC),
 *   au prorata des jours restants pour les autres offres ;
 * - incorporation d'une nouvelle famille (adhérent et ayants droit, demande du 2026-11-12) dans une formule de l'offre
 *   commerciale du contrat ; en MINENE, la formule de sa taille (SOLO, FAMILLE, FAMILLE PLUS) est prise d'office ;
 * - changement de formule d'une famille (CR OREOLE du 26-10-2026) ;
 * - autre modification saisie dans l'écran Santé (couverture…).
 * Le devis d'avenant s'ouvre ensuite dans l'écran Santé.
 */
export const AvenantSanteModal = ({ isOpen, onClose, idContrat }) => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [dateEffet, setDateEffet] = useState('');
  const [mode, setMode] = useState('incorporation');
  const [idAdherent, setIdAdherent] = useState(0);
  const [idOffre, setIdOffre] = useState(0);
  const [membre, setMembre] = useState(MEMBRE_VIDE);
  const [nouvelleFamille, setNouvelleFamille] = useState(FAMILLE_VIDE);
  const [envoi, setEnvoi] = useState(false);
  const surprimes = reglagesMinene().surprimes;

  useEffect(() => {
    if (!isOpen || !idContrat) return undefined;
    let actif = true;
    setDonnees(null);
    setErreur('');
    santeApi.preparerAvenant(idContrat)
      .then((d) => {
        if (!actif) return;
        setDonnees(d);
        setDateEffet(d.DateEffet || '');
        setMode('incorporation');
        // Famille unique de la police : déjà choisie, rien à ressaisir
        const unique = d.Familles?.length === 1 ? d.Familles[0] : null;
        setIdAdherent(unique ? unique.IdAdherent : 0);
        setIdOffre(unique ? (formuleApresIncorporation(unique) || unique).IdOffre : 0);
        setMembre(MEMBRE_VIDE);
        setNouvelleFamille({ ...FAMILLE_VIDE, IdOffre: d.Familles?.[0]?.IdOffre || 0 });
      })
      .catch((err) => { if (actif) setErreur(messageErreurApi(err)); });
    return () => { actif = false; };
  }, [isOpen, idContrat]);

  const famille = useMemo(() => (donnees?.Familles || []).find((f) => f.IdAdherent === Number(idAdherent)), [donnees, idAdherent]);

  // Changement de formule : formule proposée d'office, celle qui accueille une personne de plus quand l'actuelle est pleine
  const choisirFamille = (valeur) => {
    setIdAdherent(Number(valeur));
    const f = (donnees?.Familles || []).find((x) => x.IdAdherent === Number(valeur));
    setIdOffre(f ? (formuleApresIncorporation(f) || f).IdOffre : 0);
  };

  const contrat = donnees?.Contrat;
  const joursRestants = contrat ? jours(dateEffet, contrat.DateExpiration) : 0;
  const joursPeriode = contrat ? jours(contrat.DateEffet, contrat.DateExpiration) : 0;
  const enCours = donnees?.EnCours?.[0];
  // Avenant commencé par un collègue : il le continue d'un clic, la saisie passe à son nom
  const avenantCollegue = Boolean(enCours && !enCours.MaSaisie && aLeDroit('devis.update'));
  const ouvrirEnCours = async () => {
    if (avenantCollegue) {
      try {
        await santeApi.continuerSaisie(enCours.IdDevis);
      } catch (err) {
        toastError(messageErreurApi(err));
        return;
      }
    }
    onClose();
    navigate(`/user/quotes/sante?edit=${enCours.IdDevis}`);
  };
  // Police MINENE : prime fixée par formule, l'écart annuel est dû en entier (sans prorata)
  const forfaitaire = Boolean(donnees?.Forfaitaire);

  // Incorporation : formule de la famille après l'arrivée du membre et écart de prime de base entre les deux formules
  const apres = famille ? formuleApresIncorporation(famille) : null;
  const changeFormule = Boolean(famille && apres && apres.IdOffre !== famille.IdOffre);
  const primesConnues = changeFormule && apres.PrimeBase != null && famille.PrimeBase != null;
  const ecartAnnuel = primesConnues ? Number(apres.PrimeBase) - Number(famille.PrimeBase) : 0;
  const estimation = joursPeriode > 0 ? Math.round((ecartAnnuel * Math.max(joursRestants, 0)) / joursPeriode) : 0;
  // Écart TTC au barème des deux formules (MINENE : 800 000 - 600 000 = 200 000 F)
  const formuleAvant = famille?.Formules.find((o) => o.IdOffre === famille.IdOffre);
  const ttcAvant = formuleAvant?.PrimeTtc ?? null;
  const ecartTtc = changeFormule && ttcAvant != null && apres.PrimeTtc != null ? Number(apres.PrimeTtc) - Number(ttcAvant) : null;
  // Détail de l'avenant, calculé par le serveur comme le fera le devis : l'accessoire du barème est pris dans l'écart
  const detailEcart = changeFormule && forfaitaire ? famille.Ecarts?.[apres.IdOffre] : null;
  const decomposition = detailEcart ? {
    primeNette: Number(detailEcart.PrimeNette),
    accessoire: Number(detailEcart.Accessoire),
    taxe: Number(detailEcart.Taxe),
  } : null;
  const age = ageAu(membre.DateNaissance, dateEffet);
  const certificatPropose = membre.Lien === 'E' && age !== null && age > Number(surprimes.ageMaxEnfant);
  const affectionsMax = Math.max(0, Number(surprimes.affectionsMax) || 0);
  const majMembre = (cle, valeur) => setMembre((m) => ({ ...m, [cle]: valeur }));

  // Nouvelle famille : formules des offres commerciales du contrat, formule retenue à la taille de la famille
  const formulesContrat = useMemo(() => {
    const vues = new Map();
    (donnees?.Familles || []).forEach((f) => f.Formules.forEach((o) => {
      if (!vues.has(o.IdOffre)) vues.set(o.IdOffre, { ...o, Groupe: f.Formules });
    }));
    return [...vues.values()];
  }, [donnees]);
  const tailleFamille = 1 + nouvelleFamille.Membres.length;
  const groupeFamille = formulesContrat.find((o) => o.IdOffre === Number(nouvelleFamille.IdOffre))?.Groupe || [];
  const formuleRetenue = formuleALaTaille(groupeFamille, nouvelleFamille.IdOffre, tailleFamille);
  const majAdherent = (cle, valeur) => setNouvelleFamille((f) => ({ ...f, Adherent: { ...f.Adherent, [cle]: valeur } }));
  const majMembreFamille = (rang, cle, valeur) => setNouvelleFamille((f) => ({
    ...f, Membres: f.Membres.map((m, i) => (i === rang ? { ...m, [cle]: valeur } : m)),
  }));
  const ajouterMembreFamille = () => setNouvelleFamille((f) => ({
    ...f, Membres: [...f.Membres, { ...MEMBRE_VIDE, Nom: f.Adherent.Nom, Lien: f.Membres.length ? 'E' : 'C' }],
  }));
  const retirerMembreFamille = (rang) => setNouvelleFamille((f) => ({ ...f, Membres: f.Membres.filter((_, i) => i !== rang) }));
  const certificatPour = (m) => {
    const a = ageAu(m.DateNaissance, dateEffet);
    return m.Lien === 'E' && a !== null && a > Number(surprimes.ageMaxEnfant);
  };
  const aideAge = (naissance) => {
    const a = ageAu(naissance, dateEffet);
    return a !== null && a >= 0 ? `${pluriel(a, 'an')} au ${formatDate(dateEffet)}` : undefined;
  };
  const champAffections = (valeur, maj) => (
    <input type="number" min="0" max={affectionsMax} className="form-control" value={valeur}
      onChange={(e) => maj(Math.max(0, Math.min(affectionsMax, Number(e.target.value) || 0)))} />
  );
  const champSexe = (valeur, maj) => (
    <select className="form-control" value={valeur} onChange={(e) => maj(e.target.value)}>
      <option value="">Choisir</option>
      <option value="F">Féminin</option>
      <option value="M">Masculin</option>
    </select>
  );

  const creer = async () => {
    if (!dateEffet) { toastError('Saisissez la date d\'effet de l\'avenant.'); return; }
    let envoiAvenant = { DateEffet: dateEffet, IdAdherent: 0, IdOffre: 0 };
    if (mode === 'incorporation') {
      if (!famille) { toastError('Choisissez la famille du nouveau membre.'); return; }
      if (!apres) { toastError('Aucune formule de l\'offre n\'accueille une famille de cette taille.'); return; }
      if (!membre.Nom.trim()) { toastError('Saisissez le nom du nouveau membre.'); return; }
      if (!membre.DateNaissance) { toastError('Saisissez la date de naissance du nouveau membre.'); return; }
      if (!membre.Sexe) { toastError('Précisez le sexe du nouveau membre.'); return; }
      envoiAvenant = {
        ...envoiAvenant, IdAdherent: famille.IdAdherent,
        Membre: { ...membre, Nom: membre.Nom.trim(), Prenom: membre.Prenom.trim(), Certificat: certificatPropose && membre.Certificat },
      };
    } else if (mode === 'famille') {
      const a = nouvelleFamille.Adherent;
      if (!formuleRetenue) { toastError(`Aucune formule de l'offre n'accueille une famille de ${tailleFamille} personnes.`); return; }
      if (!a.Nom.trim()) { toastError('Saisissez le nom de l\'adhérent.'); return; }
      if (!a.DateNaissance) { toastError('Saisissez la date de naissance de l\'adhérent.'); return; }
      if (!a.Sexe) { toastError('Précisez le sexe de l\'adhérent.'); return; }
      const incomplet = nouvelleFamille.Membres.findIndex((m) => !m.Nom.trim() || !m.DateNaissance || !m.Sexe);
      if (incomplet >= 0) { toastError(`Membre n° ${incomplet + 1} : nom, date de naissance et sexe obligatoires.`); return; }
      envoiAvenant = {
        ...envoiAvenant,
        Famille: {
          IdOffre: formuleRetenue.IdOffre,
          Adherent: { ...a, Nom: a.Nom.trim(), Prenom: a.Prenom.trim(), Matricule: a.Matricule.trim(), Mobile: a.Mobile.trim() },
          Membres: nouvelleFamille.Membres.map((m) => ({
            ...m, Nom: m.Nom.trim(), Prenom: m.Prenom.trim(), Certificat: certificatPour(m) && m.Certificat,
          })),
        },
      };
    } else if (mode === 'formule') {
      if (!famille) { toastError('Choisissez la famille qui change de formule.'); return; }
      envoiAvenant = { ...envoiAvenant, IdAdherent: famille.IdAdherent, IdOffre: Number(idOffre) || 0 };
    }
    setEnvoi(true);
    try {
      const r = await santeApi.creerAvenant(idContrat, envoiAvenant);
      const passage = r.Formule ? `, qui passe de ${r.FormuleAvant} à ${r.Formule}` : '';
      if (mode === 'incorporation') {
        success(`Avenant ${r.NumeroDevis} créé : ${r.Membre} incorporé(e) dans la famille ${r.Famille}${passage}. `
          + `Prime de l'avenant : ${fcfa(r.PrimeTtc)} F TTC. Vérifiez-le dans l'écran Santé puis confirmez-le.`);
      } else if (mode === 'famille') {
        success(`Avenant ${r.NumeroDevis} créé : famille ${r.Famille} incorporée (${pluriel(Number(r.Personnes), 'personne')}`
          + `${r.Formule ? `, ${r.Formule}` : ''}). ${r.MessageMembre ? `${r.MessageMembre} ` : ''}`
          + `Prime de l'avenant : ${fcfa(r.PrimeTtc)} F TTC. Vérifiez-le dans l'écran Santé puis confirmez-le.`);
      } else if (mode === 'formule') {
        success(`Avenant ${r.NumeroDevis} créé${r.Formule ? ` : la famille ${r.Famille} passe de ${r.FormuleAvant} à ${r.Formule}` : ''}. `
          + 'Vérifiez la composition dans l\'écran Santé puis enregistrez le devis.');
      } else {
        success(`Avenant ${r.NumeroDevis} créé avec la composition en vigueur : faites la modification dans l'écran Santé puis enregistrez le devis.`);
      }
      onClose();
      navigate(`/user/quotes/sante?edit=${r.IdDevis}`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  const grille = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="medium" title="Incorporation ou changement de formule"
      subtitle={contrat ? `Police ${contrat.NumeroPolice} - ${contrat.Client || ''}` : undefined}>
      {erreur && <div style={{ color: 'var(--accent-amber)', fontSize: '0.85rem' }}>{erreur}</div>}
      {!erreur && !donnees && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Lecture du contrat…</div>}
      {donnees && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
          <div style={{ color: 'var(--text-secondary)' }}>
            Période du contrat : du <strong>{formatDate(contrat.DateEffet)}</strong> au <strong>{formatDate(contrat.DateExpiration)}</strong>, échéance inchangée.
            {' '}L'avenant reprend la composition en vigueur sous la même police ; sa prime est l'écart de prime annuelle entre la
            nouvelle composition et l'actuelle, {forfaitaire
              ? <>dû <strong>en entier</strong> : tarif forfaitaire MINENE, sans prorata ni ristourne.</>
              : 'au prorata des jours restants, sans ristourne.'}
          </div>

          {enCours ? (
            <div style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.45)', background: 'rgba(245, 158, 11, 0.08)' }}>
              Un avenant est déjà en cours de saisie : devis <strong>{enCours.NumeroDevis}</strong>, effet le {formatDate(enCours.DateEffet)}.
              {!enCours.MaSaisie && enCours.Operateur && <> Commencé par <strong>{enCours.Operateur}</strong>.</>}
              <div style={{ marginTop: '0.6rem' }}>
                <button type="button" className="btn btn-primary" onClick={ouvrirEnCours}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <ArrowRight size={14} /> {avenantCollegue ? 'Continuer cet avenant' : "Ouvrir l'avenant en cours"}
                </button>
              </div>
            </div>
          ) : !donnees.Familles?.length ? (
            <div style={{ color: 'var(--accent-amber)' }}>
              Aucune famille enregistrée pour ce contrat : le changement se saisit par un nouveau devis.
            </div>
          ) : (
            <>
              <div className="qp-segments" role="group" aria-label="Type de modification" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                {MODES.map(([code, Icone, libelle]) => (
                  <button key={code} type="button" aria-pressed={mode === code} onClick={() => setMode(code)}>
                    <Icone size={13} /> {libelle}
                  </button>
                ))}
              </div>

              <div style={grille}>
                {champ('Date d\'émission',
                  <input type="date" className="form-control" value={aujourdhui()} readOnly disabled title="Date du jour, non modifiable" />,
                  'Date du jour, non imprimée sur les documents')}
                {champ(mode === 'incorporation' || mode === 'famille' ? 'Date d\'incorporation *' : 'Date d\'effet de l\'avenant *',
                  <input type="date" className="form-control" value={dateEffet} min={contrat.DateEffet} max={contrat.DateExpiration}
                    onChange={(e) => setDateEffet(e.target.value)} />,
                  forfaitaire ? 'Au choix dans la période. Tarif forfaitaire : pas de prorata'
                    : joursPeriode > 0 && joursRestants > 0 ? `Au choix dans la période. Prorata : ${joursRestants} jours sur ${joursPeriode}` : 'Au choix dans la période')}
                {champ('Date d\'échéance',
                  <input type="date" className="form-control" value={contrat.DateExpiration} readOnly disabled title="Fin du contrat, non modifiable" />,
                  'Fin du contrat, non modifiable')}
              </div>

              <div style={grille}>
                {(mode === 'incorporation' || mode === 'formule') && champ('Famille *',
                  <select className="form-control" value={idAdherent} onChange={(e) => choisirFamille(e.target.value)}>
                    <option value={0}>Choisir la famille</option>
                    {donnees.Familles.map((f) => (
                      <option key={f.IdAdherent} value={f.IdAdherent}>
                        {f.Adherent} - {f.Option || libelleFormule(f)} - {pluriel(Number(f.Personnes), 'personne')}
                      </option>
                    ))}
                  </select>)}
                {mode === 'formule' && famille && champ('Nouvelle formule',
                  <select className="form-control" value={idOffre} onChange={(e) => setIdOffre(Number(e.target.value))}>
                    {famille.Formules.map((o) => (
                      <option key={o.IdOffre} value={o.IdOffre}>
                        {libelleFormule(o)}{o.IdOffre === famille.IdOffre ? ' - actuelle' : ''}
                      </option>
                    ))}
                  </select>)}
              </div>

              {mode === 'incorporation' && (
                <>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <UserPlus size={15} /> Nouveau membre
                  </div>
                  <div style={grille}>
                    {champ('Lien *',
                      <select className="form-control" value={membre.Lien} onChange={(e) => majMembre('Lien', e.target.value)}>
                        <option value="C">Conjoint</option>
                        <option value="E">Enfant</option>
                      </select>)}
                    {champ('Nom *', <input className="form-control" value={membre.Nom} onChange={(e) => majMembre('Nom', e.target.value)} maxLength={60} />)}
                    {champ('Prénoms', <input className="form-control" value={membre.Prenom} onChange={(e) => majMembre('Prenom', e.target.value)} maxLength={80} />)}
                    {champ('Date de naissance *',
                      <input type="date" className="form-control" value={membre.DateNaissance} max={dateEffet || undefined}
                        onChange={(e) => majMembre('DateNaissance', e.target.value)} />,
                      age !== null && age >= 0 ? `${pluriel(age, 'an')} au ${formatDate(dateEffet)}` : undefined)}
                    {champ('Sexe *',
                      <select className="form-control" value={membre.Sexe} onChange={(e) => majMembre('Sexe', e.target.value)}>
                        <option value="">Choisir</option>
                        <option value="F">Féminin</option>
                        <option value="M">Masculin</option>
                      </select>)}
                    {champ('Affections chroniques',
                      <input type="number" min="0" max={affectionsMax} className="form-control" value={membre.NombrePathologie}
                        onChange={(e) => majMembre('NombrePathologie', Math.max(0, Math.min(affectionsMax, Number(e.target.value) || 0)))} />,
                      `Surprime de ${surprimes.affection} % de la prime de base par affection en MINENE.`)}
                  </div>
                  {certificatPropose && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input type="checkbox" checked={membre.Certificat} onChange={(e) => majMembre('Certificat', e.target.checked)} />
                      <span>
                        Certificat de scolarité ou rapport médical fourni : enfant de plus de {surprimes.ageMaxEnfant} ans admis
                        jusqu'à {surprimes.ageMaxEnfantCertificat} ans.
                      </span>
                    </label>
                  )}

                  {famille && (
                    <div style={{
                      display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.75rem 0.9rem', borderRadius: '8px',
                      border: `1px solid ${!apres ? 'rgba(244, 63, 94, 0.45)' : changeFormule ? 'rgba(236, 72, 153, 0.45)' : 'var(--border-subtle)'}`,
                      background: !apres ? 'rgba(244, 63, 94, 0.07)' : changeFormule ? 'rgba(236, 72, 153, 0.07)' : 'var(--bg-surface-elevated)',
                      color: 'var(--text-secondary)',
                    }}>
                      <Users size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      {!apres ? (
                        <span>
                          Aucune formule de l'offre n'accueille une famille de {pluriel(Number(famille.Personnes) + 1, 'personne')} :
                          la famille <strong>{famille.Adherent}</strong> est complète en {libelleFormule(famille)}.
                        </span>
                      ) : changeFormule ? (
                        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <span>
                            <strong style={{ color: 'var(--text-primary)' }}>Changement de formule.</strong> La famille {famille.Adherent} passe
                            de {pluriel(Number(famille.Personnes), 'personne')} à {Number(famille.Personnes) + 1} : sa formule {famille.Option}
                            {' '}est complète, elle passe en <strong style={{ color: 'var(--text-primary)' }}>{apres.Option || apres.Formule}</strong>.
                          </span>
                          {forfaitaire && ecartTtc != null ? (
                            <>
                              <span>
                                Prime de la nouvelle personne : écart entre les deux formules, {fcfa(apres.PrimeTtc)} − {fcfa(ttcAvant)} ={' '}
                                <strong style={{ color: 'var(--text-primary)' }}>{fcfa(ecartTtc)} F TTC</strong>,
                                dû en entier : tarif forfaitaire, sans prorata.
                              </span>
                              {decomposition && (
                                <span>
                                  Détail : prime nette {fcfa(decomposition.primeNette)} F + accessoire {fcfa(decomposition.accessoire)} F
                                  {' '}+ taxes {fcfa(decomposition.taxe)} F. Surprime d'âge éventuelle en plus.
                                </span>
                              )}
                            </>
                          ) : primesConnues ? (
                            <span>
                              Prime de la nouvelle personne : écart entre les deux formules, {fcfa(apres.PrimeBase)} − {fcfa(famille.PrimeBase)} ={' '}
                              <strong style={{ color: 'var(--text-primary)' }}>{fcfa(ecartAnnuel)} F par an</strong>
                              {forfaitaire
                                ? ', dû en entier : tarif forfaitaire, sans prorata'
                                : joursPeriode > 0 && <>, soit environ <strong style={{ color: 'var(--text-primary)' }}>{fcfa(estimation)} F</strong> de prime nette pour {joursRestants} jours sur {joursPeriode}</>}.
                            </span>
                          ) : (
                            <span>
                              Prime de la nouvelle personne : écart entre les deux formules{forfaitaire ? ', dû en entier' : ', au prorata des jours restants'}.
                            </span>
                          )}
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {forfaitaire
                              ? 'Montant au barème : une réduction, une majoration ou des surprimes de la famille le modifient ; le montant exact est calculé à la création de l\'avenant.'
                              : 'Surprimes, réduction ou majoration de la famille, supplément d\'accessoire et taxe sont calculés à la création de l\'avenant.'}
                          </span>
                        </span>
                      ) : famille.PersonnesMax ? (
                        <span>
                          La famille {famille.Adherent} passe à {pluriel(Number(famille.Personnes) + 1, 'personne')} et reste
                          en <strong style={{ color: 'var(--text-primary)' }}>{libelleFormule(famille)}</strong> : pas
                          d'écart de formule. Seules d'éventuelles surprimes du nouveau membre (âge, affections) s'ajoutent{forfaitaire ? '' : ', au prorata'}.
                        </span>
                      ) : (
                        <span>
                          La famille {famille.Adherent} passe à {pluriel(Number(famille.Personnes) + 1, 'personne')}. Prime de
                          l'avenant : écart de prime annuelle avec la composition actuelle, au prorata des jours restants, calculé à la création.
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}

              {mode === 'famille' && (
                <>
                  <div style={grille}>
                    {champ('Formule *',
                      <select className="form-control" value={nouvelleFamille.IdOffre}
                        onChange={(e) => setNouvelleFamille((f) => ({ ...f, IdOffre: Number(e.target.value) }))}>
                        <option value={0}>Choisir la formule</option>
                        {formulesContrat.map((o) => <option key={o.IdOffre} value={o.IdOffre}>{libelleFormule(o)}</option>)}
                      </select>,
                      'Formules des offres commerciales du contrat ; même collège et même zone que les familles de cette offre')}
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <UserPlus size={15} /> Adhérent (assuré principal)
                  </div>
                  <div style={grille}>
                    {champ('Nom *', <input className="form-control" value={nouvelleFamille.Adherent.Nom} maxLength={60}
                      onChange={(e) => majAdherent('Nom', e.target.value)} />)}
                    {champ('Prénoms', <input className="form-control" value={nouvelleFamille.Adherent.Prenom} maxLength={80}
                      onChange={(e) => majAdherent('Prenom', e.target.value)} />)}
                    {champ('Date de naissance *',
                      <input type="date" className="form-control" value={nouvelleFamille.Adherent.DateNaissance} max={dateEffet || undefined}
                        onChange={(e) => majAdherent('DateNaissance', e.target.value)} />,
                      aideAge(nouvelleFamille.Adherent.DateNaissance))}
                    {champ('Sexe *', champSexe(nouvelleFamille.Adherent.Sexe, (v) => majAdherent('Sexe', v)))}
                    {champ('Affections chroniques', champAffections(nouvelleFamille.Adherent.NombrePathologie, (v) => majAdherent('NombrePathologie', v)))}
                    {champ('Matricule', <input className="form-control" value={nouvelleFamille.Adherent.Matricule} maxLength={30}
                      onChange={(e) => majAdherent('Matricule', e.target.value)} />)}
                    {champ('Mobile', <input className="form-control" value={nouvelleFamille.Adherent.Mobile} maxLength={20}
                      onChange={(e) => majAdherent('Mobile', e.target.value)} />)}
                  </div>

                  {nouvelleFamille.Membres.map((m, rang) => (
                    <div key={rang} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.6rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Membre n° {rang + 1}</span>
                        <button type="button" className="btn btn-secondary" onClick={() => retirerMembreFamille(rang)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem' }}>
                          <Trash2 size={13} /> Retirer
                        </button>
                      </div>
                      <div style={grille}>
                        {champ('Lien *',
                          <select className="form-control" value={m.Lien} onChange={(e) => majMembreFamille(rang, 'Lien', e.target.value)}>
                            <option value="C">Conjoint</option>
                            <option value="E">Enfant</option>
                          </select>)}
                        {champ('Nom *', <input className="form-control" value={m.Nom} maxLength={60}
                          onChange={(e) => majMembreFamille(rang, 'Nom', e.target.value)} />)}
                        {champ('Prénoms', <input className="form-control" value={m.Prenom} maxLength={80}
                          onChange={(e) => majMembreFamille(rang, 'Prenom', e.target.value)} />)}
                        {champ('Date de naissance *',
                          <input type="date" className="form-control" value={m.DateNaissance} max={dateEffet || undefined}
                            onChange={(e) => majMembreFamille(rang, 'DateNaissance', e.target.value)} />,
                          aideAge(m.DateNaissance))}
                        {champ('Sexe *', champSexe(m.Sexe, (v) => majMembreFamille(rang, 'Sexe', v)))}
                        {champ('Affections chroniques', champAffections(m.NombrePathologie, (v) => majMembreFamille(rang, 'NombrePathologie', v)))}
                      </div>
                      {certificatPour(m) && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input type="checkbox" checked={m.Certificat} onChange={(e) => majMembreFamille(rang, 'Certificat', e.target.checked)} />
                          <span>
                            Certificat de scolarité ou rapport médical fourni : enfant de plus de {surprimes.ageMaxEnfant} ans admis
                            jusqu'à {surprimes.ageMaxEnfantCertificat} ans.
                          </span>
                        </label>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={ajouterMembreFamille}
                    style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Plus size={14} /> Ajouter un conjoint ou un enfant
                  </button>

                  {Number(nouvelleFamille.IdOffre) > 0 && (
                    <div style={{
                      display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.75rem 0.9rem', borderRadius: '8px',
                      border: `1px solid ${formuleRetenue ? 'var(--border-subtle)' : 'rgba(244, 63, 94, 0.45)'}`,
                      background: formuleRetenue ? 'var(--bg-surface-elevated)' : 'rgba(244, 63, 94, 0.07)',
                      color: 'var(--text-secondary)',
                    }}>
                      <Users size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      {!formuleRetenue ? (
                        <span>Aucune formule de l'offre n'accueille une famille de {pluriel(tailleFamille, 'personne')}.</span>
                      ) : (
                        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <span>
                            Famille de {pluriel(tailleFamille, 'personne')}, incorporée
                            en <strong style={{ color: 'var(--text-primary)' }}>{libelleFormule(formuleRetenue)}</strong>
                            {formuleRetenue.IdOffre !== Number(nouvelleFamille.IdOffre) && ' (formule de sa taille, prise d\'office)'}.
                          </span>
                          {forfaitaire && formuleRetenue.PrimeTtc != null ? (
                            <span>
                              Prime de la famille au barème : <strong style={{ color: 'var(--text-primary)' }}>{fcfa(formuleRetenue.PrimeTtc)} F TTC</strong>,
                              {' '}due en entier : tarif forfaitaire, sans prorata. Surprimes d'âge ou d'affections éventuelles en plus.
                            </span>
                          ) : (
                            <span>
                              Prime de l'avenant : prime annuelle de la famille{forfaitaire ? ', due en entier' : ` au prorata des jours restants (${Math.max(joursRestants, 0)} sur ${joursPeriode})`},
                              {' '}calculée à la création avec les surprimes, réductions, accessoire et taxes.
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}

              {mode === 'formule' && famille && Number(idOffre) !== Number(famille.IdOffre) && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', color: 'var(--text-secondary)' }}>
                  <Users size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    La famille <strong>{famille.Adherent}</strong> passe de {famille.Option || 'sa formule'} à{' '}
                    <strong>{famille.Formules.find((o) => o.IdOffre === Number(idOffre))?.Option || 'la nouvelle formule'}</strong>.
                    {' '}La composition s'ouvre ensuite dans l'écran Santé.
                  </span>
                </div>
              )}
              {mode === 'ecran' && (
                <div style={{ color: 'var(--text-secondary)' }}>
                  L'avenant reprend la composition en vigueur et s'ouvre dans l'écran Santé : ajout d'un membre, d'une couverture
                  ou toute autre modification. Un membre ajouté à une famille complète la fait passer d'office dans la formule de sa taille.
                </div>
              )}

              {donnees.Avenants?.length > 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  Avenants déjà émis sur la période :{' '}
                  {donnees.Avenants.map((a) => `${formatDate(a.DateEffet)} - ${fcfa(a.PrimeTtc)} F TTC`).join(' ; ')}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
                <button type="button" className="btn btn-primary" onClick={creer} disabled={envoi || (mode === 'incorporation' && Boolean(famille) && !apres)
                  || (mode === 'famille' && Number(nouvelleFamille.IdOffre) > 0 && !formuleRetenue)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FilePlus2 size={15} /> {envoi ? 'Création…' : mode === 'incorporation' || mode === 'famille' ? 'Incorporer' : 'Créer l\'avenant'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default AvenantSanteModal;
