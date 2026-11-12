"""
Flux financiers du cabinet après l'encaissement des primes (Code CIMA) :

1. État récapitulatif des encaissements : montant, mode, référence et statut de chaque ligne
   encaissée (quittance), par compagnie.
2. Reversement à la compagnie : le cabinet reverse la prime encaissée ENTIÈRE (le courtier ne
   déduit pas sa commission des primes à reverser). Procédures d'URANUS sp_enregistrement_reversement
   (montants par ligne d'encaissement, numéro de reversement) et sp_validation_reversement (paiement
   à la compagnie : chèque, virement…). Bordereau de reversement au modèle d'OREOLE (Compagnie,
   Client, Branche, Police, Quittance, Avenant, dates, prime nette, accessoire, taxe, TTC, commission).
3. Réclamation des commissions : bordereau récapitulatif (en général mensuel) des quittances
   reversées cochées, qui réclame à l'assureur la commission due au cabinet.
4. Encaissement des commissions : règlement de l'assureur (chèque ou virement) imputé sur les
   lignes du bordereau ; états des commissions payées et non payées (chiffre d'affaires du
   cabinet = commissions, pas émissions).

Commission due d'une quittance = commission du contrat (prime HT hors FGA et CEDEAO x taux,
stdcontrat.commissionintermediaire) + accessoires du cabinet (stdcontrat.accessoireintermediaire), réclamée entière
dès le premier reversement de la quittance, comme sur les bordereaux d'OREOLE (1175 : commission entière au 1er
acompte) ; les reversements suivants de la quittance (solde) ne portent plus de commission. Bordereaux, courriers et
tableau de reversement au modèle d'OREOLE : production/views_bordereaux.py.

Encaissements repris d'URANUS (saisis en décembre 2025, encaissés jusqu'au 14/11/2025) : réputés
reversés hors LE PHARE, ils ne sont pas proposés au reversement (DEBUT_REVERSEMENTS).
"""

from collections import OrderedDict
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import connection, transaction
from django.db.models import Sum
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from configuration_api.parametrage import valeur_parametre
from institutionnel.authentication import KnoxOrDemoTokenAuthentication
from autorisations.permissions import DroitDeLaRoute

from .reste_encaissement import reste_a_encaisser

AUTHENTIFICATION = [KnoxOrDemoTokenAuthentication, BasicAuthentication]
# Premier jour des encaissements saisis dans LE PHARE (avant : reprise d'URANUS) ; réglable dans
# l'admin (Le cabinet > Règles de gestion, paramètre « finance.debut_reversements »)
DEBUT_REVERSEMENTS = date(2025, 12, 1)


def debut_reversements():
    return valeur_parametre("finance.debut_reversements", DEBUT_REVERSEMENTS)
ZERO = Decimal("0")


class ErreurFinance(Exception):
    """Saisie refusée : message affiché tel quel."""


class EcrituresAdministrateur(DroitDeLaRoute):
    """Lecture pour tout utilisateur connecté ; reversements, réclamations et règlements de commissions selon les
    droits attribués (reversements, commissions : DroitDeLaRoute, séparation des tâches de la garde)."""


def _franc(valeur):
    return Decimal(valeur or 0).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _nombre(valeur):
    return float(valeur) if valeur is not None else 0.0


def _date(valeur, champ, obligatoire=True):
    if not valeur:
        if obligatoire:
            raise ErreurFinance(f"{champ} : à renseigner.")
        return None
    if isinstance(valeur, date):
        return valeur
    texte = str(valeur).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(texte, fmt).date()
        except ValueError:
            continue
    raise ErreurFinance(f"{champ} : date invalide ({valeur!r}).")


def _entier(valeur, champ, obligatoire=True):
    try:
        nombre = int(valeur or 0)
    except (TypeError, ValueError):
        raise ErreurFinance(f"{champ} : valeur invalide.")
    if obligatoire and nombre <= 0:
        raise ErreurFinance(f"{champ} : à renseigner.")
    return nombre


def _montant(valeur, champ):
    try:
        montant = Decimal(str(valeur).replace(" ", "").replace(",", "."))
    except (InvalidOperation, TypeError):
        raise ErreurFinance(f"{champ} : montant invalide.")
    if montant <= 0:
        raise ErreurFinance(f"{champ} : doit être positif.")
    return montant


def _lignes(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        colonnes = [c[0] for c in cursor.description]
        return [dict(zip(colonnes, ligne)) for ligne in cursor.fetchall()]


def _erreur(exc):
    message = str(exc).split("\n")[0]
    return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)


def _iso(valeur):
    if valeur is None:
        return None
    if isinstance(valeur, datetime):
        valeur = valeur.date()
    return valeur.isoformat()


# ------------------------------------------------------------------ lignes d'encaissement
# Une ligne par quittance encaissée : encaissement (mode, référence), quittance, contrat
# (avenant, commission), compagnie, branche, client, chèque éventuel
SQL_LIGNES_ENCAISSEMENT = """
    SELECT de.iddetailencaissement, e.idencaissement, e.numeropiece, e.dateencaissement::date AS dateencaissement,
           COALESCE(e.piece_annulee, FALSE) AS annulee, e.motifannulation,
           m.idmodeencaissement AS idmode, m.libellemodepaiement AS mode, UPPER(TRIM(COALESCE(m.abregereglement, ''))) AS abrege,
           COALESCE(NULLIF(TRIM(e.numerocheque), ''), NULLIF(TRIM(e.numerobordereau), ''), NULLIF(TRIM(e.numerorecuoperateur), ''),
                    NULLIF(TRIM(e.compte_compensation), ''), e.referencetransaction::text, '') AS reference,
           CASE WHEN UPPER(TRIM(COALESCE(b.libelle, ''))) IN ('', 'NEANT', 'AUCUNE', 'AUCUN') THEN NULL ELSE TRIM(b.libelle) END AS banque,
           de.montant_encaissement, COALESCE(de.montantreglement, 0) AS montantreverse,
           q.idquittance, q.numeroquittance, q.numeropolice, q.dateemission, q.dateeffet::date AS dateeffet,
           q.dateexpiration::date AS dateexpiration, q.primenette, q.accessoire, q.taxe, q.primettc,
           ct.idcontrat, ct.numeroavenant, COALESCE(ct.commissionintermediaire, 0) AS commission,
           COALESCE(ct.accessoireintermediaire, 0) AS acccourtier,
           cie.idcompagnie, cie.raisonsociale AS compagnie, p.libelleproduit AS branche,
           TRIM(cl.nom || ' ' || COALESCE(cl.prenoms, '')) AS client,
           ch.statut AS statutcheque, e.datecheque, e.datereceptioncheque,
           CASE WHEN op.iddevis_sante IS NOT NULL AND COALESCE(q.primettc, 0) > 0
                THEN LEAST((COALESCE(ct.primenette, 0) + COALESCE(ct.accessoirecompagnie, 0)) / q.primettc, 1) END AS partcompagnie
    FROM stddetailencaissement de
    JOIN stdencaissement e ON e.idencaissement = de.idencaissement
    JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
    LEFT JOIN LATERAL (SELECT c.idcontrat, c.iddevis, c.numeroavenant, c.commissionintermediaire, c.accessoireintermediaire, c.idcompagnie,
                              c.primenette, c.accessoirecompagnie
                       FROM stdcontrat c WHERE c.idquittance = q.idquittance ORDER BY c.idcontrat LIMIT 1) ct ON TRUE
    LEFT JOIN lephare_oreole_package op ON op.iddevis_sante = ct.iddevis
    LEFT JOIN stdcompagnie cie ON cie.idcompagnie = COALESCE(ct.idcompagnie, q.idaperiteur)
    LEFT JOIN stdproduit p ON p.idproduit = q.idproduit
    LEFT JOIN stdclient cl ON cl.idclient = q.idclient
    LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
    LEFT JOIN stdbanque b ON b.idbanque = e.idbanque
    LEFT JOIN LATERAL (SELECT c.statut FROM stdchequeoperation op JOIN stdcheque c ON c.idcheque = op.idcheque
                       WHERE op.idencaissement = e.idencaissement ORDER BY op.idoperation DESC LIMIT 1) ch ON TRUE
"""

LIBELLES_STATUT = {
    "ANNULE": "Annulé",
    "IMPAYE": "Chèque impayé",
    "REVERSE": "Reversé à la compagnie",
    "PARTIEL": "Partiellement reversé",
    "A_REVERSER": "À reverser",
    "DECAISSEMENT": "Décaissement (déduit)",
    "DEDUIT": "Couvert par un décaissement",
    "REPRIS": "Repris d'URANUS",
}

