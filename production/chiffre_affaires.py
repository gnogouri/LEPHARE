"""
Chiffre d'affaires du cabinet (demande du 2026-11-12 : « Oreole est un courtier d'assurances et son chiffre d'affaires, ce
sont les commissions qu'il perçoit »). Les primes émises reviennent aux compagnies ; le revenu du cabinet, ce sont ses
commissions et ses accessoires. Lu par le cockpit opérationnel (views_cockpit) et le tableau de bord de la direction
(views_tableau_de_bord).

- Acquis : commission du contrat (stdcontrat.commissionintermediaire) + accessoires du cabinet
  (stdcontrat.accessoireintermediaire ; en Oreole Santé, frais courtiers gardés par le cabinet) des actes émis sur la
  période (date d'émission), contrats annulés exclus, comme la commission due des reversements (views_finance) ; plus la
  commission du courtier sur les régimes autofinancés RAFAS facturée sur la période (sante/rafas.py).
- Perçu : règlements de commissions des compagnies (date du règlement), frais courtiers d'Oreole Santé gardés par le
  cabinet à l'encaissement de la cotisation (date de l'encaissement, au prorata du montant encaissé), affaires antérieures
  saisies avec leur commission déjà perçue, commission RAFAS réglée (date du règlement).
- En attente (situation au jour) : commissions des primes reversées non encore payées (views_finance) et commission RAFAS
  facturée non réglée.
- Apporteurs : commissions dues aux apporteurs d'affaires sur les quittances émises de la période, d'après le dernier
  calcul du module Apporteurs (production/apporteurs.py).

Période p : {"debut", "au", "debut_n1", "au_n1"} (exercice arrêté au jour « au », même date de l'exercice précédent).
"""
import math
from datetime import date

from . import views_finance

CONTRAT_VALIDE = "COALESCE(c.idcontratannulation, 0) = 0"
# Montant valide (NaN : devis importé d'un fichier à cellules vides, compté pour zéro)
_VALIDE = "COALESCE(NULLIF({}, 'NaN'), 0)"
# Chiffre d'affaires d'un contrat c : commission + accessoires du cabinet
SQL_CHIFFRE_AFFAIRES = f"({_VALIDE.format('c.commissionintermediaire')} + {_VALIDE.format('c.accessoireintermediaire')})"
# Décaissement de prime mal affectée : compté en négatif, comme la caisse
_MONTANT_ENCAISSE = ("CASE WHEN UPPER(TRIM(COALESCE(m.abregereglement, ''))) = ANY(%(decaissements)s) "
                     "THEN -de.montant_encaissement ELSE de.montant_encaissement END")

SOURCES_PERCU = {
    "Compagnies": "Règlements de commissions des compagnies",
    "FraisCourtiers": "Frais courtiers d'Oreole Santé gardés à l'encaissement",
    "Reprises": "Affaires antérieures saisies avec leur commission perçue",
    "Rafas": "Commission RAFAS réglée",
}


def _lignes(cursor, sql, params=None):
    cursor.execute(sql, params or [])
    colonnes = [c[0] for c in cursor.description]
    return [dict(zip(colonnes, ligne)) for ligne in cursor.fetchall()]


def _table(cursor, nom):
    cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [f"public.{nom}"])
    return bool(cursor.fetchone()[0])


def _nombre(valeur):
    nombre = float(valeur or 0)
    return 0.0 if math.isnan(nombre) else nombre


def _franc(valeur):
    return round(_nombre(valeur))


def _taux(part, total):
    return round(float(part) * 100 / float(total), 1) if total else None


def _parametres(p):
    return {**p, "decaissements": sorted(views_finance.MODES_DECAISSEMENT)}


