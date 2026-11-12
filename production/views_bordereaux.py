"""
Bordereaux et courriers d'OREOLE aux compagnies, tableau de reversement : modèles du dossier FInance_LEPHARE
(bordereaux JCW 1175 et 2088, bordereau 2117, courriers JCW et KOUMOUE, tableaux SANLAM « COMMI-MOIS » et NSIA
« primes non soldées »), demande du 2026-10-19.

Le titre du bordereau dépend de l'ordre des règlements transmis :
- chèques (ou virements) du client à l'ordre de la compagnie, et toute prime payée en espèces (demande du 2026-10-20 :
  pas de reversement par le cabinet ni de versement au compte de la compagnie) : BORDEREAU DE RECLAMATION DE
  COMMISSION, « Montant à reverser » 0 et « Montant reversé » Direct ; le reversement est payé dès l'émission (mode
  « A la compagnie », ou « Espèces ») ;
- primes encaissées par OREOLE (chèques à son ordre, paiement mobile, virements) : OREOLE les reverse par son
  propre chèque, BORDEREAU DE REVERSEMENT DE PRIME, « Montant à reverser » = prime reversée entière (Code CIMA).
Un bordereau porte un ou plusieurs clients ; une sélection qui mêle les deux ordres donne deux bordereaux.

Colonnes du bordereau (vérifiées au franc sur les bordereaux 1175, 2088 et 2117) :
  Prime HT = prime nette hors accessoires, taxes, FGA et CEDEAO (fn_lephare_prime_ht) ;
  Encaissement = cumul payé par le client sur la quittance à la date du bordereau ;
  Acc. Courtier = accessoires du cabinet (stdcontrat.accessoireintermediaire ; NSIA et SUNU : 50/50) ;
  Commission = Prime HT x taux (stdcontrat.commissionintermediaire), réclamée entière dès le 1er acompte ;
  Frais gestion, Com. Déduite, Acc. déduits = 0 (Code CIMA : le courtier ne déduit rien des primes) ;
  Montant Reversé = prime reversée, ou « Direct ».
Les primes soldées et les primes en arriéré (acompte : reste dû) forment deux blocs.

Tableau de reversement (COMMI-MOIS) : une ligne par quittance, au mois de son dernier bordereau, les reversements
suivants en sous-lignes ; L = somme des M, Q = J x P + O (commission à percevoir), S = Q - R ; total par mois et état
récapitulatif ; feuilles séparées pour les primes soldées / non soldées et les commissions perçues / non perçues.
"""

import io
from collections import OrderedDict
from datetime import date, datetime
from decimal import Decimal

from django.db import connection, transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from configuration_api.parametrage import valeur_parametre

from .models import BordereauReversement
from .reste_encaissement import reste_a_encaisser
from .views_finance import (
    AUTHENTIFICATION,
    ZERO,
    EcrituresAdministrateur,
    ErreurFinance,
    SQL_ACC_COURTIER,
    SQL_LIGNES_ENCAISSEMENT,
    SQL_PART_COMPAGNIE,
    _date,
    _entier,
    _erreur,
    _est_decaissement,
    _iso,
    _lignes,
    _nombre,
    _restes_nets,
    controle_paiement_cabinet,
    debut_reversements,
    part_compagnie,
)

REVERSEMENT = BordereauReversement.NATURE_REVERSEMENT
RECLAMATION = BordereauReversement.NATURE_RECLAMATION
TITRES = {REVERSEMENT: "BORDEREAU DE REVERSEMENT DE PRIME", RECLAMATION: "BORDEREAU DE RECLAMATION DE COMMISSION"}
NOMS_BORDEREAU = {REVERSEMENT: "le bordereau de reversement de prime", RECLAMATION: "le bordereau de réclamation de commission"}
MODE_A_LA_COMPAGNIE = 28  # stdmodeencaissement « A la compagnie » (CHQ, banque) : chèque du client transmis
MODE_ESPECES = 2
LIBELLES_BRANCHE = {
    1: "Automobile", 2: "Individuelle Accidents", 3: "Voyage", 4: "Multirisque Habitation", 5: "Santé",
    6: "Transport", 7: "Multirisque Professionnelle", 8: "Responsabilité Civile", 9: "Tous Dommages", 10: "Vie",
}
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre",
        "décembre"]
ORDINAUX = {1: "premier", 2: "deuxième", 3: "troisième", 4: "quatrième", 5: "cinquième", 6: "sixième"}


# ------------------------------------------------------------------ outils
def _f(montant):
    """Montant au format des documents d'OREOLE : 1 073 824."""
    return f"{int(round(Decimal(montant or 0))):,}".replace(",", " ")


def _jma(valeur):
    if not valeur:
        return ""
    if isinstance(valeur, datetime):
        valeur = valeur.date()
    return valeur.strftime("%d/%m/%Y")


def _date_lettres(valeur):
    return f"{valeur.day:02d} {MOIS[valeur.month - 1]} {valeur.year}"


def _branche(id_produit, libelle):
    return LIBELLES_BRANCHE.get(id_produit) or (libelle or "").strip().title()


def _ordinal(rang):
    return ORDINAUX.get(rang, f"{rang}e")


def _texte(valeur, longueur):
    return str(valeur or "").strip()[:longueur]


def reglages_compagnie(id_compagnie, raison_sociale=""):
    """Réglages « Reversements » de la compagnie (Administration > Compagnies), complétés des valeurs par défaut."""
    from configuration_api.models import CompagnieDocument

    document = CompagnieDocument.objects.filter(IdCompagnie=id_compagnie).first()
    r = dict((document.Reversement or {}) if document else {})
    nom = (raison_sociale or "").strip()
    return {
        "NomBordereau": (r.get("NomBordereau") or nom).strip(),
        "Destinataire": (r.get("Destinataire") or nom).strip(),
        "Service": (r.get("Service") or "").strip(),
        "Ville": (r.get("Ville") or "ABIDJAN").strip(),
        "AttentionDe": (r.get("AttentionDe") or "").strip(),
        "Appellation": (r.get("Appellation") or "Monsieur").strip(),
        "PartAccessoiresCourtier": r.get("PartAccessoiresCourtier"),
    }


def ligne_attention(destinataire):
    """Ligne « À l'attention … » d'un courrier. Le réglage de la compagnie donne la personne ou la fonction, avec son
    article au besoin : « du Directeur de Courtage » ou « le Directeur de Courtage » → « À l'attention du Directeur de
    Courtage » ; « Monsieur TANO » → « À l'attention de Monsieur TANO ». (Même règle : impressionsFinance.js.)"""
    texte = " ".join(str(destinataire or "").replace("’", "'").split())
    bas = texte.lower()
    if not texte or bas.startswith(("à l'attention", "a l'attention")):
        return texte
    if bas.startswith(("du ", "des ", "d'")) or texte.startswith("de "):
        return f"À l'attention {texte}"
    for article, contraction in (("le ", "du "), ("les ", "des "), ("la ", "de la "), ("l'", "de l'")):
        if bas.startswith(article):
            return f"À l'attention {contraction}{texte[len(article):]}"
    return f"À l'attention de {texte}"


def numero_bordereau(numero_quittance, jour):
    """Numéro d'un bordereau : code courtier (contrat de la première prime) + mois + exercice + « B » + n° du mois
    (fn_lephare_numero_bordereau, suite commune à toutes les pièces du mois ; sans la catégorie depuis 2026-10-21)."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT public.fn_lephare_numero_bordereau(%s, %s)", [numero_quittance, jour])
        return cursor.fetchone()[0]


# ------------------------------------------------------------------ quittances, paiements, règlements
SQL_QUITTANCES = """
    SELECT q.idquittance, q.numeroquittance, q.numeropolice, q.idproduit, p.libelleproduit,
           q.dateeffet::date AS dateeffet, q.dateexpiration::date AS dateexpiration, q.primettc,
           TRIM(cl.nom || ' ' || COALESCE(cl.prenoms, '')) AS client,
           ct.idcontrat, ct.idcompagnie, NULLIF(TRIM(ct.numeroavenant), '') AS avenant,
           CASE WHEN UPPER(TRIM(COALESCE(ct.numeropolicecompagnie, ''))) IN ('', 'RAS', 'NEANT') THEN NULL
                ELSE TRIM(ct.numeropolicecompagnie) END AS policecompagnie,
           NULLIF(TRIM(ct.numeroavenantcompagnie), '') AS avenantcompagnie,
           COALESCE(ct.taux_commission, q.taux_commission, 0) AS taux,
           COALESCE(ct.commissionintermediaire, 0) AS commission,
           """ + SQL_ACC_COURTIER.format(ct="ct") + """ AS acccourtier, """ + SQL_PART_COMPAGNIE.format(ct="ct") + """ AS partcompagnie,
           public.fn_lephare_prime_ht(COALESCE(ct.primenette, q.primenette), COALESCE(ct.accessoire, q.accessoire),
                                      COALESCE(ct.taxe, q.taxe), ct.fga, ct.cedeao, COALESCE(ct.primettc, q.primettc),
                                      ct.primeimposee) AS primeht
    FROM stdquittance q
    LEFT JOIN LATERAL (SELECT c.* FROM stdcontrat c WHERE c.idquittance = q.idquittance ORDER BY c.idcontrat LIMIT 1) ct ON TRUE
    LEFT JOIN stdproduit p ON p.idproduit = q.idproduit
    LEFT JOIN stdclient cl ON cl.idclient = q.idclient
    WHERE q.numeroquittance = ANY(%s)
"""


def _quittances(numeros):
    if not numeros:
        return {}
    return {q["numeroquittance"]: q for q in _lignes(SQL_QUITTANCES, [list(numeros)])}


def _avenant(q):
    """Avenant imprimé : celui de la compagnie s'il est connu, sinon le n° d'avenant du contrat (0000001 → 1)."""
    if q["avenantcompagnie"]:
        return q["avenantcompagnie"]
    avenant = (q["avenant"] or "").strip()
    return str(int(avenant)) if avenant.isdigit() else avenant


def _infos_quittance(q):
    branche = _branche(q["idproduit"], q["libelleproduit"])
    return {
        "IdQuittance": q["idquittance"],
        "NumeroQuittance": q["numeroquittance"],
        "IdContrat": q["idcontrat"],
        "Client": q["client"] or "",
        "Branche": branche,
        "Assurance": f"Assurance {branche}",
        "NumeroPolice": q["numeropolice"] or "",
        "PoliceCompagnie": q["policecompagnie"] or "",
        # Police et avenant déduits du contrat : n° de la compagnie s'il a été saisi au devis, sinon ceux du système
        "AvenantCompagnie": _avenant(q),
        "DateEffet": _iso(q["dateeffet"]),
        "DateExpiration": _iso(q["dateexpiration"]),
        "PrimeHT": _nombre(round(q["primeht"] or 0)),
        "PrimeTtc": _nombre(part_compagnie(q["primettc"], q["partcompagnie"])),
        "AccCourtier": _nombre(q["acccourtier"]),
        "Taux": _nombre(q["taux"]),
        "Commission": _nombre(q["commission"]),
    }


def _paiements(numeros):
    """Encaissements valides de chaque quittance, dans l'ordre : rang, cumul payé après chacun, statut (comptant,
    1er acompte…, solde). Un décaissement (DMA) diminue le cumul sans compter comme paiement. Un reliquat de moins de
    5 F compte comme soldé."""
    if not numeros:
        return {}
    lignes = _lignes(
        """
        SELECT de.iddetailencaissement, de.numeroquittance, e.dateencaissement::date AS dateencaissement,
               de.montant_encaissement, UPPER(TRIM(COALESCE(m.abregereglement, ''))) AS abrege, q.primettc
        FROM stddetailencaissement de
        JOIN stdencaissement e ON e.idencaissement = de.idencaissement
        JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
        LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
        WHERE de.numeroquittance = ANY(%s) AND NOT COALESCE(e.piece_annulee, FALSE) AND de.montant_encaissement > 0
        ORDER BY e.dateencaissement, de.iddetailencaissement
        """,
        [list(numeros)],
    )
    resultat = {}
    for l in lignes:
        liste = resultat.setdefault(l["numeroquittance"], [])
        precedent = liste[-1] if liste else {"Cumul": ZERO, "Rang": 0}
        decaissement = _est_decaissement(l)
        cumul = precedent["Cumul"] + (-l["montant_encaissement"] if decaissement else l["montant_encaissement"])
        rang = precedent["Rang"] + (0 if decaissement else 1)
        ttc = l["primettc"] or ZERO
        if ttc > 0 and reste_a_encaisser(ttc, cumul) == 0:
            code = "COMPTANT" if rang == 1 else "SOLDE"
        else:
            code = "ACOMPTE"
        liste.append({"IdDetail": l["iddetailencaissement"], "Date": l["dateencaissement"], "Cumul": cumul,
                      "Rang": rang, "Code": code, "Decaissement": decaissement})
    return resultat


def _libelle_paiement(code, rang):
    # Prime payée en totalité, en un seul règlement ou au dernier acompte : « Soldé » (demande du 2026-10-21, au lieu
    # de « Comptant » et « Solde »)
    if code in ("COMPTANT", "SOLDE"):
        return "Soldé"
    return "1er acompte" if rang == 1 else f"{rang}e acompte"


def _paiement_de(paiements, numero, id_detail):
    return next((p for p in paiements.get(numero, []) if p["IdDetail"] == id_detail), None)


SQL_REGLEMENTS = """
    SELECT e.idencaissement, e.idmodepaiement, UPPER(TRIM(COALESCE(m.abregereglement, ''))) AS abrege,
           m.libellemodepaiement AS mode, e.dateencaissement::date AS dateencaissement, e.datecheque,
           -- Espèces : transmises directement à la compagnie (réclamation de commission), sans reversement par le
           -- cabinet (demande du 2026-10-20), quel que soit l'ordre saisi auparavant. Package Oreole Santé : l'argent reste au
           -- cabinet, qui garde ses frais courtiers et reverse à chaque compagnie sa part, quel que soit le mode (décision du 2026-11-05)
           CASE WHEN pk.package THEN 'CABINET'
                WHEN e.idmodepaiement = %s OR e.ordrereglement = 'COMPAGNIE'
                     OR UPPER(TRIM(COALESCE(m.abregereglement, ''))) = 'ESP' THEN 'COMPAGNIE' ELSE 'CABINET' END AS ordre,
           NULLIF(TRIM(e.numerocheque), '') AS numerocheque, NULLIF(TRIM(e.numerobordereau), '') AS numerobordereau,
           NULLIF(TRIM(e.numerorecuoperateur), '') AS recu, NULLIF(TRIM(e.compte_compensation), '') AS compensation,
           e.idbanque, CASE WHEN UPPER(TRIM(COALESCE(b.libelle, ''))) IN ('', 'NEANT', 'AUCUNE', 'AUCUN') THEN NULL
                            ELSE TRIM(b.libelle) END AS banque,
           e.montantencaissement, ch.montantinitial
    FROM stdencaissement e
    LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
    LEFT JOIN stdbanque b ON b.idbanque = e.idbanque
    LEFT JOIN LATERAL (SELECT c.montantinitial FROM stdchequeoperation op JOIN stdcheque c ON c.idcheque = op.idcheque
                       WHERE op.idencaissement = e.idencaissement ORDER BY op.idoperation LIMIT 1) ch ON TRUE
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM stddetailencaissement dx JOIN stdquittance qx ON qx.numeroquittance = dx.numeroquittance
                                       JOIN stdcontrat cx ON cx.idquittance = qx.idquittance
                                       JOIN lephare_oreole_package px ON cx.iddevis IN (px.iddevis_sante, px.iddevis_ia, px.iddevis_afa)
                                       WHERE dx.idencaissement = e.idencaissement) AS package) pk
    WHERE e.idencaissement = ANY(%s)
