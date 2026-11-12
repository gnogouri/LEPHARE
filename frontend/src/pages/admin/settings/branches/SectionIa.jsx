import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Receipt, RotateCcw, Save, Tags, Trash2, UserPlus } from 'lucide-react';
import { SectionParametrage } from '../../../../components/admin/EnTeteParametrage';
import { AmountInput } from '../../../../components/common/AmountInput';
import { parametrageApi } from '../../../../api/endpoints';
import { useToast } from '../../../../context/ToastContext';
import { messageErreurApi } from '../../../../utils/financeUtils';
import { Interrupteur } from '../../../../components/admin/Interrupteur';
import { ReglagesIaForfaitsAutres } from './ReglagesIaForfaitsAutres';

// Réglages Individuelle Accidents (configuration_api/parametrage_ia.py) : tarif NSIA par classe d'activité et
// accessoires selon la prime nette, lus par fn_calcul_prime_ia_nsia et fn_get_accessoire_ia_nsia.

const fcfa = (v) => Math.round(Number(v) || 0).toLocaleString('fr-FR');
const nombre = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const texte = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
// Exemple affiché : 5 M décès, 5 M invalidité permanente, 250 000 de frais médicaux
const EXEMPLE = { deces: 5000000, invalidite: 5000000, frais: 250000 };