# Modes qui sortent de l'argent d'une quittance (enregistrés en positif par la caisse) : leur
# montant est compté en négatif et déduit du reste à reverser de la quittance
MODES_DECAISSEMENT = {"DMA"}  # Décaissement de prime mal affectée


def _est_decaissement(ligne):
    return ligne["abrege"] in MODES_DECAISSEMENT


# Oreole Santé : la compagnie ne connaît que sa part (prime HT + accessoires) ; les frais courtiers restent au cabinet, ils
# ne se reversent pas et ne se réclament pas. {ct} : contrat de la quittance q.
SQL_EST_OREOLE = "EXISTS (SELECT 1 FROM lephare_oreole_package opk WHERE opk.iddevis_sante = {ct}.iddevis)"
SQL_ACC_COURTIER = "CASE WHEN " + SQL_EST_OREOLE + " THEN 0 ELSE COALESCE({ct}.accessoireintermediaire, 0) END"
SQL_PART_COMPAGNIE = ("CASE WHEN " + SQL_EST_OREOLE + " AND COALESCE(q.primettc, 0) > 0 "
                      "THEN LEAST((COALESCE({ct}.primenette, 0) + COALESCE({ct}.accessoirecompagnie, 0)) / q.primettc, 1) END")


def part_compagnie(montant, part):
    """Part d'un montant de quittance revenant à la compagnie : tout, sauf en Oreole Santé (SQL_PART_COMPAGNIE)."""
    if part is None or montant is None:
        return montant
    return (montant * part).quantize(Decimal(1), rounding=ROUND_HALF_UP)


def _a_reverser(ligne):
    """Part de l'encaissement due à la compagnie : tout, sauf en Oreole Santé où le cabinet garde ses frais courtiers (prime HT +
    accessoires à MCI, au prorata de l'encaissement)."""
    return part_compagnie(ligne["montant_encaissement"], ligne.get("partcompagnie"))


def _restes_nets(numeros_quittance):
    """Reste à reverser de chaque ligne d'encaissement, décaissements de la quittance déduits :
    reste net de la quittance = encaissé − reversé − décaissé (au moins 0), réparti sur ses
    lignes d'encaissement dans l'ordre chronologique."""
    if not numeros_quittance:
        return {}
    toutes = _lignes(
        SQL_LIGNES_ENCAISSEMENT
        + " WHERE de.numeroquittance = ANY(%s) AND NOT COALESCE(e.piece_annulee, FALSE) AND de.montant_encaissement > 0"
        + " ORDER BY e.dateencaissement, de.iddetailencaissement",
        [list(numeros_quittance)],
    )
    par_quittance = {}
    for l in toutes:
        par_quittance.setdefault(l["numeroquittance"], []).append(l)
    restes = {}
    for lignes in par_quittance.values():
        encaissements = [l for l in lignes if not _est_decaissement(l)]
        decaisse = sum((l["montant_encaissement"] for l in lignes if _est_decaissement(l)), ZERO)
        net = max(sum((max(_a_reverser(l) - l["montantreverse"], ZERO) for l in encaissements), ZERO) - decaisse, ZERO)
        for l in encaissements:
            part = min(max(_a_reverser(l) - l["montantreverse"], ZERO), net)
            restes[l["iddetailencaissement"]] = part
            net -= part
    return restes


def _statut_encaissement(ligne, reste_net=None):
    if ligne["annulee"]:
        return "IMPAYE" if ligne["statutcheque"] in ("IMPAYE", "REENCAISSE") else "ANNULE"
    if _est_decaissement(ligne):
        return "DECAISSEMENT"
    if ligne["montantreverse"] >= _a_reverser(ligne) > 0:
        return "REVERSE"
    if ligne["dateencaissement"] and ligne["dateencaissement"] < debut_reversements() and ligne["montantreverse"] == 0:
        return "REPRIS"
    if reste_net is not None and reste_net <= 0:
        return "DEDUIT"
    if ligne["montantreverse"] > 0:
        return "PARTIEL"
    return "A_REVERSER"


def _ligne_bordereau(ligne):
    """Colonnes du bordereau d'OREOLE (une quittance)."""
    return {
        "IdDetailEncaissement": ligne["iddetailencaissement"],
        "Compagnie": ligne["compagnie"] or "",
        "IdCompagnie": ligne["idcompagnie"],
        "Client": ligne["client"] or "",
        "Branche": ligne["branche"] or "",
        "NumeroPolice": ligne["numeropolice"] or "",
        "NumeroQuittance": ligne["numeroquittance"],
        "NumeroAvenant": (ligne["numeroavenant"] or "").strip(),
        "DateEmission": _iso(ligne["dateemission"]),
        "DateEffet": _iso(ligne["dateeffet"]),
        "DateExpiration": _iso(ligne["dateexpiration"]),
        "PrimeNette": _nombre(ligne["primenette"]),
        "Accessoire": _nombre(ligne["accessoire"]),
        "Taxe": _nombre(ligne["taxe"]),
        "PrimeTtc": _nombre(ligne["primettc"]),
        "Commission": _nombre(ligne["commission"]),
    }


def _ligne_encaissement(ligne, restes=None):
    """restes : reste à reverser net par ligne (_restes_nets), décaissements de la quittance déduits."""
    reste_net = (restes or {}).get(ligne["iddetailencaissement"]) if restes is not None else None
    statut = _statut_encaissement(ligne, reste_net)
    if statut in ("A_REVERSER", "PARTIEL"):
        reste = reste_net if reste_net is not None else max(_a_reverser(ligne) - ligne["montantreverse"], ZERO)
    else:
        reste = ZERO
    signe = -1 if statut == "DECAISSEMENT" else 1
    return {
        **_ligne_bordereau(ligne),
        "IdEncaissement": ligne["idencaissement"],
        "NumeroPiece": ligne["numeropiece"] or "",
        "DateEncaissement": _iso(ligne["dateencaissement"]),
        "Mode": ligne["mode"] or "",
        "IdMode": ligne["idmode"],
        "Reference": ligne["reference"] or "",
        "Banque": ligne["banque"] or "",
        # Chèque : date d'émission et date de réception au cabinet (DateEncaissement = date de saisie)
        "DateCheque": _iso(ligne["datecheque"]),
        "DateReceptionCheque": _iso(ligne["datereceptioncheque"]),
        # Décaissement : compté en négatif (déduit des totaux et du reste à reverser)
        "Montant": _nombre(ligne["montant_encaissement"]) * signe,
        "MontantReverse": _nombre(ligne["montantreverse"]),
        "ResteAReverser": _nombre(reste),
        "Statut": statut,
        "LibelleStatut": LIBELLES_STATUT[statut],
        "MotifAnnulation": (ligne["motifannulation"] or "").strip(),
    }


def encaissements_a_reverser():
    """Lignes d'encaissement encore à reverser, toutes compagnies, décaissements déduits : celles de l'écran des
    reversements (cockpit, conventions, tableau de bord)."""
    lignes = _lignes(
        SQL_LIGNES_ENCAISSEMENT + """
        WHERE NOT COALESCE(e.piece_annulee, FALSE) AND de.montant_encaissement > COALESCE(de.montantreglement, 0)
          AND e.dateencaissement::date >= %s
        """,
        [debut_reversements()],
    )
    restes = _restes_nets({l["numeroquittance"] for l in lignes})
    return [l for l in (_ligne_encaissement(l, restes) for l in lignes if not _est_decaissement(l)) if l["ResteAReverser"] > 0]


# ------------------------------------------------------------------ recherche d'un règlement
# Référence du règlement : numéro du chèque, du virement ou de la traite, bordereau d'espèces, reçu de l'opérateur, compensation, transaction
SQL_REFERENCE_REGLEMENT = """COALESCE(NULLIF(TRIM(e.numerocheque), ''), NULLIF(TRIM(e.numerobordereau), ''), NULLIF(TRIM(e.numerorecuoperateur), ''),
    NULLIF(TRIM(e.compte_compensation), ''), e.referencetransaction::text, '')"""
MAX_REGLEMENTS_TROUVES = 60


