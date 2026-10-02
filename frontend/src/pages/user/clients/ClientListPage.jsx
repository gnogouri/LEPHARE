import React, { useState, useEffect } from 'react';
import { DataTable } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Modal } from '../../../components/common/Modal';
import { EditClientModal } from './EditClientModal';
import { dataStore } from '../../../api/dataStore';
import { customerApi, configRefApi, secteurActiviteApi, professionApi, sanitizeClientForApi } from '../../../api/endpoints';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { canUser } from '../../../utils/rbac';
import { Users, Plus, Phone, Mail, MapPin, Building, User, Eye, Edit2, Archive, Printer, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { exportToPdf, printFicheClient } from '../../../utils/exportUtils';
import { useNavigate } from 'react-router-dom';
import { trierParLibelle } from '../../../utils/sortUtils';

// Champs jamais modifiés depuis la fenêtre de modification : identifiants attribués et soldes
const CHAMPS_CLIENT_NON_MODIFIABLES = ['Matricule', 'numero_assure', 'cle_unique', 'Solde', 'Avoir', 'CreeCie', 'IdCategorie', 'IdProfil'];

export const ClientListPage = () => {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [archivingClient, setArchivingClient] = useState(null);
  const { success, error: toastError, info } = useToast();
  const navigate = useNavigate();

  const handleConfirmArchive = async () => {
    if (!archivingClient) return;
    try {
      // 1. Mise à jour statut archivé dataStore
      dataStore.archiveClient(archivingClient.id);

      // 2. Synchronisation API backend si connecté
      try {
        const id = archivingClient.IdClient || archivingClient.id;
        if (id) {
          await customerApi.updateClient(id, {
            ...archivingClient,
            Statut: 'A',
          });
        }
      } catch (err) {
        console.warn('Sync API archive client:', err);
      }

      // 3. Mise à jour dynamique de la liste
      setClients((prev) =>
        prev.map((c) =>
          (String(c.id) === String(archivingClient.id) || String(c.IdClient) === String(archivingClient.IdClient))
            ? { ...c, Statut: 'A', statut: 'Archivé', statut_badge: 'slate' }
            : c
        )
      );

      success(`Fiche client « ${archivingClient.nomcomplet} » archivée avec succès (conservation CIMA).`);
      setArchivingClient(null);
    } catch (err) {
      toastError(err?.message || "Erreur lors de l'archivage du client.");
    }
  };

  // Modal d'ajout rapide d'une profession (stdprofession)
  const [isAddProfessionOpen, setIsAddProfessionOpen] = useState(false);
  const [newProfessionLibelle, setNewProfessionLibelle] = useState('');
  const [newProfessionCode, setNewProfessionCode] = useState('');
  const [isSavingProfession, setIsSavingProfession] = useState(false);

  const handleAddProfession = async (e) => {
    e.preventDefault();
    if (!newProfessionLibelle.trim()) return;
    setIsSavingProfession(true);
    try {
      const payload = { Libelle: newProfessionLibelle.trim() };
      if (newProfessionCode.trim()) {
        payload.CodeProfession = newProfessionCode.trim().toUpperCase();
      }
      const res = await professionApi.create(payload);
      const created = res.data;
      setRefData((prev) => ({
        ...prev,
        professions: [...prev.professions, created].sort((a, b) => (a.Libelle || '').localeCompare(b.Libelle || '')),
      }));
      setFormData((prev) => ({
        ...prev,
        IdProfession: created.IdProfession,
        profession: created.Libelle,
      }));
      setIsAddProfessionOpen(false);
      setNewProfessionLibelle('');
      setNewProfessionCode('');
      success(`Profession « ${created.Libelle} » créée et sélectionnée.`);
    } catch (err) {
      toastError(err?.response?.data?.error || err?.response?.data?.Libelle?.[0] || 'Erreur lors de la création de la profession.');
    } finally {
      setIsSavingProfession(false);
    }
  };

  // Modal d'ajout rapide d'un secteur d'activité économique
  const [isAddSecteurOpen, setIsAddSecteurOpen] = useState(false);
  const [newSecteurLibelle, setNewSecteurLibelle] = useState('');
  const [isSavingSecteur, setIsSavingSecteur] = useState(false);

  const handleAddSecteur = async (e) => {
    e.preventDefault();
    if (!newSecteurLibelle.trim()) return;
    setIsSavingSecteur(true);
    try {
      const res = await secteurActiviteApi.create({ Libelle: newSecteurLibelle.trim().toUpperCase() });
      const created = res.data;
      setRefData((prev) => ({
        ...prev,
        secteurs: [...prev.secteurs, created],
      }));
      setFormData((prev) => ({ ...prev, IdSecteurActivite: created.IdSecteurActivite }));
      setIsAddSecteurOpen(false);
      setNewSecteurLibelle('');
      success(`Secteur d'activité « ${created.Libelle} » créé et sélectionné.`);
    } catch (err) {
      toastError(err?.response?.data?.error || 'Erreur lors de la création du secteur.');
    } finally {
      setIsSavingSecteur(false);
    }
  };

  const loadClients = async () => {
    setLoading(true);
    try {
      const data = await customerApi.getClients();
      if (Array.isArray(data)) {
        setClients(data);
      }
    } catch (err) {
      console.error('Erreur chargement clients Django:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintClients = () => {
    if (!clients || clients.length === 0) {
      toastError('Aucun client à imprimer.');
      return;
    }

    const today = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const headers = [
      'Client / Raison Sociale',
      'Type',
      'Téléphone',
      'Email / Ville',
      'Profession',
      'Total Primes',
    ];

    const rows = clients.map((c) => {
      const civiliteTag = c.civilite && c.typeclient !== 'Entreprise' ? `[${c.civilite}] ` : '';
      const fullName = `${civiliteTag}${c.nomcomplet || c.Nom || 'Client sans nom'}`;
      const contact = c.mobile || c.telephone || 'Non renseigné';
      const emailVille = [c.email, c.ville].filter(Boolean).join(' • ') || (c.ville || 'Abidjan');
      const profession = c.profession || c.libelleprofession || (c.typeclient === 'Entreprise' ? 'Entreprise / Société' : 'Particulier');

      return [
        fullName,
        c.typeclient || 'Particulier',
        contact,
        emailVille,
        profession,
        c.total_primes || '0 FCFA',
      ];
    });

    exportToPdf({
      filename: `Repertoire_Clients_LE_PHARE_${new Date().toISOString().slice(0, 10)}.pdf`,
      title: 'Répertoire de la base clientèle',
      enTete: false,
      piedDePage: false,
      metadata: {
        'Date d\'édition': today,
        'Édité par': user?.nom ? `${user.nom} (${user.email || ''})` : (user?.email || 'Gestionnaire'),
        'Nombre total de fiches': `${clients.length} clients enregistrés`,
        'Base de données': 'LE PHARE Assurances',
      },
      headers,
      rows,
    });
  };

  useEffect(() => {
    loadClients();
  }, []);

  // Référentiels de configuration chargés depuis l'API
  const [refData, setRefData] = useState({
    qualites: [],
    villes: [],
    professions: [],
    secteurs: [],
  });

  const [modalTab, setModalTab] = useState('identite');
  const modalTabOrder = ['identite', 'coordonnees', 'professionnel', 'banque'];
  // Client venant d'être créé : bascule le modal sur l'écran de confirmation + impression
  const [createdClient, setCreatedClient] = useState(null);

  // Form State Exhaustif (41 champs réels de stdclient)
  const initialFormState = {
    // 1. Identité
    typeclient: 'Particulier',
    Particulier: 'V',
    IdQualite: 1,
    nom: '',
    prenom: '',
    CniPat: '',
    DateNaissance: '',
    LieuNaissance: '',

    // 2. Coordonnées
    telephone: '',
    mobile: '',
    fixe: '',
    fax: '',
    email: '',
    adresse: '',
    Adresse2: '',
    IdVille: 1,
    ville: 'Abidjan',
    CodePostal: '',

    // 3. Domaine d'activité
    Responsable: '',
    Fonction: '',
    IdProfession: 1,
    profession: '',
    IdSecteurActivite: '',

    // Classification : types souscripteur / assuré (1 = personne physique, 2 = personne morale)
    // déduits du type de personne choisi à l'étape 1 ; VIP, statut et reconquête par défaut
    idtypeclient: 1,
    idtypeassure: 1,
    Vip: 'N',
    Statut: 'V',
    Reconquete: 'N',

    // 4. Données Financières & Fiscales
    Rib: '',
    NumeroCompte: '',
    ExonereDeTaxes: false,
    ExonereDeAccess: false,
  };

  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    const refreshClients = () => {
      // Recharger directement depuis l'API backend
      customerApi.getClients().then((data) => {
        if (data && Array.isArray(data)) {
          setClients(data);
        }
      }).catch(() => {
        setClients(dataStore.getClients());
      });
    };

    // Charger les tables de référence depuis l'API / fallback
    Promise.all([
      configRefApi.getQualites(),
      configRefApi.getVilles(),
      configRefApi.getProfessions(),
      configRefApi.getSecteursActivite(),
    ]).then(([qualites, villes, professions, secteurs]) => {
      setRefData({
        qualites: qualites || [],
        villes: villes || [],
        professions: professions || [],
        secteurs: secteurs || [],
      });
    }).catch((err) => {
      console.warn('Erreur chargement référentiels:', err);
    });

    customerApi.getClients().then((data) => {
      if (data && Array.isArray(data) && data.length > 0) {
        const formatted = data.map((c) => {
          const id = c.IdClient || c.id;
          const isPart = c.Particulier === '1' || c.Particulier === 'V' || c.typeclient === 'Particulier';
          const nom = (c.Nom || c.nom || '').trim();
          const prenom = (c.Prenoms || c.prenom || '').trim();
          const nomcomplet = c.nomcomplet || [nom, prenom].filter(Boolean).join(' ') || `Client ${id}`;

          return {
            id,
            IdClient: id,
            codeclient: c.Matricule || c.numero_assure || c.codeclient || `CLI-${String(id).padStart(5, '0')}`,
            Matricule: c.Matricule || c.codeclient || `CLI-${String(id).padStart(5, '0')}`,
            numero_assure: c.numero_assure || `ASS-${String(id).padStart(5, '0')}`,
            cle_unique: c.cle_unique || '',
            nom: nom || nomcomplet,
            Nom: nom || nomcomplet,
            prenom: prenom,
            Prenoms: prenom,
            nomcomplet: nomcomplet,
            typeclient: isPart ? 'Particulier' : 'Entreprise',
            Particulier: isPart ? 'V' : 'F',
            IdQualite: c.IdQualite || (isPart ? 1 : 4),
            civilite: c.civilite || (isPart ? 'Monsieur' : 'Soci?t?'),
            DateNaissance: c.DateNaissance || null,
            LieuNaissance: c.LieuNaissance || '',
            CniPat: c.CniPat || '',
            telephone: c.Telephone || c.Mobile || c.telephone || '',
            Telephone: c.Telephone || c.Mobile || c.telephone || '',
            mobile: c.Mobile || c.Telephone || '',
            Mobile: c.Mobile || c.Telephone || '',
            fixe: c.Fixe || '',
            Fixe: c.Fixe || '',
            fax: c.Fax || '',
            Fax: c.Fax || '',
            email: c.Email || c.email || '',
            Email: c.Email || c.email || '',
            adresse: c.Adresse1 || c.adresse || '',
            Adresse1: c.Adresse1 || c.adresse || '',
            Adresse2: c.Adresse2 || '',
            IdVille: c.IdVille || 1,
            ville: c.ville || 'Abidjan',
            CodePostal: c.CodePostal || '',
            IdProfession: c.IdProfession || 1,
            profession: c.libelleprofession || c.Fonction || c.profession || '',
            libelleprofession: c.libelleprofession || c.Fonction || c.profession || '',
            IdSecteurActivite: c.IdSecteurActivite || null,
            Responsable: c.Responsable || '',
            Fonction: c.Fonction || '',
            Vip: c.Vip || 'N',
            is_vip: c.Vip === 'V' || c.Vip === '1',
            Statut: c.Statut || 'V',
            idtypeclient: c.idtypeclient || (isPart ? 1 : 2),
            idtypeassure: c.idtypeassure || (isPart ? 1 : 2),
            Rib: c.Rib || '',
            NumeroCompte: c.NumeroCompte || '',
            ExonereDeTaxes: Boolean(c.ExonereDeTaxes),
            ExonereDeAccess: Boolean(c.ExonereDeAccess),
            contrats_actifs: c.contrats_actifs || 0,
            devis_en_cours: c.devis_en_cours || 0,
            total_primes: c.total_primes || '0 FCFA',
          };
        });
        setClients(formatted);
        setLoading(false);
      }
    }).catch((err) => {
      console.warn('Erreur chargement clients API:', err);
      setClients(dataStore.getClients());
      setLoading(false);
    });

    return dataStore.subscribe((key) => {
      if (key === 'uranus_clients') {
        refreshClients();
      }
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isEntreprise = formData.typeclient === 'Entreprise';

    // Trouver libellés associés aux identifiants sélectionnés
    const selectedQualite = refData.qualites.find((q) => q.IdQualite === Number(formData.IdQualite));
    const selectedVille = refData.villes.find((v) => v.IdVille === Number(formData.IdVille));
    const selectedProf = refData.professions.find((p) => p.IdProfession === Number(formData.IdProfession));
    const selectedSecteur = refData.secteurs.find((s) => s.IdSecteurActivite === Number(formData.IdSecteurActivite));

    const newClientPayload = {
      ...formData,
      Nom: formData.nom,
      Prenoms: isEntreprise ? '' : formData.prenom,
      nomcomplet: isEntreprise ? formData.nom : `${formData.nom} ${formData.prenom}`.trim(),
      Particulier: isEntreprise ? 'F' : 'V',
      civilite: selectedQualite ? selectedQualite.Libelle : (isEntreprise ? 'Société' : 'Monsieur'),
      ville: selectedVille ? selectedVille.Libelle : formData.ville,
      profession: selectedProf ? selectedProf.Libelle : (formData.profession || (isEntreprise ? 'Société' : 'Commerçant')),
      libelleprofession: selectedProf ? selectedProf.Libelle : (formData.profession || (isEntreprise ? 'Société' : 'Commerçant')),
      secteur_activite: selectedSecteur ? (selectedSecteur.Libelle || selectedSecteur.LibelleSecteurActivite) : '',
      contrats_actifs: 0,
      devis_en_cours: 0,
      total_primes: '0 FCFA',
    };

    // Enregistrement dans le dataStore réactif (avec tous les 41 champs)
    // Envoi direct à l'API Django REST (/api/client/)
    try {
      const res = await customerApi.createClient(newClientPayload);
      const savedClient = res.data || {};
      const matricule = savedClient.Matricule || savedClient.codeclient || newClientPayload.codeclient;
      success(`Client [${matricule}] ${newClientPayload.nomcomplet} a été créé avec succès.`);
      // Fusionne les données saisies avec la réponse de l'API pour disposer de toutes les
      // informations sur la fiche imprimable (matricule, IdClient, etc.)
      setCreatedClient({ ...newClientPayload, ...savedClient, Matricule: matricule, codeclient: matricule });
      loadClients();
    } catch (err) {
      toastError(err.response?.data?.detail || err.response?.data?.message || 'Le client n\'a pas pu être créé. Veuillez réessayer.');
    }
  };

  // Ferme et réinitialise complètement le modal de création (Annuler / Fermer après impression)
  const closeCreateModal = () => {
    setIsModalOpen(false);
    setCreatedClient(null);
    setFormData(initialFormState);
    setModalTab('identite');
  };

  // Navigation "Suivant" avec validation minimale de l'étape en cours
  const handleNextTab = () => {
    const isEntreprise = formData.typeclient === 'Entreprise';
    if (modalTab === 'identite' && !formData.nom.trim()) {
      toastError(isEntreprise ? 'La raison sociale est requise.' : 'Le nom de famille est requis.');
      return;
    }
    if (modalTab === 'coordonnees' && !formData.telephone.trim()) {
      toastError('Le numéro de téléphone principal est obligatoire.');
      return;
    }
    const idx = modalTabOrder.indexOf(modalTab);
    if (idx < modalTabOrder.length - 1) {
      setModalTab(modalTabOrder[idx + 1]);
    }
  };

  // Navigation "Précédent"
  const handlePrevTab = () => {
    const idx = modalTabOrder.indexOf(modalTab);
    if (idx > 0) {
      setModalTab(modalTabOrder[idx - 1]);
    }
  };

  const isFirstModalTab = modalTab === modalTabOrder[0];
  const isLastModalTab = modalTab === modalTabOrder[modalTabOrder.length - 1];

  const columns = [
    {
      header: 'Matricule',
      accessor: 'codeclient',
      render: (row) => (
        <div>
          <strong style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{row.codeclient || row.Matricule}</strong>
          {row.numero_assure && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {row.numero_assure}
            </div>
          )}
        </div>
      ),
    },
    {
      header: 'Assuré / Raison Sociale',
      accessor: 'nomcomplet',
      render: (row) => {
        const civilite = row.civilite && row.typeclient !== 'Entreprise' && row.civilite !== '-' ? row.civilite : null;
        const profession = row.profession || row.libelleprofession;
        const piece = row.CniPat && row.CniPat !== '-' ? row.CniPat : null;

        return (
          <div>
            <div style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {civilite && (
                <span style={{ fontSize: '0.75rem', color: '#93c5fd' }}>[{civilite}]</span>
              )}
              <span>{row.nomcomplet || row.Nom || 'Client sans nom'}</span>
              {(row.Vip === 'V' || row.is_vip) && (
                <span style={{ fontSize: '0.65rem', background: '#f59e0b', color: '#000', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>
                  VIP
                </span>
              )}
            </div>
            {(profession || piece) ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {profession ? profession : ''}
                {profession && piece ? ' • ' : ''}
                {piece ? piece : ''}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      header: 'Type & Qualité',
      accessor: 'typeclient',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '4px',
            background: row.typeclient === 'Entreprise' ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)',
            color: row.typeclient === 'Entreprise' ? '#c084fc' : '#60a5fa',
          }}
        >
          {row.typeclient === 'Entreprise' ? <Building size={12} /> : <User size={12} />}
          {row.typeclient}
        </span>
      ),
    },
    {
      header: 'Coordonnées',
      render: (row) => {
        const phone = row.mobile || row.telephone;
        const email = row.email;
        const ville = row.ville || 'Abidjan';

        return (
          <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {phone ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                <Phone size={12} color="#60a5fa" /> {phone}
              </span>
            ) : null}
            {email ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
                <Mail size={12} /> {email}
              </span>
            ) : null}
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
              <MapPin size={12} /> {ville}
            </span>
          </div>
        );
      },
    },
    {
      header: 'Activité',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <span style={{ color: '#34d399', fontWeight: 600 }}>{row.contrats_actifs || 0} polices</span> •{' '}
          <span style={{ color: '#fbbf24' }}>{row.devis_en_cours || 0} devis</span>
        </div>
      ),
    },
    {
      header: 'Total Primes',
      accessor: 'total_primes',
      render: (row) => <strong style={{ color: '#f8fafc' }}>{row.total_primes || '0 FCFA'}</strong>,
    },
    {
      header: 'Actions',
      render: (row) => {
        const canEdit = canUser(user, 'edit', 'clients');
        const canDelete = canUser(user, 'delete', 'clients');

        return (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              onClick={() => navigate(`/user/clients/${row.id || row.IdClient}`)}
              title="Consulter le dossier client 360°"
            >
              <Eye size={13} />
              <span>360°</span>
            </button>

            <button
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              onClick={() => printFicheClient(row)}
              title="Imprimer la fiche client"
            >
              <Printer size={13} color="#60a5fa" />
              <span>Fiche</span>
            </button>

            <button
              className="btn btn-secondary"
              disabled={!canEdit}
              style={{
                padding: '0.3rem 0.55rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                opacity: canEdit ? 1 : 0.45,
                cursor: canEdit ? 'pointer' : 'not-allowed',
              }}
              onClick={() => setEditingClient(row)}
              title={canEdit ? 'Modifier les informations du client' : 'Non habilité pour la modification'}
            >
              <Edit2 size={13} color="#60a5fa" />
              <span>Modifier</span>
            </button>

            <button
              className="btn btn-secondary"
              disabled={!canDelete || row.Statut === 'A' || row.statut === 'Archivé'}
              style={{
                padding: '0.3rem 0.55rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: (row.Statut === 'A' || row.statut === 'Archivé') ? 'var(--text-muted)' : canDelete ? '#f87171' : 'var(--text-muted)',
                borderColor: (row.Statut === 'A' || row.statut === 'Archivé') ? 'var(--border-subtle)' : canDelete ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-subtle)',
                opacity: (row.Statut === 'A' || row.statut === 'Archivé') ? 0.6 : canDelete ? 1 : 0.45,
                cursor: (row.Statut === 'A' || row.statut === 'Archivé') ? 'default' : canDelete ? 'pointer' : 'not-allowed',
              }}
              onClick={() => {
                if (row.Statut !== 'A' && row.statut !== 'Archivé') {
                  setArchivingClient(row);
                }
              }}
              title={
                (row.Statut === 'A' || row.statut === 'Archivé')
                  ? 'Client déjà archivé (Code CIMA)'
                  : canDelete
                  ? 'Archiver la fiche client (conservation CIMA)'
                  : 'Non habilité pour archiver'
              }
            >
              <Archive size={13} />
              <span>{(row.Statut === 'A' || row.statut === 'Archivé') ? 'Archivé' : 'Archiver'}</span>
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Users size={26} color="#3b82f6" />
            Clientèle
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestion intégrale et exhaustive de la base clientèle, personnes physiques et morales selon le Code CIMA.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePrintClients}
            disabled={loading || clients.length === 0}
            title="Imprimer le répertoire officiel de la clientèle"
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <Printer size={16} />
            <span>Imprimer la Liste</span>
          </button>

          <button className="btn btn-primary" onClick={() => { setFormData(initialFormState); setModalTab('identite'); setCreatedClient(null); setIsModalOpen(true); }}>
            <Plus size={16} />
            <span>Nouveau Client</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <DataTable
          columns={columns}
          data={clients}
          loading={loading}
          searchPlaceholder="Rechercher par nom, matricule, téléphone, pièce ou profession..."
        />
      </div>

      {/* New Client Modal Exhaustif */}
      <Modal isOpen={isModalOpen} onClose={closeCreateModal} title="Enregistrement d'un Nouveau Client" size="large">
        {createdClient ? (
          /* ÉCRAN DE CONFIRMATION : client créé, proposition d'impression de la fiche */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1.5rem 1rem', textAlign: 'center' }}>
            <CheckCircle2 size={48} color="#34d399" />
            <div>
              <h3 style={{ margin: 0, color: '#fff' }}>Client enregistré avec succès</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.35rem' }}>
                <strong>{createdClient.nomcomplet}</strong> ({createdClient.Matricule || createdClient.codeclient}) a bien été créé.
                Vous pouvez imprimer sa fiche client dès maintenant ou plus tard depuis la liste.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
                Fermer
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => printFicheClient(createdClient)}
              >
                <Printer size={16} />
                <span>Imprimer la fiche client</span>
              </button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Navigation par Onglets */}
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
            {[
              { id: 'identite', label: '1. Identité' },
              { id: 'coordonnees', label: '2. Coordonnées' },
              { id: 'professionnel', label: "3. Domaine d'activité" },
              { id: 'banque', label: '4. Banque & Fiscalité' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`btn ${modalTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', whiteSpace: 'nowrap' }}
                onClick={() => setModalTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ONGLET 1: IDENTITÉ */}
          {modalTab === 'identite' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 700 }}>Type de Personne Juridique</label>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fff', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="typeclient"
                      value="Particulier"
                      checked={formData.typeclient === 'Particulier'}
                      onChange={() => setFormData({ ...formData, typeclient: 'Particulier', Particulier: 'V', IdQualite: 1, idtypeclient: 1, idtypeassure: 1 })}
                    />
                    Personne physique
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fff', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="typeclient"
                      value="Entreprise"
                      checked={formData.typeclient === 'Entreprise'}
                      onChange={() => setFormData({ ...formData, typeclient: 'Entreprise', Particulier: 'F', IdQualite: 4, prenom: '', idtypeclient: 2, idtypeassure: 2 })}
                    />
                    Personne morale
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: formData.typeclient === 'Entreprise' ? '1fr 2fr' : '1fr 2fr 2fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Civilité</label>
                  <select
                    className="form-control"
                    value={formData.IdQualite}
                    onChange={(e) => setFormData({ ...formData, IdQualite: Number(e.target.value) })}
                  >
                    {trierParLibelle(refData.qualites, (q) => q.Libelle).map((q) => (
                      <option key={q.IdQualite} value={q.IdQualite}>
                        {q.Libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    {formData.typeclient === 'Entreprise' ? 'Raison Sociale *' : 'Nom de Famille *'}
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    value={formData.nom}
                    onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                    placeholder={formData.typeclient === 'Entreprise' ? 'Ex: SIVOM CI SA' : 'Ex: KOUAME'}
                  />
                </div>

                {formData.typeclient === 'Particulier' && (
                  <div className="form-group">
                    <label className="form-label">Prénom(s) *</label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      value={formData.prenom}
                      onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                      placeholder="Ex: Yao Patrick"
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: formData.typeclient === 'Particulier' ? '1.5fr 1fr 1fr' : '1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">
                    {formData.typeclient === 'Entreprise' ? 'N° Registre de Commerce (RCCM / Patente)' : 'N° Pièce d\'Identité (CNI / Passeport / Attestation)'}
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.CniPat}
                    onChange={(e) => setFormData({ ...formData, CniPat: e.target.value })}
                    placeholder={formData.typeclient === 'Entreprise' ? 'Ex: CI-ABJ-2022-B-14890' : 'Ex: CI00293849102'}
                  />
                </div>

                {formData.typeclient === 'Particulier' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Date de Naissance</label>
                      <input
                        type="date"
                        className="form-control"
                        value={formData.DateNaissance}
                        onChange={(e) => setFormData({ ...formData, DateNaissance: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Lieu de Naissance</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.LieuNaissance}
                        onChange={(e) => setFormData({ ...formData, LieuNaissance: e.target.value })}
                        placeholder="Ex: Abidjan Cocody"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ONGLET 2: COORDONNÉES */}
          {modalTab === 'coordonnees' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Téléphone Mobile (Principal) *</label>
                  <input
                    type="tel"
                    className="form-control"
                    required
                    value={formData.mobile || formData.telephone}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value, telephone: e.target.value })}
                    placeholder="Ex: +225 07 08 09 10 11"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Téléphone Fixe</label>
                  <input
                    type="tel"
                    className="form-control"
                    value={formData.fixe}
                    onChange={(e) => setFormData({ ...formData, fixe: e.target.value })}
                    placeholder="Ex: +225 27 22 40 10 11"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Adresse Email</label>
                  <input
                    type="email"
                    className="form-control"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="client@domaine.ci"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Numéro de Fax</label>
                  <input
                    type="tel"
                    className="form-control"
                    value={formData.fax}
                    onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
                    placeholder="+225 27..."
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Adresse Géographique (Adresse 1)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.adresse}
                    onChange={(e) => setFormData({ ...formData, adresse: e.target.value, Adresse1: e.target.value })}
                    placeholder="Commune, quartier, rue..."
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Complément d'Adresse (Adresse 2)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.Adresse2}
                    onChange={(e) => setFormData({ ...formData, Adresse2: e.target.value })}
                    placeholder="Bâtiment, étage, porte, villa..."
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Ville</label>
                  <select
                    className="form-control"
                    value={formData.IdVille}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const selected = refData.villes.find((v) => v.IdVille === id);
                      setFormData({ ...formData, IdVille: id, ville: selected ? selected.Libelle : 'Abidjan' });
                    }}
                  >
                    {trierParLibelle(refData.villes, (v) => v.Libelle).map((v) => (
                      <option key={v.IdVille} value={v.IdVille}>
                        {v.Libelle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Boîte Postale</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.CodePostal}
                    onChange={(e) => setFormData({ ...formData, CodePostal: e.target.value })}
                    placeholder="Ex: 01 BP 4512 Abidjan 01"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ONGLET 3: DOMAINE D'ACTIVITÉ */}
          {modalTab === 'professionnel' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formData.typeclient === 'Entreprise' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">Nom & Prénom du Représentant Légal</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.Responsable}
                      onChange={(e) => setFormData({ ...formData, Responsable: e.target.value })}
                      placeholder="Ex: M. KOFFI N'Dri Emmanuel"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Fonction du Contact</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.Fonction}
                      onChange={(e) => setFormData({ ...formData, Fonction: e.target.value })}
                      placeholder="Ex: Directeur Général, Gérant..."
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Profession</label>
                    <button
                      type="button"
                      title="Créer une nouvelle profession"
                      onClick={() => { setIsAddProfessionOpen(true); setNewProfessionLibelle(''); setNewProfessionCode(''); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '22px', height: '22px', borderRadius: '50%',
                        border: '1.5px solid #3b82f6', background: 'rgba(59,130,246,0.12)',
                        color: '#3b82f6', cursor: 'pointer', flexShrink: 0, padding: 0,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.25)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.12)'}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <select
                    className="form-control"
                    value={formData.IdProfession}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const selected = refData.professions.find((p) => p.IdProfession === id);
                      setFormData({ ...formData, IdProfession: id, profession: selected ? selected.Libelle : '' });
                    }}
                  >
                    <option value="">-- Sélectionner une profession --</option>
                    {trierParLibelle(refData.professions, (p) => `${p.Libelle} ${p.CodeProfession ? `(${p.CodeProfession})` : ''}`).map((p) => (
                      <option key={p.IdProfession} value={p.IdProfession}>
                        {p.Libelle} {p.CodeProfession ? `(${p.CodeProfession})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Secteur d'Activité Économique</label>
                    <button
                      type="button"
                      title="Créer un nouveau secteur d'activité"
                      onClick={() => { setIsAddSecteurOpen(true); setNewSecteurLibelle(''); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '22px', height: '22px', borderRadius: '50%',
                        border: '1.5px solid #3b82f6', background: 'rgba(59,130,246,0.12)',
                        color: '#3b82f6', cursor: 'pointer', flexShrink: 0, padding: 0,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.25)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.12)'}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <select
                    className="form-control"
                    value={formData.IdSecteurActivite}
                    onChange={(e) => setFormData({ ...formData, IdSecteurActivite: e.target.value ? Number(e.target.value) : '' })}
                  >
                    <option value="">-- Sélectionner un secteur --</option>
                    {trierParLibelle(refData.secteurs, (s) => s.Libelle || s.LibelleSecteurActivite || s.libelle).map((s) => (
                      <option key={s.IdSecteurActivite} value={s.IdSecteurActivite}>
                        {s.Libelle || s.LibelleSecteurActivite || s.libelle}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ONGLET 4: BANQUE & FISCALITÉ */}
          {modalTab === 'banque' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Relevé d'Identité Bancaire (RIB - 24 caractères UEMOA)</label>
                  <input
                    type="text"
                    className="form-control"
                    maxLength={32}
                    value={formData.Rib}
                    onChange={(e) => setFormData({ ...formData, Rib: e.target.value })}
                    placeholder="Ex: CI092 01001 002348571029 45"
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    Code Banque (5) + Code Guichet (5) + N° Compte (12) + Clé RIB (2)
                  </small>
                </div>

                <div className="form-group">
                  <label className="form-label">Numéro de Compte Client Interne</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.NumeroCompte}
                    onChange={(e) => setFormData({ ...formData, NumeroCompte: e.target.value })}
                    placeholder="Ex: CPT-411-0089"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formData.ExonereDeTaxes}
                    onChange={(e) => setFormData({ ...formData, ExonereDeTaxes: e.target.checked })}
                  />
                  <span>Exonéré de Taxe d'Assurance (Art. CIMA / Diplomatique)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formData.ExonereDeAccess}
                    onChange={(e) => setFormData({ ...formData, ExonereDeAccess: e.target.checked })}
                  />
                  <span>Exonéré d'Accessoires de Police</span>
                </label>
              </div>
            </div>
          )}

          {/* Footer Modal : navigation Précédent / Suivant puis Créer sur la dernière étape */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <div>
              {isFirstModalTab ? (
                <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
                  Annuler
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={handlePrevTab} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <ArrowLeft size={16} /> Précédent
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Étape {modalTabOrder.indexOf(modalTab) + 1} sur {modalTabOrder.length}
              </span>

              {isLastModalTab ? (
                <button type="submit" className="btn btn-primary">
                  Créer & Enregistrer le Client
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={handleNextTab} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>Suivant</span> <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        </form>
        )}
      </Modal>

      {/* Modal Modification Client */}
      <EditClientModal
        isOpen={!!editingClient}
        onClose={() => setEditingClient(null)}
        client={editingClient}
        onSave={async (id, updates, avant) => {
          // Enregistrement en base (la modification ne restait jusqu'ici que dans le navigateur).
          // Seuls les champs changés dans la fenêtre partent (PATCH) : les valeurs par défaut de
          // l'écran et les champs non affichés (solde, matricule…) restent tels qu'en base.
          const apres = sanitizeClientForApi(updates);
          const reference = sanitizeClientForApi(avant);
          const modifs = Object.fromEntries(Object.entries(apres).filter(
            ([champ, valeur]) => !CHAMPS_CLIENT_NON_MODIFIABLES.includes(champ) && valeur !== reference[champ],
          ));
          if (!Object.keys(modifs).length) {
            info(`Aucune modification à enregistrer pour ${updates.nomcomplet}.`);
            return;
          }
          try {
            await customerApi.patchClient(id, modifs);
          } catch (err) {
            const reponse = err?.response?.data;
            const detail = reponse && typeof reponse === 'object'
              ? Object.values(reponse).flat().filter((m) => typeof m === 'string').join(' ; ')
              : '';
            toastError(`La fiche de ${updates.nomcomplet} n'a pas été enregistrée : ${detail || err.message}.`);
            return;
          }
          dataStore.updateClient(id, updates);
          setClients((prev) => prev.map((c) => (
            String(c.IdClient) === String(id) || String(c.id) === String(id) ? { ...c, ...updates } : c
          )));
          success(`Fiche de ${updates.nomcomplet} mise à jour avec succès !`);
        }}
      />

      {/* Modal Confirmation Archivage Sécurisé (Conformité CIMA) */}
      <Modal
        isOpen={!!archivingClient}
        onClose={() => setArchivingClient(null)}
        title="Archivage de la Fiche Client"
        size="medium"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Archive size={20} color="#f87171" />
            </div>
            <div>
              <h4 style={{ margin: '0 0 0.35rem', color: '#f87171', fontSize: '1rem', fontWeight: 700 }}>
                Confirmer l'archivage du client
              </h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Êtes-vous sûr de vouloir archiver le dossier de{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{archivingClient?.nomcomplet}</strong>{' '}
                {archivingClient?.codeclient ? `(${archivingClient.codeclient})` : ''} ?
              </p>
            </div>
          </div>

          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              ℹ️ Règle de Conservation & Intégrité CIMA :
            </div>
            L'archivage désactive le statut actif du client tout en <strong>conservant l'intégralité de son historique</strong> (contrats, polices, avenants, sinistres).
            <br />
            <strong>Aucune donnée n'est supprimée définitivement</strong> de la base de données.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setArchivingClient(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn"
              style={{
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={handleConfirmArchive}
            >
              <Archive size={15} />
              <span>Confirmer l'Archivage</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL AJOUT RAPIDE — Secteur d'Activité Économique (stdsecteuractivite)
          ===================================================================== */}
      {isAddSecteurOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddSecteurOpen(false); }}
        >
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '1.75rem',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Plus size={16} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    Nouveau Secteur d'Activité
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddSecteurOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddSecteur}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  Libellé du secteur d'activité *
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ex: AGRICULTURE, COMMERCE, TRANSPORT…"
                  value={newSecteurLibelle}
                  onChange={(e) => setNewSecteurLibelle(e.target.value)}
                  autoFocus
                  required
                  style={{ textTransform: 'uppercase' }}
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  Le libellé sera automatiquement converti en majuscules.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsAddSecteurOpen(false)}
                  disabled={isSavingSecteur}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSavingSecteur || !newSecteurLibelle.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {isSavingSecteur ? (
                    <>
                      <span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                      Enregistrement…
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Créer & Sélectionner
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL AJOUT RAPIDE — Profession (stdprofession)
          ===================================================================== */}
      {isAddProfessionOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddProfessionOpen(false); }}
        >
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '1.75rem',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Plus size={16} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    Nouvelle Profession
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Table stdprofession
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddProfessionOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddProfession}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  Libellé de la profession *
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ex: MÉDECIN, INFORMATICIEN, COMMERÇANT…"
                  value={newProfessionLibelle}
                  onChange={(e) => setNewProfessionLibelle(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  Code Profession <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(Optionnel, auto-généré si vide)</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ex: PROF15, ST12…"
                  value={newProfessionCode}
                  onChange={(e) => setNewProfessionCode(e.target.value.toUpperCase())}
                  style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsAddProfessionOpen(false)}
                  disabled={isSavingProfession}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSavingProfession || !newProfessionLibelle.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {isSavingProfession ? (
                    <>
                      <span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                      Enregistrement…
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Créer & Sélectionner
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientListPage;
