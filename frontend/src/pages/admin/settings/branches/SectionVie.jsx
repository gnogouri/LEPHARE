import React, { useEffect, useState } from 'react';
import { HeartHandshake, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { SectionParametrage } from '../../../../components/admin/EnTeteParametrage';
import { Interrupteur } from '../../../../components/admin/Interrupteur';
import { vieOffresApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { messageErreurApi } from '../../../../utils/financeUtils';
import { confirmer } from '../../../../utils/dialogue';
import '../../../user/quotes/vie/vie.css';

// Réglages Vie : offres commerciales de la liste déroulante du devis Vie (configuration_api/parametrage_vie.py) : libellé,
// formulaire de saisie (assurés avec capital et prime, ou cotisations salarié et employeur), périodicité, garantie des lignes.

const OFFRE_VIDE = { Libelle: '', Saisie: 'CAPITAL', Periodicite: 'ANNUELLE', IdGarantie: 231, Ordre: 10, Description: '', Actif: true };
const champs = (o) => ({ Libelle: o.Libelle, Saisie: o.Saisie, Periodicite: o.Periodicite, IdGarantie: Number(o.IdGarantie), Ordre: Number(o.Ordre) || 0, Description: o.Description || '', Actif: Boolean(o.Actif) });

const CarteOffre = ({ offre, listes, onEnregistre, onRetire, nouvelle }) => {
  const { success, error: toastError } = useToast();
  const [saisie, setSaisie] = useState(champs(offre));
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { setSaisie(champs(offre)); }, [offre]);
  const modifiee = JSON.stringify(saisie) !== JSON.stringify(champs(offre));
  const maj = (champ, valeur) => setSaisie((s) => ({ ...s, [champ]: valeur }));

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const r = nouvelle ? await vieOffresApi.creer(saisie) : await vieOffresApi.modifier(offre.IdOffre, saisie);
      onEnregistre(r);
      success(`Offre « ${r.Offre?.Libelle || saisie.Libelle} » ${nouvelle ? 'ajoutée' : 'enregistrée'}.`);
      if (nouvelle) setSaisie(champs(OFFRE_VIDE));
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const retirer = async () => {
    if (!(await confirmer({ ton: 'danger', titre: `Supprimer l'offre « ${offre.Libelle} » ?`, message: "Elle ne sera plus proposée à la saisie des devis Vie. Une offre déjà portée par un devis ne se supprime pas : désactivez-la.", confirmer: "Supprimer l'offre", annuler: 'Garder' }))) return;
    try {
      onRetire(await vieOffresApi.supprimer(offre.IdOffre));
      success(`Offre « ${offre.Libelle} » supprimée.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    }
  };

  return (
    <div className={`vie-offre-carte${saisie.Actif ? '' : ' inactive'}${modifiee ? ' modifiee' : ''}`}>
      <label>Libellé dans la liste
        <input className="form-control" maxLength={100} value={saisie.Libelle} onChange={(e) => maj('Libelle', e.target.value)} placeholder={nouvelle ? 'Ex. Épargne retraite' : ''} />
      </label>
      <label>Formulaire de saisie
        <select className="form-control" value={saisie.Saisie} onChange={(e) => maj('Saisie', e.target.value)} disabled={!nouvelle && offre.Devis > 0}
          title={!nouvelle && offre.Devis > 0 ? `${offre.Devis} devis portent cette offre : son formulaire ne change plus` : undefined}>
          {listes.Saisies.map((s) => <option key={s.Code} value={s.Code}>{s.Libelle}</option>)}
        </select>
      </label>
      <label>Périodicité
        <select className="form-control" value={saisie.Periodicite} onChange={(e) => maj('Periodicite', e.target.value)}>
          {listes.Periodicites.map((p) => <option key={p.Code} value={p.Code}>{p.Libelle}</option>)}
        </select>
      </label>
      <label>Garantie des lignes du devis
        <select className="form-control" value={saisie.IdGarantie} onChange={(e) => maj('IdGarantie', Number(e.target.value))}>
          {listes.Garanties.map((g) => <option key={g.IdGarantie} value={g.IdGarantie}>{g.Libelle}</option>)}
        </select>
      </label>
      <label>Ordre
        <input type="number" min={0} max={999} className="form-control" value={saisie.Ordre} onChange={(e) => maj('Ordre', e.target.value)} />
      </label>
      <div className="vie-offre-carte-actions">
        <Interrupteur actif={saisie.Actif} libelle={`Offre ${saisie.Libelle || 'nouvelle'} proposée à la saisie`} onChange={(v) => maj('Actif', v)}
          titre={saisie.Actif ? 'Proposée à la saisie des devis Vie' : 'Plus proposée : les devis qui la portent la gardent'} />
        {modifiee && !nouvelle && <button type="button" className="btn btn-secondary" onClick={() => setSaisie(champs(offre))} title="Annuler les changements"><RotateCcw size={14} /></button>}
        {nouvelle ? (
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!saisie.Libelle.trim() || envoi} aria-busy={envoi}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={14} /> Ajouter</button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifiee || !saisie.Libelle.trim() || envoi} aria-busy={envoi} title="Enregistrer"><Save size={14} /></button>
            {offre.Devis === 0 && <button type="button" className="btn btn-link" onClick={retirer} aria-label={`Supprimer ${offre.Libelle}`}><Trash2 size={15} /></button>}
          </>
        )}
      </div>
      <label className="large">Description affichée sous la liste
        <input className="form-control" maxLength={500} value={saisie.Description} onChange={(e) => maj('Description', e.target.value)} />
      </label>
      {!nouvelle && <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', alignSelf: 'center' }}>{offre.Devis ? `${offre.Devis} devis` : 'Aucun devis'}</span>}
    </div>
  );
};

export const SectionVie = () => {
  const { error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  useEffect(() => {
    vieOffresApi.lister()
      .then(setDonnees)
      .catch((err) => toastError(`Offres Vie non chargées : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SectionParametrage icone={HeartHandshake} titre="Offres commerciales"
      description="Liste déroulante du devis Vie, dans cet ordre. Le formulaire de saisie décide de l'écran : assurés avec capital, prime et bénéficiaires (AFA, Temporaire décès), ou état des cotisations salarié et employeur (Retraite complémentaire). Périodicité mensuelle : un devis par mois, du 1er au dernier jour.">
      {!donnees ? <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div>
        : !donnees.Reglable ? <p className="vie-message" style={{ margin: 0 }}>{donnees.Message}</p> : (
          <div className="vie-page vie-offres-admin">
            {donnees.Offres.map((o) => (
              <CarteOffre key={o.IdOffre} offre={o} listes={donnees} onEnregistre={setDonnees} onRetire={setDonnees} />
            ))}
            <CarteOffre nouvelle offre={OFFRE_VIDE} listes={donnees} onEnregistre={setDonnees} onRetire={setDonnees} />
          </div>
        )}
    </SectionParametrage>
  );
};

export default SectionVie;