def rechercher_reglements(parametres):
    """À quoi a servi un règlement, quel qu'en soit le mode (demande du 2026-11-05) : recherche par référence, pièce, émetteur, quittance,
    police, client ou montant ; chaque règlement revient avec toutes les quittances qu'il a payées, même si une seule correspond."""
    texte = " ".join(str(parametres.get("q") or "").split())
    mode = _entier(parametres.get("mode"), "Mode", obligatoire=False)
    du = _date(parametres.get("du"), "Du", obligatoire=False)
    au = _date(parametres.get("au"), "Au", obligatoire=False)
    if len(texte) < 2 and not mode:
        raise ErreurFinance("Saisissez au moins 2 caractères : numéro du chèque ou du virement, police, quittance, client, émetteur.")
    conditions, params = [], []
    if len(texte) >= 2:
        motif = "%" + texte.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        champs = ["e.numerocheque", "e.numerobordereau", "e.numerorecuoperateur", "e.compte_compensation", "e.numeropiece", "e.referencetransaction::text",
                  "e.nomtireurcheque", "de.numeroquittance", "q.numeropolice", "TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, ''))"]
        possibles = [f"{champ} ILIKE %s" for champ in champs]
        params += [motif] * len(champs)
        chiffres = texte.replace(" ", "")
        if chiffres.isdigit():
            possibles.append("de.montant_encaissement = %s")
            params.append(int(chiffres))
        conditions.append("(" + " OR ".join(possibles) + ")")
    if mode:
        conditions.append("e.idmodepaiement = %s")
        params.append(mode)
    if du:
        conditions.append("e.dateencaissement::date >= %s")
        params.append(du)
    if au:
        conditions.append("e.dateencaissement::date <= %s")
        params.append(au)
    trouves = _lignes(
        f"""SELECT e.idencaissement, e.idmodepaiement, e.idbanque, {SQL_REFERENCE_REGLEMENT} AS reference, e.dateencaissement
            FROM stdencaissement e
            LEFT JOIN stddetailencaissement de ON de.idencaissement = e.idencaissement
            LEFT JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
            LEFT JOIN stdclient cl ON cl.idclient = q.idclient
            WHERE {" AND ".join(conditions)}
            GROUP BY e.idencaissement ORDER BY e.dateencaissement DESC, e.idencaissement DESC LIMIT %s""",
        params + [MAX_REGLEMENTS_TROUVES * 3],
    )

    def cle(ligne):
        # Un même chèque, virement ou bordereau peut servir plusieurs fois : c'est un seul règlement
        return (ligne["idmodepaiement"], ligne["idbanque"], ligne["reference"]) if ligne["reference"] else ("PIECE", ligne["idencaissement"])

    cles = list(OrderedDict.fromkeys(cle(t) for t in trouves))
    tronque = len(cles) > MAX_REGLEMENTS_TROUVES
    cles = cles[:MAX_REGLEMENTS_TROUVES]
    ids = {c[1] for c in cles if c[0] == "PIECE"}
    instruments = [c for c in cles if c[0] != "PIECE"]
    if instruments:
        for autre in _lignes(
            f"""SELECT e.idencaissement, e.idmodepaiement, e.idbanque, {SQL_REFERENCE_REGLEMENT} AS reference FROM stdencaissement e
                WHERE e.idmodepaiement = ANY(%s) AND {SQL_REFERENCE_REGLEMENT} = ANY(%s)""",
            [list({c[0] for c in instruments}), list({c[2] for c in instruments})],
        ):
            if cle(autre) in instruments:
                ids.add(autre["idencaissement"])
    if not ids:
        return {"Reglements": [], "Tronque": False}
    ids = list(ids)
    # Contre-passations d'une annulation écartées : la ligne d'origine porte le statut « Annulé »
    brutes = _lignes(SQL_LIGNES_ENCAISSEMENT + """ WHERE e.idencaissement = ANY(%s) AND de.montant_encaissement > 0
                     ORDER BY e.dateencaissement, e.idencaissement, de.iddetailencaissement""", [ids])
    restes = _restes_nets({l["numeroquittance"] for l in brutes})
    complements = {c["idencaissement"]: c for c in _lignes(
        f"""SELECT e.idencaissement, e.idmodepaiement, e.idbanque, {SQL_REFERENCE_REGLEMENT} AS reference, NULLIF(TRIM(e.nomtireurcheque), '') AS emetteur,
                   u.name AS operateur, e.datecheque, e.datereceptioncheque
            FROM stdencaissement e LEFT JOIN account_uranususer u ON u.id = e.idutilisateur WHERE e.idencaissement = ANY(%s)""", [ids])}
    cheques = {c["idencaissement"]: c for c in _lignes(
        """SELECT op.idencaissement, c.montantinitial, c.soldedisponible, c.statut, c.datedepot
           FROM stdchequeoperation op JOIN stdcheque c ON c.idcheque = op.idcheque WHERE op.idencaissement = ANY(%s)""", [ids])}
    encaisses = {q["numeroquittance"]: q["encaisse"] for q in _lignes(
        "SELECT numeroquittance, COALESCE(mt_encaisse, 0) AS encaisse FROM stdquittance WHERE numeroquittance = ANY(%s)", [list({l["numeroquittance"] for l in brutes})])}
    libelles_cheque = {"A_DEPOSER": "À déposer", "ENCAISSE": "Encaissé", "IMPAYE": "Impayé", "REENCAISSE": "Réencaissé"}
    groupes = OrderedDict((c, None) for c in cles)
    for brute in brutes:
        complement = complements[brute["idencaissement"]]
        groupe = groupes.get(cle(complement))
        if groupe is None:
            if cle(complement) not in groupes:
                continue
            groupe = groupes[cle(complement)] = {
                "Cle": "-".join(str(x) for x in cle(complement)), "Mode": brute["mode"] or "", "Reference": brute["reference"] or "", "Banque": brute["banque"] or "",
                "Emetteur": complement["emetteur"] or "", "DateCheque": _iso(complement["datecheque"]), "DateReception": _iso(complement["datereceptioncheque"]),
                "Cheque": None, "Montant": 0.0, "MontantReverse": 0.0, "Pieces": [], "Lignes": [],
            }
        cheque = cheques.get(brute["idencaissement"])
        if cheque and not groupe["Cheque"]:
            groupe["Cheque"] = {"MontantInitial": _nombre(cheque["montantinitial"]), "SoldeDisponible": _nombre(cheque["soldedisponible"]), "Statut": cheque["statut"],
                                "LibelleStatut": libelles_cheque.get(cheque["statut"], cheque["statut"] or ""), "DateDepot": _iso(cheque["datedepot"])}
        ligne = _ligne_encaissement(brute, restes)
        ligne.update({"IdContrat": brute["idcontrat"], "Operateur": complement["operateur"] or "",
                      "ResteDuQuittance": _nombre(reste_a_encaisser(brute["primettc"], encaisses.get(brute["numeroquittance"])))})
        groupe["Lignes"].append(ligne)
        if ligne["NumeroPiece"] and ligne["NumeroPiece"] not in groupe["Pieces"]:
            groupe["Pieces"].append(ligne["NumeroPiece"])
        if ligne["Statut"] not in ("ANNULE", "IMPAYE"):
            groupe["Montant"] += ligne["Montant"]
            groupe["MontantReverse"] += ligne["MontantReverse"]
    reglements = [g for g in groupes.values() if g]
    for groupe in reglements:
        groupe["NombrePolices"] = len({l["NumeroPolice"] for l in groupe["Lignes"]})
        groupe["NombreQuittances"] = len({l["NumeroQuittance"] for l in groupe["Lignes"]})
        groupe["Annule"] = all(l["Statut"] in ("ANNULE", "IMPAYE") for l in groupe["Lignes"])
    return {"Reglements": reglements, "Tronque": tronque}


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def recherche_reglements(request):
    """GET /api/finance/encaissements/recherche/?q=&mode=&du=&au= : à quoi a servi un règlement."""
    try:
        return Response(rechercher_reglements(request.query_params))
    except ErreurFinance as erreur:
        return _erreur(erreur)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def etat_encaissements(request):
    """GET /api/finance/encaissements/?du=&au=&compagnie=&mode=&statut= : état récapitulatif."""
    try:
        return Response(donnees_etat_encaissements(request.query_params))
    except ErreurFinance as erreur:
        return _erreur(erreur)