"""


def _reglements(ids_encaissement):
    if not ids_encaissement:
        return {}
    return {r["idencaissement"]: r for r in _lignes(SQL_REGLEMENTS, [MODE_A_LA_COMPAGNIE, list(ids_encaissement)])}


def _montant_instrument(r):
    """Montant du chèque entier (un chèque peut régler plusieurs quittances), sinon celui de l'encaissement."""
    return r["montantinitial"] or r["montantencaissement"]


def _instrument(r, pour_courrier=False):
    """Description d'un règlement du client : colonne « Nature du reversement » du tableau, ou texte du courrier."""
    jour = _jma(r["datecheque"] or r["dateencaissement"])
    montant = _f(_montant_instrument(r))
    banque = f"{r['banque']} " if r["banque"] else ""
    if r["abrege"] == "CHQ" or r["idmodepaiement"] == MODE_A_LA_COMPAGNIE:
        return (f"le chèque {banque}N°{r['numerocheque'] or ''} du {jour} de FCFA {montant}" if pour_courrier
                else f"CHQ {banque}N°{r['numerocheque'] or ''} du {jour} de FCFA {montant}")
    if r["abrege"] == "VIR":
        return (f"l'avis de virement {banque}N°{r['numerocheque'] or ''} du {jour} de FCFA {montant}" if pour_courrier
                else f"VIR {banque}N°{r['numerocheque'] or ''} du {jour} de FCFA {montant}")
    if r["abrege"] == "TRT":
        return f"{'la traite' if pour_courrier else 'TRAITE'} {banque}N°{r['numerocheque'] or ''} du {jour} de FCFA {montant}"
    if r["abrege"] == "ESP":
        # Espèces transmises directement à la compagnie : pas de bordereau de versement (demande du 2026-10-20)
        numero = f" N°{r['numerobordereau']}" if r["numerobordereau"] else ""
        return f"{'le règlement en espèces' if pour_courrier else 'Espèces'}{numero} du {jour} de FCFA {montant}"
    if r["abrege"] == "PYM":
        return f"{'le paiement' if pour_courrier else 'Paiement'} mobile N°{r['recu'] or ''} du {jour} de FCFA {montant}"
    reference = r["numerocheque"] or r["compensation"] or ""
    return f"{r['mode'] or 'Règlement'} {reference} du {jour} de FCFA {montant}".replace("  ", " ")


def _libelle_instrument(abrege, id_mode, mode):
    """Libellé d'un règlement au pied du bordereau : « CHÈQUE N° … », « ESPÈCES du … »…"""
    if abrege in ("CHQ",) or id_mode == MODE_A_LA_COMPAGNIE:
        return "CHÈQUE"
    return {"VIR": "VIREMENT", "TRT": "TRAITE", "ESP": "ESPÈCES", "PYM": "PAIEMENT MOBILE"}.get(abrege) or (mode or "RÈGLEMENT").upper()


def _paiement_cabinet(entete, pour_courrier=False):
    """Règlement d'OREOLE à la compagnie (bordereau de reversement), enregistré par sp_validation_reversement."""
    if not entete["valide"]:
        return "" if pour_courrier else "À payer à la compagnie"
    jour = _jma(entete["datereversement"])
    montant = _f(entete["montantreversement"])
    banque = f"{entete['banque']} " if entete["banque"] else ""
    if entete["abrege"] in ("CHQ", "TRT"):
        return (f"notre chèque {banque}N°{entete['numerocheque'] or ''} du {jour} de FCFA {montant}" if pour_courrier
                else f"CHQ {banque}N°{entete['numerocheque'] or ''} du {jour} de FCFA {montant}")
    if entete["abrege"] == "VIR":
        return (f"notre virement {banque}N°{entete['numerocheque'] or ''} du {jour} de FCFA {montant}" if pour_courrier
                else f"VIR {banque}N°{entete['numerocheque'] or ''} du {jour} de FCFA {montant}")
    return f"{'notre règlement ' if pour_courrier else ''}{entete['mode'] or ''} du {jour} de FCFA {montant}".strip()


# ------------------------------------------------------------------ primes à transmettre
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def a_transmettre(request):
    """GET /api/finance/bordereaux/a-transmettre/?compagnie= : primes encaissées non encore transmises, avec l'ordre
    du règlement (nature du bordereau), le statut de paiement de la quittance et les colonnes du bordereau."""
    try:
        id_compagnie = _entier(request.query_params.get("compagnie"), "Compagnie")
    except ErreurFinance as erreur:
        return _erreur(erreur)
    brutes = _lignes(
        SQL_LIGNES_ENCAISSEMENT + """
        WHERE cie.idcompagnie = %s AND NOT COALESCE(e.piece_annulee, FALSE)
          AND de.montant_encaissement > COALESCE(de.montantreglement, 0)
          AND e.dateencaissement::date >= %s
        ORDER BY e.dateencaissement DESC, de.iddetailencaissement DESC
        """,
        [id_compagnie, debut_reversements()],
    )
    brutes = [l for l in brutes if not _est_decaissement(l)]
    numeros = {l["numeroquittance"] for l in brutes}
    restes = _restes_nets(numeros)
    quittances = _quittances(numeros)
    paiements = _paiements(numeros)
    reglements = _reglements({l["idencaissement"] for l in brutes})
    resultat = []
    for l in brutes:
        reste = restes.get(l["iddetailencaissement"], ZERO)
        q = quittances.get(l["numeroquittance"])
        if reste <= 0 or not q:
            continue
        r = reglements.get(l["idencaissement"])
        p = _paiement_de(paiements, l["numeroquittance"], l["iddetailencaissement"])
        cumul_total = paiements.get(l["numeroquittance"], [{}])[-1].get("Cumul", ZERO)
        ordre = r["ordre"] if r else "CABINET"
        resultat.append({
            **_infos_quittance(q),
            "IdDetailEncaissement": l["iddetailencaissement"],
            "IdEncaissement": l["idencaissement"],
            "NumeroPiece": l["numeropiece"] or "",
            "DateEncaissement": _iso(l["dateencaissement"]),
            "Mode": l["mode"] or "",
            "Reference": l["reference"] or "",
            "Banque": l["banque"] or "",
            "Reglement": _instrument(r) if r else "",
            "Ordre": ordre,
            "Nature": RECLAMATION if ordre == "COMPAGNIE" else REVERSEMENT,
            "Montant": _nombre(l["montant_encaissement"]),
            "ResteAReverser": _nombre(reste),
            "CumulEncaisse": _nombre(p["Cumul"] if p else cumul_total),
            "Arriere": _nombre(part_compagnie(max((q["primettc"] or ZERO) - cumul_total, ZERO), q["partcompagnie"])),
            "StatutPaiement": p["Code"] if p else "",
            "LibelleStatutPaiement": _libelle_paiement(p["Code"], p["Rang"]) if p else "",
        })
    return Response({"Lignes": resultat, "DebutReversements": debut_reversements().isoformat()})


# ------------------------------------------------------------------ bordereaux
SQL_ENTETES = """
    SELECT r.idreversement, r.numeroreversement, r.datereversement, r.idcompagnie, cie.raisonsociale AS compagnie,
           r.montantreversement, COALESCE(r.valide, FALSE) AS valide, r.datevalidation,
           NULLIF(TRIM(r.numerocheque), '') AS numerocheque, r.idmodereversement, m.libellemodepaiement AS mode,
           UPPER(TRIM(COALESCE(m.abregereglement, ''))) AS abrege,
           CASE WHEN UPPER(TRIM(COALESCE(bq.libelle, ''))) IN ('', 'NEANT', 'AUCUNE', 'AUCUN') THEN NULL ELSE TRIM(bq.libelle) END AS banque,
           b.id AS idbordereau, b.numero, COALESCE(b.nature, %s) AS nature, b.datebordereau, b.datedecharge,
           (SELECT COUNT(DISTINCT de.numeroquittance) FROM stddetailreversement d
            JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
            WHERE d.idreversement = r.idreversement) AS nombre,
           (SELECT STRING_AGG(DISTINCT TRIM(cl.nom || ' ' || COALESCE(cl.prenoms, '')), ', ')
            FROM stddetailreversement d
            JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
            JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
            JOIN stdclient cl ON cl.idclient = q.idclient
            WHERE d.idreversement = r.idreversement) AS clients
    FROM stdreversementcompagnie r
    LEFT JOIN lephare_bordereau_reversement b ON b.idreversement = r.idreversement
    LEFT JOIN stdcompagnie cie ON cie.idcompagnie = r.idcompagnie
    LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = r.idmodereversement
    LEFT JOIN stdbanque bq ON bq.idbanque = r.idbanque
    WHERE NOT COALESCE(r.pieceannulee, FALSE) AND NOT COALESCE(b.annule, FALSE)
"""


def _entete_json(e):
    nature = e["nature"]
    direct = nature == RECLAMATION
    return {
        "IdReversement": e["idreversement"],
        "IdBordereau": e["idbordereau"],
        "Numero": e["numero"],
        "NumeroReversement": (e["numeroreversement"] or "").strip(),
        "Nature": nature,
        "Titre": TITRES[nature],
        "DateBordereau": _iso(e["datebordereau"] or e["datereversement"]),
        "DateDecharge": _iso(e["datedecharge"]),
        "IdCompagnie": e["idcompagnie"],
        "Compagnie": e["compagnie"] or "",
        "Clients": e["clients"] or "",
        "NombreQuittances": e["nombre"],
        "MontantReverse": _nombre(e["montantreversement"]),
        "MontantAReverser": 0.0 if direct else _nombre(e["montantreversement"]),
        "Direct": direct,
        "Valide": bool(e["valide"]),
        "Paiement": _paiement_cabinet(e) if not direct else "Chèque(s) du client transmis",
        "Statut": "TRANSMIS" if direct else ("PAYE" if e["valide"] else "A_PAYER"),
        "LibelleStatut": ("Transmis (direct)" if direct else ("Payé à la compagnie" if e["valide"] else "À payer à la compagnie")),
    }