# ------------------------------------------------------------------ lectures
def lire_acquis(cursor, p):
    """Commissions et accessoires des actes émis du 1er janvier de l'exercice précédent au jour, par mois."""
    return _lignes(cursor, f"""
        SELECT EXTRACT(YEAR FROM c.dateemission)::int AS annee, EXTRACT(MONTH FROM c.dateemission)::int AS mois,
               (c.dateemission::date <= %(au_n1)s OR c.dateemission::date >= %(debut)s) AS comparable,
               COUNT(*) AS nombre, SUM({_VALIDE.format('c.commissionintermediaire')}) AS commission,
               SUM({_VALIDE.format('c.accessoireintermediaire')}) AS accessoires, SUM({_VALIDE.format('c.primenette')}) AS pn
        FROM stdcontrat c
        WHERE {CONTRAT_VALIDE} AND c.dateemission::date BETWEEN %(debut_n1)s AND %(au)s
        GROUP BY 1, 2, 3
    """, p)


def lire_percu(cursor, p):
    """Sommes perçues par le cabinet du 1er janvier de l'exercice précédent au jour : (source, idproduit, idcompagnie, jour, montant)."""
    p = _parametres(p)
    lignes = [dict(l, source="Compagnies") for l in _lignes(cursor, """
        SELECT q.idproduit, pc.compagnie_id AS idcompagnie, pc.date_paiement::date AS jour, SUM(dp.montant_commission_paye) AS montant
        FROM std_detail_paiement_commission dp
        JOIN std_paiement_commission pc ON pc.id = dp.paiement_id
        JOIN stddetailreversement d ON d.iddetailreversement = dp.detail_reversement_id
        JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
        JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
        WHERE NOT dp.est_annule AND pc.date_paiement::date BETWEEN %(debut_n1)s AND %(au)s
        GROUP BY 1, 2, 3
    """, p)]
    if _table(cursor, "lephare_oreole_package"):
        # Oreole Santé : la compagnie ne reçoit que sa part, le cabinet garde ses frais courtiers à l'encaissement
        # (views_finance.SQL_PART_COMPAGNIE) ; part du cabinet = frais courtiers / cotisation, au prorata de l'encaissé
        lignes += [dict(l, source="FraisCourtiers") for l in _lignes(cursor, f"""
            SELECT q.idproduit, ct.idcompagnie, e.dateencaissement::date AS jour,
                   SUM(({_MONTANT_ENCAISSE}) * ct.frais / NULLIF(q.primettc, 'NaN')) AS montant
            FROM stddetailencaissement de
            JOIN stdencaissement e ON e.idencaissement = de.idencaissement
            LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
            JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
            JOIN LATERAL (SELECT c.iddevis, c.idcompagnie, NULLIF(c.accessoireintermediaire, 'NaN') AS frais FROM stdcontrat c
                          WHERE c.idquittance = q.idquittance ORDER BY c.idcontrat LIMIT 1) ct ON TRUE
            WHERE NOT COALESCE(e.piece_annulee, FALSE) AND e.dateencaissement::date BETWEEN %(debut_n1)s AND %(au)s
              AND NULLIF(q.primettc, 'NaN') > 0 AND ct.frais > 0
              AND EXISTS (SELECT 1 FROM lephare_oreole_package opk WHERE opk.iddevis_sante = ct.iddevis)
            GROUP BY 1, 2, 3
        """, p)]
    if _table(cursor, "lephare_reprise"):
        # Affaire antérieure soldée : commission déjà perçue hors LE PHARE (date de la reprise à défaut, celle de l'émission)
        lignes += [dict(l, source="Reprises") for l in _lignes(cursor, f"""
            SELECT c.idproduit, c.idcompagnie, COALESCE(r.date_commission_percue, c.dateemission::date) AS jour,
                   SUM({SQL_CHIFFRE_AFFAIRES}) AS montant
            FROM lephare_reprise r JOIN stdcontrat c ON c.idcontrat = r.idcontrat
            WHERE r.commission_percue AND {CONTRAT_VALIDE}
              AND COALESCE(r.date_commission_percue, c.dateemission::date) BETWEEN %(debut_n1)s AND %(au)s
            GROUP BY 1, 2, 3
        """, p)]
    return lignes


