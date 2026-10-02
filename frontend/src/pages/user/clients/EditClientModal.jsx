import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { configRefApi, professionApi } from '../../../api/endpoints';
import { User, Phone, Mail, MapPin, Briefcase, Building2, Save, ShieldCheck, CreditCard, Plus, ArrowLeft, ArrowRight } from 'lucide-react';
import { trierParLibelle } from '../../../utils/sortUtils';

export const EditClientModal = ({ isOpen, onClose, client, onSave }) => {
  const [modalTab, setModalTab] = useState('identite');
  const modalTabOrder = ['identite', 'coordonnees', 'professionnel', 'banque'];
  const [refData, setRefData] = useState({
    qualites: [],
    villes: [],
    professions: [],
    secteurs: [],
  });

  // Modal d'ajout rapide d'une profession
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
        libelleprofession: created.Libelle,
      }));
      setIsAddProfessionOpen(false);
      setNewProfessionLibelle('');
      setNewProfessionCode('');
    } catch (err) {
      console.error('Erreur création profession:', err);
    } finally {
      setIsSavingProfession(false);
    }
  };

  // Formulaire tel qu'à l'ouverture : l'enregistrement n'envoie que ce qui en diffère
  const [formInitial, setFormInitial] = useState(null);
  const [formData, setFormData] = useState({
    // 1. Identité
    typeclient: 'Particulier',
    Particulier: 'V',
    IdQualite: 1,
    civilite: 'Monsieur',
    nom: '',
    Nom: '',
    prenom: '',
    Prenoms: '',
    nomcomplet: '',
    CniPat: '',
    DateNaissance: '',
    LieuNaissance: '',

    // 2. Coordonnées
    telephone: '',
    Telephone: '',
    mobile: '',
    Mobile: '',
    fixe: '',
    Fixe: '',
    fax: '',
    Fax: '',
    email: '',
    Email: '',
    adresse: '',
    Adresse1: '',
    Adresse2: '',
    IdVille: 1,
    ville: 'Abidjan',
    CodePostal: '',

    // 3. Domaine d'activité
    Responsable: '',
    Fonction: '',
    IdProfession: 1,
    profession: '',
    libelleprofession: '',
    IdSecteurActivite: '',

    // Classification : types souscripteur / assuré (1 = personne physique, 2 = personne morale)
    // déduits du type de personne ; VIP, statut et reconquête conservés tels qu'en base
    idtypeclient: 1,
    idtypeassure: 1,
    Vip: 'N',
    Statut: 'V',
    Reconquete: 'N',
    CreeCie: 'V',

    // 4. Données Financières & Fiscales
    Rib: '',
    NumeroCompte: '',
    Solde: '0',
    Avoir: '0',
    ExonereDeTaxes: false,
    ExonereDeAccess: false,
  });

  useEffect(() => {
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
      console.warn('Erreur chargement référentiels edit modal:', err);
    });
  }, []);

  useEffect(() => {
    if (client) {
      const isPart = client.typeclient === 'Particulier' || client.Particulier === 'V' || client.Particulier === '1';
      const initial = {
        typeclient: isPart ? 'Particulier' : 'Entreprise',
        Particulier: isPart ? 'V' : 'F',
        IdQualite: client.IdQualite || (isPart ? 1 : 4),
        civilite: client.civilite || (isPart ? 'Monsieur' : 'Société'),
        nom: client.nom || client.Nom || '',
        Nom: client.Nom || client.nom || '',
        prenom: isPart ? (client.prenom || client.Prenoms || '') : '',
        Prenoms: isPart ? (client.Prenoms || client.prenom || '') : '',
        nomcomplet: client.nomcomplet || (client.Nom ? `${client.Nom} ${client.Prenoms || ''}`.trim() : client.nom),
        CniPat: client.CniPat || '',
        DateNaissance: client.DateNaissance || '',
        LieuNaissance: client.LieuNaissance || '',

        telephone: client.telephone || client.Telephone || '',
        Telephone: client.Telephone || client.telephone || '',
        mobile: client.mobile || client.Mobile || '',
        Mobile: client.Mobile || client.mobile || '',
        fixe: client.fixe || client.Fixe || '',
        Fixe: client.Fixe || client.fixe || '',
        fax: client.fax || client.Fax || '',
        Fax: client.Fax || client.fax || '',
        email: client.email || client.Email || '',
        Email: client.Email || client.email || '',
        adresse: client.adresse || client.Adresse1 || '',
        Adresse1: client.Adresse1 || client.adresse || '',
        Adresse2: client.Adresse2 || '',
        IdVille: client.IdVille || 1,
        ville: client.ville || 'Abidjan',
        CodePostal: client.CodePostal || '',

        Responsable: client.Responsable || '',
        Fonction: client.Fonction || '',
        IdProfession: client.IdProfession || 1,
        profession: client.profession || client.libelleprofession || '',
        libelleprofession: client.libelleprofession || client.profession || '',
        IdSecteurActivite: client.IdSecteurActivite || '',

        idtypeclient: client.idtypeclient || (isPart ? 1 : 2),
        idtypeassure: client.idtypeassure || (isPart ? 1 : 2),
        Vip: client.Vip || (client.is_vip ? 'V' : 'N'),
        Statut: client.Statut || 'V',
        Reconquete: client.Reconquete || 'N',
        CreeCie: client.CreeCie || 'V',

        Rib: client.Rib || '',
        NumeroCompte: client.NumeroCompte || '',
        Solde: client.Solde !== undefined ? String(client.Solde) : '0',
        Avoir: client.Avoir !== undefined ? String(client.Avoir) : '0',
        ExonereDeTaxes: Boolean(client.ExonereDeTaxes),
        ExonereDeAccess: Boolean(client.ExonereDeAccess),
      };
      setFormData(initial);
      setFormInitial(initial);
      setModalTab('identite');
    }
  }, [client]);

  if (!isOpen || !client) return null;

  // Client tel que le formulaire le décrit (champs de l'API et libellés affichés dans la liste)
  const versClient = (donnees) => {
    const isEntreprise = donnees.typeclient === 'Entreprise';
    const selectedQualite = refData.qualites.find((q) => q.IdQualite === Number(donnees.IdQualite));
    const selectedVille = refData.villes.find((v) => v.IdVille === Number(donnees.IdVille));
    const selectedProf = refData.professions.find((p) => p.IdProfession === Number(donnees.IdProfession));
    const selectedSecteur = refData.secteurs.find((s) => s.IdSecteurActivite === Number(donnees.IdSecteurActivite));
    return {
      ...donnees,
      Nom: donnees.nom,
      Prenoms: isEntreprise ? '' : donnees.prenom,
      nomcomplet: isEntreprise ? donnees.nom : `${donnees.nom} ${donnees.prenom}`.trim(),
      Particulier: isEntreprise ? 'F' : 'V',
      civilite: selectedQualite ? selectedQualite.Libelle : (isEntreprise ? 'Société' : 'Monsieur'),
      ville: selectedVille ? selectedVille.Libelle : donnees.ville,
      profession: selectedProf ? selectedProf.Libelle : donnees.profession,
      libelleprofession: selectedProf ? selectedProf.Libelle : donnees.profession,
      secteur_activite: selectedSecteur ? (selectedSecteur.Libelle || selectedSecteur.LibelleSecteurActivite) : '',
    };
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(client.id || client.IdClient, versClient(formData), versClient(formInitial || formData));
    onClose();
  };

  // Navigation Précédent / Suivant entre les étapes
  const tabIndex = modalTabOrder.indexOf(modalTab);
  const isFirstTab = tabIndex === 0;
  const isLastTab = tabIndex === modalTabOrder.length - 1;
  const handlePrevTab = () => { if (!isFirstTab) setModalTab(modalTabOrder[tabIndex - 1]); };
  const handleNextTab = () => { if (!isLastTab) setModalTab(modalTabOrder[tabIndex + 1]); };

  const clientNomComplet =
    client.nomcomplet ||
    `${client.Nom || client.nom || ''} ${client.Prenoms || client.prenom || ''}`.trim() ||
    client.codeclient || client.Matricule || client.id;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Modifier la Fiche Client : ${clientNomComplet}`}
      size="large"
    >
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
                    name="typeclient_edit"
                    value="Particulier"
                    checked={formData.typeclient === 'Particulier'}
                    onChange={() => setFormData({ ...formData, typeclient: 'Particulier', Particulier: 'V', IdQualite: 1, idtypeclient: 1, idtypeassure: 1 })}
                  />
                  Personne physique
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fff', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="typeclient_edit"
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
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value, Nom: e.target.value })}
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
                    onChange={(e) => setFormData({ ...formData, prenom: e.target.value, Prenoms: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: formData.typeclient === 'Particulier' ? '1.5fr 1fr 1fr' : '1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">
                  {formData.typeclient === 'Entreprise' ? 'N° Registre de Commerce (RCCM / Patente)' : 'N° Pièce d\'Identité (CNI / Passeport)'}
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.CniPat}
                  onChange={(e) => setFormData({ ...formData, CniPat: e.target.value })}
                />
              </div>

              {formData.typeclient === 'Particulier' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Date de Naissance</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.DateNaissance || ''}
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
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value, telephone: e.target.value, Mobile: e.target.value, Telephone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Téléphone Fixe</label>
                <input
                  type="tel"
                  className="form-control"
                  value={formData.fixe}
                  onChange={(e) => setFormData({ ...formData, fixe: e.target.value, Fixe: e.target.value })}
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
                  onChange={(e) => setFormData({ ...formData, email: e.target.value, Email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Numéro de Fax</label>
                <input
                  type="tel"
                  className="form-control"
                  value={formData.fax}
                  onChange={(e) => setFormData({ ...formData, fax: e.target.value, Fax: e.target.value })}
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
                />
              </div>

              <div className="form-group">
                <label className="form-label">Complément d'Adresse (Adresse 2)</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.Adresse2}
                  onChange={(e) => setFormData({ ...formData, Adresse2: e.target.value })}
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
                  <label className="form-label">Représentant Légal</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.Responsable}
                    onChange={(e) => setFormData({ ...formData, Responsable: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Fonction du Contact</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.Fonction}
                    onChange={(e) => setFormData({ ...formData, Fonction: e.target.value })}
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
                      setFormData({ ...formData, IdProfession: id, profession: selected ? selected.Libelle : '', libelleprofession: selected ? selected.Libelle : '' });
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
                  {/* /api/secteuractivite/ renvoie le libellé dans « Libelle » */}
                  {trierParLibelle(refData.secteurs, (s) => s.Libelle || s.LibelleSecteurActivite).map((s) => (
                    <option key={s.IdSecteurActivite} value={s.IdSecteurActivite}>
                      {s.Libelle || s.LibelleSecteurActivite}
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
                <label className="form-label">Relevé d'Identité Bancaire (RIB 24 car.)</label>
                <input
                  type="text"
                  className="form-control"
                  maxLength={32}
                  value={formData.Rib}
                  onChange={(e) => setFormData({ ...formData, Rib: e.target.value })}
                  placeholder="Ex: CI092 01001 002348571029 45"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Numéro de Compte Client</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.NumeroCompte}
                  onChange={(e) => setFormData({ ...formData, NumeroCompte: e.target.value })}
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
                <span>Exonéré de Taxe d'Assurance (Art. CIMA)</span>
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

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuler
            </button>
            {!isFirstTab && (
              <button type="button" className="btn btn-secondary" onClick={handlePrevTab} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <ArrowLeft size={16} /> Précédent
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Étape {tabIndex + 1} sur {modalTabOrder.length}
            </span>
            {!isLastTab && (
              <button type="button" className="btn btn-secondary" onClick={handleNextTab} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>Suivant</span> <ArrowRight size={16} />
              </button>
            )}
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Save size={15} />
              <span>Enregistrer Modifications</span>
            </button>
          </div>
        </div>
      </form>

      {/* MODAL AJOUT RAPIDE — Profession */}
      {isAddProfessionOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
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
                  {isSavingProfession ? 'Enregistrement…' : 'Créer & Sélectionner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
};
export default EditClientModal;