SQL_DETAILS = """
    SELECT d.iddetailreversement, d.idreversement, d.montantreverse, de.iddetailencaissement, de.idencaissement,
           de.numeroquittance, e.dateencaissement::date AS dateencaissement
    FROM stddetailreversement d
    JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
    JOIN stdencaissement e ON e.idencaissement = de.idencaissement
"""


def _bordereaux_precedents(numeros, id_reversement, date_bordereau):
    """Bordereau antérieur de chaque quittance (courrier « Nous faisons suite à notre courrier du … »)."""
    if not numeros:
        return {}
    lignes = _lignes(
        """
        SELECT de.numeroquittance, r.idreversement, COALESCE(b.datebordereau, r.datereversement) AS datebordereau,
               MAX(de.iddetailencaissement) AS dernierdetail
        FROM stddetailreversement d
        JOIN stdreversementcompagnie r ON r.idreversement = d.idreversement AND NOT COALESCE(r.pieceannulee, FALSE)
        LEFT JOIN lephare_bordereau_reversement b ON b.idreversement = r.idreversement
        JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
        WHERE de.numeroquittance = ANY(%s) AND r.idreversement <> %s AND NOT COALESCE(b.annule, FALSE)
          AND (COALESCE(b.datebordereau, r.datereversement), r.idreversement) < (%s, %s)
        GROUP BY 1, 2, 3
        ORDER BY 3, 2
        """,
        [list(numeros), id_reversement, date_bordereau, id_reversement],
    )
    resultat = {}
    for l in lignes:
        resultat[l["numeroquittance"]] = l  # le plus récent l'emporte (ordre croissant)
    return resultat


def lire_bordereau(id_reversement):
    entetes = _lignes(SQL_ENTETES + " AND r.idreversement = %s", [REVERSEMENT, id_reversement])
    if not entetes:
        return None
    e = entetes[0]
    entete = _entete_json(e)
    details = _lignes(SQL_DETAILS + " WHERE d.idreversement = %s ORDER BY e.dateencaissement, de.iddetailencaissement", [id_reversement])
    numeros = list(OrderedDict.fromkeys(d["numeroquittance"] for d in details))
    quittances = _quittances(numeros)
    paiements = _paiements(numeros)
    reglements = _reglements({d["idencaissement"] for d in details})
    date_bordereau = e["datebordereau"] or e["datereversement"] or date.today()

    lignes = []
    for numero in numeros:
        q = quittances.get(numero)
        if not q:
            continue
        siens = [d for d in details if d["numeroquittance"] == numero]
        dernier = siens[-1]
        p = _paiement_de(paiements, numero, dernier["iddetailencaissement"]) or {"Cumul": ZERO, "Rang": 0, "Code": "ACOMPTE"}
        ttc = q["primettc"] or ZERO
        reste = reste_a_encaisser(ttc, p["Cumul"])
        lignes.append({
            **_infos_quittance(q),
            "Avenant": _avenant(q),
            "Encaissement": _nombre(part_compagnie(p["Cumul"], q["partcompagnie"])),
            "FraisGestion": 0.0, "ComDeduite": 0.0, "AccDeduits": 0.0,
            "MontantReverse": _nombre(sum((d["montantreverse"] for d in siens), ZERO)),
            "Soldee": reste <= 0,
            "ResteDu": _nombre(part_compagnie(reste, q["partcompagnie"])),
            "StatutPaiement": p["Code"],
            "RangPaiement": p["Rang"],
            "LibelleStatutPaiement": _libelle_paiement(p["Code"], p["Rang"]),
            "IdsEncaissement": sorted({d["idencaissement"] for d in siens}),
        })

    def total(cle, ls):
        return sum(l[cle] for l in ls)

    blocs = []
    for soldee, titre in ((True, "PRIMES SOLDÉES"), (False, "PRIMES EN ARRIÉRÉ")):
        ls = [l for l in lignes if l["Soldee"] == soldee]
        if ls:
            blocs.append({"Titre": titre, "Soldees": soldee, "Lignes": ls,
                          "Totaux": {c: total(c, ls) for c in ("PrimeHT", "PrimeTtc", "Encaissement", "AccCourtier", "Commission", "MontantReverse", "ResteDu")}})
    # Règlements transmis : chèques du client (direct) ou chèque d'OREOLE
    if entete["Direct"]:
        vus = OrderedDict()
        for d in details:
            r = reglements.get(d["idencaissement"])
            if r:
                cle = (r["abrege"], r["banque"], r["numerocheque"]) if r["numerocheque"] else ("ENC", d["idencaissement"])
                vus.setdefault(cle, r)
        cheques = [{"Texte": _instrument(r), "TexteCourrier": _instrument(r, pour_courrier=True),
                    "Libelle": _libelle_instrument(r["abrege"], r["idmodepaiement"], r["mode"]), "Especes": r["abrege"] == "ESP",
                    "Banque": "" if r["abrege"] == "ESP" else r["banque"] or "", "Numero": r["numerocheque"] or r["numerobordereau"] or "",
                    "Date": _iso(r["datecheque"] or r["dateencaissement"]), "Montant": _nombre(_montant_instrument(r))}
                   for r in vus.values()]
    else:
        cheques = ([{"Texte": _paiement_cabinet(e), "TexteCourrier": _paiement_cabinet(e, pour_courrier=True),
                     "Libelle": _libelle_instrument(e["abrege"], e["idmodereversement"], e["mode"]), "Especes": False,
                     "Banque": e["banque"] or "", "Numero": e["numerocheque"] or "", "Date": _iso(e["datereversement"]),
                     "Montant": _nombre(e["montantreversement"])}] if e["valide"] else [])

    reglages = reglages_compagnie(e["idcompagnie"], e["compagnie"])
    precedents = _bordereaux_precedents(numeros, id_reversement, date_bordereau)
    return {
        **entete,
        "NomBordereau": reglages["NomBordereau"],
        "Lignes": lignes,
        "Blocs": blocs,
        "Totaux": {c: total(c, lignes) for c in ("PrimeHT", "PrimeTtc", "Encaissement", "AccCourtier", "Commission", "MontantReverse", "ResteDu")},
        "Cheques": cheques,
        "Courrier": _courrier(entete, lignes, cheques, reglages, precedents, paiements, date_bordereau),
    }