def donnees_etat_encaissements(parametres):
    """État des encaissements (écran, bordereau récapitulatif imprimé et Excel) : une ligne par quittance encaissée
    du … au … (date de saisie), filtres compagnie, mode et statut ; annulés et chèques impayés hors totaux."""
    du = _date(parametres.get("du"), "Du", obligatoire=False) or date(date.today().year, 1, 1)
    au = _date(parametres.get("au"), "Au", obligatoire=False) or date.today()
    if du > au:
        raise ErreurFinance("Le début de la période dépasse sa fin.")
    # Contre-passations d'une annulation (montants négatifs) écartées : la ligne d'origine porte
    # le statut « Annulé » et son motif
    conditions, params = ["e.dateencaissement::date BETWEEN %s AND %s", "de.montant_encaissement > 0"], [du, au]
    if parametres.get("compagnie"):
        conditions.append("cie.idcompagnie = %s")
        params.append(_entier(parametres["compagnie"], "Compagnie"))
    if parametres.get("mode"):
        conditions.append("e.idmodepaiement = %s")
        params.append(_entier(parametres["mode"], "Mode"))
    brutes = _lignes(SQL_LIGNES_ENCAISSEMENT + " WHERE " + " AND ".join(conditions) + " ORDER BY e.dateencaissement, e.idencaissement, de.iddetailencaissement", params)
    restes = _restes_nets({l["numeroquittance"] for l in brutes})
    lignes = [_ligne_encaissement(l, restes) for l in brutes]
    statut = parametres.get("statut")
    if statut:
        lignes = [l for l in lignes if l["Statut"] == statut]

    def totaux(cle):
        resultat = {}
        for l in lignes:
            if l["Statut"] in ("ANNULE", "IMPAYE"):
                continue
            groupe = resultat.setdefault(l[cle] or "-", {"Libelle": l[cle] or "-", "Nombre": 0, "Montant": 0.0, "Reverse": 0.0})
            groupe["Nombre"] += 1
            groupe["Montant"] += l["Montant"]
            groupe["Reverse"] += l["MontantReverse"]
        return sorted(resultat.values(), key=lambda g: -g["Montant"])

    valides = [l for l in lignes if l["Statut"] not in ("ANNULE", "IMPAYE")]
    return {
        "Du": du.isoformat(), "Au": au.isoformat(),
        "Lignes": lignes,
        "ParMode": totaux("Mode"),
        "ParCompagnie": totaux("Compagnie"),
        "ParStatut": [
            {"Statut": s, "Libelle": LIBELLES_STATUT[s], "Nombre": sum(1 for l in lignes if l["Statut"] == s),
             "Montant": sum(l["Montant"] for l in lignes if l["Statut"] == s)}
            for s in LIBELLES_STATUT if any(l["Statut"] == s for l in lignes)
        ],
        "Total": {"Nombre": len(valides), "Montant": sum(l["Montant"] for l in valides),
                  "Reverse": sum(l["MontantReverse"] for l in valides),
                  "ResteAReverser": sum(l["ResteAReverser"] for l in valides)},
        "DebutReversements": debut_reversements().isoformat(),
    }


# ------------------------------------------------------------------ reversements
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def lignes_a_reverser(request):
    """GET /api/finance/reversements/a-reverser/?compagnie= : primes encaissées non encore reversées."""
    try:
        id_compagnie = _entier(request.query_params.get("compagnie"), "Compagnie")
    except ErreurFinance as erreur:
        return _erreur(erreur)
    lignes = _lignes(
        SQL_LIGNES_ENCAISSEMENT + """
        WHERE cie.idcompagnie = %s AND NOT COALESCE(e.piece_annulee, FALSE)
          AND de.montant_encaissement > COALESCE(de.montantreglement, 0)
          AND e.dateencaissement::date >= %s
        ORDER BY e.dateencaissement, de.iddetailencaissement
        """,
        [id_compagnie, debut_reversements()],
    )
    # Décaissements jamais reversés : déduits du reste à reverser de leur quittance
    restes = _restes_nets({l["numeroquittance"] for l in lignes})
    resultat = [_ligne_encaissement(l, restes) for l in lignes if not _est_decaissement(l)]
    return Response({
        "Lignes": [l for l in resultat if l["ResteAReverser"] > 0],
        "DebutReversements": debut_reversements().isoformat(),
    })


def _entete_reversement(ligne):
    valide = bool(ligne["valide"])
    return {
        "IdReversement": ligne["idreversement"],
        "Numero": (ligne["numeroreversement"] or "").strip(),
        "DateReversement": _iso(ligne["datereversement"]),
        "IdCompagnie": ligne["idcompagnie"],
        "Compagnie": ligne["compagnie"] or "",
        "Montant": _nombre(ligne["montantreversement"]),
        "NombreQuittances": ligne["nombre"],
        "Commissions": _nombre(ligne["commissions"]),
        "Valide": valide,
        "DateValidation": _iso(ligne["datevalidation"]),
        "Mode": ligne["mode"] or "",
        "Reference": (ligne["numerocheque"] or ligne["comptecompensation"] or "").strip(),
        "Banque": ligne["banque"] or "",
        "Statut": "PAYE" if valide else "A_PAYER",
        "LibelleStatut": "Payé à la compagnie" if valide else "À payer à la compagnie",
    }


# Commission due au cabinet sur une ligne de reversement : commission et accessoires du cabinet en entier sur le premier
# reversement (non annulé) de la quittance, rien sur les suivants
COMMISSION_DUE = """CASE WHEN {d}.iddetailreversement = (
        SELECT MIN(d1.iddetailreversement) FROM stddetailreversement d1
        JOIN stdreversementcompagnie r1 ON r1.idreversement = d1.idreversement AND NOT COALESCE(r1.pieceannulee, FALSE)
        JOIN stddetailencaissement de1 ON de1.iddetailencaissement = d1.iddetailencaissement
        WHERE de1.numeroquittance = {de}.numeroquittance)
    THEN COALESCE({ct}.commissionintermediaire, 0) + """ + SQL_ACC_COURTIER + """
    ELSE 0 END"""


SQL_REVERSEMENTS = """
    SELECT r.idreversement, r.numeroreversement, r.datereversement, r.idcompagnie, cie.raisonsociale AS compagnie,
           r.montantreversement, r.valide, r.datevalidation, r.numerocheque, r.comptecompensation,
           m.libellemodepaiement AS mode, NULLIF(TRIM(b.libelle), '') AS banque,
           (SELECT COUNT(*) FROM stddetailreversement d WHERE d.idreversement = r.idreversement) AS nombre,
           (SELECT COALESCE(SUM(""" + COMMISSION_DUE.format(d="d", de="de", ct="ct") + """), 0)
            FROM stddetailreversement d
            JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
            JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
            LEFT JOIN LATERAL (SELECT c.iddevis, c.commissionintermediaire, c.accessoireintermediaire FROM stdcontrat c
                               WHERE c.idquittance = q.idquittance ORDER BY c.idcontrat LIMIT 1) ct ON TRUE
            WHERE d.idreversement = r.idreversement) AS commissions
    FROM stdreversementcompagnie r
    LEFT JOIN stdcompagnie cie ON cie.idcompagnie = r.idcompagnie
    LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = r.idmodereversement
    LEFT JOIN stdbanque b ON b.idbanque = r.idbanque
    WHERE NOT COALESCE(r.pieceannulee, FALSE)
"""