const ClasseIa = ({ classe, onEnregistre }) => {
  const { success, error: toastError } = useToast();
  const initial = { Libelle: classe.Libelle, TauxDeces: texte(classe.TauxDeces), TauxInvalidite: texte(classe.TauxInvalidite), TauxFraisMedicaux: texte(classe.TauxFraisMedicaux) };
  const [saisie, setSaisie] = useState(initial);
  const [envoi, setEnvoi] = useState(false);
  const modifie = JSON.stringify(saisie) !== JSON.stringify(initial);
  const exemple = Math.round(EXEMPLE.deces * nombre(saisie.TauxDeces) / 1000) + Math.round(EXEMPLE.invalidite * nombre(saisie.TauxInvalidite) / 1000)
    + Math.round(EXEMPLE.frais * nombre(saisie.TauxFraisMedicaux) / 100);
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const maj = await parametrageApi.modifierClasseIa(classe.Classe, {
        Libelle: saisie.Libelle, TauxDeces: saisie.TauxDeces, TauxInvalidite: saisie.TauxInvalidite, TauxFraisMedicaux: saisie.TauxFraisMedicaux,
      });
      onEnregistre(maj);
      success(`Classe ${maj.Classe} enregistrée : elle s'applique aux prochains devis IA NSIA.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const champ = (cle, unite, libelle) => (
    <label className="rb-champ"><span className="rb-champ-libelle">{libelle}</span>
      <span className="rb-unite" data-unite={unite}>
        <input className="form-control" inputMode="decimal" value={saisie[cle]} onChange={(e) => setSaisie((s) => ({ ...s, [cle]: e.target.value }))} />
      </span>
    </label>
  );
  return (
    <div className="rb-mode">
      <div className="rb-mode-entete">
        <strong>Classe {Number(classe.Classe)}</strong>
        <span className="rb-discret" title={classe.Exemples}>{classe.Professions} profession{classe.Professions > 1 ? 's' : ''}{classe.Exemples ? `, ex. ${classe.Exemples.split(', ').slice(0, 3).join(', ')}` : ''}</span>
      </div>
      <div className="rb-grille">
        <label className="rb-champ"><span className="rb-champ-libelle">Libellé</span>
          <input className="form-control" maxLength={120} value={saisie.Libelle} onChange={(e) => setSaisie((s) => ({ ...s, Libelle: e.target.value }))} /></label>
        {champ('TauxDeces', '‰', 'Décès, du capital')}
        {champ('TauxInvalidite', '‰', 'Invalidité permanente, du capital')}
        {champ('TauxFraisMedicaux', '%', 'Frais médicaux, du capital')}
      </div>
      <div className="rb-actions">
        <span className="rb-discret">Exemple, 5 M décès + 5 M invalidité + 250 000 F de frais : <strong style={{ color: 'var(--text-primary)' }}>{fcfa(exemple)} F</strong> de prime nette</span>
        {modifie && <button type="button" className="btn btn-secondary" onClick={() => setSaisie(initial)} title="Annuler les changements"><RotateCcw size={14} /></button>}
        {modifie && <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={envoi} aria-busy={envoi}><Save size={14} /> Enregistrer</button>}
      </div>
    </div>
  );
};

export const SectionIa = () => {
  const { success, error: toastError } = useToast();
  const [donnees, setDonnees] = useState(null);
  const [tranches, setTranches] = useState([]);
  const [offres, setOffres] = useState([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    parametrageApi.getIa()
      .then((d) => { setDonnees(d); setTranches(d.Tranches); setOffres(d.Offres || []); })
      .catch((err) => toastError(`Réglages IA non chargés : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!donnees) {
    return <SectionParametrage icone={UserPlus} titre="Tarif IA NSIA"><div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div></SectionParametrage>;
  }
  const paliers = tranches.filter((t) => t.PrimeMax !== null);
  const auDela = tranches.find((t) => t.PrimeMax === null) || { PrimeMax: null, Montant: 0, TauxAuDela: 0 };
  const modifiees = JSON.stringify(tranches) !== JSON.stringify(donnees.Tranches);
  const offresModifiees = JSON.stringify(offres) !== JSON.stringify(donnees.Offres || []);
  const parts = donnees.Parts || [];
  const partNsia = parts.find((p) => p.IdCompagnie === 1)?.Part;
  const enregistrerOffres = async () => {
    setEnvoi(true);
    try {
      const d = await parametrageApi.modifierOffresIa(offres.map((o) => ({ IdOffre: o.IdOffre, Montant: o.Montant, Actif: o.Actif })));
      setDonnees((x) => ({ ...x, Offres: d.Offres }));
      setOffres(d.Offres);
      success('Accessoires des offres IA enregistrés.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };
  const changer = (i, cle, valeur) => setTranches((l) => {
    const p = l.filter((t) => t.PrimeMax !== null);
    p[i] = { ...p[i], [cle]: valeur };
    return [...p, l.find((t) => t.PrimeMax === null) || auDela];
  });
  const changerAuDela = (cle, valeur) => setTranches((l) => [...l.filter((t) => t.PrimeMax !== null), { ...auDela, [cle]: valeur }]);
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const d = await parametrageApi.modifierTranchesIa([...paliers, auDela].map((t) => ({
        PrimeMax: t.PrimeMax, Montant: t.Montant, TauxAuDela: t.PrimeMax === null ? String(t.TauxAuDela ?? 0).replace(',', '.') : null,
      })));
      setDonnees((x) => ({ ...x, Tranches: d.Tranches }));
      setTranches(d.Tranches);
      success('Accessoires IA NSIA enregistrés.');
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <>
      <SectionParametrage icone={UserPlus} titre={`Tarif ${donnees.Compagnie} par classe d'activité`}
        description="La classe vient de la profession de l'assuré. Prime = capital × taux ; décès et invalidité en ‰, frais médicaux en %. Les autres compagnies utilisent leur barème enregistré.">
        <div className="rb-modes">
          {donnees.Classes.map((c) => (
            <ClasseIa key={c.Classe} classe={c} onEnregistre={(maj) => setDonnees((d) => ({ ...d, Classes: d.Classes.map((x) => (x.Classe === maj.Classe ? maj : x)) }))} />
          ))}
        </div>
      </SectionParametrage>

      <SectionParametrage icone={Receipt} titre="Accessoires selon la prime nette"
        description={`Montant de la première tranche dont le plafond n'est pas dépassé ; au-delà de la dernière : pourcentage de la prime nette plus un montant. Partagé selon la part du cabinet réglée sur la fiche NSIA${partNsia !== undefined ? ` (${texte(partNsia)} % au cabinet)` : ''}.`}>
        <div className="table-wrapper">
          <table className="rb-table">
            <thead><tr><th>Prime nette jusqu'à</th><th>Accessoires</th><th aria-label="Retirer" /></tr></thead>
            <tbody>
              {paliers.map((t, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td><AmountInput value={t.PrimeMax ?? ''} onChange={(n) => changer(i, 'PrimeMax', Number(n) || 0)} /></td>
                  <td><AmountInput value={t.Montant ?? ''} onChange={(n) => changer(i, 'Montant', Number(n) || 0)} /></td>
                  <td><button type="button" className="btn btn-link" aria-label="Retirer cette tranche" onClick={() => setTranches((l) => [...l.filter((x) => x.PrimeMax !== null).filter((_, k) => k !== i), auDela])}><Trash2 size={15} /></button></td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Au-delà</td>
                <td>
                  <div className="rb-grille" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                    <span className="rb-unite" data-unite="% de la PN">
                      <input className="form-control" inputMode="decimal" aria-label="Pourcentage de la prime nette au-delà" value={texte(auDela.TauxAuDela)} onChange={(e) => changerAuDela('TauxAuDela', e.target.value)} />
                    </span>
                    <AmountInput value={auDela.Montant ?? ''} onChange={(n) => changerAuDela('Montant', Number(n) || 0)} />
                  </div>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="rb-actions">
          <button type="button" className="btn btn-secondary" style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={() => setTranches((l) => [...l.filter((x) => x.PrimeMax !== null), { PrimeMax: (paliers.at(-1)?.PrimeMax || 0) + 1000000, Montant: 0, TauxAuDela: null }, auDela])}>
            <Plus size={15} /> Ajouter une tranche
          </button>
          {modifiees && <button type="button" className="btn btn-secondary" onClick={() => setTranches(donnees.Tranches)} title="Annuler les changements"><RotateCcw size={14} /></button>}
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifiees || envoi} aria-busy={envoi}><Save size={14} /> Enregistrer la grille</button>
        </div>
      </SectionParametrage>

      <SectionParametrage icone={Tags} titre="Accessoires forfaitaires des offres"
        description="Offres dont l'accessoire est un montant fixe au lieu du barème (CGA, CI-ÉNERGIES…), partagé entre la compagnie et le cabinet selon la part réglée sur la fiche de chaque compagnie.">
        <div className="rb-formule" style={{ marginTop: 0, marginBottom: '0.9rem' }}>
          <span>Part du cabinet dans les accessoires : {parts.length ? parts.map((p) => `${p.RaisonSociale} ${texte(p.Part)} %`).join(', ') : 'aucune compagnie réglée'}.</span>
          <span className="rb-discret">Elle se règle sur la fiche de chaque compagnie, onglet Reversements : <Link to="/admin/settings/companies">Compagnies partenaires</Link>. Sans réglage, la compagnie applique son barème et le cabinet le sien.</span>
        </div>
        <div className="table-wrapper">
          <table className="rb-table">
            <thead><tr><th>Offre</th><th>Accessoire de l'offre</th><th>Compagnie / cabinet à 50 %</th><th>Appliqué</th></tr></thead>
            <tbody>
              {offres.map((o) => (
                <tr key={o.IdOffre} className={o.Actif ? '' : 'inactive'}>
                  <td style={{ fontWeight: 700 }}>{o.Libelle}<div className="rb-discret">Offre n° {o.IdOffre}</div></td>
                  <td style={{ minWidth: 160 }}><AmountInput value={o.Montant ?? ''} onChange={(n) => setOffres((l) => l.map((x) => (x.IdOffre === o.IdOffre ? { ...x, Montant: Number(n) || 0 } : x)))} /></td>
                  <td className="rb-discret">{texte((Number(o.Montant) || 0) / 2)} F + {texte((Number(o.Montant) || 0) / 2)} F</td>
                  <td><Interrupteur actif={!!o.Actif} onChange={(v) => setOffres((l) => l.map((x) => (x.IdOffre === o.IdOffre ? { ...x, Actif: v } : x)))} libelle={`Accessoire forfaitaire de l'offre ${o.Libelle}`}
                    titre="Désactivé : l'offre suit le barème des accessoires" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rb-actions">
          {offresModifiees && <button type="button" className="btn btn-secondary" onClick={() => setOffres(donnees.Offres || [])} title="Annuler les changements"><RotateCcw size={14} /></button>}
          <button type="button" className="btn btn-primary" onClick={enregistrerOffres} disabled={!offresModifiees || envoi} aria-busy={envoi}><Save size={14} /> Enregistrer les offres</button>
        </div>
      </SectionParametrage>

      <ReglagesIaForfaitsAutres reglages={donnees.Reglages} />
    </>
  );
};

export default SectionIa;