def _courrier(entete, lignes, cheques, reglages, precedents, paiements, date_bordereau):
    """Courrier de règlement de prime au modèle d'OREOLE (courriers JCW du 12/01 et du 19/05/2026, KOUMOUE du
    01/09/2026) ; plusieurs clients : « P/C ASSURES DIVERS » (demande du 2026-10-19)."""
    clients = list(OrderedDict.fromkeys(l["Client"] for l in lignes))
    branches = list(OrderedDict.fromkeys(l["Branche"] for l in lignes))
    une_quittance = len(lignes) == 1
    l = lignes[0] if lignes else {}
    nom_bordereau = NOMS_BORDEREAU[entete["Nature"]]
    appellation = reglages["Appellation"] or "Monsieur"

    if une_quittance:
        code, rang = l["StatutPaiement"], l["RangPaiement"]
        suffixe = {"COMPTANT": "", "SOLDE": "/SOLDE"}.get(code, "/1er ACOMPTE" if rang == 1 else f"/{rang}ème ACOMPTE")
        objet = f"REGLEMENT DE PRIME{suffixe}"
    else:
        objet = "REGLEMENT DE PRIMES"
    branche_objet = f"Assurance {branches[0]}" if len(branches) == 1 else "Assurances diverses"
    periode = (f"Période du {_jma(datetime.fromisoformat(l['DateEffet']))} au {_jma(datetime.fromisoformat(l['DateExpiration']))}"
               if une_quittance and l.get("DateEffet") and l.get("DateExpiration") else "")
    pour_compte = f"P/C {clients[0]}" if len(clients) == 1 else "P/C ASSURES DIVERS"

    textes = [c["TexteCourrier"] for c in cheques if c["TexteCourrier"]]
    if not textes:
        instrument = f"notre règlement de FCFA {_f(entete['MontantReverse'])}"
    elif len(textes) == 1:
        instrument = textes[0]
    elif all(t.startswith("le chèque ") for t in textes):
        instrument = "les chèques " + ", ".join(t.replace("le chèque ", "") for t in textes[:-1]) + " et " + textes[-1].replace("le chèque ", "")
    else:
        instrument = ", ".join(textes[:-1]) + " et " + textes[-1]
    branche_texte = branches[0] if len(branches) == 1 else ""
    # Primes réglées en espèces : rien à transmettre en annexe, le courrier en informe la compagnie
    especes = bool(cheques) and all(c.get("Especes") for c in cheques)
    details_especes = " et ".join(f"le {_jma(datetime.fromisoformat(c['Date']))} pour FCFA {_f(c['Montant'])}" if c["Date"]
                                  else f"pour FCFA {_f(c['Montant'])}" for c in cheques)

    precedent = precedents.get(l.get("NumeroQuittance")) if une_quittance else None
    paragraphes = []
    if especes:
        if precedent:
            p_avant = _paiement_de(paiements, l["NumeroQuittance"], precedent["dernierdetail"])
            transmis = "le premier acompte" if not p_avant or p_avant["Rang"] <= 1 else f"le {_ordinal(p_avant['Rang'])} acompte"
            paragraphes.append(
                f"Nous faisons suite à notre courrier du {_jma(precedent['datebordereau'])} par lequel nous vous avions transmis "
                f"{transmis} de notre relation commune. Il a porté sur le règlement de la prime d'assurance {branche_texte.lower()}."
            )
            objet_paiement = "le solde du client" if l["StatutPaiement"] in ("SOLDE", "COMPTANT") else f"le {_ordinal(l['RangPaiement'])} acompte"
            paragraphes.append(f"Par la présente, nous vous informons que {objet_paiement} a été réglé en espèces {details_especes}.")
        elif une_quittance and l["StatutPaiement"] == "ACOMPTE":
            paragraphes.append(
                f"Nous vous informons que le {_ordinal(l['RangPaiement'])} acompte de la prime d'assurance {branche_texte} de notre "
                f"relation commune en objet a été réglé en espèces {details_especes}.".replace("  ", " ")
            )
        elif len(clients) == 1:
            sujet = "la prime" if une_quittance else "les primes"
            verbe = "a été réglée" if une_quittance else "ont été réglées"
            assurance = f"d'assurance {branche_texte} " if branche_texte else "d'assurance "
            paragraphes.append(f"Nous vous informons que {sujet} {assurance}de notre relation commune en objet {verbe} en espèces {details_especes}.")
        else:
            paragraphes.append(
                f"Nous vous informons que les primes d'assurance de nos relations communes figurant sur le bordereau joint ont été "
                f"réglées en espèces {details_especes}."
            )
    elif precedent:
        p_avant = _paiement_de(paiements, l["NumeroQuittance"], precedent["dernierdetail"])
        transmis = "le premier acompte" if not p_avant or p_avant["Rang"] <= 1 else f"le {_ordinal(p_avant['Rang'])} acompte"
        paragraphes.append(
            f"Nous faisons suite à notre courrier du {_jma(precedent['datebordereau'])} par lequel nous vous avions transmis "
            f"{transmis} de notre relation commune. Il a porté sur le règlement de la prime d'assurance {branche_texte.lower()}."
        )
        objet_paiement = "le solde du client" if l["StatutPaiement"] in ("SOLDE", "COMPTANT") else f"le {_ordinal(l['RangPaiement'])} acompte"
        paragraphes.append(f"Par la présente, nous vous transmettons en annexe, {instrument} représentant {objet_paiement}.")
    elif une_quittance and l["StatutPaiement"] == "ACOMPTE":
        paragraphes.append(
            f"Nous vous transmettons en annexe de la présente, {instrument}, représentant le {_ordinal(l['RangPaiement'])} "
            f"acompte de la prime d'assurance {branche_texte} de notre relation commune en objet."
        )
    elif len(clients) == 1:
        primes = "de la prime" if une_quittance else "des primes"
        assurance = f"d'assurance {branche_texte} " if branche_texte else "d'assurance "
        paragraphes.append(
            f"Nous vous transmettons en annexe de la présente, {instrument}, pour le règlement {primes} {assurance}"
            f"de notre relation commune en objet."
        )
    else:
        paragraphes.append(
            f"Nous vous transmettons en annexe de la présente, {instrument}, pour le règlement des primes d'assurance de "
            f"nos relations communes figurant sur le bordereau joint."
        )

    pieces = [f"{nom_bordereau} ;"]
    if precedent:
        pieces.append(f"la décharge du courrier du {_jma(precedent['datebordereau'])}.")
    elif une_quittance:
        pieces.append(f"la condition particulière {branche_texte.lower()} correspondante.".replace("  ", " "))
    else:
        pieces.append("les conditions particulières correspondantes.")

    ville_signature = str(valeur_parametre("documents.ville_signature", "Abidjan") or "Abidjan").upper()
    return {
        "Lieu": f"{ville_signature}, le {_date_lettres(date_bordereau)}",
        "Destinataire": reglages["Destinataire"],
        "Service": reglages["Service"],
        "Ville": reglages["Ville"],
        "AttentionDe": ligne_attention(reglages["AttentionDe"]),
        "Objet": objet,
        "Branche": branche_objet,
        "Periode": periode,
        "PourCompte": pour_compte,
        "Appellation": f"{appellation},",
        "Paragraphes": paragraphes,
        "PiecesJointes": pieces,
        "Salutation": f"Veuillez agréer, {appellation}, nos distinguées salutations.",
        "Signataire": str(valeur_parametre("finance.courrier_signataire", "Yvette DA") or ""),
        "Fonction": str(valeur_parametre("finance.courrier_fonction", "LE DIRECTEUR GENERAL") or ""),
        "PaiementManquant": not cheques,
    }


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def bordereaux(request):
    """GET /api/finance/bordereaux/?compagnie=&du=&au=&nature= : bordereaux émis.
    POST {IdCompagnie, DateBordereau, Numero, Lignes: [IdDetailEncaissement], Paiement: {IdMode, IdBanque,
    NumeroCheque, DatePaiement, NomEmetteur}} : un bordereau par nature (ordre des règlements) ; la prime encaissée est
    transmise entière ; le paiement d'OREOLE (bordereau de reversement) peut être saisi ici ou plus tard."""
    if request.method == "GET":
        conditions, params = [], [REVERSEMENT]
        if request.query_params.get("compagnie"):
            conditions.append("r.idcompagnie = %s")
            params.append(int(request.query_params["compagnie"]))
        if request.query_params.get("nature") in (REVERSEMENT, RECLAMATION):
            conditions.append("COALESCE(b.nature, 'REVERSEMENT') = %s")
            params.append(request.query_params["nature"])
        try:
            for cle, operateur in (("du", ">="), ("au", "<=")):
                if request.query_params.get(cle):
                    conditions.append(f"COALESCE(b.datebordereau, r.datereversement) {operateur} %s")
                    params.append(_date(request.query_params[cle], cle))
        except ErreurFinance as erreur:
            return _erreur(erreur)
        sql = SQL_ENTETES + "".join(f" AND {c}" for c in conditions) + \
            " ORDER BY COALESCE(b.datebordereau, r.datereversement) DESC, b.numero DESC NULLS LAST, r.idreversement DESC"
        return Response({"Bordereaux": [_entete_json(e) for e in _lignes(sql, params)]})

    try:
        donnees = request.data
        id_compagnie = _entier(donnees.get("IdCompagnie"), "Compagnie")
        date_bordereau = _date(donnees.get("DateBordereau") or date.today(), "Date du bordereau")
        ids = [_entier(i, "Ligne d'encaissement") for i in (donnees.get("Lignes") or [])]
        if not ids:
            raise ErreurFinance("Cochez au moins une prime encaissée à transmettre.")
        if len(set(ids)) != len(ids):
            raise ErreurFinance("Une même prime est cochée deux fois.")
        paiement = donnees.get("Paiement") or {}
        resultats = []
        with transaction.atomic():
            # Numérotation : un seul bordereau numéroté à la fois
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(hashtext('lephare_bordereau_reversement'))")
            controle = _lignes(SQL_LIGNES_ENCAISSEMENT + " WHERE de.iddetailencaissement = ANY(%s)", [ids])
            par_id = {l["iddetailencaissement"]: l for l in controle}
            restes = _restes_nets({l["numeroquittance"] for l in controle})
            reglements = _reglements({l["idencaissement"] for l in controle})
            groupes = OrderedDict(((REVERSEMENT, []), (RECLAMATION, [])))
            for id_ligne in ids:
                ligne = par_id.get(id_ligne)
                if not ligne:
                    raise ErreurFinance(f"Ligne d'encaissement {id_ligne} introuvable.")
                if ligne["idcompagnie"] != id_compagnie:
                    raise ErreurFinance(f"La quittance {ligne['numeroquittance']} n'est pas une affaire de cette compagnie.")
                if ligne["annulee"]:
                    raise ErreurFinance(f"L'encaissement de la quittance {ligne['numeroquittance']} est annulé.")
                if _est_decaissement(ligne):
                    raise ErreurFinance(f"La quittance {ligne['numeroquittance']} : un décaissement ne se transmet pas.")
                reste = restes.get(id_ligne, ZERO)
                if reste <= 0:
                    raise ErreurFinance(f"La quittance {ligne['numeroquittance']} n'a plus rien à transmettre.")
                r = reglements.get(ligne["idencaissement"])
                nature = RECLAMATION if r and r["ordre"] == "COMPAGNIE" else REVERSEMENT
                groupes[nature].append((ligne, reste))
            # Bordereau de reversement : le paiement du cabinet (chèque ou virement) est saisi à la génération
            if groupes[REVERSEMENT]:
                if not paiement.get("IdMode"):
                    raise ErreurFinance("Bordereau de reversement de prime : saisissez le paiement (chèque ou virement) pour le générer.")
                controle_paiement_cabinet(paiement)
            for nature, lignes in groupes.items():
                if not lignes:
                    continue
                # Code courtier de la première prime (la plus ancienne encaissée), mois et exercice du bordereau
                premiere = min((l for l, _ in lignes), key=lambda l: (l["dateencaissement"], l["iddetailencaissement"]))
                numero = numero_bordereau(premiere["numeroquittance"], date_bordereau)
                montants = [reste for _, reste in lignes]
                total = sum(montants, ZERO)
                with connection.cursor() as cursor:
                    cursor.execute(
                        "CALL sp_enregistrement_reversement(%s, %s, %s::integer[], %s::numeric[], NULL, %s, 1, %s, '', '', '', '', 0, '')",
                        [request.user.id, id_compagnie, [l["iddetailencaissement"] for l, _ in lignes], montants, date_bordereau, total],
                    )
                    id_reversement, message = cursor.fetchone()
                    if not id_reversement:
                        raise ErreurFinance(message or "Le reversement n'a pas été enregistré.")
                    if nature == RECLAMATION:
                        # Chèques du client transmis tels quels : rien à payer par le cabinet
                        premier = reglements.get(lignes[0][0]["idencaissement"])
                        numeros_cheques = " / ".join(OrderedDict.fromkeys(
                            reglements[l["idencaissement"]]["numerocheque"] for l, _ in lignes
                            if reglements.get(l["idencaissement"]) and reglements[l["idencaissement"]]["numerocheque"]))
                        bancaire = bool(premier and premier["banque"] and numeros_cheques)
                        cursor.execute(
                            "CALL sp_validation_reversement(%s, %s, %s, %s, %s, %s, '', '', '', '')",
                            [request.user.id, id_reversement, MODE_A_LA_COMPAGNIE if bancaire else MODE_ESPECES, date_bordereau,
                             premier["idbanque"] if bancaire else 1, numeros_cheques[:20] if bancaire else ""],
                        )
                    elif paiement.get("IdMode"):
                        cursor.execute(
                            "CALL sp_validation_reversement(%s, %s, %s, %s, %s, %s, %s, '', '', '')",
                            [request.user.id, id_reversement, _entier(paiement.get("IdMode"), "Mode de paiement"),
                             _date(paiement.get("DatePaiement") or date_bordereau, "Date du paiement"),
                             _entier(paiement.get("IdBanque"), "Banque", obligatoire=False) or 1,
                             _texte(paiement.get("NumeroCheque"), 20), _texte(paiement.get("NomEmetteur"), 50)],
                        )
                BordereauReversement.objects.create(
                    id_reversement=id_reversement, numero=numero, nature=nature, date_bordereau=date_bordereau,
                    cree_par=request.user,
                )
                resultats.append(id_reversement)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    except Exception as erreur:  # message de la procédure (RAISE EXCEPTION)
        return _erreur(erreur)
    return Response({"Bordereaux": [lire_bordereau(i) for i in resultats]}, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def bordereau(request, id_reversement):
    """GET /api/finance/bordereaux/<idreversement>/ : bordereau (blocs soldées / arriéré), règlements transmis et
    courrier de règlement de prime."""
    resultat = lire_bordereau(id_reversement)
    if not resultat:
        return Response({"error": "Bordereau introuvable."}, status=status.HTTP_404_NOT_FOUND)
    return Response(resultat)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def decharge(request, id_reversement):
    """POST /api/finance/bordereaux/<idreversement>/decharge/ {DateDecharge} : cachet « courrier arrivé » de la
    compagnie (colonne « Date de décharge de la Cie » du tableau)."""
    try:
        date_decharge = _date(request.data.get("DateDecharge"), "Date de décharge", obligatoire=False)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    objet = BordereauReversement.objects.filter(id_reversement=id_reversement, annule=False).first()
    if not objet:
        return Response({"error": "Bordereau introuvable."}, status=status.HTTP_404_NOT_FOUND)
    if date_decharge and date_decharge < objet.date_bordereau:
        return _erreur(f"La décharge ne peut pas précéder le bordereau du {_jma(objet.date_bordereau)}.")
    objet.date_decharge = date_decharge
    objet.save(update_fields=["date_decharge"])
    return Response(lire_bordereau(id_reversement))


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def annuler_bordereau(request, id_reversement):
    """POST /api/finance/bordereaux/<idreversement>/annuler/ {Motif} : bordereau émis par erreur. Les primes
    redeviennent à transmettre ; refusé si une commission a été réclamée ou payée sur ses quittances."""
    motif = _texte(request.data.get("Motif"), 255)
    if len(motif) < 5:
        return _erreur("Motif de l'annulation : à préciser.")
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "SELECT idreversement FROM stdreversementcompagnie WHERE idreversement = %s AND NOT COALESCE(pieceannulee, FALSE) FOR UPDATE",
            [id_reversement],
        )
        if not cursor.fetchone():
            return Response({"error": "Bordereau introuvable ou déjà annulé."}, status=status.HTTP_404_NOT_FOUND)
        cursor.execute(
            """
            SELECT (SELECT COUNT(*) FROM std_detail_reclamation_commission dx JOIN std_reclamation_commission x ON x.id = dx.reclamation_id
                    WHERE x.statut <> 'ANNULEE' AND dx.detail_reversement_id IN (SELECT iddetailreversement FROM stddetailreversement WHERE idreversement = %s)),
                   (SELECT COUNT(*) FROM std_detail_paiement_commission dp
                    WHERE NOT dp.est_annule AND dp.detail_reversement_id IN (SELECT iddetailreversement FROM stddetailreversement WHERE idreversement = %s))
            """,
            [id_reversement, id_reversement],
        )
        reclamees, payees = cursor.fetchone()
        if reclamees or payees:
            return _erreur("La commission de ce bordereau est déjà réclamée ou payée : annulez d'abord la réclamation.")
        # Primes de nouveau à transmettre : montants reversés retirés des encaissements et des quittances
        cursor.execute(
            """
            UPDATE stddetailencaissement de SET montantreglement = GREATEST(COALESCE(de.montantreglement, 0) - d.montantreverse, 0)
            FROM stddetailreversement d WHERE d.idreversement = %s AND d.iddetailencaissement = de.iddetailencaissement
            """,
            [id_reversement],
        )
        cursor.execute(
            """
            UPDATE stdquittance q SET mt_regle = GREATEST(COALESCE(q.mt_regle, 0) - t.montant, 0),
                   reglee = (GREATEST(COALESCE(q.mt_regle, 0) - t.montant, 0) = COALESCE(q.mt_encaisse, 0))
            FROM (SELECT de.numeroquittance, SUM(d.montantreverse) AS montant FROM stddetailreversement d
                  JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
                  WHERE d.idreversement = %s GROUP BY 1) t
            WHERE q.numeroquittance = t.numeroquittance
            """,
            [id_reversement],
        )
        nom = (getattr(request.user, "get_full_name", lambda: "")() or request.user.get_username())[:50]
        cursor.execute(
            """
            UPDATE stdreversementcompagnie SET pieceannulee = TRUE, dateannulation = NOW(), datesaisieannulation = NOW(),
                   nomannulation = %s, motifannulation = %s WHERE idreversement = %s
            """,
            [nom, motif[:60], id_reversement],
        )
        BordereauReversement.objects.filter(id_reversement=id_reversement).update(
            annule=True, motif_annulation=motif, date_annulation=timezone.now()
        )
    return Response({"IdReversement": id_reversement, "Annule": True})