def lire_rafas(cursor, p):
    """Commission du courtier sur les régimes autofinancés : facturée (date d'émission), réglée (date de règlement), et reste
    non réglé au jour. Rien sans la migration production 0218."""
    if not _table(cursor, "lephare_rafas_honoraire"):
        return {"Lignes": [], "NonReglee": 0.0}
    lignes = _lignes(cursor, """
        SELECT 'emis' AS sens, date_emission AS jour, COUNT(*) AS nombre, SUM(montant) AS montant, SUM(base) AS base
        FROM lephare_rafas_honoraire WHERE beneficiaire = 'COURTIER' AND date_emission BETWEEN %(debut_n1)s AND %(au)s GROUP BY 2
        UNION ALL
        SELECT 'regle', date_paiement, COUNT(*), SUM(montant), 0
        FROM lephare_rafas_honoraire WHERE beneficiaire = 'COURTIER' AND date_paiement BETWEEN %(debut_n1)s AND %(au)s GROUP BY 2
    """, p)
    cursor.execute("""SELECT COALESCE(SUM(montant), 0) FROM lephare_rafas_honoraire
                      WHERE beneficiaire = 'COURTIER' AND date_paiement IS NULL AND date_emission <= %s""", [p["au"]])
    return {"Lignes": lignes, "NonReglee": _nombre(cursor.fetchone()[0])}


def lire_apporteurs(cursor, p):
    """Commissions des apporteurs d'affaires sur les quittances émises de la période (payées ou à payer)."""
    if not _table(cursor, "lephare_commission_apporteur"):
        return {"Payees": 0.0, "APayer": 0.0}
    cursor.execute("""
        SELECT COALESCE(SUM(montant) FILTER (WHERE statut = 'PAYEE'), 0), COALESCE(SUM(montant) FILTER (WHERE statut = 'A_PAYER'), 0)
        FROM lephare_commission_apporteur WHERE statut <> 'ANNULEE' AND dateemission BETWEEN %(debut)s AND %(au)s
    """, p)
    payees, a_payer = cursor.fetchone()
    return {"Payees": _nombre(payees), "APayer": _nombre(a_payer)}


# ------------------------------------------------------------------ synthèse (sans base de données)
def _jour(valeur):
    return valeur if isinstance(valeur, date) else date.fromisoformat(str(valeur)[:10])


