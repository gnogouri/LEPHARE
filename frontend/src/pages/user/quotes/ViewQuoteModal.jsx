import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/common/Modal';
import { StatusBadge } from '../../../components/common/StatusBadge';
import {
  printQuoteFacture,
  printConditionsParticulieres,
  printAnnexeIa,
  estDevisIaImprimable,
  printAnnexeFlotte,
  estDevisFlotteAuto,
  estDevisVoyage,
  printBordereauTransport,
} from '../../../utils/exportUtils';
import { formatDate } from '../../../utils/dateUtils';
import { cedeaoDansPrimeNette } from '../../../utils/tarificationAuto';
import { ImpositionRecapFlotte } from './ImpositionRecapFlotte';
import { iaApi, santeApi, voyageApi, transportApi, mrhApi } from '../../../api/endpoints';
import {
  FileText,
  Printer,
  CheckCircle,
  Building2,
  Calendar,
  User,
  Shield,
  Car,
  Home,
  HeartPulse,
  Plane,
  Ship,
  Package,
  MapPin,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Users,
  UserPlus,
  Pencil,
} from 'lucide-react';

const fcfa = (montant) => `${Number(montant || 0).toLocaleString('fr-FR')} FCFA`;

// Champ des blocs Références et Décompte : libellé au-dessus de la valeur, sur la grille commune
// .fiche-devis-grille (index.css). Couleur en style en ligne pour garder la recoloration du mode clair.
const Champ = ({ libelle, couleur, libelleColore = false, className, children }) => (
  <div className={className}>
    <div className="fiche-devis-champ-libelle" style={libelleColore ? { color: couleur } : undefined}>{libelle}</div>
    <div className="fiche-devis-champ-valeur" style={couleur ? { color: couleur } : undefined}>{children}</div>
  </div>
);

