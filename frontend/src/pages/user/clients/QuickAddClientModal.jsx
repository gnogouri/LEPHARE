import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { configRefApi, customerApi } from '../../../api/endpoints';
import { dataStore } from '../../../api/dataStore';
import { useToast } from '../../../context/ToastContext';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Building2,
  Save,
  Plus,
  ArrowRight,
  ArrowLeft,
  Check,
  CreditCard,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { trierParLibelle } from '../../../utils/sortUtils';

export const QuickAddClientModal = ({ isOpen, onClose, onClientCreated }) => {
  const { success, error: toastError } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Navigation par étapes
  const [step, setStep] = useState(1);

  // Référentiels
  const [refData, setRefData] = useState({
    qualites: [],
    villes: [],
    professions: [],
    secteurs: [],
  });

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      Promise.all([
        configRefApi.getQualites().catch(() => []),
        configRefApi.getVilles().catch(() => []),
        configRefApi.getProfessions().catch(() => []),
        configRefApi.getSecteursActivite().catch(() => []),
      ]).then(([qualites, villes, professions, secteurs]) => {
        setRefData({
          qualites: qualites || [],
          villes: villes || [],
          professions: professions || [],
          secteurs: secteurs || [],
        });
      });
    }
  }, [isOpen]);

  // Formulaire complet exhaustif (standards stdclient)
  const [formData, setFormData] = useState({
    // Étape 1 : Identité
    typeclient: 'Particulier',
    Particulier: 'V',
    IdQualite: 1,
    nom: '',
    prenom: '',
    DateNaissance: '',
    LieuNaissance: '',
    CniPat: '',
    DateDelivrancePiece: '',
    LieuDelivrancePiece: '',
    Nationalite: 'Ivoirienne',
    SituationMatrimoniale: 'Célibataire',

    // Étape 2 : Coordonnées
    telephone: '',
    Mobile: '',
    email: '',
    adresse: '',
    BoitePostale: '',
    IdVille: 1,
    ville: 'Abidjan',
    Commune: '',
    Quartier: '',

    // Étape 3 : Domaine d'activité
    IdProfession: '',
    profession: '',
    IdSecteurActivite: '',
    secteur_activite: '',
    Employeur: '',
    RegistreCommerce: '',
    CompteContribuable: '',
    NomContact: '',
    Fonction: '',

    // Types souscripteur / assuré (1 = personne physique, 2 = personne morale) déduits du type
    // de personne choisi à l'étape 1 ; VIP et statut par défaut
    idtypeclient: 1,
    idtypeassure: 1,
    Vip: 'N',
    Statut: 'V',

    // Étape 4 : Banque & Fiscalité
    Rib: '',
    NumeroCompte: '',
    ExonereDeTaxes: false,
    ExonereDeAccess: false,
  });

  const isEntreprise = formData.typeclient === 'Entreprise';

  const steps = [
    { id: 1, title: '1. Identité' },
    { id: 2, title: '2. Coordonnées' },
    { id: 3, title: "3. Domaine d'activité" },
    { id: 4, title: '4. Banque & Fiscalité' },
  ];

  const handleNext = (e) => {
    e.preventDefault();
    // Validation étape 1
    if (step === 1) {
      if (!formData.nom.trim()) {
        toastError(isEntreprise ? "La raison sociale est requise." : "Le nom de famille est requis.");
        return;
      }
    }
    // Validation étape 2
    if (step === 2) {
      if (!formData.telephone.trim()) {
        toastError("Le numéro de téléphone principal est obligatoire.");
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrev = () => {
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.nom.trim()) {
      toastError("Le nom du souscripteur est obligatoire.");
      setStep(1);
      return;
    }
    if (!formData.telephone.trim()) {
      toastError("Le numéro de téléphone est obligatoire.");
      setStep(2);
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedQualite = refData.qualites.find((q) => q.IdQualite === Number(formData.IdQualite));
      const selectedVille = refData.villes.find((v) => v.IdVille === Number(formData.IdVille));
      const selectedProf = refData.professions.find((p) => p.IdProfession === Number(formData.IdProfession));
      const selectedSecteur = refData.secteurs.find((s) => s.IdSecteurActivite === Number(formData.IdSecteurActivite));

      const nomComplet = isEntreprise ? formData.nom.trim() : `${formData.nom.trim()} ${formData.prenom.trim()}`.trim();

      const newClientPayload = {
        ...formData,
        Nom: formData.nom.trim(),
        Prenoms: isEntreprise ? '' : formData.prenom.trim(),
        nom: formData.nom.trim(),
        prenom: isEntreprise ? '' : formData.prenom.trim(),
        nomcomplet: nomComplet,
        Particulier: isEntreprise ? 'F' : 'V',
        civilite: selectedQualite ? selectedQualite.Libelle : (isEntreprise ? 'Société' : 'Monsieur'),
        ville: selectedVille ? selectedVille.Libelle : (formData.ville || 'Abidjan'),
        Ville: selectedVille ? selectedVille.Libelle : (formData.ville || 'Abidjan'),
        profession: selectedProf ? selectedProf.Libelle : (formData.profession || (isEntreprise ? 'Entreprise' : 'Cadre / Salarié')),
        libelleprofession: selectedProf ? selectedProf.Libelle : (formData.profession || (isEntreprise ? 'Entreprise' : 'Cadre / Salarié')),
        secteur_activite: selectedSecteur ? (selectedSecteur.Libelle || selectedSecteur.LibelleSecteurActivite) : '',
        telephone: formData.telephone.trim(),
        Telephone: formData.telephone.trim(),
        Mobile: formData.Mobile.trim() || formData.telephone.trim(),
        Email: formData.email.trim(),
        adresse: formData.adresse.trim() || 'Abidjan, Côte d’Ivoire',
        Adresse: formData.adresse.trim() || 'Abidjan, Côte d’Ivoire',
        contrats_actifs: 0,
        devis_en_cours: 0,
        total_primes: '0 FCFA',
      };

      let createdClient = null;

      // 1. Sauvegarde dans Django API
      try {
        const res = await customerApi.createClient(newClientPayload);
        if (res && res.data) {
          createdClient = {
            id: res.data.IdClient || res.data.id,
            ...res.data,
            ...newClientPayload,
            codeclient: res.data.Matricule || res.data.codeclient || `CLI-2024-${String(res.data.IdClient || Date.now()).slice(-4)}`,
          };
        }
      } catch (err) {
        console.warn('API creation fallback to local dataStore:', err);
      }

      // 2. Fallback / Synchronisation locale dataStore
      if (!createdClient) {
        createdClient = dataStore.createClient(newClientPayload);
      }

      success(`Client ${createdClient.nomcomplet} (${createdClient.codeclient || 'Nouveau'}) enregistré avec succès !`);

      if (onClientCreated) {
        onClientCreated(createdClient);
      }

      onClose();
    } catch (err) {
      console.error(err);
      toastError("Erreur lors de l'enregistrement du client");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Enregistrement d'un Nouveau Client"
      maxWidth="780px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Stepper Header */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', overflowX: 'auto' }}>
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`btn ${step === s.id ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                fontSize: '0.8rem',
                padding: '0.4rem 0.75rem',
                whiteSpace: 'nowrap',
                background: step === s.id ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : '',
                borderColor: step === s.id ? '#3b82f6' : 'var(--border-subtle)',
              }}
              onClick={() => setStep(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>

        {/* ÉTAPE 1 : IDENTITÉ */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 700 }}>Type de Personne Juridique</label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label
                  style={{
                    flex: 1,
                    padding: '0.65rem 1rem',
                    borderRadius: '8px',
                    border: `2px solid ${!isEntreprise ? '#3b82f6' : 'var(--border-subtle)'}`,
                    background: !isEntreprise ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <input
                    type="radio"
                    name="modalQuickType"
                    checked={!isEntreprise}
                    onChange={() => setFormData({ ...formData, typeclient: 'Particulier', Particulier: 'V', IdQualite: 1, idtypeclient: 1, idtypeassure: 1 })}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <User size={16} color="#60a5fa" />
                  <span style={{ fontWeight: 600, color: '#fff', fontSize: '0.9rem' }}>Personne physique</span>
                </label>

                <label
                  style={{
                    flex: 1,
                    padding: '0.65rem 1rem',
                    borderRadius: '8px',
                    border: `2px solid ${isEntreprise ? '#3b82f6' : 'var(--border-subtle)'}`,
                    background: isEntreprise ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <input
                    type="radio"
                    name="modalQuickType"
                    checked={isEntreprise}
                    onChange={() => setFormData({ ...formData, typeclient: 'Entreprise', Particulier: 'F', IdQualite: 4, prenom: '', idtypeclient: 2, idtypeassure: 2 })}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <Building2 size={16} color="#60a5fa" />
                  <span style={{ fontWeight: 600, color: '#fff', fontSize: '0.9rem' }}>Personne morale</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isEntreprise ? '1.2fr 2.5fr' : '1fr 1.5fr 1.5fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Civilité</label>
                <select
                  className="form-control"
                  value={formData.IdQualite}
                  onChange={(e) => setFormData({ ...formData, IdQualite: Number(e.target.value) })}
                >
                  {refData.qualites.length > 0 ? (
                    trierParLibelle(refData.qualites, (q) => q.Libelle).map((q) => (
                      <option key={q.IdQualite} value={q.IdQualite}>
                        {q.Libelle}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value={1}>Monsieur</option>
                      <option value={2}>Madame</option>
                      <option value={3}>Mademoiselle</option>
                      <option value={4}>Société</option>
                    </>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  {isEntreprise ? 'Raison Sociale *' : 'Nom de Famille *'}
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder={isEntreprise ? 'Ex: SIVOM CI SA' : 'Ex: KOUAME'}
                />
              </div>

              {!isEntreprise && (
                <div className="form-group">
                  <label className="form-label">Prénom(s)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.prenom}
                    onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                    placeholder="Ex: Yao Patrick"
                  />
                </div>
              )}
            </div>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">N° Pièce d'Identité / RCCM</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.CniPat}
                  onChange={(e) => setFormData({ ...formData, CniPat: e.target.value })}
                  placeholder={isEntreprise ? 'RCCM : CI-ABJ-03-2022-B12-00123' : 'CNI : CI001928374'}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date de Naissance / Création</label>
                <input
                  type="date"
                  className="form-control"
                  value={formData.DateNaissance}
                  onChange={(e) => setFormData({ ...formData, DateNaissance: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Lieu de Naissance / Siège</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.LieuNaissance}
                  onChange={(e) => setFormData({ ...formData, LieuNaissance: e.target.value })}
                  placeholder="Ex: Treichville, Abidjan"
                />
              </div>
            </div>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Nationalité</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.Nationalite}
                  onChange={(e) => setFormData({ ...formData, Nationalite: e.target.value })}
                />
              </div>

              {!isEntreprise && (
                <div className="form-group">
                  <label className="form-label">Situation Matrimoniale</label>
                  <select
                    className="form-control"
                    value={formData.SituationMatrimoniale}
                    onChange={(e) => setFormData({ ...formData, SituationMatrimoniale: e.target.value })}
                  >
                    <option value="Célibataire">Célibataire</option>
                    <option value="Divorcé(e)">Divorcé(e)</option>
                    <option value="Marié(e)">Marié(e)</option>
                    <option value="Veuf/Veuve">Veuf / Veuve</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ÉTAPE 2 : COORDONNÉES & ADRESSE */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Phone size={14} /> Téléphone Principal *
                </label>
                <input
                  type="tel"
                  required
                  className="form-control"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                  placeholder="+225 27 22 40 10 11"
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Phone size={14} /> Téléphone Mobile
                </label>
                <input
                  type="tel"
                  className="form-control"
                  value={formData.Mobile}
                  onChange={(e) => setFormData({ ...formData, Mobile: e.target.value })}
                  placeholder="+225 07 08 09 10 11"
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Mail size={14} /> Adresse Email
                </label>
                <input
                  type="email"
                  className="form-control"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="contact@client.ci"
                />
              </div>
            </div>

            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Ville (Table stdville)</label>
                <select
                  className="form-control"
                  value={formData.IdVille}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const v = refData.villes.find((item) => item.IdVille === id);
                    setFormData({ ...formData, IdVille: id, ville: v ? v.Libelle : formData.ville });
                  }}
                >
                  {refData.villes.length > 0 ? (
                    trierParLibelle(refData.villes, (v) => v.Libelle).map((v) => (
                      <option key={v.IdVille} value={v.IdVille}>
                        {v.Libelle}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value={1}>Abidjan</option>
                      <option value={2}>Bouaké</option>
                      <option value={3}>San-Pédro</option>
                      <option value={4}>Yamoussoukro</option>
                    </>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Commune</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.Commune}
                  onChange={(e) => setFormData({ ...formData, Commune: e.target.value })}
                  placeholder="Ex: Cocody, Plateau, Marcory..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Quartier / Précision</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.Quartier}
                  onChange={(e) => setFormData({ ...formData, Quartier: e.target.value })}
                  placeholder="Ex: Angré 8ème Tranche"
                />
              </div>
            </div>

            <div className="responsive-form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <MapPin size={14} /> Adresse Géographique
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.adresse}
                  onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                  placeholder="Ex: Rue L82, Immeuble Horizon, 3ème étage"
                />
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Boîte Postale</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.BoitePostale}
                  onChange={(e) => setFormData({ ...formData, BoitePostale: e.target.value })}
                  placeholder="Ex: 01 BP 4512 Abidjan 01"
                />
              </div>
            </div>
          </div>
        )}

        {/* ÉTAPE 3 : DOMAINE D'ACTIVITÉ */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="responsive-form-row">
              <div className="form-group">
                <label className="form-label">Profession</label>
                <select
                  className="form-control"
                  value={formData.IdProfession}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const p = refData.professions.find((item) => item.IdProfession === id);
                    setFormData({ ...formData, IdProfession: id, profession: p ? p.Libelle : '' });
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
                <label className="form-label">Secteur d'Activité</label>
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

            {isEntreprise ? (
              <div className="responsive-form-row">
                <div className="form-group">
                  <label className="form-label">Compte Contribuable (N° CC)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.CompteContribuable}
                    onChange={(e) => setFormData({ ...formData, CompteContribuable: e.target.value })}
                    placeholder="Ex: 0102938 A"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Contact Principal</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.NomContact}
                    onChange={(e) => setFormData({ ...formData, NomContact: e.target.value })}
                    placeholder="Ex: M. Bamba Karim"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Fonction du Contact</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.Fonction}
                    onChange={(e) => setFormData({ ...formData, Fonction: e.target.value })}
                    placeholder="Ex: Directeur Général"
                  />
                </div>
              </div>
            ) : (
              <div className="responsive-form-row">
                <div className="form-group">
                  <label className="form-label">Employeur</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.Employeur}
                    onChange={(e) => setFormData({ ...formData, Employeur: e.target.value })}
                    placeholder="Ex: Port Autonome d'Abidjan"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Poste Occupé</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.Fonction}
                    onChange={(e) => setFormData({ ...formData, Fonction: e.target.value })}
                    placeholder="Ex: Ingénieur Système"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ÉTAPE 4 : BANQUE & FISCALITÉ */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="responsive-form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Relevé d'Identité Bancaire (RIB - 24 car. UEMOA)</label>
                <input
                  type="text"
                  className="form-control"
                  maxLength={32}
                  value={formData.Rib}
                  onChange={(e) => setFormData({ ...formData, Rib: e.target.value })}
                  placeholder="CI092 01001 002348571029 45"
                />
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">N° Compte Client</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.NumeroCompte}
                  onChange={(e) => setFormData({ ...formData, NumeroCompte: e.target.value })}
                  placeholder="CPT-411-0089"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '2rem', padding: '0.85rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={formData.ExonereDeTaxes}
                  onChange={(e) => setFormData({ ...formData, ExonereDeTaxes: e.target.checked })}
                />
                <span>Exonéré de Taxe d'Assurance (Art. CIMA)</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>
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

        {/* Navigation Buttons (Précédent / Suivant / Enregistrer) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
          <div>
            {step > 1 ? (
              <button type="button" className="btn btn-secondary" onClick={handlePrev} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <ArrowLeft size={16} /> Précédent
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Annuler
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Étape {step} sur 4
            </span>

            {step < 4 ? (
              <button type="button" className="btn btn-primary" onClick={handleNext} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>Suivant</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'linear-gradient(135deg, #059669, #10b981)' }}
                disabled={isSubmitting}
              >
                <Save size={16} />
                {isSubmitting ? "Enregistrement en cours…" : "Créer & Sélectionner le Client"}
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
};
