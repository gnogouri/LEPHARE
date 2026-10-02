import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { customerApi } from '../../../api/endpoints';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingSpinner';
import { printFicheClient } from '../../../utils/exportUtils';
import { ArrowLeft, User, Phone, Building, Shield, FileText, CreditCard, Printer } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';

// Lignes affichées d'emblée par tableau : un gros compte (plus de 1 000 émissions de contrats)
// reste fluide, le reste s'affiche à la demande
const LIGNES_PAR_PAGE = 50;

const montant = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} FCFA`;
const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());

const COULEUR_ENCAISSEMENT = { Soldé: 'emerald', Partiel: 'amber', 'À encaisser': 'rose', 'Sans quittance': 'slate' };

const Champ = ({ libelle, valeur, mono }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
    <span className="text-muted">{libelle} :</span>
    {texte(valeur)
      ? <strong style={{ textAlign: 'right', overflowWrap: 'anywhere', fontFamily: mono ? 'var(--font-mono)' : undefined }}>{texte(valeur)}</strong>
      : <span style={{ color: 'var(--text-muted)' }}>Non renseigné</span>}
  </div>
);

const Carte = ({ icone, couleur, titre, children }) => (
  <div className="glass-panel" style={{ padding: '1.5rem' }}>
    <h3 className="title-md" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {React.createElement(icone, { size: 18, color: couleur })}
      {titre}
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.85rem' }}>{children}</div>
  </div>
);

const Indicateur = ({ libelle, valeur, detail }) => (
  <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>{libelle}</div>
    <div style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: '0.2rem' }}>{valeur}</div>
    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{detail}</div>
  </div>
);

// Tableau d'une liste du dossier, avec « Tout afficher » au-delà de LIGNES_PAR_PAGE lignes
const TableauDossier = ({ colonnes, lignes, vide }) => {
  const [toutAfficher, setToutAfficher] = useState(false);
  if (!lignes.length) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{vide}</p>;
  const affichees = toutAfficher ? lignes : lignes.slice(0, LIGNES_PAR_PAGE);
  return (
    <>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>{colonnes.map((c) => <th key={c.titre} style={c.droite ? { textAlign: 'right' } : undefined}>{c.titre}</th>)}</tr>
          </thead>
          <tbody>
            {affichees.map((l) => (
              <tr key={l.id}>
                {colonnes.map((c) => <td key={c.titre} style={c.droite ? { textAlign: 'right', whiteSpace: 'nowrap' } : undefined}>{c.rendu(l)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lignes.length > LIGNES_PAR_PAGE && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: '0.75rem' }} onClick={() => setToutAfficher((v) => !v)}>
          {toutAfficher ? `Afficher les ${LIGNES_PAR_PAGE} premières lignes` : `Tout afficher (${lignes.length.toLocaleString('fr-FR')} lignes)`}
        </button>
      )}
    </>
  );
};

/**
 * Dossier 360° d'un client (bouton « 360° » de la Clientèle) : une seule requête,
 * /api/client/:id/dossier/, qui filtre en base les devis et contrats du client.
 */
export const ClientDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [dossier, setDossier] = useState(null);
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setErreur('');
    customerApi.getDossierClient(id)
      .then((d) => { if (isMounted) setDossier(d); })
      .catch((err) => {
        console.error('Erreur chargement dossier client:', err);
        if (isMounted) setErreur(err?.response?.status === 404 ? 'Client introuvable.' : 'Impossible de charger le dossier de ce client. Veuillez réessayer.');
      })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [id]);

  const retour = (
    <button className="btn btn-secondary" onClick={() => navigate('/user/clients')} style={{ padding: '0.4rem 0.8rem' }}>
      <ArrowLeft size={16} />
      Retour
    </button>
  );

  if (loading) {
    return (
      <div style={{ padding: '5rem 1rem', display: 'flex', justifyContent: 'center' }}>
        <LoadingSpinner size={42} />
      </div>
    );
  }
  if (erreur || !dossier) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        {retour}
        <p style={{ color: '#f87171' }}>{erreur || 'Client introuvable.'}</p>
      </div>
    );
  }

  const c = dossier.client || {};
  const s = dossier.synthese || {};
  const devis = dossier.devis || [];
  const contrats = dossier.contrats || [];
  const entreprise = Boolean(c.entreprise);
  const nomComplet = [texte(c.nom), texte(c.prenoms)].filter(Boolean).join(' ') || `Client n° ${c.id}`;
  const devisEnAttente = devis.filter((d) => !d.expire);
  const policesEnVigueur = Number(s.polices_en_vigueur) || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {retour}
          <div>
            <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              {nomComplet}
              {c.vip && <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>VIP</span>}
            </h1>
            <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
              N° client {c.id}{texte(c.matricule) ? ` • Matricule ${c.matricule}` : ''} • {texte(c.categorie) || (entreprise ? 'Personne morale' : 'Personne physique')}
            </span>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => printFicheClient({ IdClient: c.id, codeclient: c.matricule })}>
          <Printer size={16} />
          <span>Imprimer la fiche</span>
        </button>
      </div>

      {/* Synthèse commerciale */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <Indicateur
          libelle="Devis en cours"
          valeur={devis.length.toLocaleString('fr-FR')}
          detail={`${devisEnAttente.length} en attente, ${devis.length - devisEnAttente.length} expiré(s)`}
        />
        <Indicateur
          libelle="Polices en vigueur"
          valeur={policesEnVigueur.toLocaleString('fr-FR')}
          detail={`sur ${(Number(s.nombre_polices) || 0).toLocaleString('fr-FR')} police(s) émise(s) • ${montant(s.primes_en_vigueur)}`}
        />
        <Indicateur
          libelle="Total des primes émises"
          valeur={montant(s.total_primes)}
          detail={s.dernier_contrat ? `Dernier contrat le ${formatDate(s.dernier_contrat)}` : 'Aucun contrat'}
        />
      </div>

      {/* Identité et coordonnées, telles qu'enregistrées */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
        <Carte icone={User} couleur="#3b82f6" titre={entreprise ? 'Identité de l\'entreprise' : 'Identité'}>
          {!entreprise && <Champ libelle="Civilité" valeur={c.civilite} />}
          <Champ libelle={entreprise ? 'RCCM / Patente' : 'Pièce d\'identité'} valeur={c.piece_identite} />
          <Champ libelle={entreprise ? 'Date de création' : 'Date de naissance'} valeur={c.date_naissance ? formatDate(c.date_naissance) : ''} />
          <Champ libelle={entreprise ? 'Siège' : 'Lieu de naissance'} valeur={c.lieu_naissance} />
          {entreprise && <Champ libelle="Interlocuteur" valeur={c.responsable} />}
        </Carte>

        <Carte icone={Phone} couleur="#60a5fa" titre="Coordonnées">
          <Champ libelle="Téléphone" valeur={c.telephone} />
          <Champ libelle="Mobile" valeur={c.mobile} />
          <Champ libelle="Fixe" valeur={c.fixe} />
          <Champ libelle="Email" valeur={c.email} />
          <Champ libelle="Adresse" valeur={[c.adresse, c.adresse_complement].map(texte).filter(Boolean).join(', ')} />
          <Champ libelle="Ville" valeur={c.ville} />
          <Champ libelle="Code postal" valeur={c.code_postal} />
        </Carte>

        <Carte icone={Building} couleur="#a855f7" titre="Activité professionnelle">
          <Champ libelle={entreprise ? 'Activité' : 'Profession'} valeur={c.profession} />
          <Champ libelle="Secteur d'activité" valeur={c.secteur_activite} />
          <Champ libelle={entreprise ? 'Fonction de l\'interlocuteur' : 'Poste occupé'} valeur={c.fonction} />
        </Carte>

        <Carte icone={CreditCard} couleur="#10b981" titre="Informations financières">
          <Champ libelle="N° compte client" valeur={c.numero_compte} mono />
          <Champ libelle="RIB" valeur={c.rib} mono />
          <Champ libelle="Exonéré de taxe" valeur={c.exonere_taxes ? 'Oui' : 'Non'} />
          <Champ libelle="Exonéré d'accessoires" valeur={c.exonere_accessoires ? 'Oui' : 'Non'} />
        </Carte>
      </div>

      {/* Contrats : une ligne par émission (affaire nouvelle, renouvellement, avenant) */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 className="title-md" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shield size={18} color="#8b5cf6" />
          Contrats ({contrats.length.toLocaleString('fr-FR')} émission{contrats.length > 1 ? 's' : ''})
        </h3>
        <TableauDossier
          lignes={contrats}
          vide="Aucun contrat pour ce client."
          colonnes={[
            { titre: 'N° police', rendu: (l) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{l.numero_police}</strong> },
            { titre: 'Mouvement', rendu: (l) => l.avenant || '—' },
            { titre: 'Branche', rendu: (l) => `${l.branche || '—'}${l.flotte ? ' (flotte)' : ''}` },
            { titre: 'Compagnie', rendu: (l) => l.compagnie || '—' },
            { titre: 'Émis le', rendu: (l) => formatDate(l.date_emission) },
            { titre: 'Période', rendu: (l) => `${formatDate(l.date_effet)} au ${formatDate(l.date_expiration)}` },
            { titre: 'Prime TTC', droite: true, rendu: (l) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{montant(l.prime_ttc)}</strong> },
            {
              titre: 'Encaissement',
              rendu: (l) => (
                <span title={l.numero_quittance ? `Quittance ${l.numero_quittance} : ${montant(l.encaissement?.montant)} encaissés` : undefined}>
                  <StatusBadge label={l.encaissement?.statut || '—'} color={COULEUR_ENCAISSEMENT[l.encaissement?.statut]} />
                </span>
              ),
            },
            { titre: 'Statut', rendu: (l) => <StatusBadge label={l.en_vigueur ? 'En vigueur' : 'Expiré'} color={l.en_vigueur ? 'emerald' : 'slate'} /> },
          ]}
        />
      </div>

      {/* Devis en cours : ni confirmés ni archivés */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 className="title-md" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileText size={18} color="#0ea5e9" />
          Devis en cours ({devis.length.toLocaleString('fr-FR')})
        </h3>
        <TableauDossier
          lignes={devis}
          vide="Aucun devis en cours pour ce client."
          colonnes={[
            { titre: 'N° devis', rendu: (l) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{l.numero}</strong> },
            { titre: 'Branche', rendu: (l) => `${l.branche || '—'}${l.flotte ? ' (flotte)' : ''}` },
            { titre: 'Compagnie', rendu: (l) => l.compagnie || '—' },
            { titre: 'Émis le', rendu: (l) => formatDate(l.date_emission) },
            { titre: 'Période', rendu: (l) => `${formatDate(l.date_effet)} au ${formatDate(l.date_expiration)}` },
            { titre: 'Prime TTC', droite: true, rendu: (l) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{montant(l.prime_ttc)}</strong> },
            { titre: 'Statut', rendu: (l) => <StatusBadge label={l.expire ? 'Expiré' : 'En attente'} color={l.expire ? 'slate' : 'amber'} /> },
          ]}
        />
      </div>
    </div>
  );
};

export default ClientDetailPage;
