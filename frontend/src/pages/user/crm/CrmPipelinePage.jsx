import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from '../../../components/common/MetricCard';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { crmApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import {
  Users,
  TrendingUp,
  Plus,
  Search,
  Filter,
  Calendar,
  Banknote,
  CheckCircle,
  ChevronRight,
  Briefcase,
  Layers,
  UserCheck,
  Edit2,
  Trash2,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import { EditLeadModal } from './EditLeadModal';
import { canUser, getCurrentUser, validateBusinessRule } from '../../../utils/rbac';
import {
  ETAPES,
  ETAPES_OUVERTES,
  etapeDe,
  messageErreurApi,
  montantProspect,
  relanceEnRetard,
  relanceLisible,
  useCommerciaux,
} from './suiviCommercial';

const enMillions = (v) => `${(v / 1000000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M FCFA`;
const texte = (v) => (v && String(v).trim()) || '—';
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Devis à ouvrir pour un prospect : le formulaire Automobile pour l'auto et la flotte
const routeDevis = (branche) => (/auto|flotte/i.test(branche || '') ? '/user/quotes/auto' : '/user/quotes');

// Relance en toutes lettres (« 18 sept. 2026 ») et son échéance (« en retard de 10 jours »),
// la date complète au survol
const Relance = ({ prospect }) => {
  const relance = relanceLisible(prospect);
  if (!relance) return <span style={{ color: 'var(--text-muted)' }}>Non définie</span>;
  return (
    <span title={relance.complete} style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{relance.date}</span>
      {relance.echeance && (
        <span style={{ color: relance.retard ? '#f87171' : '#d97706', fontWeight: relance.retard ? 700 : 500 }}>
          {' · '}{relance.echeance}
        </span>
      )}
    </span>
  );
};

export const CrmPipelinePage = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [viewMode, setViewMode] = useState('kanban');
  const [currentUser] = useState(() => getCurrentUser());
  // Prospect ouvert dans la fenêtre : 'nouveau' en création, le prospect en modification
  const [prospectOuvert, setProspectOuvert] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const commerciaux = useCommerciaux();

  const nomUtilisateur = String(currentUser?.nom || currentUser?.name || '').trim();
  const commercialParDefaut = commerciaux.find((c) => c.toLowerCase() === nomUtilisateur.toLowerCase()) || '';

  const loadLeads = async () => {
    setLoading(true);
    setErreurChargement('');
    try {
      const data = await crmApi.getLeads();
      setLeads((Array.isArray(data) ? data : []).map((l) => ({ ...l, prime_estimee: montantProspect(l.prime_estimee) })));
    } catch (err) {
      console.error('Chargement du suivi commercial impossible', err);
      setErreurChargement(`Les prospects n'ont pas pu être chargés : ${messageErreurApi(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const remplacer = (prospect) => setLeads((prev) => prev.map((l) => (l.id === prospect.id
    ? { ...prospect, prime_estimee: montantProspect(prospect.prime_estimee) }
    : l)));

  // Création ou modification (EditLeadModal) : true si enregistré en base
  const enregistrerProspect = async (donnees) => {
    const lead = prospectOuvert === 'nouveau' ? null : prospectOuvert;
    try {
      if (lead) {
        const { data } = await crmApi.updateLead(lead.id, donnees);
        remplacer(data);
        success(`Prospect ${data.nom_prospect} mis à jour.`);
      } else {
        const { data } = await crmApi.createLead({
          ...donnees,
          historique_echanges: [{ date: aujourdhui(), auteur: donnees.commercial_attribue || nomUtilisateur || 'Commercial', action: "Création de l'opportunité" }],
        });
        setLeads((prev) => [{ ...data, prime_estimee: montantProspect(data.prime_estimee) }, ...prev]);
        success(`Prospect ${data.nom_prospect} enregistré sous la référence ${data.id_lead}.`);
      }
      return true;
    } catch (err) {
      toastError(`Prospect non enregistré : ${messageErreurApi(err)}`);
      return false;
    }
  };

  const changerEtape = async (lead, etape) => {
    setEnCours(lead.id);
    try {
      const { data } = await crmApi.updateLeadStage(lead.id, etape);
      remplacer(data);
      success(`${lead.nom_prospect} : « ${etapeDe(etape).label} ».`);
    } catch (err) {
      toastError(`Étape non modifiée : ${messageErreurApi(err)}`);
    } finally {
      setEnCours(null);
    }
  };

  // Suppression définitive, sauf une affaire gagnée (règle commerciale de rbac)
  const supprimer = async (lead) => {
    const regle = validateBusinessRule('delete', 'leads', lead);
    if (!regle.allowed) {
      toastError(`${regle.reason} ${regle.suggestion || ''}`.trim());
      return;
    }
    if (!window.confirm(`Supprimer définitivement le prospect ${lead.id_lead} — ${lead.nom_prospect} ?`)) return;
    try {
      await crmApi.deleteLead(lead.id);
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      success(`L'opportunité ${lead.nom_prospect} a été supprimée.`);
    } catch (err) {
      toastError(`Opportunité non supprimée : ${messageErreurApi(err)}`);
    }
  };

  // Filtre par branche : les branches réellement présentes dans le suivi
  const branches = useMemo(
    () => [...new Set(leads.map((l) => l.branche).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr-FR')),
    [leads],
  );

  const filteredLeads = leads.filter((l) => {
    const q = searchTerm.trim().toLowerCase();
    const matchSearch = !q || [l.id_lead, l.nom_prospect, l.contact, l.commercial_attribue, l.branche, l.telephone, l.email]
      .some((v) => String(v || '').toLowerCase().includes(q));
    return matchSearch && (selectedBranch === 'ALL' || l.branche === selectedBranch);
  });

  // Indicateurs : affaires en cours (hors gagnées et perdues) et transformation des affaires clôturées
  const enCoursLeads = filteredLeads.filter((l) => ETAPES_OUVERTES.includes(l.statut));
  const totalPipelineVal = enCoursLeads.reduce((acc, l) => acc + l.prime_estimee, 0);
  const wonLeads = filteredLeads.filter((l) => l.statut === 'Gagné');
  const lostLeads = filteredLeads.filter((l) => l.statut === 'Perdu');
  const wonVal = wonLeads.reduce((acc, l) => acc + l.prime_estimee, 0);
  const cloturees = wonLeads.length + lostLeads.length;
  const conversionRate = cloturees ? Math.round((wonLeads.length / cloturees) * 100) : null;
  const relancesEnRetard = filteredLeads.filter(relanceEnRetard).length;

  // La colonne des affaires perdues n'apparaît que si elle a des affaires
  const etapesAffichees = ETAPES.filter((e) => e.id !== 'Perdu' || lostLeads.length > 0);
  const peutModifier = canUser(currentUser, 'edit', 'leads');
  const peutSupprimer = canUser(currentUser, 'delete', 'leads');
  const peutCreer = canUser(currentUser, 'create', 'leads');

  const actionsProspect = (lead, compact = false) => (
    <>
      {peutModifier && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: compact ? '0.2rem 0.45rem' : '0.25rem 0.45rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          title="Modifier ce prospect"
          aria-label={`Modifier ${lead.nom_prospect}`}
          onClick={() => setProspectOuvert(lead)}
        >
          <Edit2 size={compact ? 11 : 13} />
          {compact && <span>Modifier</span>}
        </button>
      )}
      {peutSupprimer && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: compact ? '0.2rem 0.45rem' : '0.25rem 0.45rem', fontSize: '0.7rem', color: '#f87171' }}
          title="Supprimer ce prospect"
          aria-label={`Supprimer ${lead.nom_prospect}`}
          onClick={() => supprimer(lead)}
        >
          <Trash2 size={compact ? 11 : 13} />
        </button>
      )}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl">Suivi commercial</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Prospects et affaires en cours, étape par étape.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/user/clients')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            title="Clientèle : la fiche de chaque client donne sa vue 360°"
          >
            <UserCheck size={16} />
            <span>Fiches clients 360°</span>
          </button>
          {peutCreer && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setProspectOuvert('nouveau')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Plus size={16} />
              <span>Nouveau prospect</span>
            </button>
          )}
        </div>
      </div>

      {/* Indicateurs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <MetricCard
          title="Affaires en cours"
          value={enCoursLeads.length}
          subtitle={relancesEnRetard ? `${relancesEnRetard} relance(s) en retard` : `Sur ${filteredLeads.length} prospect(s)`}
          icon={<Briefcase size={22} color="#60a5fa" />}
        />
        <MetricCard
          title="Volume du pipeline"
          value={enMillions(totalPipelineVal)}
          subtitle="Primes estimées des affaires en cours"
          icon={<Banknote size={22} color="#fbbf24" />}
          color="amber"
        />
        <MetricCard
          title="Affaires gagnées"
          value={enMillions(wonVal)}
          subtitle={`${wonLeads.length} affaire(s) gagnée(s)`}
          icon={<CheckCircle size={22} color="#34d399" />}
          color="emerald"
        />
        <MetricCard
          title="Taux de transformation"
          value={conversionRate === null ? '—' : `${conversionRate} %`}
          subtitle={cloturees ? `${wonLeads.length} gagnée(s) sur ${cloturees} affaire(s) clôturée(s)` : 'Aucune affaire clôturée'}
          icon={<TrendingUp size={22} color="#818cf8" />}
          color="purple"
        />
      </div>

      {/* Filtres et affichage */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '280px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: '340px', minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="search"
              className="form-control"
              style={{ paddingLeft: '2.5rem', fontSize: '0.875rem' }}
              placeholder="Rechercher prospect, contact, commercial, référence…"
              aria-label="Rechercher un prospect"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={15} color="var(--text-muted)" />
            <select
              className="form-control"
              style={{ fontSize: '0.85rem', width: '220px' }}
              aria-label="Filtrer par branche"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
            >
              <option value="ALL">Toutes branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
            onClick={() => setViewMode('kanban')}
          >
            <Layers size={14} style={{ marginRight: '0.35rem' }} /> Kanban
          </button>
          <button
            type="button"
            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
            onClick={() => setViewMode('list')}
          >
            <Users size={14} style={{ marginRight: '0.35rem' }} /> Liste
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
          <LoadingSpinner size={36} />
        </div>
      )}

      {!loading && erreurChargement && (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: '#f87171' }}>{erreurChargement}</span>
          <button type="button" className="btn btn-secondary" onClick={loadLeads} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RotateCcw size={14} /> Réessayer
          </button>
        </div>
      )}

      {!loading && !erreurChargement && (viewMode === 'kanban' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
          {etapesAffichees.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => l.statut === stage.id);
            const stageTotal = stageLeads.reduce((acc, l) => acc + l.prime_estimee, 0);
            const ouverte = ETAPES_OUVERTES.includes(stage.id);
            const suivante = ouverte ? ETAPES[ETAPES.findIndex((s) => s.id === stage.id) + 1] : null;

            return (
              <div
                key={stage.id}
                className="glass-panel"
                style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', borderRadius: 'var(--radius-lg)', borderTop: `3px solid ${stage.color}` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{stage.label}</span>
                    <span style={{ background: stage.bg, color: stage.color, padding: '0.15rem 0.5rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
                      {stageLeads.length}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{enMillions(stageTotal)}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: '200px' }}>
                  {stageLeads.length === 0 ? (
                    <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                      Aucune affaire à cette étape
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        data-prospect={lead.id_lead}
                        style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.5rem', boxShadow: 'var(--shadow-sm)' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{lead.id_lead}</span>
                          <StatusBadge label={texte(lead.branche)} color="slate" />
                        </div>

                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{lead.nom_prospect}</div>

                        {(lead.contact || lead.telephone) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <Users size={13} />
                            <span>{[lead.contact, lead.telephone].filter(Boolean).join(' · ')}</span>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', gap: '0.5rem' }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Prime estimée</div>
                            <div style={{ fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-mono)' }}>{lead.prime_estimee.toLocaleString('fr-FR')} FCFA</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Commercial</div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{texte(lead.commercial_attribue)}</div>
                          </div>
                        </div>

                        {(lead.prochaine_action || lead.date_action) && (
                          <div style={{ fontSize: '0.75rem', background: 'var(--bg-surface-elevated)', padding: '0.45rem 0.6rem', borderRadius: '4px', display: 'flex', alignItems: 'flex-start', gap: '0.45rem', color: 'var(--text-muted)' }}>
                            <Calendar size={13} color={relanceEnRetard(lead) ? '#f87171' : '#fbbf24'} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              {lead.prochaine_action && (
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.prochaine_action}>
                                  {lead.prochaine_action}
                                </span>
                              )}
                              <Relance prospect={lead} />
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                          {suivante && peutModifier && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={enCours === lead.id}
                              style={{ flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.7rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.25rem' }}
                              title={`Passer à « ${suivante.label} »`}
                              onClick={() => changerEtape(lead, suivante.id)}
                            >
                              <span>Étape suivante</span>
                              <ChevronRight size={13} />
                            </button>
                          )}
                          {ouverte && peutModifier && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={enCours === lead.id}
                              style={{ padding: '0.25rem 0.45rem', fontSize: '0.7rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                              title="Classer l'affaire comme perdue"
                              onClick={() => {
                                if (window.confirm(`Classer l'affaire « ${lead.nom_prospect} » comme perdue ?`)) changerEtape(lead, 'Perdu');
                              }}
                            >
                              <XCircle size={12} /> Perdue
                            </button>
                          )}
                          {stage.id === 'Perdu' && peutModifier && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={enCours === lead.id}
                              style={{ flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.7rem' }}
                              title="Remettre l'affaire en négociation"
                              onClick={() => changerEtape(lead, 'Négociation')}
                            >
                              Rouvrir
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                            title="Créer un devis pour ce prospect"
                            onClick={() => navigate(routeDevis(lead.branche))}
                          >
                            Devis
                          </button>
                        </div>

                        {(peutModifier || peutSupprimer) && (
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', paddingTop: '0.35rem', borderTop: '1px dashed var(--border-subtle)' }}>
                            {actionsProspect(lead, true)}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '1rem' }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Réf. prospect</th>
                  <th>Prospect / société</th>
                  <th>Contact</th>
                  <th>Branche</th>
                  <th style={{ textAlign: 'right' }}>Prime estimée</th>
                  <th>Étape</th>
                  <th>Commercial</th>
                  <th>Prochaine relance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                      {leads.length ? 'Aucun prospect ne correspond à la recherche.' : 'Aucun prospect : créez-en un avec « Nouveau prospect ».'}
                    </td>
                  </tr>
                )}
                {filteredLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td><strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{lead.id_lead}</strong></td>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{lead.nom_prospect}</strong></td>
                    <td>
                      <div>{texte(lead.contact)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{[lead.telephone, lead.email].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td><StatusBadge label={texte(lead.branche)} color="slate" /></td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}><strong>{lead.prime_estimee.toLocaleString('fr-FR')} FCFA</strong></td>
                    <td><StatusBadge label={etapeDe(lead.statut).label} color={etapeDe(lead.statut).badge} /></td>
                    <td>{texte(lead.commercial_attribue)}</td>
                    <td style={{ fontSize: '0.8rem' }}><Relance prospect={lead} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => navigate(routeDevis(lead.branche))}
                        >
                          Devis
                        </button>
                        {actionsProspect(lead)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Création / modification d'un prospect */}
      <EditLeadModal
        isOpen={Boolean(prospectOuvert)}
        onClose={() => setProspectOuvert(null)}
        lead={prospectOuvert === 'nouveau' ? null : prospectOuvert}
        onSave={enregistrerProspect}
        commerciaux={commerciaux}
        commercialParDefaut={commercialParDefaut}
      />

    </div>
  );
};

export default CrmPipelinePage;
