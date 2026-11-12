import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shield, Lock, User, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { nomCabinet } from '../../utils/parametrage';

// Connexion avec le compte LE PHARE (mêmes identifiants que dans URANUS : adresse e-mail et mot de passe)
const messageErreur = (err) => {
  const statut = err?.response?.status;
  const data = err?.response?.data;
  if (!err?.response) return 'Serveur injoignable : vérifiez la connexion puis réessayez.';
  if (statut === 403) return data?.detail || 'Connexion refusée.';
  if (statut === 400) return 'Adresse e-mail ou mot de passe incorrect.';
  return data?.detail || data?.error || 'Connexion impossible.';
};

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const connecter = async (e) => {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await login(email, motDePasse);
      navigate('/user/dashboard', { replace: true });
    } catch (err) {
      setErreur(messageErreur(err));
      setMotDePasse('');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 20%, rgba(37,99,235,0.2) 0%, transparent 60%), #0b1120', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '1.75rem 1.85rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 2px 10px rgba(37,99,235,0.4)', marginBottom: '0.75rem' }}>
            <Shield size={24} />
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>LE PHARE</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{nomCabinet()}</p>
        </div>

        {params.get('session') === 'expiree' && !erreur && (
          <div className="bandeau-anime" role="status" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--accent-amber)', color: '#fcd34d', fontSize: '0.8rem', marginBottom: '1rem' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} /> Votre session a expiré ou a été fermée : reconnectez-vous.
          </div>
        )}
        {erreur && (
          <div role="alert" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--accent-rose)', color: '#fda4af', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {erreur}
          </div>
        )}

        <form onSubmit={connecter}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Adresse e-mail</label>
            <div style={{ position: 'relative' }}>
              <User size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input id="email" type="email" autoComplete="username" className="form-control" style={{ paddingLeft: '2.6rem' }} value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@oreole-ci.com" required autoFocus />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="mot-de-passe">Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input id="mot-de-passe" type="password" autoComplete="current-password" className="form-control" style={{ paddingLeft: '2.6rem' }}
                value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder="••••••••" required />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={envoi} style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}>
            {envoi ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
            <span>Se connecter</span>
          </button>
        </form>
        <p style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Les comptes existants utilisent leur adresse e-mail et leur mot de passe habituels. Mot de passe oublié : adressez-vous à l'administrateur.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
