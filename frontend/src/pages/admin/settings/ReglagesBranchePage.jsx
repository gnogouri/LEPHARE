import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Boxes, Coins, ExternalLink, Factory, LayoutGrid, Loader2, Percent, Receipt, RotateCcw, Save, SlidersHorizontal,
} from 'lucide-react';
import { EnTeteParametrage, SectionParametrage } from '../../../components/admin/EnTeteParametrage';
import { LigneParametre } from '../../../components/admin/LigneParametre';
import { Interrupteur } from '../../../components/admin/Interrupteur';
import { ADMIN_MENU } from '../../../components/layout/adminMenu';
import { parametrageApi } from '../../../api/endpoints';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { messageErreurApi } from '../../../utils/financeUtils';
import { chargerParametrage } from '../../../utils/parametrage';
import { BRANCHES, adresseBranche, brancheDuModule } from '../../../utils/branchesProduction';
import { SectionTransport } from './branches/SectionTransport';
import { SectionIa } from './branches/SectionIa';
import { SectionMrh } from './branches/SectionMrh';
import { SectionRc } from './branches/SectionRc';
import { SectionVie } from './branches/SectionVie';

// Réglages d'une branche de production, au même endroit (demande du 2026-10-21 : « le paramétrage pour toutes les
// branches de production actives, ce qui évitera la confusion ») : production (saisie, compagnie proposée), règles de
// la branche, réglages propres (Transport, IA, MRH, RC, offres commerciales Vie), écrans détaillés et tables communes.

const SECTIONS = { transport: SectionTransport, ia: SectionIa, mrh: SectionMrh, rc: SectionRc, vie: SectionVie };
const ECRANS = ADMIN_MENU.flatMap((g) => g.items);

// Tables communes à toutes les branches, ouvertes filtrées sur la branche
const tablesCommunes = (b) => [
  { to: `/admin/settings/offres?branche=${b.brancheCima}`, label: 'Offres et garanties', icon: Boxes, description: 'Formules proposées par compagnie et par catégorie, garanties comprises et franchises.' },
  { to: `/admin/settings/taxes?produit=${b.idProduit}`, label: 'Taxes', icon: Percent, description: 'Taux de taxe par garantie, avec leur période de validité.' },
  { to: `/admin/settings/commissions-baremes?produit=${b.idProduit}`, label: 'Taux de commission', icon: Coins, description: 'Commission du cabinet par compagnie, avec sa période de validité.' },
  { to: `/admin/settings/tarifs?produit=${b.idProduit}`, label: 'Accessoires', icon: Receipt, description: 'Frais de dossier par tranche de prime nette : compagnie et part du cabinet.' },
];

const CarteLien = ({ to, label, description, icon: Icone }) => (
  <Link to={to} className="rb-carte">
    <span className="rb-carte-icone"><Icone size={18} /></span>
    <span style={{ minWidth: 0 }}>
      <span className="rb-carte-titre">{label} <ArrowRight size={14} /></span>
      <span className="rb-carte-texte">{description}</span>
    </span>
  </Link>
);