def _lire_reversement(id_reversement):
    entetes = _lignes(SQL_REVERSEMENTS + " AND r.idreversement = %s", [id_reversement])
    if not entetes:
        return None
    lignes = _lignes(
        SQL_LIGNES_ENCAISSEMENT.replace(
            "FROM stddetailencaissement de",
            "FROM stddetailreversement dr JOIN stddetailencaissement de ON de.iddetailencaissement = dr.iddetailencaissement",
        ).replace("SELECT de.iddetailencaissement,", "SELECT dr.iddetailreversement, dr.montantreverse AS montantdetailreverse, "
                  + COMMISSION_DUE.format(d="dr", de="de", ct="ct") + " AS commissiondue, de.iddetailencaissement,")
        + " WHERE dr.idreversement = %s ORDER BY e.dateencaissement, de.iddetailencaissement",
        [id_reversement],
    )
    details = []
    for l in lignes:
        details.append({
            **_ligne_bordereau(l),
            "IdDetailReversement": l["iddetailreversement"],
            "NumeroPiece": l["numeropiece"] or "",
            "DateEncaissement": _iso(l["dateencaissement"]),
            "Mode": l["mode"] or "",
            "Reference": l["reference"] or "",
            "MontantReverse": _nombre(l["montantdetailreverse"]),
            "CommissionDue": _nombre(l["commissiondue"]),
        })
    return {**_entete_reversement(entetes[0]), "Lignes": details}


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def reversements(request):
    """GET /api/finance/reversements/?compagnie=&du=&au= ; POST : reverser des primes encaissées.
    POST { IdCompagnie, DateReversement, Lignes: [{ IdDetailEncaissement, Montant }] }"""
    if request.method == "GET":
        conditions, params = [], []
        if request.query_params.get("compagnie"):
            conditions.append("r.idcompagnie = %s")
            params.append(int(request.query_params["compagnie"]))
        try:
            for cle, operateur in (("du", ">="), ("au", "<=")):
                if request.query_params.get(cle):
                    conditions.append(f"r.datereversement {operateur} %s")
                    params.append(_date(request.query_params[cle], cle))
        except ErreurFinance as erreur:
            return _erreur(erreur)
        sql = SQL_REVERSEMENTS + "".join(f" AND {c}" for c in conditions) + " ORDER BY r.datereversement DESC, r.idreversement DESC"
        return Response({"Reversements": [_entete_reversement(l) for l in _lignes(sql, params)]})

    try:
        donnees = request.data
        id_compagnie = _entier(donnees.get("IdCompagnie"), "Compagnie")
        date_reversement = _date(donnees.get("DateReversement") or date.today(), "Date du reversement")
        lignes = donnees.get("Lignes") or []
        if not lignes:
            raise ErreurFinance("Cochez au moins une prime encaissée à reverser.")
        ids = [_entier(l.get("IdDetailEncaissement"), "Ligne d'encaissement") for l in lignes]
        montants = [_montant(l.get("Montant"), "Montant à reverser") for l in lignes]
        if len(set(ids)) != len(ids):
            raise ErreurFinance("Une même ligne d'encaissement est cochée deux fois.")
        # Les lignes doivent être des primes de cette compagnie, encaissées et non annulées
        controle = _lignes(
            SQL_LIGNES_ENCAISSEMENT + " WHERE de.iddetailencaissement = ANY(%s)", [ids]
        )
        par_id = {l["iddetailencaissement"]: l for l in controle}
        restes = _restes_nets({l["numeroquittance"] for l in controle})
        for id_ligne, montant in zip(ids, montants):
            ligne = par_id.get(id_ligne)
            if not ligne:
                raise ErreurFinance(f"Ligne d'encaissement {id_ligne} introuvable.")
            if ligne["idcompagnie"] != id_compagnie:
                raise ErreurFinance(f"La quittance {ligne['numeroquittance']} n'est pas une affaire de cette compagnie.")
            if ligne["annulee"]:
                raise ErreurFinance(f"L'encaissement de la quittance {ligne['numeroquittance']} est annulé.")
            if _est_decaissement(ligne):
                raise ErreurFinance(f"La quittance {ligne['numeroquittance']} : un décaissement ne se reverse pas.")
            # Reste net : décaissements de la quittance déduits
            reste = restes.get(id_ligne, ZERO)
            if montant > reste:
                raise ErreurFinance(
                    f"Quittance {ligne['numeroquittance']} : {f'{montant:,.0f}'.replace(',', ' ')} F dépasse le reste à reverser "
                    f"({f'{reste:,.0f}'.replace(',', ' ')} F, décaissements déduits)."
                )
        total = sum(montants)
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_enregistrement_reversement(%s, %s, %s::integer[], %s::numeric[], NULL, %s, 1, %s, '', '', '', '', 0, '')",
                [request.user.id, id_compagnie, ids, montants, date_reversement, total],
            )
            id_reversement, message = cursor.fetchone()
            if not id_reversement:
                raise ErreurFinance(message or "Le reversement n'a pas été enregistré.")
    except ErreurFinance as erreur:
        return _erreur(erreur)
    except Exception as erreur:  # message de la procédure (RAISE EXCEPTION)
        return _erreur(erreur)
    return Response(_lire_reversement(id_reversement), status=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def reversement(request, id_reversement):
    """GET /api/finance/reversements/<id>/ : en-tête et lignes du bordereau de reversement."""
    resultat = _lire_reversement(id_reversement)
    if not resultat:
        return Response({"error": "Reversement introuvable."}, status=status.HTTP_404_NOT_FOUND)
    return Response(resultat)


def controle_paiement_cabinet(donnees):
    """Paiement d'un bordereau de reversement par le cabinet (demande du 2026-10-21) : par chèque ou par virement,
    banque du cabinet obligatoire, numéro obligatoire pour un chèque. Renvoie le mode de paiement."""
    id_mode = _entier(donnees.get("IdMode"), "Paiement (chèque ou virement)")
    mode = _lignes(
        "SELECT UPPER(TRIM(COALESCE(abregereglement, ''))) AS abrege, LOWER(COALESCE(libellemodepaiement, '')) AS libelle "
        "FROM stdmodeencaissement WHERE idmodeencaissement = %s", [id_mode])
    if not mode or mode[0]["abrege"] not in ("CHQ", "VIR") or "compagnie" in mode[0]["libelle"]:
        raise ErreurFinance("Paiement de la compagnie : par chèque ou par virement.")
    if _entier(donnees.get("IdBanque"), "Banque", obligatoire=False) <= 1:
        raise ErreurFinance("Banque du cabinet : à renseigner.")
    if mode[0]["abrege"] == "CHQ" and not str(donnees.get("NumeroCheque") or "").strip():
        raise ErreurFinance("N° du chèque : à renseigner.")
    return id_mode


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def valider_reversement(request, id_reversement):
    """POST /api/finance/reversements/<id>/valider/ : paiement du reversement à la compagnie.
    { IdMode, IdBanque, NumeroCheque, NomEmetteur, ReferenceCompensation, DateReversement }"""
    try:
        donnees = request.data
        id_mode = controle_paiement_cabinet(donnees)
        date_reversement = _date(donnees.get("DateReversement") or date.today(), "Date du paiement")
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_validation_reversement(%s, %s, %s, %s, %s, %s, %s, '', %s, '')",
                [
                    request.user.id, id_reversement, id_mode, date_reversement,
                    _entier(donnees.get("IdBanque"), "Banque", obligatoire=False) or 1,
                    str(donnees.get("NumeroCheque") or "").strip()[:50],
                    str(donnees.get("NomEmetteur") or "").strip()[:50],
                    str(donnees.get("ReferenceCompensation") or "").strip()[:50],
                ],
            )
    except ErreurFinance as erreur:
        return _erreur(erreur)
    except Exception as erreur:
        return _erreur(erreur)
    return Response(_lire_reversement(id_reversement))


# ------------------------------------------------------------------ commissions
# Lignes de reversements PAYÉS à la compagnie : commission due, réclamée, payée, reste
SQL_COMMISSIONS = """
    SELECT d.iddetailreversement, r.idreversement, r.numeroreversement, r.datereversement, r.idcompagnie,
           cie.raisonsociale AS compagnie, d.montantreverse, q.idquittance, q.numeroquittance, q.numeropolice,
           q.primenette, q.primettc, q.dateeffet::date AS dateeffet, q.dateexpiration::date AS dateexpiration,
           q.idproduit, p.libelleproduit AS branche,
           TRIM(cl.nom || ' ' || COALESCE(cl.prenoms, '')) AS client, ct.numeroavenant,
           CASE WHEN UPPER(TRIM(COALESCE(ct.numeropolicecompagnie, ''))) IN ('', 'RAS', 'NEANT') THEN NULL
                ELSE TRIM(ct.numeropolicecompagnie) END AS policecompagnie,
           COALESCE(ct.taux_commission, 0) AS taux, COALESCE(ct.commissionintermediaire, 0) AS commissionht,
           """ + SQL_ACC_COURTIER.format(ct="ct") + """ AS acccourtier, """ + SQL_PART_COMPAGNIE.format(ct="ct") + """ AS partcompagnie,
           public.fn_lephare_prime_ht(ct.primenette, ct.accessoire, ct.taxe, ct.fga, ct.cedeao, ct.primettc, ct.primeimposee) AS primeht,
           bo.numero AS numerobordereau, COALESCE(bo.datebordereau, r.datereversement) AS datebordereau,
           """ + COMMISSION_DUE.format(d="d", de="de", ct="ct") + """ AS commissiondue,
           rc.id AS idreclamation, rc.reference AS reclamation, rc.date_emission AS datereclamation,
           COALESCE((SELECT SUM(dp.montant_commission_paye) FROM std_detail_paiement_commission dp
                     WHERE dp.detail_reversement_id = d.iddetailreversement AND NOT dp.est_annule), 0) AS commissionpayee
    FROM stddetailreversement d
    JOIN stdreversementcompagnie r ON r.idreversement = d.idreversement
    JOIN stddetailencaissement de ON de.iddetailencaissement = d.iddetailencaissement
    JOIN stdquittance q ON q.numeroquittance = de.numeroquittance
    LEFT JOIN LATERAL (SELECT c.* FROM stdcontrat c WHERE c.idquittance = q.idquittance ORDER BY c.idcontrat LIMIT 1) ct ON TRUE
    LEFT JOIN lephare_bordereau_reversement bo ON bo.idreversement = r.idreversement
    LEFT JOIN stdcompagnie cie ON cie.idcompagnie = r.idcompagnie
    LEFT JOIN stdproduit p ON p.idproduit = q.idproduit
    LEFT JOIN stdclient cl ON cl.idclient = q.idclient
    LEFT JOIN LATERAL (SELECT x.id, x.reference, x.date_emission FROM std_detail_reclamation_commission dx
                       JOIN std_reclamation_commission x ON x.id = dx.reclamation_id
                       WHERE dx.detail_reversement_id = d.iddetailreversement AND x.statut <> 'ANNULEE'
                       ORDER BY x.id DESC LIMIT 1) rc ON TRUE
    WHERE r.valide AND NOT COALESCE(r.pieceannulee, FALSE) AND NOT COALESCE(bo.annule, FALSE)
"""