# ------------------------------------------------------------------ tableau de reversement (COMMI-MOIS)
def tableau_reversement(id_compagnie, du, au):
    """Une ligne par quittance reversée à la compagnie, rangée au mois de son dernier bordereau (dans la période)."""
    details = _lignes(
        """
        SELECT d.iddetailreversement, d.idreversement, d.montantreverse, de.idencaissement, de.numeroquittance,
               COALESCE(b.datebordereau, r.datereversement) AS datebordereau, b.datedecharge, b.numero,
               COALESCE(b.nature, %s) AS nature, r.datereversement, r.montantreversement, COALESCE(r.valide, FALSE) AS valide,
               NULLIF(TRIM(r.numerocheque), '') AS numerocheque, m.libellemodepaiement AS mode,
               UPPER(TRIM(COALESCE(m.abregereglement, ''))) AS abrege,
               CASE WHEN UPPER(TRIM(COALESCE(bq.libelle, ''))) IN ('', 'NEANT', 'AUCUNE', 'AUCUN') THEN NULL ELSE TRIM(bq.libelle) END AS banque
        FROM stddetailreversement d
        JOIN stdreversementcompagnie r ON r.idreversement = d.idreversement AND NOT COALESCE(r.pieceannulee, FALSE)
        LEFT JOIN lephare_bordereau_reversement b ON b.idreversement = r.idreversement
        LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = r.idmodereversement
        LEFT JOIN stdbanque bq ON bq.idbanque = r.idbanque
        JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
        WHERE r.idcompagnie = %s AND NOT COALESCE(b.annule, FALSE)
        ORDER BY 6, d.idreversement, d.iddetailreversement
        """,
        [REVERSEMENT, id_compagnie],
    )
    par_quittance = OrderedDict()
    for d in details:
        par_quittance.setdefault(d["numeroquittance"], []).append(d)
    # Quittance retenue si son dernier bordereau tombe dans la période
    retenues = {n: ds for n, ds in par_quittance.items() if du <= ds[-1]["datebordereau"] <= au}
    quittances = _quittances(retenues.keys())
    reglements = _reglements({d["idencaissement"] for ds in retenues.values() for d in ds})
    ids_details = [d["iddetailreversement"] for ds in retenues.values() for d in ds]
    commissions = {}
    if ids_details:
        for c in _lignes(
            """
            SELECT dp.detail_reversement_id, dp.montant_commission_paye, pc.id, pc.mode_paiement, pc.reference_paiement,
                   pc.date_paiement, pc.montant_total, NULLIF(TRIM(bq.libelle), '') AS banque
            FROM std_detail_paiement_commission dp
            JOIN std_paiement_commission pc ON pc.id = dp.paiement_id
            LEFT JOIN stdbanque bq ON bq.idbanque = pc.idbanque
            WHERE dp.detail_reversement_id = ANY(%s) AND NOT dp.est_annule
            """,
            [ids_details],
        ):
            commissions.setdefault(c["detail_reversement_id"], []).append(c)

    lignes = []
    for numero, ds in retenues.items():
        q = quittances.get(numero)
        if not q:
            continue
        reversements = OrderedDict()
        for d in ds:
            rv = reversements.setdefault(d["idreversement"], {"d": d, "Montant": ZERO, "Encaissements": []})
            rv["Montant"] += d["montantreverse"]
            rv["Encaissements"].append(d["idencaissement"])
        sous_lignes = []
        for rv in reversements.values():
            d = rv["d"]
            if d["nature"] == RECLAMATION:
                textes = OrderedDict.fromkeys(_instrument(reglements[i]) for i in rv["Encaissements"] if reglements.get(i))
                nature_texte = " ; ".join(textes)
            else:
                nature_texte = _paiement_cabinet({**d, "montantreversement": d["montantreversement"]})
            sous_lignes.append({
                "IdReversement": d["idreversement"], "Numero": d["numero"], "DateCourrier": _iso(d["datebordereau"]),
                "DateDecharge": _iso(d["datedecharge"]), "Montant": _nombre(rv["Montant"]), "Nature": nature_texte,
                "Direct": d["nature"] == RECLAMATION,
            })
        reverse = sum((rv["Montant"] for rv in reversements.values()), ZERO)
        payes = [c for d in ds for c in commissions.get(d["iddetailreversement"], [])]
        percue = sum((c["montant_commission_paye"] for c in payes), ZERO)
        a_percevoir = Decimal(q["commission"] or 0) + Decimal(q["acccourtier"] or 0)
        cheques_commission = OrderedDict()
        for c in payes:
            banque = f"{c['banque']} " if c["banque"] else ""
            cheques_commission[c["id"]] = (f"{'CHQ' if c['mode_paiement'] == 'CHQ' else 'VIR'} {banque}N°{c['reference_paiement']} "
                                           f"du {_jma(c['date_paiement'])} de FCFA {_f(c['montant_total'])}")
        ttc = part_compagnie(q["primettc"] or ZERO, q["partcompagnie"])
        reste = reste_a_encaisser(ttc, reverse)
        observations = []
        if reste > 0:
            observations.append(f"Reste à encaisser : {_f(reste)}")
        if a_percevoir > 0 and percue >= a_percevoir:
            observations.append("COMMISSION PERCUE")
        elif percue > 0:
            observations.append("COMMISSION PERCUE EN PARTIE")
        mois = ds[-1]["datebordereau"].replace(day=1)
        lignes.append({
            **_infos_quittance(q),
            "Mois": mois.isoformat(),
            "Souscripteur": q["client"] or "",
            "Encaissement": _nombre(reverse),
            "CommissionAPercevoir": _nombre(a_percevoir),
            "CommissionPercue": _nombre(percue),
            "SoldeCommission": _nombre(a_percevoir - percue),
            "ChequesCommission": " ; ".join(cheques_commission.values()),
            "Observation": " - ".join(observations),
            "Soldee": reste <= 0,
            "ResteAEncaisser": _nombre(reste),
            "Reversements": sous_lignes,
        })
    lignes.sort(key=lambda l: (l["Mois"], l["Reversements"][0]["DateCourrier"] or "", l["Reversements"][0]["Numero"] or ""))
    return lignes


FEUILLES = OrderedDict((
    ("TOUT", ("COMMI-MOIS", "TABLEAU DE REVERSEMENT", lambda l: True)),
    ("SOLDEES", ("PRIMES SOLDEES", "PRIMES SOLDEES", lambda l: l["Soldee"])),
    ("NON_SOLDEES", ("PRIMES NON SOLDEES", "NON SOLDE", lambda l: not l["Soldee"])),
    ("COMMISSIONS_PERCUES", ("COMMISSIONS PERCUES", "COMMISSIONS PERCUES", lambda l: l["CommissionPercue"] > 0)),
    ("COMMISSIONS_NON_PERCUES", ("COMMISSIONS NON PERCUES", "COMMISSIONS NON PERCUES", lambda l: l["SoldeCommission"] > 0)),
))
CHAMPS_TOTAUX = ("PrimeHT", "PrimeTtc", "Encaissement", "AccCourtier", "CommissionAPercevoir", "CommissionPercue", "SoldeCommission")


def _periode_tableau(request):
    id_compagnie = _entier(request.query_params.get("compagnie"), "Compagnie")
    du = _date(request.query_params.get("du"), "Du", obligatoire=False) or date(date.today().year, 1, 1)
    au = _date(request.query_params.get("au"), "Au", obligatoire=False) or date(date.today().year, 12, 31)
    if du > au:
        raise ErreurFinance("Le début de la période dépasse sa fin.")
    return id_compagnie, du, au


def _nom_compagnie(id_compagnie):
    with connection.cursor() as cursor:
        cursor.execute("SELECT raisonsociale FROM stdcompagnie WHERE idcompagnie = %s", [id_compagnie])
        ligne = cursor.fetchone()
    return (ligne[0] or "").strip() if ligne else ""


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def tableau(request):
    """GET /api/finance/tableau-reversement/?compagnie=&du=&au=&feuille= : tableau de reversement de la compagnie
    (feuille : TOUT, SOLDEES, NON_SOLDEES, COMMISSIONS_PERCUES, COMMISSIONS_NON_PERCUES)."""
    try:
        id_compagnie, du, au = _periode_tableau(request)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    lignes = tableau_reversement(id_compagnie, du, au)
    feuille = request.query_params.get("feuille") or "TOUT"
    if feuille in FEUILLES:
        lignes = [l for l in lignes if FEUILLES[feuille][2](l)]
    mois = OrderedDict()
    for l in lignes:
        mois.setdefault(l["Mois"], []).append(l)
    recap = [{"Mois": m, **{c: sum(l[c] for l in ls) for c in CHAMPS_TOTAUX}} for m, ls in mois.items()]
    reglages = reglages_compagnie(id_compagnie, _nom_compagnie(id_compagnie))
    return Response({
        "Compagnie": reglages["NomBordereau"], "Du": du.isoformat(), "Au": au.isoformat(),
        "Lignes": lignes, "Recapitulatif": recap,
        "Total": {c: sum(l[c] for l in lignes) for c in CHAMPS_TOTAUX},
        "Feuilles": [{"Code": c, "Libelle": v[0]} for c, v in FEUILLES.items()],
    })


def _format_taux(taux):
    """Format Excel du taux de commission : 20 % ; 22,5 % avec ses décimales (le format « 0% » l'arrondissait)."""
    return "0%" if float(taux or 0).is_integer() else "0.0#%"


def _nom_cabinet():
    from configuration_api.models import ParametreSite

    site = ParametreSite.objects.order_by("id_parametre_site").first()
    return (getattr(site, "raison_sociale", "") or "OREOLE ASSURANCES").strip()