export const ReglagesBranchePage = () => {
  const { module } = useParams();
  const branche = brancheDuModule(module);
  const { peut } = useAuth();
  const { success, error: toastError } = useToast();
  const [produit, setProduit] = useState(null);
  const [saisie, setSaisie] = useState(null);
  const [compagnies, setCompagnies] = useState([]);
  const [parametres, setParametres] = useState([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!branche) return undefined;
    let actif = true;
    setProduit(null);
    Promise.all([parametrageApi.getProduits(), parametrageApi.getCompagnies().catch(() => []), parametrageApi.getParametres().catch(() => [])])
      .then(([p, cies, params]) => {
        if (!actif) return;
        const ligne = (p.Produits || []).find((x) => Number(x.IdProduit) === branche.idProduit) || null;
        setProduit(ligne);
        setSaisie(ligne ? { ...ligne } : null);
        setCompagnies((cies || []).filter((c) => c.Active).map((c) => ({ id: Number(c.IdCompagnie), nom: c.RaisonSociale })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')));
        setParametres(params || []);
      })
      .catch((err) => toastError(`Réglages non chargés : ${messageErreurApi(err)}`));
    return () => { actif = false; };
  }, [module]); // eslint-disable-line react-hooks/exhaustive-deps

  const reglesBranche = useMemo(
    () => (branche?.parametres || []).map((cle) => parametres.find((p) => p.Cle === cle)).filter(Boolean),
    [branche, parametres],
  );

  if (!branche) return <Navigate replace to="/admin/settings/branches" />;
  const Icone = branche.icone;
  const Section = SECTIONS[branche.section];
  const modifie = produit && saisie && (Boolean(saisie.SaisieOuverte) !== Boolean(produit.SaisieOuverte)
    || Number(saisie.IdCompagnieDefaut || 0) !== Number(produit.IdCompagnieDefaut || 0));
  const pages = (branche.pages || []).map((to) => ECRANS.find((e) => e.to === to)).filter((e) => e && peut(e.droit));

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const maj = await parametrageApi.modifierProduit(branche.idProduit, { SaisieOuverte: saisie.SaisieOuverte, IdCompagnieDefaut: saisie.IdCompagnieDefaut || null });
      setProduit(maj);
      setSaisie({ ...maj });
      chargerParametrage(true);
      success(`${branche.libelle} : ${maj.SaisieOuverte ? 'saisie ouverte' : 'saisie fermée'}, compagnie proposée enregistrée.`);
    } catch (err) {
      toastError(messageErreurApi(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="rb-page">
      <EnTeteParametrage
        icone={Icone}
        titre={`Réglages ${branche.libelle}`}
        description={branche.description}
        usage="Tout ce qui se règle pour cette branche est ici. Chaque modification s'applique aux prochains devis et est inscrite au journal d'audit."
        actions={(
          <>
            <Link to="/admin/settings/branches" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><LayoutGrid size={15} /> Toutes les branches</Link>
            {produit?.SaisieOuverte && (
              <Link to={`/user/quotes/${branche.module}`} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><ExternalLink size={15} /> Formulaire de devis</Link>
            )}
          </>
        )}
      />

      <nav className="rb-sommaire" aria-label="Sections de la page">
        <a href="#rb-production">Production</a>
        {reglesBranche.length > 0 && <a href="#rb-regles">Règles</a>}
        {Section && <a href="#rb-propres">Tarif et listes</a>}
        {pages.length > 0 && <a href="#rb-ecrans">Écrans détaillés</a>}
        <a href="#rb-communes">Tables communes</a>
      </nav>

      <div id="rb-production">
        <SectionParametrage icone={Factory} titre="Production" description="Ouverture de la saisie des devis de la branche et compagnie sélectionnée à l'ouverture d'un nouveau devis.">
          {!saisie ? <div style={{ color: 'var(--text-muted)' }}><Loader2 size={15} className="spin" /> Chargement…</div> : (
            <div className="rb-production">
              <div className="rb-champ">
                <span className="rb-champ-libelle">Saisie des devis</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Interrupteur actif={!!saisie.SaisieOuverte} desactive={!saisie.ModuleSaisie} libelle="Saisie des devis ouverte"
                    onChange={(v) => setSaisie((s) => ({ ...s, SaisieOuverte: v }))} titre="Ouvrir ou fermer la saisie des devis de cette branche" />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{saisie.SaisieOuverte ? 'Ouverte' : 'Fermée'}</span>
                </span>
              </div>
              <label className="rb-champ">
                <span className="rb-champ-libelle">Compagnie proposée</span>
                <select className="form-control" value={saisie.IdCompagnieDefaut || ''}
                  onChange={(e) => setSaisie((s) => ({ ...s, IdCompagnieDefaut: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">Première de la liste</option>
                  {compagnies.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </label>
              <div className="rb-champ">
                <span className="rb-champ-libelle">Onglet du registre</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{saisie.Onglet || '-'} <Link to="/admin/settings/products" style={{ fontSize: '0.78rem', fontWeight: 400 }}>Produits</Link></span>
              </div>
              <div className="rb-actions">
                {modifie && <button type="button" className="btn btn-secondary" onClick={() => setSaisie({ ...produit })} title="Annuler les changements"><RotateCcw size={14} /></button>}
                <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!modifie || envoi} aria-busy={envoi}><Save size={14} /> Enregistrer</button>
              </div>
            </div>
          )}
        </SectionParametrage>
      </div>

      {reglesBranche.length > 0 && (
        <div id="rb-regles">
          <SectionParametrage icone={SlidersHorizontal} titre="Règles de la branche" description="Contrôles appliqués à la saisie et à l'enregistrement des devis de la branche.">
            {reglesBranche.map((p) => (
              <LigneParametre key={p.Cle} parametre={p}
                onEnregistre={(maj) => { setParametres((l) => l.map((x) => (x.Cle === maj.Cle ? maj : x))); chargerParametrage(true); }} />
            ))}
          </SectionParametrage>
        </div>
      )}

      {Section && <div id="rb-propres"><Section /></div>}

      {pages.length > 0 && (
        <div id="rb-ecrans">
          <SectionParametrage icone={LayoutGrid} titre="Écrans détaillés de la branche" description="Les tarifs et règles qui demandent un écran à part.">
            <div className="rb-cartes">{pages.map((p) => <CarteLien key={p.to} {...p} />)}</div>
          </SectionParametrage>
        </div>
      )}

      <div id="rb-communes">
        <SectionParametrage icone={Boxes} titre="Tables communes, ouvertes sur cette branche" description="Ces tables servent à toutes les branches : chaque lien les ouvre déjà filtrées sur la branche.">
          <div className="rb-cartes">{tablesCommunes(branche).map((t) => <CarteLien key={t.to} {...t} />)}</div>
        </SectionParametrage>
      </div>
    </div>
  );
};

/** Toutes les branches : saisie ouverte ou fermée, compagnie proposée, accès à leurs réglages. */
export const ReglagesBranchesPage = () => {
  const { error: toastError } = useToast();
  const [produits, setProduits] = useState(null);
  const [compagnies, setCompagnies] = useState({});
  useEffect(() => {
    Promise.all([parametrageApi.getProduits(), parametrageApi.getCompagnies().catch(() => [])])
      .then(([p, cies]) => {
        setProduits(p.Produits || []);
        setCompagnies(Object.fromEntries((cies || []).map((c) => [Number(c.IdCompagnie), c.RaisonSociale])));
      })
      .catch((err) => toastError(`Produits non chargés : ${messageErreurApi(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="rb-page">
      <EnTeteParametrage icone={LayoutGrid} titre="Réglages par branche"
        description="Une page par branche de production : ce qui s'y règle, au même endroit. Une branche fermée à la saisie reste réglable ici."
        usage="La saisie d'une branche et sa compagnie proposée se règlent aussi sur sa page." />
      <div className="rb-branches">
        {BRANCHES.map((b) => {
          const p = (produits || []).find((x) => Number(x.IdProduit) === b.idProduit);
          const Icone = b.icone;
          return (
            <Link key={b.module} to={adresseBranche(b.module)} className="rb-branche">
              <span className="rb-carte-icone"><Icone size={20} /></span>
              <span className="rb-carte-titre">{b.libelle}</span>
              <span className="rb-carte-texte">{b.description}</span>
              <span className="rb-branche-etat">
                {!produits ? '…' : (
                  <>
                    <span className={`rb-pastille ${p?.SaisieOuverte ? 'ouverte' : ''}`}>{p?.SaisieOuverte ? 'Saisie ouverte' : 'Saisie fermée'}</span>
                    {p?.IdCompagnieDefaut ? <span>Proposée : {compagnies[Number(p.IdCompagnieDefaut)] || `n° ${p.IdCompagnieDefaut}`}</span> : null}
                  </>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default ReglagesBranchePage;