LIBELLES_COMMISSION = {
    "A_RECLAMER": "À réclamer",
    "RECLAMEE": "Réclamée, non payée",
    "PARTIELLE": "Partiellement payée",
    "PAYEE": "Payée",
}


def _branche(id_produit, libelle):
    """Libellé de la branche des bordereaux d'OREOLE (« Automobile », « Individuelle Accidents »…)."""
    from .views_bordereaux import _branche as branche_bordereau  # import différé : views_bordereaux importe ce module

    return branche_bordereau(id_produit, libelle)


def _ligne_commission(l):
    due, payee = _franc(l["commissiondue"]), _franc(l["commissionpayee"])
    if due > 0 and payee >= due:
        statut = "PAYEE"
    elif payee > 0:
        statut = "PARTIELLE"
    elif l["idreclamation"]:
        statut = "RECLAMEE"
    else:
        statut = "A_RECLAMER"
    return {
        "IdDetailReversement": l["iddetailreversement"],
        "IdReversement": l["idreversement"],
        "NumeroReversement": (l["numeroreversement"] or "").strip(),
        "DateReversement": _iso(l["datereversement"]),
        "IdCompagnie": l["idcompagnie"],
        "Compagnie": l["compagnie"] or "",
        "IdQuittance": l["idquittance"],
        "NumeroQuittance": l["numeroquittance"],
        "NumeroPolice": l["numeropolice"] or "",
        "NumeroAvenant": (l["numeroavenant"] or "").strip(),
        "Branche": l["branche"] or "",
        "Client": l["client"] or "",
        "DateEffet": _iso(l["dateeffet"]),
        "DateExpiration": _iso(l["dateexpiration"]),
        "IdProduit": l["idproduit"],
        "Assurance": _branche(l["idproduit"], l["branche"]),
        "PoliceCompagnie": l["policecompagnie"] or "",
        "NumeroBordereau": l["numerobordereau"],
        "DateBordereau": _iso(l["datebordereau"]),
        "PrimeNette": _nombre(l["primenette"]),
        "PrimeHT": _nombre(round(l["primeht"] or 0)),
        "PrimeTtc": _nombre(part_compagnie(l["primettc"], l["partcompagnie"])),
        "Taux": _nombre(l["taux"]),
        "CommissionHT": _nombre(l["commissionht"]),
        "AccCourtier": _nombre(l["acccourtier"]),
        "MontantReverse": _nombre(l["montantreverse"]),
        "CommissionDue": _nombre(due),
        "CommissionPayee": _nombre(payee),
        "Reste": _nombre(max(due - payee, ZERO)),
        "IdReclamation": l["idreclamation"],
        "Reclamation": l["reclamation"] or "",
        "DateReclamation": _iso(l["datereclamation"]),
        "Statut": statut,
        "LibelleStatut": LIBELLES_COMMISSION[statut],
    }


def _commissions(id_compagnie=None, du=None, au=None, ids=None, id_reclamation=None):
    conditions, params = [], []
    if id_compagnie:
        conditions.append("r.idcompagnie = %s")
        params.append(id_compagnie)
    if du:
        conditions.append("r.datereversement >= %s")
        params.append(du)
    if au:
        conditions.append("r.datereversement <= %s")
        params.append(au)
    if ids is not None:
        conditions.append("d.iddetailreversement = ANY(%s)")
        params.append(list(ids))
    if id_reclamation:
        conditions.append("d.iddetailreversement IN (SELECT detail_reversement_id FROM std_detail_reclamation_commission WHERE reclamation_id = %s)")
        params.append(id_reclamation)
    sql = SQL_COMMISSIONS + "".join(f" AND {c}" for c in conditions) + " ORDER BY r.datereversement, d.iddetailreversement"
    # Reversements suivants d'une quittance (solde) : sans commission, la commission entière étant due au premier
    return [_ligne_commission(l) for l in _lignes(sql, params) if l["commissiondue"] or l["commissionpayee"]]


def _totaux_commissions(lignes):
    return {
        "Nombre": len(lignes),
        "PrimesReversees": sum(l["MontantReverse"] for l in lignes),
        "CommissionDue": sum(l["CommissionDue"] for l in lignes),
        "CommissionPayee": sum(l["CommissionPayee"] for l in lignes),
        "Reste": sum(l["Reste"] for l in lignes),
    }


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def etat_commissions(request):
    """GET /api/finance/commissions/?compagnie=&du=&au=&statut= : quittances reversées et leur commission.
    statut : A_RECLAMER, RECLAMEE, PARTIELLE, PAYEE ou PAYEES / NON_PAYEES (regroupements)."""
    try:
        du = _date(request.query_params.get("du"), "Du", obligatoire=False)
        au = _date(request.query_params.get("au"), "Au", obligatoire=False)
    except ErreurFinance as erreur:
        return _erreur(erreur)
    id_compagnie = int(request.query_params.get("compagnie") or 0) or None
    lignes = _commissions(id_compagnie, du, au)
    statut = request.query_params.get("statut")
    if statut == "PAYEES":
        lignes = [l for l in lignes if l["CommissionPayee"] > 0]
    elif statut == "NON_PAYEES":
        lignes = [l for l in lignes if l["Reste"] > 0]
    elif statut:
        lignes = [l for l in lignes if l["Statut"] == statut]
    par_compagnie = {}
    for l in lignes:
        groupe = par_compagnie.setdefault(l["Compagnie"], [])
        groupe.append(l)
    return Response({
        "Lignes": lignes,
        "Total": _totaux_commissions(lignes),
        "ParCompagnie": [{"Compagnie": c, **_totaux_commissions(ls)} for c, ls in sorted(par_compagnie.items())],
    })


# ------------------------------------------------------------------ état récapitulatif des commissions
def _synthese_commissions(lignes):
    """Commissions dues = payées + en attente de paiement ; l'attente distingue les commissions réclamées à l'assureur
    (bordereau récapitulatif émis, règlement attendu) de celles qui ne sont pas encore réclamées."""
    def somme(valeurs):
        return round(sum(valeurs), 2)

    due = somme(l["CommissionDue"] for l in lignes)
    payee = somme(l["CommissionPayee"] for l in lignes)
    reclamee = somme(l["Reste"] for l in lignes if l["IdReclamation"])
    a_reclamer = somme(l["Reste"] for l in lignes if not l["IdReclamation"])
    return {
        "Nombre": len(lignes),
        "PrimesReversees": somme(l["MontantReverse"] for l in lignes),
        "CommissionDue": due,
        "CommissionPayee": payee,
        "EnAttenteReclamee": reclamee,
        "EnAttenteAReclamer": a_reclamer,
        "EnAttente": round(reclamee + a_reclamer, 2),
        "TauxRecouvrement": round(payee * 100 / due, 1) if due else 0.0,
    }


def _jours(depuis, jour):
    return (jour - date.fromisoformat(depuis[:10])).days if depuis else None