def _classeur_tableau(lignes, nom, du, au):
    """Classeur au modèle COMMI-MOIS d'OREOLE : Arial Narrow 14, bordures moyennes, un bloc par mois (formules
    Q = J*P+O, S = Q-R, L = somme des M, TOTAL), état récapitulatif ; une feuille par état."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    from core.exports import texte_excel

    bord = Side(style="medium")
    cadre = Border(left=bord, right=bord, top=bord, bottom=bord)
    gris = PatternFill("solid", fgColor="E7E6E6")
    centre = Alignment(horizontal="center", vertical="center", wrap_text=True)
    largeurs = [35.6, 33.0, 18.7, 19.7, 18.4, 23.3, 25.6, 18.4, 19.6, 18.4, 18.0, 20.1, 21.3, 31.1, 15.1, 17.1, 19.4,
                21.1, 20.1, 31.6, 23.4]
    entetes = ["NOM DU CLIENT", "STRUCTURE / SOUSCRIPTEUR", "DATE DU COURRIER", "DATE DE DECHARGE DE LA CIE",
               "N° DU BORDEREAU", "ASSURANCE", "N° POLICE", "EFFET", "EXPIRATION", "PRIME HT", "PRIME TTC",
               "ENCAISSEMENT", "MONTANT REVERSE", "NATURE DU REVERSEMENT", "ACC. COURTIER", "TAUX COM %",
               "COMMISSION A PERCEVOIR", "COMMISSION PERCUE", "SOLDE", "CHEQUE DE COMMISSION",
               "OBSERVATION (Emissions - Encaissements)"]
    MONTANT, JOUR = "#,##0", "dd/mm/yyyy"

    def cellule(ws, ligne, colonne, valeur, gras=False, format_=None, taille=14, fond=None, formule=False):
        # formule=True seulement pour les formules construites ici (SUM, ROUND…) ; toute autre chaîne (client,
        # police, référence de chèque…) reste du texte, même si elle commence par « = »
        c = ws.cell(row=ligne, column=colonne, value=valeur)
        if isinstance(valeur, str) and not formule:
            texte_excel(c)
        c.font = Font(name="Arial Narrow", size=taille, bold=gras)
        c.alignment = centre
        c.border = cadre
        if format_:
            c.number_format = format_
        if fond:
            c.fill = fond
        return c

    def jour(iso):
        return datetime.fromisoformat(iso) if iso else None

    classeur = Workbook()
    classeur.remove(classeur.active)
    for code, (titre_feuille, titre, filtre) in FEUILLES.items():
        ws = classeur.create_sheet(titre_feuille[:31])
        ws.sheet_view.zoomScale = 70
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A3
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        for i, largeur in enumerate(largeurs, start=1):
            ws.column_dimensions[get_column_letter(i)].width = largeur
        ws.merge_cells("G4:P4")
        cellule(ws, 4, 7, f"{titre} {nom} DU {_jma(du)} AU {_jma(au)}", gras=True, taille=16, fond=gris)
        for colonne in range(8, 17):
            ws.cell(row=4, column=colonne).border = cadre
        ws.row_dimensions[4].height = 44
        retenues = [l for l in lignes if filtre(l)]
        mois = OrderedDict()
        for l in retenues:
            mois.setdefault(l["Mois"], []).append(l)
        rangee = 9
        totaux = []
        for m, ls in mois.items():
            cellule(ws, rangee, 1, datetime.fromisoformat(m), gras=True, format_="[$-40C]mmmm\\-yy;@", fond=gris)
            ws.row_dimensions[rangee].height = 40
            rangee += 1
            for i, entete in enumerate(entetes, start=1):
                cellule(ws, rangee, i, entete, gras=True)
            ws.row_dimensions[rangee].height = 55
            rangee += 1
            debut = rangee
            for l in ls:
                sous = l["Reversements"]
                premiere = rangee
                for k, rv in enumerate(sous):
                    r = rangee + k
                    cellule(ws, r, 3, jour(rv["DateCourrier"]), format_=JOUR)
                    cellule(ws, r, 4, jour(rv["DateDecharge"]), format_=JOUR)
                    cellule(ws, r, 5, rv["Numero"])
                    cellule(ws, r, 13, rv["Montant"], gras=True, format_=MONTANT)
                    cellule(ws, r, 14, rv["Nature"])
                    ws.row_dimensions[r].height = 46
                derniere = rangee + len(sous) - 1
                valeurs = {
                    1: l["Client"], 2: l["Souscripteur"], 6: l["Branche"], 7: l["PoliceCompagnie"] or l["NumeroPolice"],
                    8: jour(l["DateEffet"]), 9: jour(l["DateExpiration"]), 10: l["PrimeHT"], 11: l["PrimeTtc"],
                    12: f"=SUM(M{premiere}:M{derniere})" if derniere > premiere else f"=+M{premiere}",
                    15: l["AccCourtier"], 16: l["Taux"] / 100, 17: f"=ROUND(J{premiere}*P{premiere},0)+O{premiere}",
                    18: l["CommissionPercue"], 19: f"=+Q{premiere}-R{premiere}", 20: l["ChequesCommission"],
                    21: l["Observation"],
                }
                formats = {8: JOUR, 9: JOUR, 10: MONTANT, 11: MONTANT, 12: MONTANT, 15: MONTANT, 16: _format_taux(l["Taux"]),
                           17: MONTANT, 18: MONTANT, 19: MONTANT}
                gras = {10, 11, 12, 15, 17, 18, 19}
                for colonne, valeur in valeurs.items():
                    cellule(ws, premiere, colonne, valeur, gras=colonne in gras, format_=formats.get(colonne),
                            formule=colonne in (12, 17, 19))
                    if derniere > premiere:
                        for r in range(premiere + 1, derniere + 1):
                            ws.cell(row=r, column=colonne).border = cadre
                        ws.merge_cells(start_row=premiere, start_column=colonne, end_row=derniere, end_column=colonne)
                rangee = derniere + 1
            fin = rangee - 1
            ws.merge_cells(start_row=rangee, start_column=1, end_row=rangee, end_column=9)
            cellule(ws, rangee, 1, "TOTAL", gras=True)
            for colonne in range(2, 10):
                ws.cell(row=rangee, column=colonne).border = cadre
            for colonne in (10, 11, 12, 13, 15, 17, 18, 19):
                lettre = get_column_letter(colonne)
                cellule(ws, rangee, colonne, f"=SUM({lettre}{debut}:{lettre}{fin})", gras=True, format_=MONTANT, formule=True)
            ws.row_dimensions[rangee].height = 41
            totaux.append((m, rangee))
            rangee += 3
        # État récapitulatif
        if totaux:
            rangee += 1
            ws.merge_cells(start_row=rangee, start_column=4, end_row=rangee, end_column=16)
            cellule(ws, rangee, 4, "ETAT RECAPITULATIF", gras=True)
            for colonne in range(5, 17):
                ws.cell(row=rangee, column=colonne).border = cadre
            rangee += 1
            for colonne, libelle in ((4, "MOIS"), (6, "PRIME TTC"), (8, "ENCAISSEMENTS"), (10, "REVERSEMENTS"),
                                     (12, "COMMISSION A PERCEVOIR"), (14, "COMMISSION PERCUE"), (16, "SOLDE")):
                if colonne < 16:
                    ws.merge_cells(start_row=rangee, start_column=colonne, end_row=rangee, end_column=colonne + 1)
                    ws.cell(row=rangee, column=colonne + 1).border = cadre
                cellule(ws, rangee, colonne, libelle, gras=True)
            premiere_recap = rangee + 1
            for m, ligne_total in totaux:
                rangee += 1
                valeurs = ((4, datetime.fromisoformat(m), "mmm-yy"), (6, f"=+K{ligne_total}", MONTANT),
                           (8, f"=+L{ligne_total}", MONTANT), (10, f"=+M{ligne_total}", MONTANT),
                           (12, f"=+Q{ligne_total}", MONTANT), (14, f"=+R{ligne_total}", MONTANT),
                           (16, f"=+S{ligne_total}", MONTANT))
                for colonne, valeur, format_ in valeurs:
                    if colonne < 16:
                        ws.merge_cells(start_row=rangee, start_column=colonne, end_row=rangee, end_column=colonne + 1)
                        ws.cell(row=rangee, column=colonne + 1).border = cadre
                    cellule(ws, rangee, colonne, valeur, gras=True, format_=format_, formule=colonne != 4)
            rangee += 1
            for colonne in (4, 6, 8, 10, 12, 14, 16):
                if colonne < 16:
                    ws.merge_cells(start_row=rangee, start_column=colonne, end_row=rangee, end_column=colonne + 1)
                    ws.cell(row=rangee, column=colonne + 1).border = cadre
                lettre = get_column_letter(colonne)
                fin_lettre = get_column_letter(colonne + 1) if colonne < 16 else lettre
                valeur = "TOTAL" if colonne == 4 else f"=SUM({lettre}{premiere_recap}:{fin_lettre}{rangee - 1})"
                cellule(ws, rangee, colonne, valeur, gras=True, format_=None if colonne == 4 else MONTANT, formule=colonne != 4)
        else:
            cellule(ws, 9, 1, "Aucune ligne pour cette période.")
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def tableau_excel(request):
    """GET /api/finance/tableau-reversement/excel/?compagnie=&du=&au= : classeur COMMI-MOIS, une feuille par état
    (tableau complet, primes soldées, primes non soldées, commissions perçues, commissions non perçues)."""
    try:
        id_compagnie, du, au = _periode_tableau(request)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    nom = reglages_compagnie(id_compagnie, _nom_compagnie(id_compagnie))["NomBordereau"]
    contenu = _classeur_tableau(tableau_reversement(id_compagnie, du, au), nom, du, au)
    reponse = HttpResponse(contenu, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    fichier = f"TABLEAU DE REVERSEMENT {nom} {du:%d-%m-%Y} au {au:%d-%m-%Y}.xlsx".replace("/", "-")
    reponse["Content-Disposition"] = f'attachment; filename="{fichier}"'
    return reponse


# ------------------------------------------------------------------ bordereau récapitulatif de réclamation (Excel)
def _classeur_reclamation(rc, nom_compagnie):
    """Bordereau récapitulatif de reversement — réclamation de commissions, à la présentation du tableau COMMI-MOIS
    (Arial Narrow, bordures moyennes, titre grisé) : une ligne par quittance réclamée ; commission à percevoir =
    commission + accessoires du cabinet, reste dû = à percevoir - déjà perçue, totaux en formules."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    from core.exports import texte_excel

    bord = Side(style="medium")
    cadre = Border(left=bord, right=bord, top=bord, bottom=bord)
    gris = PatternFill("solid", fgColor="E7E6E6")
    centre = Alignment(horizontal="center", vertical="center", wrap_text=True)
    a_gauche = Alignment(horizontal="left", vertical="center", wrap_text=True)
    MONTANT, JOUR = "#,##0", "dd/mm/yyyy"
    entetes = [
        ("N° DU BORDEREAU", 14), ("DATE DU COURRIER", 16), ("NOM DU CLIENT", 34), ("ASSURANCE", 22), ("N° POLICE", 22),
        ("EFFET", 14), ("EXPIRATION", 14), ("PRIME HT", 16), ("PRIME TTC", 16), ("MONTANT REVERSE", 17), ("TAUX COM %", 11),
        ("COMMISSION", 15), ("ACC. COURTIER", 14), ("COMMISSION A PERCEVOIR", 18), ("COMMISSION PERCUE", 17), ("RESTE DU", 16),
    ]

    def cellule(ws, ligne, colonne, valeur, gras=False, format_=None, taille=14, fond=None, formule=False, gauche=False):
        # formule=True seulement pour les formules construites ici ; toute autre chaîne reste du texte
        c = ws.cell(row=ligne, column=colonne, value=valeur)
        if isinstance(valeur, str) and not formule:
            texte_excel(c)
        c.font = Font(name="Arial Narrow", size=taille, bold=gras)
        c.alignment = a_gauche if gauche else centre
        c.border = cadre
        if format_:
            c.number_format = format_
        if fond:
            c.fill = fond
        return c

    def jour(iso):
        return datetime.fromisoformat(iso) if iso else None

    classeur = Workbook()
    ws = classeur.active
    ws.title = "RECLAMATION"
    ws.sheet_view.zoomScale = 70
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    for i, (_, largeur) in enumerate(entetes, start=1):
        ws.column_dimensions[get_column_letter(i)].width = largeur

    ws.merge_cells("C2:N2")
    cellule(ws, 2, 3, f"BORDEREAU RECAPITULATIF DE REVERSEMENT - RECLAMATION DE COMMISSIONS {nom_compagnie}",
            gras=True, taille=16, fond=gris)
    for colonne in range(4, 15):
        ws.cell(row=2, column=colonne).border = cadre
    ws.row_dimensions[2].height = 40
    infos = (
        ("Bordereau N°", rc["Reference"]),
        ("Émis le", jour(rc["DateEmission"])),
        ("Période", f"du {_jma(jour(rc['PeriodeDebut']))} au {_jma(jour(rc['PeriodeFin']))}"),
        ("Compagnie", nom_compagnie),
    )
    for i, (libelle, valeur) in enumerate(infos, start=4):
        cellule(ws, i, 1, libelle, gras=True, gauche=True)
        ws.merge_cells(start_row=i, start_column=2, end_row=i, end_column=3)
        cellule(ws, i, 2, valeur, format_=JOUR if isinstance(valeur, datetime) else None, gauche=True)
        ws.cell(row=i, column=3).border = cadre

    rangee = 9
    for i, (entete, _) in enumerate(entetes, start=1):
        cellule(ws, rangee, i, entete, gras=True)
    ws.row_dimensions[rangee].height = 55
    lignes = sorted(rc.get("Lignes") or [], key=lambda l: (l.get("DateBordereau") or l.get("DateReversement") or "",
                                                          str(l.get("NumeroBordereau") or "")))
    debut = rangee + 1
    for l in lignes:
        rangee += 1
        valeurs = [
            (l.get("NumeroBordereau") or l.get("NumeroReversement"), None),
            (jour(l.get("DateBordereau") or l.get("DateReversement")), JOUR),
            (l.get("Client"), None), (l.get("Assurance") or l.get("Branche"), None),
            (l.get("PoliceCompagnie") or l.get("NumeroPolice"), None),
            (jour(l.get("DateEffet")), JOUR), (jour(l.get("DateExpiration")), JOUR),
            (l.get("PrimeHT"), MONTANT), (l.get("PrimeTtc"), MONTANT), (l.get("MontantReverse"), MONTANT),
            ((l.get("Taux") or 0) / 100, _format_taux(l.get("Taux"))), (l.get("CommissionHT"), MONTANT), (l.get("AccCourtier"), MONTANT),
            (f"=L{rangee}+M{rangee}", MONTANT), (l.get("CommissionPayee"), MONTANT), (f"=N{rangee}-O{rangee}", MONTANT),
        ]
        for colonne, (valeur, format_) in enumerate(valeurs, start=1):
            cellule(ws, rangee, colonne, valeur, gras=colonne in (12, 13, 14, 16), format_=format_,
                    formule=colonne in (14, 16), gauche=colonne == 3)
        ws.row_dimensions[rangee].height = 40
    fin = rangee
    rangee += 1
    ws.merge_cells(start_row=rangee, start_column=1, end_row=rangee, end_column=7)
    cellule(ws, rangee, 1, "TOTAL", gras=True)
    for colonne in range(2, 8):
        ws.cell(row=rangee, column=colonne).border = cadre
    for colonne in range(8, 17):
        if colonne == 11:
            cellule(ws, rangee, colonne, "")
            continue
        lettre = get_column_letter(colonne)
        cellule(ws, rangee, colonne, f"=SUM({lettre}{debut}:{lettre}{fin})" if lignes else 0, gras=True,
                format_=MONTANT, formule=bool(lignes))
    ws.row_dimensions[rangee].height = 40

    rangee += 2
    # Somme réclamée : les commissions du bordereau ; règlements déjà reçus et reste dû précisés à la suite
    reclame, paye = rc.get("MontantCommissions") or 0, rc.get("MontantPaye") or 0
    if not paye:
        suite = ""
    elif rc.get("Reste"):
        suite = f" (déjà réglé : {_f(paye)} FCFA ; reste dû : {_f(rc['Reste'])} FCFA)"
    else:
        suite = ", réglé en totalité"
    ws.merge_cells(start_row=rangee, start_column=1, end_row=rangee, end_column=12)
    arrete = ws.cell(row=rangee, column=1,
                     value=f"Arrêté le présent bordereau à la somme de {_f(reclame)} FCFA, montant des commissions réclamées{suite}.")
    texte_excel(arrete)
    arrete.font = Font(name="Arial Narrow", size=14, bold=True)
    rangee += 3
    for colonne, texte in ((1, f"POUR {_nom_cabinet().upper()}"), (13, f"POUR {nom_compagnie}")):
        signature = ws.cell(row=rangee, column=colonne, value=texte)
        texte_excel(signature)
        signature.font = Font(name="Arial Narrow", size=14, bold=True, underline="single")
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def reclamation_excel(request, id_reclamation):
    """GET /api/finance/commissions/reclamations/<id>/excel/ : bordereau récapitulatif de réclamation en Excel."""
    from commissions.models import ReclamationCommission

    from .views_finance import _reclamation_json

    objet = ReclamationCommission.objects.select_related("compagnie").filter(pk=id_reclamation).first()
    if not objet:
        return Response({"error": "Bordereau de réclamation introuvable."}, status=status.HTTP_404_NOT_FOUND)
    rc = _reclamation_json(objet, avec_lignes=True)
    nom = reglages_compagnie(objet.compagnie_id, objet.compagnie.RaisonSociale)["NomBordereau"]
    reponse = HttpResponse(_classeur_reclamation(rc, nom),
                           content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    reponse["Content-Disposition"] = f'attachment; filename="BORDEREAU RECAPITULATIF {rc["Reference"]} {nom}.xlsx"'
    return reponse


# ------------------------------------------------------------------ état récapitulatif des commissions (Excel)
def _periode_texte(du, au):
    if du and au:
        return f"DU {_jma(date.fromisoformat(du))} AU {_jma(date.fromisoformat(au))}"
    if du:
        return f"DEPUIS LE {_jma(date.fromisoformat(du))}"
    if au:
        return f"JUSQU'AU {_jma(date.fromisoformat(au))}"
    return "TOUTES PERIODES"


def _libelle_mois(cle):
    return f"{MOIS[int(cle[5:7]) - 1].capitalize()} {cle[:4]}" if cle else ""


def _situation_commission(l):
    if l["Statut"] == "PAYEE":
        return f"Payée ({l['Reclamation']})" if l["Reclamation"] else "Payée"
    reference = f"{l['Reclamation']} du {_jma(date.fromisoformat(l['DateReclamation']))}" if l["DateReclamation"] else l["Reclamation"]
    if l["Statut"] == "PARTIELLE":
        return f"Payée en partie - {reference}"
    if l["Statut"] == "RECLAMEE":
        return f"Réclamée - {reference}"
    return "À réclamer"


def _classeur_recapitulatif_commissions(r, nom):
    """État récapitulatif des commissions payées et en attente de paiement, à la présentation des classeurs d'OREOLE
    (Arial Narrow, bordures moyennes, titres grisés) : synthèse par compagnie et par mois (total en attente = réclamées
    + non encore réclamées, taux de recouvrement = payées / dues), règlements reçus, bordereaux réclamés en attente,
    commissions non encore réclamées, détail des quittances ; totaux et contrôles en formules."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    from core.exports import texte_excel

    bord = Side(style="medium")
    cadre = Border(left=bord, right=bord, top=bord, bottom=bord)
    gris = PatternFill("solid", fgColor="E7E6E6")
    centre = Alignment(horizontal="center", vertical="center", wrap_text=True)
    a_gauche = Alignment(horizontal="left", vertical="center", wrap_text=True)
    MONTANT, JOUR, POURCENT = "#,##0", "dd/mm/yyyy", "0.0%"
    titre_cie = nom or "TOUTES LES COMPAGNIES"
    periode = _periode_texte(r["Du"], r["Au"])
    situation = _jma(date.fromisoformat(r["Situation"]))

    def cellule(ws, ligne, colonne, valeur, gras=False, format_=None, taille=12, fond=None, formule=False, gauche=False):
        # formule=True seulement pour les formules construites ici ; toute autre chaîne reste du texte
        c = ws.cell(row=ligne, column=colonne, value=valeur)
        if isinstance(valeur, str) and not formule:
            texte_excel(c)
        c.font = Font(name="Arial Narrow", size=taille, bold=gras)
        c.alignment = a_gauche if gauche else centre
        c.border = cadre
        if format_:
            c.number_format = format_
        if fond:
            c.fill = fond
        return c

    def fusion(ws, ligne, premiere, derniere, valeur, **options):
        ws.merge_cells(start_row=ligne, start_column=premiere, end_row=ligne, end_column=derniere)
        for colonne in range(premiere + 1, derniere + 1):
            ws.cell(row=ligne, column=colonne).border = cadre
        return cellule(ws, ligne, premiere, valeur, **options)

    def feuille(titre_feuille, largeurs, titre):
        ws = classeur.create_sheet(titre_feuille)
        ws.sheet_view.zoomScale = 80
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        for i, largeur in enumerate(largeurs, start=1):
            ws.column_dimensions[get_column_letter(i)].width = largeur
        n = len(largeurs)
        fusion(ws, 2, 1, n, titre, gras=True, taille=15, fond=gris)
        ws.row_dimensions[2].height = 34
        fusion(ws, 3, 1, n, f"{titre_cie} - PRIMES REVERSEES {periode}", gras=True)
        fusion(ws, 4, 1, n, f"Situation au {situation}", gauche=False)
        return ws

    def entetes(ws, ligne, libelles, premiere=1):
        for i, libelle in enumerate(libelles, start=premiere):
            cellule(ws, ligne, i, libelle, gras=True, fond=gris)
        ws.row_dimensions[ligne].height = 48

    def total(ws, ligne, debut, fin, colonnes, libelle_jusqua):
        fusion(ws, ligne, 1, libelle_jusqua, "TOTAL", gras=True)
        for colonne in colonnes:
            lettre = get_column_letter(colonne)
            cellule(ws, ligne, colonne, f"=SUM({lettre}{debut}:{lettre}{fin})" if fin >= debut else 0, gras=True,
                    format_=MONTANT, formule=fin >= debut)

    classeur = Workbook()
    classeur.remove(classeur.active)

    # ---- 1. synthèse par compagnie et par mois de reversement
    ws = feuille("RECAPITULATIF", [36, 12, 18, 18, 18, 20, 20, 20, 15],
                 "ETAT RECAPITULATIF DES COMMISSIONS PAYEES ET EN ATTENTE DE PAIEMENT")
    colonnes_synthese = ["QUITTANCES", "PRIMES REVERSEES", "COMMISSIONS DUES", "COMMISSIONS PAYEES",
                         "EN ATTENTE : RECLAMEES A L'ASSUREUR", "EN ATTENTE : NON ENCORE RECLAMEES",
                         "TOTAL EN ATTENTE DE PAIEMENT", "TAUX DE RECOUVREMENT"]
    rangee = 6
    lignes_total = []
    for titre_bloc, libelle, groupes in (
        ("PAR COMPAGNIE", "COMPAGNIE", [(g["Compagnie"], g) for g in r["ParCompagnie"]]),
        ("PAR MOIS DE REVERSEMENT", "MOIS", [(_libelle_mois(g["Mois"]), g) for g in r["ParMois"]]),
    ):
        fusion(ws, rangee, 1, 9, titre_bloc, gras=True, fond=gris)
        rangee += 1
        entetes(ws, rangee, [libelle] + colonnes_synthese)
        debut = rangee + 1
        for etiquette, g in groupes:
            rangee += 1
            cellule(ws, rangee, 1, etiquette, gras=True, gauche=True)
            for colonne, cle in ((2, "Nombre"), (3, "PrimesReversees"), (4, "CommissionDue"), (5, "CommissionPayee"),
                                 (6, "EnAttenteReclamee"), (7, "EnAttenteAReclamer")):
                cellule(ws, rangee, colonne, g[cle], format_="0" if colonne == 2 else MONTANT, gras=colonne in (4, 5))
            cellule(ws, rangee, 8, f"=F{rangee}+G{rangee}", gras=True, format_=MONTANT, formule=True)
            cellule(ws, rangee, 9, f"=IF(D{rangee}=0,0,E{rangee}/D{rangee})", format_=POURCENT, formule=True)
        fin = rangee
        rangee += 1
        total(ws, rangee, debut, fin, range(2, 9), 1)
        ws.cell(row=rangee, column=2).number_format = "0"
        cellule(ws, rangee, 9, f"=IF(D{rangee}=0,0,E{rangee}/D{rangee})", gras=True, format_=POURCENT, formule=True)
        lignes_total.append(rangee)
        rangee += 3
    if not r["ParCompagnie"]:
        fusion(ws, rangee, 1, 9, "Aucune commission pour ces critères.")
        rangee += 2
    # Contrôles : dues = payées + en attente, et les deux synthèses (compagnies, mois) donnent les mêmes totaux
    t1, t2 = lignes_total
    for libelle, formule in (
        ("Contrôle : commissions dues - payées - total en attente (doit être 0)", f"=D{t1}-E{t1}-H{t1}"),
        ("Contrôle : total par compagnie - total par mois (doit être 0)", f"=D{t1}-D{t2}"),
    ):
        fusion(ws, rangee, 1, 4, libelle, gauche=True)
        cellule(ws, rangee, 5, formule, gras=True, format_=MONTANT, formule=True)
        rangee += 1

    # ---- 2. commissions payées : règlements reçus des assureurs
    ws = feuille("COMMISSIONS PAYEES", [15, 30, 21, 21, 12, 22, 22, 12, 18, 20],
                 "ETAT DES COMMISSIONS PAYEES - REGLEMENTS RECUS DES ASSUREURS")
    entetes(ws, 6, ["DATE DU REGLEMENT", "COMPAGNIE", "N° DU REGLEMENT", "BORDEREAU DE RECLAMATION", "MODE",
                    "N° DU CHEQUE / DU VIREMENT", "BANQUE", "QUITTANCES", "MONTANT DU REGLEMENT",
                    "COMMISSIONS REGLEES (PERIODE)"])
    rangee = 6
    for p in r["Reglements"]:
        rangee += 1
        valeurs = [(datetime.fromisoformat(p["DatePaiement"]) if p["DatePaiement"] else None, JOUR), (p["Compagnie"], None),
                   (p["Reference"], None), (p["Reclamation"], None), (p["Mode"], None), (p["ReferencePaiement"], None),
                   (p["Banque"], None), (p["Nombre"], "0"), (p["MontantReglement"], MONTANT), (p["Montant"], MONTANT)]
        for colonne, (valeur, format_) in enumerate(valeurs, start=1):
            cellule(ws, rangee, colonne, valeur, format_=format_, gras=colonne == 10, gauche=colonne == 2)
    total(ws, rangee + 1, 7, rangee, (8, 9, 10), 7)
    ws.cell(row=rangee + 1, column=8).number_format = "0"
    if not r["Reglements"]:
        fusion(ws, rangee + 3, 1, 10, "Aucun règlement de commission reçu pour ces quittances.")

    # ---- 3. commissions en attente de paiement
    ws = feuille("EN ATTENTE DE PAIEMENT", [22, 30, 16, 16, 13, 20, 18, 18],
                 "ETAT DES COMMISSIONS EN ATTENTE DE PAIEMENT")
    fusion(ws, 6, 1, 8, "COMMISSIONS RECLAMEES, EN ATTENTE DU REGLEMENT DE L'ASSUREUR", gras=True, fond=gris)
    entetes(ws, 7, ["N° DU BORDEREAU", "COMPAGNIE", "EMIS LE", "ANCIENNETE (JOURS)", "QUITTANCES",
                    "COMMISSIONS RECLAMEES", "DEJA REGLE", "RESTE DU"])
    rangee = 7
    for rc in r["Reclamations"]:
        rangee += 1
        valeurs = [(rc["Reference"], None), (rc["Compagnie"], None),
                   (datetime.fromisoformat(rc["DateEmission"]) if rc["DateEmission"] else None, JOUR),
                   (rc["Anciennete"], "0"), (rc["Nombre"], "0"), (rc["CommissionReclamee"], MONTANT),
                   (rc["CommissionPayee"], MONTANT)]
        for colonne, (valeur, format_) in enumerate(valeurs, start=1):
            cellule(ws, rangee, colonne, valeur, format_=format_, gauche=colonne == 2)
        cellule(ws, rangee, 8, f"=F{rangee}-G{rangee}", gras=True, format_=MONTANT, formule=True)
    total(ws, rangee + 1, 8, rangee, (5, 6, 7, 8), 4)
    ws.cell(row=rangee + 1, column=5).number_format = "0"
    rangee += 4
    fusion(ws, rangee, 1, 8, "COMMISSIONS NON ENCORE RECLAMEES (BORDEREAU RECAPITULATIF A EMETTRE)", gras=True, fond=gris)
    rangee += 1
    fusion(ws, rangee, 1, 2, "COMPAGNIE", gras=True, fond=gris)
    entetes(ws, rangee, ["PLUS ANCIEN REVERSEMENT", "ANCIENNETE (JOURS)", "QUITTANCES", "MONTANT A RECLAMER"], premiere=3)
    debut = rangee + 1
    for n in r["NonReclamees"]:
        rangee += 1
        fusion(ws, rangee, 1, 2, n["Compagnie"], gauche=True)
        cellule(ws, rangee, 3, datetime.fromisoformat(n["PlusAncien"]) if n["PlusAncien"] else None, format_=JOUR)
        cellule(ws, rangee, 4, n["Anciennete"], format_="0")
        cellule(ws, rangee, 5, n["Nombre"], format_="0")
        cellule(ws, rangee, 6, n["Montant"], gras=True, format_=MONTANT)
    total(ws, rangee + 1, debut, rangee, (5, 6), 4)
    ws.cell(row=rangee + 1, column=5).number_format = "0"

    # ---- 4. détail des quittances (état des commissions payées et non payées)
    ws = feuille("DETAIL DES QUITTANCES", [26, 32, 20, 19, 24, 20, 14, 16, 16, 16, 36],
                 "DETAIL DES COMMISSIONS PAR QUITTANCE")
    entetes(ws, 6, ["COMPAGNIE", "NOM DU CLIENT", "N° POLICE", "N° QUITTANCE", "ASSURANCE", "N° DU BORDEREAU DE REVERSEMENT",
                    "DATE DU REVERSEMENT", "COMMISSION DUE", "COMMISSION PAYEE", "RESTE DU", "SITUATION"])
    rangee = 6
    for l in sorted(r["Lignes"], key=lambda l: (l["Compagnie"], l["DateReversement"] or "", l["IdDetailReversement"])):
        rangee += 1
        valeurs = [(l["Compagnie"], None), (l["Client"], None), (l["PoliceCompagnie"] or l["NumeroPolice"], None),
                   (l["NumeroQuittance"], None), (l["Assurance"], None), (l["NumeroBordereau"] or l["NumeroReversement"], None),
                   (datetime.fromisoformat(l["DateReversement"]) if l["DateReversement"] else None, JOUR),
                   (l["CommissionDue"], MONTANT), (l["CommissionPayee"], MONTANT)]
        for colonne, (valeur, format_) in enumerate(valeurs, start=1):
            cellule(ws, rangee, colonne, valeur, format_=format_, gauche=colonne in (1, 2))
        cellule(ws, rangee, 10, f"=H{rangee}-I{rangee}", gras=True, format_=MONTANT, formule=True)
        cellule(ws, rangee, 11, _situation_commission(l), gauche=True)
    total(ws, rangee + 1, 7, rangee, (8, 9, 10), 7)
    cellule(ws, rangee + 1, 11, "")

    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def recapitulatif_commissions_excel(request):
    """GET /api/finance/commissions/recapitulatif/excel/?compagnie=&du=&au= : état récapitulatif des commissions
    payées et en attente de paiement (4 feuilles)."""
    from .views_finance import _filtres_recapitulatif, recapitulatif_commissions

    try:
        id_compagnie, du, au = _filtres_recapitulatif(request)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    r = recapitulatif_commissions(id_compagnie, du, au)
    reponse = HttpResponse(_classeur_recapitulatif_commissions(r, r["Compagnie"]),
                           content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    periode = _periode_texte(r["Du"], r["Au"]).replace("/", "-")
    fichier = f"ETAT RECAPITULATIF DES COMMISSIONS {r['Compagnie'] or 'TOUTES COMPAGNIES'} {periode}.xlsx"
    reponse["Content-Disposition"] = f'attachment; filename="{fichier.replace(chr(39), " ")}"'
    return reponse


# ------------------------------------------------------------------ bordereau récapitulatif des encaissements (Excel)
STATUTS_HORS_TOTAL = ("ANNULE", "IMPAYE")


def _classeur_recapitulatif_encaissements(etat, nom, filtres_texte):
    """Bordereau récapitulatif des encaissements du … au … (demande du 2026-10-21), à la présentation des classeurs
    d'OREOLE : une ligne par quittance encaissée (n° du bordereau d'encaissement, date de saisie, client, compagnie,
    quittance, mode, référence, montant, statut) ; total sans les encaissements annulés ni les chèques impayés
    (SOMME.SI.ENS), récapitulatifs par mode de paiement et par compagnie, contrôle = 0."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    from core.exports import texte_excel

    from .views_finance import LIBELLES_STATUT

    bord = Side(style="medium")
    cadre = Border(left=bord, right=bord, top=bord, bottom=bord)
    gris = PatternFill("solid", fgColor="E7E6E6")
    centre = Alignment(horizontal="center", vertical="center", wrap_text=True)
    a_gauche = Alignment(horizontal="left", vertical="center", wrap_text=True)
    MONTANT, JOUR = "#,##0", "dd/mm/yyyy"

    def cellule(ws, ligne, colonne, valeur, gras=False, format_=None, taille=12, fond=None, formule=False, gauche=False):
        c = ws.cell(row=ligne, column=colonne, value=valeur)
        if isinstance(valeur, str) and not formule:
            texte_excel(c)
        c.font = Font(name="Arial Narrow", size=taille, bold=gras)
        c.alignment = a_gauche if gauche else centre
        c.border = cadre
        if format_:
            c.number_format = format_
        if fond:
            c.fill = fond
        return c

    def fusion(ws, ligne, premiere, derniere, valeur, **options):
        ws.merge_cells(start_row=ligne, start_column=premiere, end_row=ligne, end_column=derniere)
        for colonne in range(premiere + 1, derniere + 1):
            ws.cell(row=ligne, column=colonne).border = cadre
        return cellule(ws, ligne, premiere, valeur, **options)

    classeur = Workbook()
    ws = classeur.active
    ws.title = "ENCAISSEMENTS"
    ws.sheet_view.zoomScale = 80
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    largeurs = [19, 13, 32, 24, 22, 20, 18, 15, 30, 16, 22]
    for i, largeur in enumerate(largeurs, start=1):
        ws.column_dimensions[get_column_letter(i)].width = largeur
    fusion(ws, 2, 1, 11, "BORDEREAU RECAPITULATIF DES ENCAISSEMENTS", gras=True, taille=15, fond=gris)
    ws.row_dimensions[2].height = 32
    fusion(ws, 3, 1, 11, f"{nom or 'TOUTES LES COMPAGNIES'} - ENCAISSEMENTS {_periode_texte(etat['Du'], etat['Au'])}", gras=True)
    fusion(ws, 4, 1, 11, filtres_texte or "Tous les modes et tous les statuts")

    entetes = ["N° DU BORDEREAU D'ENCAISSEMENT", "DATE DE SAISIE", "NOM DU CLIENT", "COMPAGNIE", "ASSURANCE", "N° POLICE",
               "N° QUITTANCE", "MODE", "REFERENCE / BANQUE", "MONTANT", "STATUT"]
    for i, entete in enumerate(entetes, start=1):
        cellule(ws, 6, i, entete, gras=True, fond=gris)
    ws.row_dimensions[6].height = 42
    rangee = 6
    for l in etat["Lignes"]:
        rangee += 1
        reference = " - ".join(x for x in (l["Reference"], l["Banque"]) if x)
        valeurs = [(l["NumeroPiece"], None), (datetime.fromisoformat(l["DateEncaissement"]) if l["DateEncaissement"] else None, JOUR),
                   (l["Client"], None), (l["Compagnie"], None), (_branche(None, l["Branche"]), None), (l["NumeroPolice"], None),
                   (l["NumeroQuittance"], None), (l["Mode"], None), (reference, None), (l["Montant"], MONTANT),
                   (l["LibelleStatut"], None)]
        for colonne, (valeur, format_) in enumerate(valeurs, start=1):
            cellule(ws, rangee, colonne, valeur, format_=format_, gras=colonne == 10, gauche=colonne in (3, 9))
    debut, fin = 7, rangee
    exclus = [LIBELLES_STATUT[s] for s in STATUTS_HORS_TOTAL]
    rangee += 1
    fusion(ws, rangee, 1, 9, "TOTAL (hors encaissements annulés et chèques impayés)", gras=True)
    formule_total = (f'=SUMIFS(J{debut}:J{fin},K{debut}:K{fin},"<>{exclus[0]}",K{debut}:K{fin},"<>{exclus[1]}")'
                     if fin >= debut else 0)
    cellule(ws, rangee, 10, formule_total, gras=True, format_=MONTANT, formule=fin >= debut)
    cellule(ws, rangee, 11, "")
    ligne_total = rangee

    # Récapitulatifs par mode de paiement et par compagnie (encaissements retenus au total)
    lignes_recap = []
    for titre, groupes in (("PAR MODE DE PAIEMENT", etat["ParMode"]), ("PAR COMPAGNIE", etat["ParCompagnie"])):
        if titre == "PAR COMPAGNIE" and len(groupes) < 2:
            continue
        rangee += 2
        fusion(ws, rangee, 8, 10, titre, gras=True, fond=gris)
        rangee += 1
        for colonne, entete in ((8, "LIBELLE"), (9, "NOMBRE"), (10, "MONTANT")):
            cellule(ws, rangee, colonne, entete, gras=True, fond=gris)
        premiere = rangee + 1
        for g in groupes:
            rangee += 1
            cellule(ws, rangee, 8, g["Libelle"], gauche=True)
            cellule(ws, rangee, 9, g["Nombre"], format_="0")
            cellule(ws, rangee, 10, g["Montant"], format_=MONTANT)
        rangee += 1
        cellule(ws, rangee, 8, "TOTAL", gras=True)
        cellule(ws, rangee, 9, f"=SUM(I{premiere}:I{rangee - 1})" if groupes else 0, gras=True, format_="0", formule=bool(groupes))
        cellule(ws, rangee, 10, f"=SUM(J{premiere}:J{rangee - 1})" if groupes else 0, gras=True, format_=MONTANT, formule=bool(groupes))
        lignes_recap.append(rangee)
    rangee += 2
    fusion(ws, rangee, 6, 9, "Contrôle : total - total par mode (doit être 0)", gauche=True)
    cellule(ws, rangee, 10, f"=J{ligne_total}-J{lignes_recap[0]}" if lignes_recap else 0, gras=True, format_=MONTANT,
            formule=bool(lignes_recap))
    rangee += 2
    ws.merge_cells(start_row=rangee, start_column=1, end_row=rangee, end_column=9)
    arrete = ws.cell(row=rangee, column=1,
                     value=f"Arrêté le présent bordereau à la somme de {_f(etat['Total']['Montant'])} FCFA "
                           f"({etat['Total']['Nombre']} encaissement(s) retenu(s)).")
    texte_excel(arrete)
    arrete.font = Font(name="Arial Narrow", size=13, bold=True)
    rangee += 3
    for colonne, texte in ((1, "LE CAISSIER"), (9, "VISA DE LA DIRECTION")):
        signature = ws.cell(row=rangee, column=colonne, value=texte)
        texte_excel(signature)
        signature.font = Font(name="Arial Narrow", size=13, bold=True, underline="single")
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def recapitulatif_encaissements_excel(request):
    """GET /api/finance/encaissements/recapitulatif/excel/?du=&au=&compagnie=&mode=&statut= : bordereau récapitulatif
    des encaissements de la période (mêmes lignes et totaux que l'état des encaissements)."""
    from .views_finance import LIBELLES_STATUT, donnees_etat_encaissements

    try:
        etat = donnees_etat_encaissements(request.query_params)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    id_compagnie = request.query_params.get("compagnie")
    nom = reglages_compagnie(int(id_compagnie), _nom_compagnie(int(id_compagnie)))["NomBordereau"] if id_compagnie else ""
    filtres = []
    if request.query_params.get("mode"):
        filtres.append(f"Mode : {etat['Lignes'][0]['Mode']}" if etat["Lignes"] else "Mode choisi")
    if request.query_params.get("statut") in LIBELLES_STATUT:
        filtres.append(f"Statut : {LIBELLES_STATUT[request.query_params['statut']]}")
    reponse = HttpResponse(_classeur_recapitulatif_encaissements(etat, nom, " - ".join(filtres)),
                           content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    fichier = f"BORDEREAU RECAPITULATIF DES ENCAISSEMENTS {nom or 'TOUTES COMPAGNIES'} {_periode_texte(etat['Du'], etat['Au'])}"
    reponse["Content-Disposition"] = f'attachment; filename="{fichier.replace("/", "-").replace(chr(39), " ")}.xlsx"'
    return reponse
