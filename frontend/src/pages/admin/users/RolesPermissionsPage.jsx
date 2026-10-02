import React, { useState } from 'react';
import { Lock, Shield, Check, UserCheck } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';

export const RolesPermissionsPage = () => {
  const { success } = useToast();

  const [permissions, setPermissions] = useState([
    { id: 1, module: 'Production Auto', operation: 'Créer Devis Automobile', admin: true, manager: true, operator: true },
    { id: 2, module: 'Production Auto', operation: 'Consolider en Contrat Définitif', admin: true, manager: true, operator: false },
    { id: 3, module: 'Encaissements', operation: 'Encaisser Prime & Émettre Reçu', admin: true, manager: true, operator: true },
    { id: 4, module: 'Encaissements', operation: 'Annuler une Quittance Encaissée', admin: true, manager: false, operator: false },
    { id: 5, module: 'ASACI', operation: 'Émettre Attestation Digitale Auto', admin: true, manager: true, operator: true },
    { id: 6, module: 'Dérogations', operation: 'Approuver Dérogations & Générer Jetons', admin: true, manager: false, operator: false },
    { id: 7, module: 'Reversements', operation: 'Valider Ordre de Virement Compagnies', admin: true, manager: false, operator: false },
    { id: 8, module: 'Reporting CIMA', operation: 'Consulter & Télécharger États E1/E2', admin: true, manager: true, operator: false },
  ]);

  const togglePerm = (id, roleKey) => {
    setPermissions(
      permissions.map((p) =>
        p.id === id ? { ...p, [roleKey]: !p[roleKey] } : p
      )
    );
  };

  const handleSave = () => {
    success('Matrice des droits et permissions mise à jour avec succès !');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="title-xl" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Lock size={26} color="#8b5cf6" />
            Droits d'accès détaillés
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Le tableau complet des droits, opération par opération.
          </p>
        </div>

        <button className="btn btn-primary" onClick={handleSave} style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
          <Check size={16} /> Enregistrer la Matrice
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Module Métier</th>
              <th>Action Sécurisée</th>
              <th style={{ textAlign: 'center' }}>Direction (Admin)</th>
              <th style={{ textAlign: 'center' }}>Superviseur (Manager)</th>
              <th style={{ textAlign: 'center' }}>Opérateur (Souscription)</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((perm) => (
              <tr key={perm.id}>
                <td><strong style={{ color: '#60a5fa' }}>{perm.module}</strong></td>
                <td><span style={{ color: '#fff' }}>{perm.operation}</span></td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={perm.admin}
                    onChange={() => togglePerm(perm.id, 'admin')}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={perm.manager}
                    onChange={() => togglePerm(perm.id, 'manager')}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={perm.operator}
                    onChange={() => togglePerm(perm.id, 'operator')}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RolesPermissionsPage;