def recapitulatif_commissions(id_compagnie=None, du=None, au=None, jour=None):
    """État récapitulatif des commissions des primes reversées du … au … (date du reversement), situation au jour :
    synthèse par compagnie et par mois, règlements reçus des assureurs, bordereaux réclamés en attente de règlement
    (ancienneté depuis leur émission) et commissions pas encore réclamées. Les règlements sont comptés pour la part
    imputée sur ces quittances : leur total est celui des commissions payées."""
    jour = jour or date.today()
    lignes = _commissions(id_compagnie, du, au)
    par_compagnie, par_mois, par_reclamation, a_reclamer = OrderedDict(), OrderedDict(), OrderedDict(), OrderedDict()
    for l in sorted(lignes, key=lambda l: (l["Compagnie"], l["IdCompagnie"] or 0)):
        par_compagnie.setdefault((l["IdCompagnie"], l["Compagnie"]), []).append(l)
    for l in lignes:  # dans l'ordre des reversements
        par_mois.setdefault((l["DateReversement"] or "")[:7], []).append(l)
        if l["IdReclamation"]:
            par_reclamation.setdefault(l["IdReclamation"], []).append(l)
        elif l["Reste"] > 0:
            a_reclamer.setdefault((l["IdCompagnie"], l["Compagnie"]), []).append(l)

    reclamations = []
    for id_reclamation, ls in par_reclamation.items():
        reste = round(sum(l["Reste"] for l in ls), 2)
        if reste <= 0:
            continue
        reclamations.append({
            "IdReclamation": id_reclamation, "Reference": ls[0]["Reclamation"], "IdCompagnie": ls[0]["IdCompagnie"],
            "Compagnie": ls[0]["Compagnie"], "DateEmission": ls[0]["DateReclamation"],
            "Anciennete": _jours(ls[0]["DateReclamation"], jour), "Nombre": len(ls),
            "CommissionReclamee": round(sum(l["CommissionDue"] for l in ls), 2),
            "CommissionPayee": round(sum(l["CommissionPayee"] for l in ls), 2), "Reste": reste,
        })
    reclamations.sort(key=lambda r: (r["DateEmission"] or "", r["Reference"]))

    non_reclamees = []
    for (id_cie, compagnie), ls in sorted(a_reclamer.items(), key=lambda e: e[0][1]):
        plus_ancien = min(l["DateReversement"] or "" for l in ls) or None
        non_reclamees.append({
            "IdCompagnie": id_cie, "Compagnie": compagnie, "Nombre": len(ls),
            "Montant": round(sum(l["Reste"] for l in ls), 2), "PlusAncien": plus_ancien,
            "Anciennete": _jours(plus_ancien, jour),
        })

    reglements = []
    ids = [l["IdDetailReversement"] for l in lignes if l["CommissionPayee"]]
    if ids:
        for p in _lignes(
            """
            SELECT pc.id, pc.reference, pc.date_paiement, pc.mode_paiement, pc.reference_paiement, pc.montant_total,
                   CASE WHEN UPPER(TRIM(COALESCE(bq.libelle, ''))) IN ('', 'NEANT', 'AUCUNE', 'AUCUN') THEN NULL
                        ELSE TRIM(bq.libelle) END AS banque,
                   x.reference AS reclamation, cie.raisonsociale AS compagnie,
                   SUM(dp.montant_commission_paye) AS impute, COUNT(DISTINCT dp.detail_reversement_id) AS nombre
            FROM std_detail_paiement_commission dp
            JOIN std_paiement_commission pc ON pc.id = dp.paiement_id
            LEFT JOIN std_reclamation_commission x ON x.id = pc.reclamation_id
            LEFT JOIN stdcompagnie cie ON cie.idcompagnie = pc.compagnie_id
            LEFT JOIN stdbanque bq ON bq.idbanque = pc.idbanque
            WHERE dp.detail_reversement_id = ANY(%s) AND NOT dp.est_annule
            GROUP BY pc.id, bq.libelle, x.reference, cie.raisonsociale
            ORDER BY pc.date_paiement, pc.id
            """,
            [ids],
        ):
            reglements.append({
                "IdPaiement": p["id"], "Reference": p["reference"], "DatePaiement": _iso(p["date_paiement"]),
                "Compagnie": (p["compagnie"] or "").strip(), "Reclamation": p["reclamation"] or "",
                "Mode": "Chèque" if p["mode_paiement"] == "CHQ" else "Virement",
                "ReferencePaiement": p["reference_paiement"] or "", "Banque": p["banque"] or "",
                "Nombre": p["nombre"], "MontantReglement": _nombre(p["montant_total"]), "Montant": _nombre(p["impute"]),
            })

    nom = ""
    if id_compagnie:
        from .views_bordereaux import reglages_compagnie  # import différé : views_bordereaux importe ce module

        raison = next((l["Compagnie"] for l in lignes), "") or (
            (_lignes("SELECT raisonsociale FROM stdcompagnie WHERE idcompagnie = %s", [id_compagnie]) or [{}])[0]
            .get("raisonsociale") or "")
        nom = reglages_compagnie(id_compagnie, raison)["NomBordereau"]
    return {
        "IdCompagnie": id_compagnie, "Compagnie": nom, "Du": _iso(du), "Au": _iso(au), "Situation": jour.isoformat(),
        "Total": _synthese_commissions(lignes),
        "ParCompagnie": [{"IdCompagnie": i, "Compagnie": c, **_synthese_commissions(ls)} for (i, c), ls in par_compagnie.items()],
        "ParMois": [{"Mois": m, **_synthese_commissions(ls)} for m, ls in par_mois.items()],
        "Reglements": reglements,
        "Reclamations": reclamations,
        "NonReclamees": non_reclamees,
        "Lignes": lignes,
    }


def _filtres_recapitulatif(request):
    du = _date(request.query_params.get("du"), "Du", obligatoire=False)
    au = _date(request.query_params.get("au"), "Au", obligatoire=False)
    if du and au and du > au:
        raise ErreurFinance("Le début de la période dépasse sa fin.")
    return _entier(request.query_params.get("compagnie"), "Compagnie", obligatoire=False) or None, du, au


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def etat_recapitulatif_commissions(request):
    """GET /api/finance/commissions/recapitulatif/?compagnie=&du=&au= : commissions payées et en attente de paiement
    (réclamées ou non) des primes reversées sur la période, par compagnie et par mois."""
    try:
        return Response(recapitulatif_commissions(*_filtres_recapitulatif(request)))
    except ErreurFinance as erreur:
        return _erreur(erreur)


def _reclamation_json(reclamation, avec_lignes=False):
    from commissions.models import PaiementCommission

    paiements = PaiementCommission.objects.filter(reclamation=reclamation).select_related("banque").order_by("date_paiement", "id")
    total_paye = paiements.aggregate(t=Sum("montant_total"))["t"] or ZERO
    resultat = {
        "IdReclamation": reclamation.id,
        "Reference": reclamation.reference,
        "IdCompagnie": reclamation.compagnie_id,
        "Compagnie": reclamation.compagnie.RaisonSociale,
        "PeriodeDebut": _iso(reclamation.periode_debut),
        "PeriodeFin": _iso(reclamation.periode_fin),
        "DateEmission": _iso(reclamation.date_emission),
        "MontantPrimes": _nombre(reclamation.montant_primes),
        "MontantCommissions": _nombre(reclamation.montant_commissions),
        "MontantPaye": _nombre(total_paye),
        # Bordereau annulé (jamais réglé) : plus rien n'est dû à son titre, ses quittances redeviennent à réclamer
        "Reste": ZERO if reclamation.statut == "ANNULEE" else _nombre(max(reclamation.montant_commissions - total_paye, ZERO)),
        "Statut": reclamation.statut,
        "LibelleStatut": dict(reclamation.STATUTS).get(reclamation.statut, reclamation.statut),
        "NombreQuittances": reclamation.details.count(),
        "Notes": reclamation.notes,
        "Paiements": [
            {
                "IdPaiement": p.id, "Reference": p.reference, "DatePaiement": _iso(p.date_paiement),
                "Mode": p.get_mode_paiement_display(), "ReferencePaiement": p.reference_paiement,
                "Banque": p.banque.libelle if p.banque else "", "Montant": _nombre(p.montant_total),
            }
            for p in paiements
        ],
    }
    if avec_lignes:
        resultat["Lignes"] = _commissions(id_reclamation=reclamation.id)
    return resultat


def _reference_bordereau(lignes, jour):
    """Référence d'une réclamation ou d'un paiement de commissions : numérotation des bordereaux (code courtier de la
    première prime + mois + exercice + « B » + n° du mois)."""
    from production.views_bordereaux import numero_bordereau

    premiere = min(lignes, key=lambda l: (l.get("DateReversement") or "", l.get("IdDetailReversement") or 0))
    return numero_bordereau(premiere["NumeroQuittance"], jour)