export const ViewQuoteModal = ({ isOpen, onClose, quote: quoteInitial, onConvertToContract, onQuoteUpdated }) => {
  // Devis relu après une imposition des primes du récapitulatif, et formulaire d'imposition
  // affiché à la place de la fiche (comme le panneau d'URANUS)
  const [quoteAJour, setQuoteAJour] = useState(null);
  const [imposition, setImposition] = useState(false);
  useEffect(() => {
    setQuoteAJour(null);
    setImposition(false);
  }, [quoteInitial?.iddevis, isOpen]);

  // Détail lu en base : assurés d'un devis IA (assureiainfo), saisie d'un devis Santé (couvertures,
  // adhérents, affiliés), voyage d'un devis Voyage (destination, voyageur, garanties enregistrées)
  const [detailBranche, setDetailBranche] = useState(null);
  const idDevisBase = Number(quoteInitial?.iddevis || quoteInitial?.raw?.iddevis) || 0;
  const brancheDevis = quoteInitial?.branche;
  useEffect(() => {
    let actif = true;
    setDetailBranche(null);
    if (!isOpen || !idDevisBase) return undefined;
    const chargement = brancheDevis === 'IA'
      ? iaApi.getAssuresDevis(idDevisBase).then((assures) => ({ assures: assures || [] }))
      : brancheDevis === 'Santé' ? santeApi.lireDevis(idDevisBase)
        : brancheDevis === 'Voyage' ? voyageApi.lireDevis(idDevisBase)
          : brancheDevis === 'Transport' ? transportApi.getCertificats({ iddevis: idDevisBase })
            : brancheDevis === 'MRH' ? mrhApi.getMaisons(idDevisBase) : null;
    if (!chargement) return undefined;
    chargement
      .then((d) => { if (actif) setDetailBranche(d); })
      .catch(() => { if (actif) setDetailBranche({ erreur: true }); });
    return () => { actif = false; };
  }, [isOpen, idDevisBase, brancheDevis]);

  const quote = quoteAJour || quoteInitial;
  if (!isOpen || !quote) return null;

  const flotteAuto = estDevisFlotteAuto(quote);
  const imposable = flotteAuto && !quote.confirme && !quote.raw?.confirme && !quote.devis_consolide;

  if (imposition) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Imposer les primes du récapitulatif de la flotte" size="medium">
        <ImpositionRecapFlotte
          quote={quote}
          onAnnuler={() => setImposition(false)}
          onEnregistre={(devisAJour) => {
            setQuoteAJour(devisAJour);
            setImposition(false);
            if (onQuoteUpdated) onQuoteUpdated(devisAJour);
          }}
        />
      </Modal>
    );
  }

  const isConsolidated = quote.statut === 'Consolidé';
  const details = quote.details || {};
  const raw = quote.raw || {};
  // Prime nette affichée hors FGA (qui a sa case), CEDEAO comprise (garantie du devis, sans case à
  // part), comme sur les CP : prime nette + accessoire + taxes + FGA = prime TTC. stddevis.primenette
  // comprend le FGA, et la CEDEAO sauf pour un devis à primes imposées. Copie locale d'un devis Auto :
  // sa prime nette est hors CEDEAO, qui lui est donc ajoutée.
  const primeNetteAffichee = raw.primenette != null
    ? Number(raw.primenette) - Number(raw.fga || 0) + (cedeaoDansPrimeNette({
      ...raw,
      primeImposee: Boolean(raw.prime_imposee),
      arrondiNsia: Number(raw.compagnie?.IdCompagnie ?? raw.compagnie) === 1,
    }) ? 0 : Number(raw.cedeao || 0))
    : Number(quote.prime_nette || 0) + Number(quote.cedeao || 0);
  const telephone = details.telephoneClient || raw.numerotelephoneassure || raw.telephoneclient || '—';
  const numeroActe = raw.numeroavenant || details.numeroAvenant || '0000001';

  const getBranchIcon = (branche) => {
    const b = String(branche || '').toLowerCase();
    if (b.includes('auto')) return <Car size={20} color="#3b82f6" />;
    if (b.includes('mrh') || b.includes('habit')) return <Home size={20} color="#0ea5e9" />;
    if (b.includes('sant')) return <HeartPulse size={20} color="#f43f5e" />;
    if (b.includes('voyag')) return <Plane size={20} color="#38bdf8" />;
    if (b.includes('transp')) return <Ship size={20} color="#0284c7" />;
    if (b === 'ia') return <UserPlus size={20} color="#a855f7" />;
    return <Shield size={20} color="#8b5cf6" />;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Fiche Devis"
      size="large"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Header Ribbon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            background: 'var(--surface-sunken)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {getBranchIcon(quote.branche)}
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {quote.numerodevis}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Branche : <strong>{quote.branche || 'Général'}</strong> • Émis le {formatDate(quote.date_emission)}
                {(quote.date_derniere_modification || quote.DateMaj || quote.date_maj) && (
                  <span style={{ marginLeft: '0.5rem', color: '#93c5fd' }}>
                    • Modifié le : <strong>{quote.date_derniere_modification || quote.DateMaj || quote.date_maj}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <StatusBadge label={quote.statut} color={quote.statut_badge} />
            {quote.date_expiration && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  background: new Date(quote.date_expiration) < new Date() ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.15)',
                  color: new Date(quote.date_expiration) < new Date() ? '#fca5a5' : '#34d399',
                  border: `1px solid ${new Date(quote.date_expiration) < new Date() ? '#ef4444' : '#10b981'}`,
                  fontWeight: 600,
                }}
              >
                {new Date(quote.date_expiration) < new Date()
                  ? `Expiré le ${formatDate(quote.date_expiration)}`
                  : `Valide jusqu'au ${formatDate(quote.date_expiration)}`}
              </span>
            )}
            {isConsolidated && quote.police_associee && (
              <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                Contrat lié : {quote.police_associee}
              </span>
            )}
          </div>
        </div>

        {/* Alerte si dérogation en attente (CA-07.4) */}
        {quote.circuit_approbation && quote.circuit_approbation.statut_validation === 'EN_ATTENTE_DIRECTION' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid #a855f7',
              color: '#d8b4fe',
              fontSize: '0.85rem',
            }}
          >
            <ShieldAlert size={18} color="#c084fc" />
            <div>
              <strong>Dérogation tarifaire en attente de visa (CA-07.4) :</strong> Remise de {quote.taux_remise || 0}% accordée. Motif : <em>"{quote.motif_derogation || quote.circuit_approbation.motif}"</em>.
            </div>
          </div>
        )}

        {/* Client, Intermédiaire & Partner Details */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <div className="glass-panel" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <User size={14} color="#60a5fa" />
              Souscripteur / Assuré
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
              {quote.client_nom}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <MapPin size={13} color="#94a3b8" />
              <span>{quote.adresse || quote.details?.adresse || 'Abidjan, Côte d\'Ivoire'}</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Téléphone : <strong style={{ color: 'var(--text-secondary)' }}>{telephone}</strong>
            </div>
            {quote.client_id && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                ID Client : CLI-{String(quote.client_id).padStart(3, '0')}
              </div>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Building2 size={14} color="#34d399" />
              Compagnie Porteuse & Intermédiaire
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
              {quote.compagnie}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#60a5fa', marginTop: '0.35rem' }}>
              Intermédiaire : <strong>{quote.intermediaire || 'OREOLE ASSURANCES'}</strong>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Produit : {quote.produit}
            </div>
          </div>
        </div>

        {/* Références de la police / du devis, comme sur la facture proforma */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FileText size={15} color="#60a5fa" />
            Références
          </div>
          <div className="fiche-devis-grille">
            <Champ libelle="Id. Devis">{quote.iddevis || '—'}</Champ>
            <Champ libelle="N° Devis">{quote.numerodevis || '—'}</Champ>
            <Champ libelle="Effet">{formatDate(quote.date_effet)}</Champ>
            <Champ libelle="N° Acte">{numeroActe}</Champ>
            <Champ libelle="Effet Acte">{formatDate(quote.date_effet)}</Champ>
            <Champ libelle="Expiration">{formatDate(quote.date_expiration)}</Champ>
          </div>
        </div>

        {/* Actuarial Financial Breakdown */}
        <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Décompte Actuariel CIMA & Quittance
              {quote.raw?.prime_imposee && <StatusBadge label="Primes imposées" color="amber" />}
            </div>
            {imposable && (
              <button
                type="button"
                className="btn btn-secondary no-print"
                onClick={() => setImposition(true)}
                title="Corriger le récapitulatif des primes de la flotte (prime nette, accessoire, taxes, FGA, CEDEAO, TTC)"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                <Pencil size={14} />
                <span>Imposer les primes du récapitulatif</span>
              </button>
            )}
          </div>

          <div className="fiche-devis-grille">
            <Champ libelle="Prime Nette" couleur="#60a5fa">{fcfa(primeNetteAffichee)}</Champ>
            <Champ libelle="Accessoire">{fcfa(quote.accessoires)}</Champ>
            <Champ libelle="Taxes">{fcfa(quote.taxes)}</Champ>
            <Champ libelle="FDG">{fcfa(quote.fga)}</Champ>
            <Champ libelle="Prime TTC" couleur="#34d399" libelleColore className="fiche-devis-ttc">{fcfa(quote.prime_totale)}</Champ>
          </div>

          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', borderTop: '1px dashed var(--border-subtle)', paddingTop: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Commission Apporteur :</span>{' '}
            <strong style={{ color: '#38bdf8' }}>{Number(quote.commission || 0).toLocaleString('fr-FR')} FCFA</strong>
          </div>
        </div>

        {/* Branch Specific Technical Details (IA, Santé, Voyage et Transport : détail lu en base) */}
        {(Object.keys(details).length > 0 || ['IA', 'Santé', 'Voyage', 'Transport', 'MRH'].includes(quote.branche)) && (
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
              Détails & Paramètres Techniques ({quote.branche})
            </div>

            {/* Automobile Details */}
            {quote.branche === 'Auto' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div><strong>Immatriculation :</strong> {details.immatriculation || 'Non renseignée'}</div>
                <div><strong>Genre / Usage :</strong> {details.genre || 'Véhicule Particulier'}</div>
                <div><strong>Marque & Modèle :</strong> {details.marque} {details.modele}</div>
                <div><strong>Puissance Fiscale :</strong> {details.puissanceFiscale} CV ({details.energie})</div>
                <div><strong>Valeur Vénale :</strong> {Number(details.valeurVenale || 0).toLocaleString('fr-FR')} FCFA</div>
                <div><strong>Durée de contrat :</strong> {details.dureeMois || 12} Mois</div>
                {details.guarantees && (
                  <div style={{ gridColumn: 'span 2', marginTop: '0.5rem' }}>
                    <strong style={{ display: 'block', marginBottom: '0.35rem' }}>Garanties souscrites :</strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {Object.entries(details.guarantees)
                        .filter(([_, active]) => active)
                        .map(([key]) => (
                          <span key={key} style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontSize: '0.75rem' }}>
                            {key.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MRH : maisons enregistrées (usage, capitaux, options, garanties) */}
            {quote.branche === 'MRH' && (
              !detailBranche ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement des maisons…</div>
              ) : detailBranche.erreur ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Détail MRH indisponible pour ce devis.</div>
              ) : !(detailBranche.maisons || []).length ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aucune maison enregistrée pour ce devis.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                  {detailBranche.maisons.map((m, idx) => {
                    const p = m.parametres || {};
                    const capitaux = [
                      ['Bâtiment', p.valeur_batiment], ['Contenu', p.valeur_contenu], ['Loyer mensuel', p.loyer_mensuel], ['Capital RVT', p.capital_rvt],
                    ].filter(([, v]) => Number(v) > 0);
                    return (
                      <div key={m.maison_id || idx} style={{ padding: '0.65rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-elevated)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong>Maison {idx + 1} — {m.usage_libelle || m.code_usage || 'usage non renseigné'}{m.adresse ? ` — ${m.adresse}` : ''}</strong>
                          <span style={{ fontWeight: 700 }}>{fcfa(m.prime_nette)}{m.prime_imposee ? ' (imposée)' : ''}</span>
                        </div>
                        {capitaux.length > 0 && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                            {capitaux.map(([l, v]) => `${l} : ${fcfa(v)}`).join(' • ')}
                          </div>
                        )}
                        {(m.garanties || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
                            {m.garanties.map((g) => (
                              <span key={g.code_sous_garantie || g.id_sous_garantie} style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '0.72rem', color: g.optionnelle ? 'var(--accent-purple)' : 'var(--text-secondary)' }}>
                                {g.libelle_sous_garantie || g.code_sous_garantie} {fcfa(g.prime_nette)}
                              </span>
                            ))}
                          </div>
                        )}
                        {(m.options || []).length > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.3rem' }}>Options : {m.options.join(', ').replace(/_/g, ' ')}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* Santé : saisie enregistrée (couvertures, adhérents, affiliés) */}
            {quote.branche === 'Santé' && (
              !detailBranche ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement de la saisie Santé…</div>
              ) : detailBranche.erreur ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Détail Santé indisponible pour ce devis.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem 1rem' }}>
                    <div><strong>Offre commerciale :</strong> {detailBranche.detail?.libelle_tarif || detailBranche.filiales?.[0]?.libelle_offre || '—'}</div>
                    <div><strong>Formule de couverture :</strong> {detailBranche.detail?.libelle_offre || '—'}</div>
                    <div><strong>Type de contrat :</strong> {detailBranche.detail?.libelle_type_contrat || '—'}</div>
                    <div><strong>Gestionnaire :</strong> {detailBranche.detail?.gestionnairesante || '—'}</div>
                    <div><strong>Adhérents :</strong> {detailBranche.adherents?.length || 0} • <strong>Affiliés :</strong> {detailBranche.affilies?.length || 0}</div>
                  </div>
                  {(detailBranche.filiales || []).map((f) => (
                    <div key={f.idfiliale} style={{ padding: '0.5rem 0.6rem', borderRadius: '6px', background: 'var(--bg-surface-elevated)' }}>
                      <strong>{f.libellecollege}</strong> : {f.libelle_offre} • {f.libellezone}
                    </div>
                  ))}
                  {(detailBranche.affilies || []).length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                        <thead>
                          <tr><th style={{ textAlign: 'left' }}>Nom et prénoms</th><th style={{ textAlign: 'left' }}>Lien</th><th style={{ textAlign: 'left' }}>Né(e) le</th></tr>
                        </thead>
                        <tbody>
                          {detailBranche.affilies.map((a) => (
                            <tr key={a.idaffilie}><td>{a.nom} {a.prenom}</td><td>{a.libellelien || a.lien}</td><td>{formatDate(a.datenaissance)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!(detailBranche.adherents || []).length && (
                    <div style={{ color: 'var(--text-muted)' }}>Aucun adhérent en base pour ce devis (devis repris d'URANUS sans saisie détaillée).</div>
                  )}
                </div>
              )
            )}

            {/* IA : assurés du devis (une ligne de devis par assuré) */}
            {quote.branche === 'IA' && (
              !detailBranche ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement des assurés…</div>
              ) : !(detailBranche.assures || []).length ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aucun assuré en base pour ce devis (devis repris d'URANUS sans détail).</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Assuré</th>
                        <th style={{ textAlign: 'left' }}>Né(e) le</th>
                        <th style={{ textAlign: 'left' }}>Profession</th>
                        <th style={{ textAlign: 'right' }}>Décès</th>
                        <th style={{ textAlign: 'right' }}>Infirmité</th>
                        <th style={{ textAlign: 'right' }}>Frais trait.</th>
                        <th style={{ textAlign: 'right' }}>Prime nette</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailBranche.assures.map((a) => (
                        <tr key={a.id_devis_detail}>
                          <td>{a.nom} {a.prenoms}</td>
                          <td>{formatDate(a.date_naissance)}</td>
                          <td>{a.libelle_profession || '—'}</td>
                          <td style={{ textAlign: 'right' }}>{Number(a.capital_deces || 0).toLocaleString('fr-FR')}</td>
                          <td style={{ textAlign: 'right' }}>{Number(a.capital_infirmite || 0).toLocaleString('fr-FR')}</td>
                          <td style={{ textAlign: 'right' }}>{Number(a.capital_frais_traitement || 0).toLocaleString('fr-FR')}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{Math.round(Number(a.prime_nette || 0)).toLocaleString('fr-FR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Voyage : saisie enregistrée (destination, voyageur, garanties) */}
            {quote.branche === 'Voyage' && (
              !detailBranche ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement du voyage…</div>
              ) : detailBranche.erreur ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Détail Voyage indisponible pour ce devis.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem 1rem' }}>
                    <div><strong>Formule :</strong> {detailBranche.Detail?.LibelleTarif || '—'}</div>
                    <div><strong>Offre :</strong> {detailBranche.Detail?.IdOffre ? detailBranche.Detail.LibelleOffre : '—'}</div>
                    <div><strong>Destination :</strong> {detailBranche.Complement?.LibellePaysDestination || '—'}{detailBranche.LibelleZone ? ` (${detailBranche.LibelleZone})` : ''}</div>
                    <div><strong>Schengen :</strong> {detailBranche.Complement ? (detailBranche.Complement.Schengen ? 'Oui' : 'Non') : '—'}</div>
                    <div>
                      <strong>Période :</strong> du {formatDate(detailBranche.DateEffet)} au {formatDate(detailBranche.DateExpiration)}
                      {detailBranche.DateEffet && detailBranche.DateExpiration
                        ? ` (${Math.round((new Date(detailBranche.DateExpiration) - new Date(detailBranche.DateEffet)) / 86400000)} jours)` : ''}
                    </div>
                    <div><strong>Voyageur né(e) le :</strong> {formatDate(detailBranche.Detail?.DateNaissance)}</div>
                    <div><strong>Nationalité :</strong> {detailBranche.Complement?.Nationalite || '—'}</div>
                    <div><strong>Passeport :</strong> {detailBranche.Complement?.NumeroPasseport || '—'}</div>
                    <div><strong>N° attestation :</strong> {detailBranche.Complement?.NumeroAttestation || '—'}</div>
                    <div><strong>Référence contrat :</strong> {detailBranche.Complement?.ReferenceContrat || '—'}</div>
                    <div><strong>N° police compagnie :</strong> {detailBranche.NumeroPoliceCompagnie || '—'}</div>
                    {Number(detailBranche.Detail?.TauxReduction) > 0 && <div><strong>Réduction :</strong> {detailBranche.Detail.TauxReduction} %</div>}
                  </div>
                  {(detailBranche.Garanties || []).length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>Garantie</th>
                            <th style={{ textAlign: 'right' }}>Capital</th>
                            <th style={{ textAlign: 'right' }}>Franchise</th>
                            <th style={{ textAlign: 'right' }}>Prime annuelle</th>
                            <th style={{ textAlign: 'right' }}>Prime nette</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailBranche.Garanties.map((g) => (
                            <tr key={g.IdSousGarantie}>
                              <td>{g.LibelleSousGarantie}</td>
                              <td style={{ textAlign: 'right' }}>{g.Capital ? Math.round(g.Capital).toLocaleString('fr-FR') : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{g.Franchise ? Math.round(g.Franchise).toLocaleString('fr-FR') : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{Math.round(g.PrimeAnnuelle || 0).toLocaleString('fr-FR')}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{Math.round(g.PrimeNette || 0).toLocaleString('fr-FR')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)' }}>Aucune garantie en base pour ce devis (devis repris d'URANUS sans détail).</div>
                  )}
                  {detailBranche.Detail && !detailBranche.Complement && (
                    <div style={{ color: 'var(--text-muted)' }}>Devis repris d'URANUS : destination, nationalité et passeport non enregistrés.</div>
                  )}
                </div>
              )
            )}

            {/* Transport : certificats GUCE du bordereau rattachés au devis (une ligne de devis par certificat) */}
            {quote.branche === 'Transport' && (
              !detailBranche ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chargement des certificats…</div>
              ) : detailBranche.erreur || !(detailBranche.Certificats || []).length ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Aucun certificat GUCE rattaché à ce devis (devis repris d'URANUS ou saisi hors GUCE).</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>
                      Bordereau GUCE du <strong>{formatDate(detailBranche.DebutPeriode)}</strong> au <strong>{formatDate(detailBranche.FinPeriode)}</strong> :
                      {' '}{detailBranche.Totaux.Certificats} certificats, valeur assurée {Math.round(detailBranche.Totaux.ValeurAssurance).toLocaleString('fr-FR')} FCFA
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={() => printBordereauTransport({ iddevis: idDevisBase })} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>
                      <Printer size={14} /> Bordereau
                    </button>
                  </div>
                  <div style={{ overflow: 'auto', maxHeight: '300px' }}>
                    <table className="table" style={{ width: '100%', fontSize: '0.78rem' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>N° requête</th>
                          <th style={{ textAlign: 'left' }}>Certificat</th>
                          <th style={{ textAlign: 'left' }}>Assuré</th>
                          <th style={{ textAlign: 'left' }}>Transport / voyage</th>
                          <th style={{ textAlign: 'right' }}>Valeur</th>
                          <th style={{ textAlign: 'right' }}>Prime totale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailBranche.Certificats.map((c) => (
                          <tr key={c.NumeroRequete}>
                            <td>{c.NumeroRequete}</td>
                            <td>{c.ReferenceCertificat} <span style={{ color: 'var(--text-muted)' }}>({formatDate(c.DateCertificat)})</span></td>
                            <td>{c.Assure}</td>
                            <td>{c.MoyenTransport} <span style={{ color: 'var(--text-muted)' }}>{c.Voyage}</span></td>
                            <td style={{ textAlign: 'right' }}>{Math.round(c.ValeurAssurance).toLocaleString('fr-FR')}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{Math.round(c.PrimeTtc).toLocaleString('fr-FR')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    Prime totale des certificats {Math.round(detailBranche.Totaux.PrimeTtc).toLocaleString('fr-FR')} FCFA, diminuée de la part AFS-CI
                    ({Math.round(detailBranche.Totaux.AccessoireClient).toLocaleString('fr-FR')} FCFA) : total général {Math.round(detailBranche.Totaux.TotalGeneral).toLocaleString('fr-FR')} FCFA.
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Document preview scope mirrors the official proforma and CP templates. */}
        <div className="glass-panel" style={{ padding: '1rem', border: '1px solid rgba(96, 165, 250, 0.25)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#93c5fd', marginBottom: '0.6rem', textTransform: 'uppercase' }}>
            Documents du devis
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <div>
              <strong style={{ color: '#fff' }}>Facture proforma</strong>
              <div>Souscripteur, assuré, période, référence, détail prime nette, accessoires, taxes, FGA/CEDEAO et total TTC.</div>
            </div>
            <div>
              <strong style={{ color: '#fff' }}>Conditions particulières</strong>
              <div>Risque assuré, caractéristiques techniques, garanties, plafonds, franchises, réductions, prime comptant et signatures.</div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <button className="btn btn-secondary" onClick={onClose}>
            Fermer
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => printQuoteFacture(quote)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Printer size={15} />
              <span>Imprimer Facture Proforma</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => printConditionsParticulieres(quote)}
              title={estDevisVoyage(quote)
                ? "Proposition d'assurance Voyage (souscripteur, assuré, période, garanties, primes) — enregistrable en PDF"
                : 'Conditions Particulières (références client / quittance, garanties, récapitulatif) — enregistrable en PDF'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <FileText size={15} />
              <span>{estDevisVoyage(quote) ? 'Imprimer Proposition' : 'Imprimer Conditions Particulières'}</span>
            </button>

            {estDevisIaImprimable(quote) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => printAnnexeIa(quote)}
                title="Annexe : liste des assurés du devis avec leurs capitaux et ayants droit — enregistrable en PDF"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Users size={15} />
                <span>Imprimer Annexe</span>
              </button>
            )}

            {flotteAuto && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => printAnnexeFlotte(quote)}
                title="Annexe : liste des véhicules de la flotte avec leurs primes par garantie et le décompte de prime — enregistrable en PDF"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Car size={15} />
                <span>Imprimer Annexe</span>
              </button>
            )}

            {!isConsolidated && onConvertToContract && (
              (() => {
                const todayStr = new Date().toISOString().split('T')[0];
                const isExpired = quote.date_expiration ? new Date(quote.date_expiration) < new Date(todayStr) : false;
                const isPendingApproval = quote.circuit_approbation && quote.circuit_approbation.statut_validation === 'EN_ATTENTE_DIRECTION';

                return (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isExpired || isPendingApproval}
                    onClick={() => {
                      onClose();
                      onConvertToContract(quote);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      backgroundColor: (isExpired || isPendingApproval) ? '#475569' : '#059669',
                      cursor: (isExpired || isPendingApproval) ? 'not-allowed' : 'pointer',
                    }}
                    title={
                      isExpired
                        ? 'Devis expiré : conversion bloquée (CA-07.3)'
                        : isPendingApproval
                        ? 'En attente d\'approbation de la dérogation (CA-07.4)'
                        : 'Transformer en police d\'assurance (E08)'
                    }
                  >
                    <CheckCircle size={15} />
                    <span>
                      {isExpired
                        ? 'Devis Expiré (Non transformable)'
                        : isPendingApproval
                        ? 'Visa Direction Requis'
                        : 'Transformer en Police CIMA'}
                    </span>
                  </button>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ViewQuoteModal;