def assembler(p, acquis, percu, rafas, apporteurs, en_attente=None):
    """Chiffre d'affaires de la période, comparé au même temps de l'exercice précédent, par mois, et perçu par branche et
    par compagnie. en_attente : commissions des primes reversées non payées (AReclamer, Reclamees), situation au jour."""
    annee, debut, au, au_n1 = p["debut"].year, p["debut"], p["au"], p["au_n1"]
    mois = {m: {"Mois": m, "Acquis": 0.0, "AcquisPrecedent": 0.0, "Percu": 0.0} for m in range(1, 13)}
    t = {"Commissions": 0.0, "Accessoires": 0.0, "Rafas": 0.0, "PrimeNette": 0.0, "Nombre": 0, "Precedent": 0.0}

    for l in acquis:
        ca = _nombre(l["commission"]) + _nombre(l["accessoires"])
        if l["annee"] == annee:
            t["Commissions"] += _nombre(l["commission"])
            t["Accessoires"] += _nombre(l["accessoires"])
            t["PrimeNette"] += _nombre(l["pn"])
            t["Nombre"] += l["nombre"]
            mois[l["mois"]]["Acquis"] += ca
        else:
            mois[l["mois"]]["AcquisPrecedent"] += ca
            if l["comparable"]:
                t["Precedent"] += ca

    percu_sources = {cle: 0.0 for cle in SOURCES_PERCU}
    percu_n1, par_produit, par_compagnie = 0.0, {}, {}

    def compter_percu(source, jour, montant, id_produit=None, id_compagnie=None):
        nonlocal percu_n1
        if debut <= jour <= au:
            percu_sources[source] += montant
            mois[jour.month]["Percu"] += montant
            if source != "Rafas":
                par_produit[id_produit] = par_produit.get(id_produit, 0.0) + montant
                par_compagnie[id_compagnie] = par_compagnie.get(id_compagnie, 0.0) + montant
        elif jour <= au_n1:
            percu_n1 += montant

    for l in percu:
        compter_percu(l["source"], _jour(l["jour"]), _nombre(l["montant"]), l["idproduit"], l["idcompagnie"])

    rafas_nombre = rafas_base = 0.0
    for l in rafas["Lignes"]:
        jour, montant = _jour(l["jour"]), _nombre(l["montant"])
        if l["sens"] == "regle":
            compter_percu("Rafas", jour, montant)
        elif jour.year == annee:
            t["Rafas"] += montant
            rafas_nombre += l["nombre"]
            rafas_base += _nombre(l["base"])
            mois[jour.month]["Acquis"] += montant
        else:
            mois[jour.month]["AcquisPrecedent"] += montant
            if jour <= au_n1:
                t["Precedent"] += montant

    total = t["Commissions"] + t["Accessoires"] + t["Rafas"]
    en_attente = en_attente or {}
    attente = {"AReclamer": _nombre(en_attente.get("AReclamer")), "Reclamees": _nombre(en_attente.get("Reclamees")),
               "Rafas": rafas["NonReglee"]}
    retro = apporteurs["Payees"] + apporteurs["APayer"]
    en_cours = annee == au.year and au.month < 12
    return {
        "Total": _franc(total),
        "Commissions": _franc(t["Commissions"]), "Accessoires": _franc(t["Accessoires"]), "Rafas": _franc(t["Rafas"]),
        "Nombre": t["Nombre"], "RafasFactures": int(rafas_nombre), "RafasBase": _franc(rafas_base),
        "PrimeNette": _franc(t["PrimeNette"]),
        # Revenu du cabinet rapporté aux primes nettes des actes (RAFAS à part : pas de prime d'assurance)
        "TauxMoyen": _taux(t["Commissions"] + t["Accessoires"], t["PrimeNette"]),
        "Precedent": _franc(t["Precedent"]),
        "Percu": {"Total": _franc(sum(percu_sources.values())), **{cle: _franc(v) for cle, v in percu_sources.items()}},
        "PercuPrecedent": _franc(percu_n1),
        "EnAttente": {"Total": _franc(sum(attente.values())), **{cle: _franc(v) for cle, v in attente.items()}},
        "Apporteurs": {"Total": _franc(retro), "Payees": _franc(apporteurs["Payees"]), "APayer": _franc(apporteurs["APayer"])},
        "Net": _franc(total - retro),
        "ParMois": [{
            "Mois": m,
            # Mois à venir de l'exercice en cours : pas de chiffre (et non zéro)
            "ChiffreAffaires": _franc(v["Acquis"]) if not (en_cours and m > au.month) else None,
            "ChiffreAffairesPrecedent": _franc(v["AcquisPrecedent"]),
            "Percu": _franc(v["Percu"]) if not (en_cours and m > au.month) else None,
        } for m, v in mois.items()],
        "PercuParProduit": {k: _franc(v) for k, v in par_produit.items()},
        "PercuParCompagnie": {k: _franc(v) for k, v in par_compagnie.items()},
    }


def calculer(cursor, p, en_attente=None):
    """Chiffre d'affaires de la période p (lectures seules)."""
    return assembler(p, lire_acquis(cursor, p), lire_percu(cursor, p), lire_rafas(cursor, p), lire_apporteurs(cursor, p),
                     en_attente)