@api_view(["GET", "POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def reclamations(request):
    """GET /api/finance/commissions/reclamations/?compagnie= ; POST : bordereau récapitulatif de
    reversement (réclamation des commissions) { IdCompagnie, PeriodeDebut, PeriodeFin,
    DetailsReversement: [id], Notes }"""
    from commissions.models import DetailReclamationCommission, ReclamationCommission
    from configuration_api.models import Compagnie

    if request.method == "GET":
        requete = ReclamationCommission.objects.select_related("compagnie").order_by("-date_emission", "-id")
        if request.query_params.get("compagnie"):
            requete = requete.filter(compagnie_id=int(request.query_params["compagnie"]))
        return Response({"Reclamations": [_reclamation_json(r) for r in requete]})

    try:
        donnees = request.data
        id_compagnie = _entier(donnees.get("IdCompagnie"), "Compagnie")
        compagnie = Compagnie.objects.filter(pk=id_compagnie).first()
        if not compagnie:
            raise ErreurFinance("Compagnie inconnue.")
        debut = _date(donnees.get("PeriodeDebut"), "Début de période")
        fin = _date(donnees.get("PeriodeFin"), "Fin de période")
        if debut > fin:
            raise ErreurFinance("Le début de la période dépasse sa fin.")
        ids = sorted({_entier(i, "Ligne de reversement") for i in (donnees.get("DetailsReversement") or [])})
        if not ids:
            raise ErreurFinance("Cochez au moins une quittance reversée.")
        with transaction.atomic():
            # Lignes de reversement verrouillées avant les contrôles : deux bordereaux émis en même temps ne
            # peuvent pas réclamer la même quittance (le second voit la réclamation du premier)
            from production.models import DetailReversement

            list(DetailReversement.objects.select_for_update().filter(pk__in=ids).values_list("pk", flat=True))
            lignes = _commissions(ids=ids)
            if len(lignes) != len(ids):
                raise ErreurFinance("Certaines quittances ne sont pas dans un reversement payé à la compagnie.")
            for l in lignes:
                if l["IdCompagnie"] != id_compagnie:
                    raise ErreurFinance(f"La quittance {l['NumeroQuittance']} a été reversée à une autre compagnie.")
                if l["IdReclamation"]:
                    raise ErreurFinance(f"La quittance {l['NumeroQuittance']} est déjà réclamée ({l['Reclamation']}).")
                if l["CommissionDue"] <= 0:
                    raise ErreurFinance(f"La quittance {l['NumeroQuittance']} n'a pas de commission.")
            reclamation = ReclamationCommission.objects.create(
                reference=_reference_bordereau(lignes, date.today()),
                compagnie=compagnie, periode_debut=debut, periode_fin=fin,
                montant_primes=sum(Decimal(str(l["MontantReverse"])) for l in lignes),
                montant_commissions=sum(Decimal(str(l["CommissionDue"])) for l in lignes),
                notes=str(donnees.get("Notes") or "")[:2000], created_by=request.user,
            )
            DetailReclamationCommission.objects.bulk_create([
                DetailReclamationCommission(
                    reclamation=reclamation, detail_reversement_id=l["IdDetailReversement"], quittance_id=l["IdQuittance"],
                    montant_prime_reversee=Decimal(str(l["MontantReverse"])), montant_commission=Decimal(str(l["CommissionDue"])),
                )
                for l in lignes
            ])
    except ErreurFinance as erreur:
        return _erreur(erreur)
    return Response(_reclamation_json(reclamation, avec_lignes=True), status=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def reclamation(request, id_reclamation):
    """GET /api/finance/commissions/reclamations/<id>/ : bordereau, lignes et règlements reçus."""
    from commissions.models import ReclamationCommission

    objet = ReclamationCommission.objects.select_related("compagnie").filter(pk=id_reclamation).first()
    if not objet:
        return Response({"error": "Bordereau de réclamation introuvable."}, status=status.HTTP_404_NOT_FOUND)
    return Response(_reclamation_json(objet, avec_lignes=True))


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def annuler_reclamation(request, id_reclamation):
    """POST /api/finance/commissions/reclamations/<id>/annuler/ : bordereau émis par erreur, sans règlement."""
    from commissions.models import ReclamationCommission

    with transaction.atomic():
        # Bordereau verrouillé : un règlement enregistré en même temps ne peut pas se retrouver sur un bordereau annulé
        objet = ReclamationCommission.objects.select_for_update().filter(pk=id_reclamation).first()
        if not objet:
            return Response({"error": "Bordereau de réclamation introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if objet.statut == "ANNULEE":
            return _erreur("Ce bordereau est déjà annulé.")
        if objet.paiements.exists():
            return _erreur("Ce bordereau a déjà reçu un règlement de commission : il ne peut plus être annulé.")
        objet.statut = "ANNULEE"
        objet.notes = (objet.notes + "\n" if objet.notes else "") + f"Annulé le {date.today():%d/%m/%Y} : {str(request.data.get('Motif') or '').strip()}"
        objet.save(update_fields=["statut", "notes"])
    return Response(_reclamation_json(objet))


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated, EcrituresAdministrateur])
def encaisser_commission(request, id_reclamation):
    """POST /api/finance/commissions/reclamations/<id>/paiements/ : règlement de l'assureur.
    { DatePaiement, Mode: CHQ|VIR, IdBanque, ReferencePaiement, Montant, Notes } ; le montant est
    imputé sur les lignes du bordereau, dans l'ordre, jusqu'à leur commission restante."""
    from commissions.models import DetailPaiementCommission, PaiementCommission, ReclamationCommission
    from configuration_api.models import Banque
    from production.models import DetailReversement, Quittance

    try:
        donnees = request.data
        mode = str(donnees.get("Mode") or "").upper()
        if mode not in ("CHQ", "VIR"):
            raise ErreurFinance("Mode de règlement : chèque ou virement.")
        reference_paiement = str(donnees.get("ReferencePaiement") or "").strip()[:50]
        if not reference_paiement:
            raise ErreurFinance("Référence du règlement (n° de chèque ou de virement) : à renseigner.")
        id_banque = _entier(donnees.get("IdBanque"), "Banque", obligatoire=False)
        # Tout chèque porte sa banque (demande du 2026-10-21) ; 1 = « NEANT »
        if mode == "CHQ" and id_banque <= 1:
            raise ErreurFinance("La banque du chèque est à renseigner.")
        banque = Banque.objects.filter(pk=id_banque).first() if id_banque else None
        montant = _montant(donnees.get("Montant"), "Montant du règlement")
        date_paiement = _date(donnees.get("DatePaiement") or date.today(), "Date du règlement")
        with transaction.atomic():
            # Bordereau verrouillé jusqu'à la fin de l'imputation : deux règlements simultanés (double clic, deux
            # postes) sont traités l'un après l'autre et le second voit le reste dû après le premier
            objet = ReclamationCommission.objects.select_for_update().select_related("compagnie").filter(pk=id_reclamation).first()
            if not objet:
                raise ErreurFinance("Bordereau de réclamation introuvable.")
            if objet.statut == "ANNULEE":
                raise ErreurFinance("Ce bordereau est annulé.")
            # Même règlement saisi deux fois (référence de chèque ou de virement déjà imputée sur ce bordereau)
            if PaiementCommission.objects.filter(reclamation=objet, mode_paiement=mode,
                                                 reference_paiement__iexact=reference_paiement).exists():
                raise ErreurFinance(f"Le règlement {reference_paiement} est déjà enregistré sur ce bordereau.")
            lignes = [l for l in _commissions(id_reclamation=objet.id) if l["Reste"] > 0]
            reste_total = sum(Decimal(str(l["Reste"])) for l in lignes)
            if montant > reste_total:
                raise ErreurFinance(
                    f"Le règlement ({montant:,.0f} F) dépasse la commission restant due sur ce bordereau ({reste_total:,.0f} F).".replace(",", " ")
                )
            paiement = PaiementCommission.objects.create(
                reference=_reference_bordereau(lignes or _commissions(id_reclamation=objet.id), date_paiement),
                compagnie=objet.compagnie, date_paiement=date_paiement, montant_total=montant,
                statut="VALIDE", notes=str(donnees.get("Notes") or "")[:2000], created_by=request.user,
                mode_paiement=mode, reference_paiement=reference_paiement, banque=banque, reclamation=objet,
            )
            a_imputer = montant
            for l in lignes:
                if a_imputer <= 0:
                    break
                part = min(Decimal(str(l["Reste"])), a_imputer)
                DetailPaiementCommission.objects.create(
                    paiement=paiement,
                    quittance=Quittance.objects.get(pk=l["IdQuittance"]),
                    detail_reversement=DetailReversement.objects.get(pk=l["IdDetailReversement"]),
                    montant_prime_reversee=Decimal(str(l["MontantReverse"])),
                    taux_commission=(Decimal(str(l["CommissionDue"])) * 100 / Decimal(str(l["MontantReverse"]))).quantize(Decimal("0.01")) if l["MontantReverse"] else ZERO,
                    montant_commission_du=Decimal(str(l["CommissionDue"])),
                    montant_commission_paye=part,
                    reference_affaire=l["NumeroQuittance"],
                )
                a_imputer -= part
            objet.statut = "PAYEE" if montant >= reste_total else "PARTIELLE"
            objet.save(update_fields=["statut"])
    except ErreurFinance as erreur:
        return _erreur(erreur)
    except ValueError as erreur:  # contrôles de DetailPaiementCommission.save
        return _erreur(erreur)
    return Response(_reclamation_json(objet, avec_lignes=True), status=status.HTTP_201_CREATED)
