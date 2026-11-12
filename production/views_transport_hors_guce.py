"""
Transport hors GUCE (produit 6) : marchandises transportées hors guichet unique (document OREOLE
« TRANSPORTS.docx » et questionnaires Transport, Facultés et Facultés terrestres, reçus le 2026-10-21).

Trois types de police :
- au voyage : un envoi, jusqu'à l'arrivée des marchandises à destination ; prime minimum par police au voyage ;
- annuelle : un an, renouvelable, sur la valeur prévue des envois de l'année ; prime minimum exigible ;
- d'abonnement : numéro de police sans prime, alimenté par chaque voyage déclaré (prime aux conditions de la
  police) ; la ressortie du mois regroupe les voyages et donne la facture, comme les quinzaines GUCE : devis
  « Émission de certificat » (avenant 18), contrat sous le numéro de la police et quittance
  (sp_generation_contrat_transport).
Prime = valeur assurée × (taux de la garantie de base + taux des extensions retenues), au minimum la prime minimum ;
taxe sur la prime nette et les accessoires selon le mode de transport (maritime et fluvial : 0 %, aérien : 7 %,
terrestre et ferroviaire : 14,5 %), sauf affaire exonérée. Les taux sont réglables par mode dans Administration >
Réglages par branche > Transport, sauf le FAP Sauf : jamais sous le taux minimum réglementaire.

- GET  /api/transport/hors-guce/catalogue/                         modes, types de police, garanties, listes, réglages
- POST /api/transport/hors-guce/calcul/                            décompte sans écriture
- POST /api/transport/hors-guce/devis/                             création ou « Modifier » (IdDevis)
- GET  /api/transport/hors-guce/devis/<id>/                        relecture du devis
- GET  /api/transport/hors-guce/abonnements/                       polices d'abonnement et voyages à facturer
- GET  /api/transport/hors-guce/abonnements/<idcontrat>/           voyages et ressorties d'une police
- POST /api/transport/hors-guce/abonnements/<idcontrat>/voyages/   déclaration d'un voyage
- POST /api/transport/hors-guce/voyages/<id>/annulation/           voyage annulé (tant qu'il n'est pas facturé)
- POST /api/transport/hors-guce/abonnements/<idcontrat>/ressortie/ ressortie du mois : contrat et quittance
"""

import calendar
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from configuration_api.models import TransportGarantie, TransportMode
from configuration_api.parametrage import compagnie_par_defaut, valeur_parametre
from core.date_parser import date_emission_du_jour

from .models import AffaireTransport, VoyageTransport
from .views_devis_dommages import AUTHENTIFICATION
from .views_devis_dommages import ErreurDevisDommages as ErreurSaisie
from .views_devis_dommages import _date, _decimal, _entier, _id_utilisateur, _iso, _nombre, _personne, _une_ligne

ID_PRODUIT_TRANSPORT = 6
ID_INTERMEDIAIRE = 1
ID_AVENANT_AFFAIRE_NOUVELLE = 1
ID_AVENANT_CERTIFICAT = 18  # ECT « Émission de certificat » : ressortie d'une police d'abonnement (comme GUCE)
CENT = Decimal("100")
TAUX_TAXE_ORIGINE = {
    "MARITIME": Decimal("0"),
    "FLUVIAL": Decimal("0"),
    "AERIEN": Decimal("7"),
    "TERRESTRE": Decimal("14.5"),
    "FERROVIAIRE": Decimal("14.5"),
}

# Modes, garanties et listes : Administration > Réglages par branche > Transport (tables lephare_transport_mode et
# lephare_transport_garantie, paramètres transport.liste_*, configuration_api 0101). Valeurs d'origine ci-dessous,
# appliquées seulement si les tables sont vides.
MODES_ORIGINE = [
    {"Code": "MARITIME", "Libelle": "Maritime", "CodeCategorie": "611", "Document": "Connaissement (B/L)",
     "Moyen": "Navire", "Chargements": ["En cale, sous pont", "En pontée, sur le pont", "En conteneur"]},
    {"Code": "AERIEN", "Libelle": "Aérien", "CodeCategorie": "612", "Document": "Lettre de transport aérien (LTA)",
     "Moyen": "Compagnie aérienne et n° de vol", "Chargements": ["En soute", "En conteneur aérien"]},
    {"Code": "TERRESTRE", "Libelle": "Terrestre", "CodeCategorie": "614", "Document": "Lettre de voiture",
     "Moyen": "Camion et immatriculation",
     "Chargements": ["Camion bâché", "Camion plateau", "Camion citerne", "Camion frigorifique", "En conteneur"]},
    {"Code": "FERROVIAIRE", "Libelle": "Ferroviaire", "CodeCategorie": "613", "Document": "Lettre de voiture ferroviaire",
     "Moyen": "Train", "Chargements": ["Wagon couvert", "Wagon plat", "Wagon citerne", "En conteneur"]},
    {"Code": "FLUVIAL", "Libelle": "Fluvial ou lagunaire", "CodeCategorie": "619", "Document": "Connaissement fluvial",
     "Moyen": "Barge ou bateau", "Chargements": ["En cale, sous pont", "En pontée, sur le pont", "En conteneur"]},
]

TYPES_POLICE = [
    {"Code": AffaireTransport.POLICE_VOYAGE, "Libelle": "Police au voyage", "Offre": "POLICE AU VOYAGE",
     "Resume": "Un seul envoi : le contrat prend fin à l'arrivée des marchandises à destination.",
     "Valeur": "Valeur de la marchandise transportée"},
    {"Code": AffaireTransport.POLICE_ANNUELLE, "Libelle": "Police annuelle", "Offre": "POLICE ANNUELLE",
     "Resume": "Tous les envois de l'année : souscrite pour un an et renouvelable d'année en année.",
     "Valeur": "Valeur des envois prévus sur l'année"},
    {"Code": AffaireTransport.POLICE_ABONNEMENT, "Libelle": "Police d'abonnement", "Offre": "POLICE A L'ABONNEMENT",
     "Resume": "Numéro de police sans prime, alimenté par chaque voyage déclaré ; facture à la ressortie du mois.",
     "Valeur": "Plein par expédition, valeur la plus forte d'un envoi"},
]
PAR_TYPE = {t["Code"]: t for t in TYPES_POLICE}

# Garantie de base (une seule) et extensions cumulables ; Taux : taux proposé par mode (vide : saisi à la cotation)
GARANTIES_ORIGINE = [
    {"Code": "TOUS_RISQUES", "Groupe": "BASE", "CodeSousGarantie": "19011", "Libelle": "Tous risques",
     "Description": "La couverture la plus large : dommages et pertes de la marchandise pendant le transport, "
                    "quelle qu'en soit la cause, sauf exclusions de la police.", "Taux": {}},
    {"Code": "FAP_SAUF", "Groupe": "BASE", "CodeSousGarantie": "30022", "Libelle": "FAP Sauf, accidents majeurs",
     "Description": "Franc d'avaries particulières sauf : seuls les événements majeurs sont couverts, comme le "
                    "naufrage, l'échouement, l'abordage, l'incendie ou la chute du colis.",
     "Taux": {m["Code"]: "0.15" for m in MODES_ORIGINE}, "TauxMinimum": True},
    {"Code": "ACCIDENTS_CARACTERISES", "Groupe": "BASE", "CodeSousGarantie": "50028",
     "Libelle": "Accidents caractérisés et vols consécutifs",
     "Description": "Dommages dus à un accident du moyen de transport, collision, renversement ou incendie, et vols "
                    "qui en résultent. Usuelle en transport terrestre.", "Taux": {}},
    {"Code": "GUERRE", "Groupe": "EXTENSION", "CodeSousGarantie": "19001", "Libelle": "Risques de guerre",
     "Description": "Guerre, hostilités et risques assimilés. Taux unique.", "Taux": {}},
    {"Code": "GREVES", "Groupe": "EXTENSION", "CodeSousGarantie": "14008", "Libelle": "Grèves et émeutes",
     "Description": "Grèves, émeutes et mouvements populaires.", "Taux": {}},
    {"Code": "TRANSBORDEMENT", "Groupe": "EXTENSION", "CodeSousGarantie": "30021", "Libelle": "Transbordement",
     "Description": "Surprime quand la marchandise change de navire ou de véhicule en cours de route.",
     "Taux": {m["Code"]: "0.10" for m in MODES_ORIGINE}},
    {"Code": "EMBALLAGE", "Groupe": "EXTENSION", "CodeSousGarantie": "30023", "Libelle": "Emballage, clause 53",
     "Description": "Surprime quand l'emballage lui-même est assuré, pas seulement son contenu.",
     "Taux": {m["Code"]: "0.10" for m in MODES_ORIGINE}},
    {"Code": "CHARGEMENT", "Groupe": "EXTENSION", "CodeSousGarantie": "30024", "Libelle": "Chargement et déchargement",
     "Description": "Dommages survenus pendant la manutention au départ et à l'arrivée.", "Taux": {}},
]

LISTES_ORIGINE = {
    "Etats": ("transport.liste_etats", ["Neuve", "Usagée"]),
    "Emballages": ("transport.liste_emballages", ["Caisses pleines", "Caisses à claire-voie", "Cartons",
                                                  "Balles fermées et cerclées", "Sacs de jute neufs", "Sacs papier multiplis",
                                                  "Fûts", "Bouteilles", "Palettes filmées", "Sans emballage"]),
    "Conditionnements": ("transport.liste_conditionnements", ["Conteneur complet porte à porte", "Conteneur de groupage",
                                                              "Conteneur réfrigéré", "Conventionnel simple",
                                                              "Conventionnel palettisé", "Vrac"]),
    "RisquesSpeciaux": ("transport.liste_risques_speciaux", ["Rouille", "Oxydation", "Déformation", "Denrées périssables",
                                                             "Casse", "Coulage", "Mouille", "Animaux vivants"]),
}


def _modes(tous=False):
    """Modes de transport réglés (actifs seulement, sauf tous=True pour relire une affaire existante)."""
    lignes = list(TransportMode.objects.all())
    if not lignes:
        return MODES_ORIGINE
    return [{"Code": m.Code, "Libelle": m.Libelle, "CodeCategorie": m.CodeCategorie, "Document": m.Document,
             "Moyen": m.Moyen, "Chargements": list(m.Chargements or [])} for m in lignes if tous or m.Actif]


def _par_mode(tous=True):
    return {m["Code"]: m for m in _modes(tous)}


def _garanties(toutes=False):
    """Garanties réglées (actives seulement, sauf toutes=True pour appliquer les conditions d'une police existante)."""
    lignes = list(TransportGarantie.objects.all())
    if not lignes:
        return GARANTIES_ORIGINE
    return [{"Code": g.Code, "Groupe": g.Groupe, "CodeSousGarantie": g.CodeSousGarantie, "Libelle": g.Libelle,
             "Description": g.Description, "Taux": dict(g.Taux or {}), "TauxMinimum": g.TauxMinimum}
            for g in lignes if toutes or g.Active]


def _par_garantie(toutes=True):
    return {g["Code"]: g for g in _garanties(toutes)}


def _listes():
    """Listes de saisie (paramètres transport.liste_*, une valeur par ligne)."""
    resultat = {}
    for nom, (cle, origine) in LISTES_ORIGINE.items():
        texte = str(valeur_parametre(cle, "") or "")
        valeurs = [" ".join(v.split()) for v in texte.splitlines() if v.strip()]
        resultat[nom] = valeurs or origine
    return resultat


def _arrondi(montant):
    return Decimal(montant).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _texte(valeur, longueur=255):
    return " ".join(str(valeur or "").split())[:longueur]


def _parametre(cle):
    """Réglage numérique (Decimal) ou None s'il est vide."""
    valeur = valeur_parametre(cle, None)
    return Decimal(str(valeur)) if valeur is not None else None


def _taux_taxe(mode):
    """Taux de taxe (%) réglé pour le mode, ou taux d'origine si le paramètre est absent."""
    taux = _parametre(f"transport.taux_taxe_{mode.lower()}")
    return TAUX_TAXE_ORIGINE[mode] if taux is None else taux


def _taux_propose(garantie, mode):
    """Taux proposé par le réglage de la garantie pour ce mode (Decimal) ou None."""
    taux = (garantie.get("Taux") or {}).get(mode)
    return Decimal(str(taux).replace(",", ".")) if taux not in (None, "") else None


# ------------------------------------------------------------------ référentiel
def _sous_garanties(cursor):
    """{code sous-garantie: (idsousgarantie, libellé)} des garanties du tarif Transport."""
    cursor.execute(
        "SELECT codesousgarantie, idsousgarantie, libellesousgarantie FROM stdsousgarantie WHERE codesousgarantie = ANY(%s)",
        [[g["CodeSousGarantie"] for g in _garanties(toutes=True)]],
    )
    return {code: (identifiant, libelle) for code, identifiant, libelle in cursor.fetchall()}


def _categories(cursor):
    """{mode: {IdTarif, Libelle, Offres: {type de police: (idoffre, libellé)}}}."""
    cursor.execute(
        """
        SELECT t.codecategorie, t.idtarif, t.libelle, o.idoffre, o.libelleoffre
        FROM stdtarif t LEFT JOIN stdoffre o ON o.idtarif = t.idtarif
        WHERE t.codecategorie = ANY(%s)
        ORDER BY o.idoffre
        """,
        [[m["CodeCategorie"] for m in _modes(tous=True)]],
    )
    par_code = {}
    for code, id_tarif, libelle, id_offre, libelle_offre in cursor.fetchall():
        categorie = par_code.setdefault(code, {"IdTarif": id_tarif, "Libelle": libelle, "Offres": {}})
        for type_police in TYPES_POLICE:
            if id_offre and (libelle_offre or "").upper().startswith(type_police["Offre"]):
                categorie["Offres"].setdefault(type_police["Code"], (id_offre, libelle_offre))
    return {m["Code"]: par_code.get(m["CodeCategorie"]) for m in _modes(tous=True)}


def _compagnies(cursor):
    """Compagnies ayant un taux de commission Transport en vigueur ; les plus utilisées en Transport d'abord."""
    cursor.execute(
        """
        SELECT c.idcompagnie, c.raisonsociale,
               (SELECT COUNT(*) FROM stdcontrat x WHERE x.idproduit = %s AND x.idcompagnie = c.idcompagnie)
        FROM stdcompagnie c
        WHERE c.idcompagnie <> 0 AND EXISTS (
            SELECT 1 FROM stdcommissionproduitcompagnie k
            WHERE k.idcompagnie = c.idcompagnie AND k.idproduit = %s AND CURRENT_DATE BETWEEN k.debutvalidite AND k.finvalidite)
        ORDER BY 3 DESC, c.raisonsociale
        """,
        [ID_PRODUIT_TRANSPORT, ID_PRODUIT_TRANSPORT],
    )
    return [{"IdCompagnie": i, "RaisonSociale": n, "ContratsTransport": k} for i, n, k in cursor.fetchall()]


def _reglages():
    cles = ["transport.prime_minimum", "transport.prime_minimum_police_voyage", "transport.cout_police_voyage",
            "transport.cout_par_voyage", "transport.cout_police_annuelle",
            *(f"transport.taux_taxe_{mode.lower()}" for mode in TAUX_TAXE_ORIGINE)]
    return {cle.split(".", 1)[1]: (_nombre(_parametre(cle)) if _parametre(cle) is not None else None) for cle in cles}


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def catalogue_transport(request):
    """GET /api/transport/hors-guce/catalogue/"""
    with connection.cursor() as cursor:
        categories = _categories(cursor)
        sous_garanties = _sous_garanties(cursor)
        compagnies = _compagnies(cursor)
    modes = []
    for m in _modes():
        categorie = categories.get(m["Code"]) or {"Offres": {}}
        modes.append({
            **m,
            "IdTarif": categorie.get("IdTarif"),
            "Offres": {code: {"IdOffre": o[0], "Libelle": o[1]} for code, o in categorie["Offres"].items()},
        })
    garanties = []
    for g in _garanties():
        taux = {m["Code"]: _taux_propose(g, m["Code"]) for m in modes}
        garanties.append({
            "Code": g["Code"], "Groupe": g["Groupe"], "Libelle": g["Libelle"], "Description": g["Description"],
            "IdSousGarantie": (sous_garanties.get(g["CodeSousGarantie"]) or (None,))[0],
            # Taux proposé par mode (null : à saisir) ; TauxMinimum : le taux proposé est un plancher
            "Taux": {code: (_nombre(t) if t is not None else None) for code, t in taux.items()},
            "TauxMinimum": bool(g.get("TauxMinimum")),
        })
    return Response({
        "Modes": modes,
        "TypesPolice": TYPES_POLICE,
        "Garanties": garanties,
        "Compagnies": compagnies,
        # Compagnie proposée pour le produit (Administration > Produits), sinon la première de la liste
        "IdCompagnie": next((c["IdCompagnie"] for c in compagnies if c["IdCompagnie"] == compagnie_par_defaut(ID_PRODUIT_TRANSPORT, 1)),
                            compagnies[0]["IdCompagnie"] if compagnies else 0),
        "Listes": _listes(),
        "Reglages": _reglages(),
    })


# ------------------------------------------------------------------ calcul
def _lire_garanties(donnees, mode):
    """{"Base": {"Code", "Taux"}, "Extensions": [{"Code", "Taux"}]} -> [(garantie, taux Decimal)], base en tête."""
    if not isinstance(donnees, dict):
        raise ErreurSaisie("Garanties : données attendues.")
    base = donnees.get("Base") or {}
    code_base = str(base.get("Code") or "")
    par_garantie = _par_garantie(toutes=False)
    if par_garantie.get(code_base, {}).get("Groupe") != "BASE":
        raise ErreurSaisie("Choisissez la garantie de base : Tous risques, FAP Sauf ou Accidents caractérisés.")
    retenues = [(par_garantie[code_base], base.get("Taux"))]
    vues = {code_base}
    for extension in donnees.get("Extensions") or []:
        code = str((extension or {}).get("Code") or "")
        if par_garantie.get(code, {}).get("Groupe") != "EXTENSION":
            raise ErreurSaisie(f"Extension inconnue ({code}).")
        if code not in vues:
            vues.add(code)
            retenues.append((par_garantie[code], extension.get("Taux")))
    lignes = []
    for garantie, taux_saisi in retenues:
        propose = _taux_propose(garantie, mode)
        taux = _decimal(taux_saisi, f"{garantie['Libelle']} : taux", maximum=CENT, vide=None)
        if taux is None:
            taux = propose
        if taux is None or taux <= 0:
            raise ErreurSaisie(f"{garantie['Libelle']} : saisissez le taux (aucun taux réglé dans l'administration).")
        if garantie.get("TauxMinimum") and propose is not None and taux < propose:
            raise ErreurSaisie(f"{garantie['Libelle']} : {_nombre(propose):g} % au moins, taux minimum réglementaire.")
        lignes.append((garantie, taux))
    return lignes


def calculer(cursor, type_police, mode, id_compagnie, valeur, garanties, accessoire=None, exonere=False, par_voyage=False):
    """Décompte d'une police (ou d'un voyage déclaré sur une police d'abonnement si par_voyage)."""
    sous_garanties = _sous_garanties(cursor)
    lignes = []
    for garantie, taux in garanties:
        id_sg, libelle_sg = sous_garanties.get(garantie["CodeSousGarantie"], (None, garantie["Libelle"]))
        lignes.append({"Code": garantie["Code"], "Groupe": garantie["Groupe"], "Libelle": garantie["Libelle"],
                       "IdSousGarantie": id_sg, "LibelleSousGarantie": libelle_sg, "Taux": taux,
                       "Prime": _arrondi(valeur * taux / CENT)})
    taux_total = sum((l["Taux"] for l in lignes), Decimal(0))
    prime_calculee = sum((l["Prime"] for l in lignes), Decimal(0))
    abonnement = type_police == AffaireTransport.POLICE_ABONNEMENT and not par_voyage
    exemple = None

    if type_police == AffaireTransport.POLICE_VOYAGE:
        minimum = _parametre("transport.prime_minimum_police_voyage") or _parametre("transport.prime_minimum")
        cout = _parametre("transport.cout_police_voyage")
    elif type_police == AffaireTransport.POLICE_ANNUELLE:
        minimum, cout = _parametre("transport.prime_minimum"), _parametre("transport.cout_police_annuelle")
    else:
        minimum, cout = _parametre("transport.prime_minimum"), _parametre("transport.cout_par_voyage")
    minimum = minimum or Decimal(0)
    prime_nette = max(prime_calculee, minimum)
    if prime_nette > prime_calculee and lignes:
        lignes[0]["Prime"] += prime_nette - prime_calculee  # complément de la prime minimum sur la garantie de base
    acc = _arrondi(accessoire if accessoire is not None else (cout or 0))
    taux_taxe = Decimal(0) if exonere else _taux_taxe(mode)
    for l in lignes:
        l["Taxe"] = _arrondi(l["Prime"] * taux_taxe / CENT)
    taxe = _arrondi((prime_nette + acc) * taux_taxe / CENT)
    ttc = prime_nette + acc + taxe

    if abonnement:
        # La police d'abonnement n'a pas de prime : décompte d'un voyage au plein, à titre d'exemple
        exemple = calculer(cursor, type_police, mode, id_compagnie, valeur, garanties, None, exonere, par_voyage=True)
        lignes = [{**l, "Prime": Decimal(0), "Taxe": Decimal(0)} for l in lignes]
        prime_calculee = prime_nette = acc = taxe = ttc = Decimal(0)
    id_offre = None
    categorie = _categories(cursor).get(mode) or {"Offres": {}}
    if categorie["Offres"].get(type_police):
        id_offre = categorie["Offres"][type_police][0]
    taux_commission = Decimal(_une_ligne(
        cursor, "SELECT fn_get_taux_commission_offre(%s, %s, %s, %s)",
        [ID_PRODUIT_TRANSPORT, id_compagnie, id_offre, date_emission_du_jour()],
    )[0] or 0)
    part = _une_ligne(
        cursor,
        """
        SELECT CASE WHEN COALESCE(d.reversement ->> 'PartAccessoiresCourtier', '') ~ '^[0-9]+([.][0-9]+)?$'
                    THEN (d.reversement ->> 'PartAccessoiresCourtier')::numeric END
        FROM lephare_compagnie_document d WHERE d.idcompagnie = %s
        """,
        [id_compagnie],
    )
    part = part[0] if part and part[0] is not None and part[0] <= 100 else None
    acc_intermediaire = _arrondi(acc * part / CENT) if part is not None else Decimal(0)
    ttc_arrondie = _une_ligne(cursor, "SELECT fn_lephare_arrondi_montant(%s, %s)", [ttc, ID_PRODUIT_TRANSPORT])[0]
    resultat = {
        "TypePolice": type_police,
        "Mode": mode,
        "IdOffre": id_offre,
        "Valeur": valeur,
        "Lignes": lignes,
        "TauxTotal": taux_total,
        "PrimeCalculee": prime_calculee,
        "PrimeMinimum": minimum,
        "MinimumApplique": prime_nette > prime_calculee,
        "PrimeNette": prime_nette,
        "Accessoire": acc,
        "AccessoireCompagnie": acc - acc_intermediaire,
        "AccessoireIntermediaire": acc_intermediaire,
        "TauxTaxe": taux_taxe,
        "Taxe": taxe,
        "TaxeAccessoire": taxe - sum((l["Taxe"] for l in lignes), Decimal(0)),
        "PrimeTtc": ttc,
        "PrimeTtcArrondie": ttc_arrondie,
        "TauxCommission": taux_commission,
        "Commission": _arrondi(prime_nette * taux_commission / CENT),
    }
    if exemple:
        resultat["ParVoyage"] = exemple
    return resultat


def _json(valeur):
    """Decimal -> nombre, récursivement (réponses et JSON enregistrés)."""
    if isinstance(valeur, Decimal):
        return float(valeur)
    if isinstance(valeur, dict):
        return {k: _json(v) for k, v in valeur.items()}
    if isinstance(valeur, (list, tuple)):
        return [_json(v) for v in valeur]
    if isinstance(valeur, date):
        return valeur.isoformat()
    return valeur


def _lire_calcul(donnees):
    type_police = str(donnees.get("TypePolice") or "")
    if type_police not in PAR_TYPE:
        raise ErreurSaisie("Choisissez le type de police : au voyage, annuelle ou d'abonnement.")
    mode = str(donnees.get("Mode") or "")
    if mode not in _par_mode(tous=False):
        raise ErreurSaisie("Choisissez le mode de transport.")
    id_compagnie = _entier(donnees.get("IdCompagnie"), "Compagnie")
    valeur = _decimal(donnees.get("Valeur"), PAR_TYPE[type_police]["Valeur"])
    if valeur <= 0:
        raise ErreurSaisie(f"{PAR_TYPE[type_police]['Valeur']} : à renseigner.")
    garanties = _lire_garanties(donnees.get("Garanties") or {}, mode)
    accessoire = donnees.get("Accessoire")
    accessoire = None if accessoire is None or str(accessoire).strip() == "" else _decimal(accessoire, "Accessoires")
    return {"type_police": type_police, "mode": mode, "id_compagnie": id_compagnie, "valeur": valeur,
            "garanties": garanties, "accessoire": accessoire, "exonere": bool(donnees.get("ExonereTaxe"))}


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def calcul_transport(request):
    """POST /api/transport/hors-guce/calcul/ : décompte sans écriture."""
    try:
        with connection.cursor() as cursor:
            p = _lire_calcul(request.data)
            return Response(_json(calculer(cursor, **p)))
    except ErreurSaisie as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


# ------------------------------------------------------------------ enregistrement du devis
def _saisie_propre(donnees, p):
    """Fiche du risque enregistrée (lephare_transport_affaire.saisie) ; contrôle des rubriques indispensables."""
    marchandise = donnees.get("Marchandise") or {}
    trajet = donnees.get("Trajet") or {}
    if not isinstance(marchandise, dict) or not isinstance(trajet, dict):
        raise ErreurSaisie("Marchandise et trajet : données attendues.")
    fiche = {
        "marchandise": {
            "nature": _texte(marchandise.get("Nature")),
            "etat": _texte(marchandise.get("Etat"), 40),
            "emballage": _texte(marchandise.get("Emballage"), 120),
            "conditionnement": _texte(marchandise.get("Conditionnement"), 120),
            "risques_speciaux": [_texte(r, 60) for r in (marchandise.get("RisquesSpeciaux") or []) if _texte(r, 60)][:12],
            "poids": _texte(marchandise.get("Poids"), 60),
        },
        "trajet": {
            "depart": _texte(trajet.get("Depart"), 120),
            "embarquement": _texte(trajet.get("Embarquement"), 120),
            "debarquement": _texte(trajet.get("Debarquement"), 120),
            "arrivee": _texte(trajet.get("Arrivee"), 120),
            "chargement": _texte(trajet.get("Chargement"), 80),
            "moyen": _texte(trajet.get("Moyen"), 120),
            "document": _texte(trajet.get("Document"), 80),
        },
        "vehicules": [],
        "chiffre_affaires": _nombre(_decimal(donnees.get("ChiffreAffaires"), "Chiffre d'affaires")),
        "franchise": _texte(donnees.get("Franchise"), 200),
    }
    for v in (donnees.get("Vehicules") or [])[:30]:
        if isinstance(v, dict) and (_texte(v.get("Immatriculation")) or _texte(v.get("Marque"))):
            fiche["vehicules"].append({
                "marque": _texte(v.get("Marque"), 80), "immatriculation": _texte(v.get("Immatriculation"), 30),
                "charge_utile": _texte(v.get("ChargeUtile"), 30),
                "valeur": _nombre(_decimal(v.get("Valeur"), "Valeur par chargement")),
            })
    manquants = [libelle for libelle, valeur in (
        ("type de marchandise", fiche["marchandise"]["nature"]),
        ("conditionnement", fiche["marchandise"]["conditionnement"]),
        ("point de départ", fiche["trajet"]["depart"]),
        ("point d'arrivée", fiche["trajet"]["arrivee"]),
        ("mode de chargement", fiche["trajet"]["chargement"]),
    ) if not valeur]
    if manquants:
        raise ErreurSaisie("À renseigner : " + ", ".join(manquants) + ".")
    fiche.update({
        "version": 1,
        "type_police": p["type_police"],
        "mode": p["mode"],
        "valeur": _nombre(p["valeur"]),
        "garanties": {"base": {"code": p["garanties"][0][0]["Code"], "taux": _nombre(p["garanties"][0][1])},
                      "extensions": [{"code": g["Code"], "taux": _nombre(t)} for g, t in p["garanties"][1:]]},
        "accessoire_impose": _nombre(p["accessoire"]) if p["accessoire"] is not None else None,
        "exonere_taxe": p["exonere"],
        "questionnaire": _entier(donnees.get("IdQuestionnaire"), "Questionnaire", obligatoire=False) or None,
    })
    return fiche


def _controler_personnes(cursor, donnees):
    id_client = _entier(donnees.get("IdClient"), "Prospect")
    id_assure = _entier(donnees.get("IdAssure") or id_client, "Assuré")
    for identifiant, libelle in ((id_client, "Prospect"), (id_assure, "Assuré")):
        if not _une_ligne(cursor, "SELECT 1 FROM stdclient WHERE idclient = %s", [identifiant]):
            raise ErreurSaisie(f"{libelle} introuvable (client n° {identifiant}).")
    return id_client, id_assure


def _dates(donnees, type_police):
    date_effet = _date(donnees.get("DateEffet"), "Date d'effet" if type_police != "VOYAGE" else "Date de départ")
    date_expiration = _date(donnees.get("DateExpiration"),
                            "Date d'expiration" if type_police != "VOYAGE" else "Date d'arrivée prévue")
    if date_expiration < date_effet:
        raise ErreurSaisie("La date de fin doit suivre la date de début.")
    if type_police != "VOYAGE" and (date_expiration - date_effet).days > 400:
        raise ErreurSaisie("Une police annuelle ou d'abonnement couvre un an au plus.")
    return date_effet, date_expiration


def _inserer_detail(cursor, id_devis, id_offre, id_tarif, valeur, date_effet, conducteur, trajet, moyen, document, numero,
                    reference, calcul, franchise=""):
    cursor.execute(
        """
        INSERT INTO stddevisdetail (iddevis, idoffre, idtarif, vehicule, idusage, codeusage, reference, idcarrosserie,
            puissancefiscale, nombreplace, chargeutile, valeurneuve, valeurvenale, valeuraccessoire, remorque, conducteur,
            adressecnd, datemec, datemutation, nummoteur, numchassis, typevehicule, idmarque, matricule, carteverte, essence,
            numpccnd, tauxreduction, primeimposee, primeannuelle, primenette, taxeenregistrement)
        VALUES (%s, %s, %s, 1, 0, '000', '000', 0, 0, 0, 0, %s, 0, 0, FALSE, %s, %s, %s, %s, '', %s, %s, 0, %s, FALSE, 0,
                %s, 0, FALSE, %s, %s, %s)
        RETURNING iddevisdetail
        """,
        [id_devis, id_offre, id_tarif, valeur, conducteur, trajet[:50], date_effet, date_effet, numero[:50], moyen[:50],
         reference[:50], document[:50], calcul["PrimeNette"], calcul["PrimeNette"],
         calcul["Taxe"] - calcul["TaxeAccessoire"]],
    )
    id_detail = cursor.fetchone()[0]
    _inserer_garanties(cursor, id_detail, valeur, calcul, franchise)
    return id_detail


def _inserer_garanties(cursor, id_detail, valeur, calcul, franchise=""):
    cursor.execute("DELETE FROM stddevisdetgarantie WHERE iddevisdet = %s", [id_detail])
    for l in calcul["Lignes"]:
        if not l["IdSousGarantie"]:
            raise ErreurSaisie(f"Garantie « {l['Libelle']} » absente du référentiel (migration production 0172).")
        cursor.execute(
            """
            INSERT INTO stddevisdetgarantie (iddevisdet, idgarantie, acquise, taxe, capital, tauxfranchise, minfranchise,
                maxfranchise, franchise, textefranchise, primeannuelle, primenette, old_acquise, old_primenette)
            VALUES (%s, %s, TRUE, %s, %s, 0, 0, 0, 0, %s, %s, %s, '1', %s)
            """,
            [id_detail, l["IdSousGarantie"], l["Taxe"], valeur, franchise[:200], l["Prime"], l["Prime"], l["Prime"]],
        )


def enregistrer_devis(donnees, id_utilisateur):
    with transaction.atomic(), connection.cursor() as cursor:
        p = _lire_calcul(donnees)
        id_client, id_assure = _controler_personnes(cursor, donnees)
        date_effet, date_expiration = _dates(donnees, p["type_police"])
        fiche = _saisie_propre(donnees, p)
        calcul = calculer(cursor, **p)
        categorie = _categories(cursor).get(p["mode"])
        if not categorie or not calcul["IdOffre"]:
            raise ErreurSaisie(f"Aucune offre « {PAR_TYPE[p['type_police']]['Libelle']} » pour le mode "
                               f"{_par_mode()[p['mode']]['Libelle'].lower()} (migration production 0172).")
        if not _une_ligne(cursor, "SELECT 1 FROM stdcompagnie WHERE idcompagnie = %s", [p["id_compagnie"]]):
            raise ErreurSaisie("Compagnie inconnue.")

        id_devis = _entier(donnees.get("IdDevis"), "Devis", obligatoire=False)
        jours = (date_expiration - date_effet).days
        periode, id_duree = _une_ligne(cursor, "SELECT fn_calcul_periode_contrat(%s), fn_calcul_id_duree_contrat(%s)",
                                       [jours, jours])
        police_compagnie = _texte(donnees.get("NumeroPoliceCompagnie"), 60)
        montants = [calcul["PrimeNette"], calcul["PrimeNette"], calcul["Accessoire"], calcul["AccessoireCompagnie"],
                    calcul["AccessoireIntermediaire"], calcul["Taxe"], calcul["PrimeTtc"], calcul["Commission"]]
        if id_devis:
            devis = _une_ligne(cursor, "SELECT idproduit, confirme FROM stddevis WHERE iddevis = %s FOR UPDATE", [id_devis])
            if not devis or devis[0] != ID_PRODUIT_TRANSPORT:
                raise ErreurSaisie("Ce devis n'est pas un devis Transport.")
            if devis[1]:
                raise ErreurSaisie("Devis déjà confirmé (contrat émis) : modification impossible.")
            if not AffaireTransport.objects.filter(id_devis=id_devis).exists():
                raise ErreurSaisie("Devis issu d'un bordereau GUCE : il se modifie par un nouvel import, pas ici.")
            cursor.execute(
                """
                UPDATE stddevis SET idoperateur = %s, idoffre = %s, idcompagnie = %s, idaperiteur = %s, idclient = %s,
                    idassure = %s, periode = %s, dateemission = %s, dateeffet = %s, dateexpiration = %s, idduree = %s,
                    numeropolicecompagnie = %s, renouvelable = %s, primeannuelle = %s, primenette = %s, accessoire = %s,
                    accessoirecompagnie = %s, accessoireintermediaire = %s, taxe = %s, primettc = %s,
                    commissionintermediaire = %s, fga = 0, cedeao = 0, primeimposee = FALSE
                WHERE iddevis = %s
                """,
                [id_utilisateur, calcul["IdOffre"], p["id_compagnie"], p["id_compagnie"], id_client, id_assure, periode,
                 date_emission_du_jour(), date_effet, date_expiration, id_duree, police_compagnie or None,
                 p["type_police"] == "ANNUELLE", *montants, id_devis],
            )
            cursor.execute("DELETE FROM stddevisdetgarantie WHERE iddevisdet IN "
                           "(SELECT iddevisdetail FROM stddevisdetail WHERE iddevis = %s)", [id_devis])
            cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
        else:
            cursor.execute("CALL sp_numeroter_avenant(%s, %s, NULL, %s)", [ID_AVENANT_AFFAIRE_NOUVELLE, ID_INTERMEDIAIRE, ""])
            numero_avenant = cursor.fetchone()[0]
            cursor.execute("CALL sp_generer_numero_devis(%s, %s, %s, %s, %s)",
                           [ID_INTERMEDIAIRE, p["id_compagnie"], _par_mode()[p["mode"]]["CodeCategorie"], "", ""])
            numero_devis = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO stddevis (idoperateur, idoffre, idintermediaire, idcompagnie, idproduit, idclient, idassure,
                    idavenant, numeroavenant, numerodevis, flotte, idaperiteur, coassurance, periode, dateemission, dateeffet,
                    dateexpiration, confirme, idduree, numeropolicecompagnie, renouvelable, primeimposee, primeannuelle,
                    primenette, accessoire, accessoirecompagnie, accessoireintermediaire, taxe, primettc,
                    commissionintermediaire, fga, cedeao)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s, FALSE, %s, %s, %s, %s, FALSE, %s, %s, %s, FALSE,
                        %s, %s, %s, %s, %s, %s, %s, %s, 0, 0)
                RETURNING iddevis
                """,
                [id_utilisateur, calcul["IdOffre"], ID_INTERMEDIAIRE, p["id_compagnie"], ID_PRODUIT_TRANSPORT, id_client,
                 id_assure, ID_AVENANT_AFFAIRE_NOUVELLE, numero_avenant, numero_devis, p["id_compagnie"], periode,
                 date_emission_du_jour(), date_effet, date_expiration, id_duree, police_compagnie or None,
                 p["type_police"] == "ANNUELLE", *montants],
            )
            id_devis = cursor.fetchone()[0]

        nom_assure = _une_ligne(cursor, "SELECT TRIM(COALESCE(nom, '') || ' ' || COALESCE(prenoms, '')) FROM stdclient "
                                        "WHERE idclient = %s", [id_assure])[0]
        trajet = f"{fiche['trajet']['depart']} - {fiche['trajet']['arrivee']}"
        _inserer_detail(cursor, id_devis, calcul["IdOffre"], categorie["IdTarif"], p["valeur"], date_effet,
                                    fiche["marchandise"]["nature"] or nom_assure, trajet, fiche["trajet"]["moyen"],
                                    fiche["trajet"]["document"], "", "", calcul, fiche["franchise"])
        AffaireTransport.objects.update_or_create(
            id_devis=id_devis,
            defaults={"type_police": p["type_police"], "mode": p["mode"], "saisie": fiche, "calcul": _json(calcul),
                      **({"cree_par_id": id_utilisateur} if id_utilisateur and not donnees.get("IdDevis") else {})},
        )
        # Compagnie changée : le déclencheur différé renumérote le devis ; contrôles immédiats pour lire le numéro définitif
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        totaux = _une_ligne(cursor, "SELECT numerodevis, primenette, accessoire, taxe, primettc FROM stddevis WHERE iddevis = %s",
                            [id_devis])
    return {
        "ObjectId": id_devis,
        "OutputMessage": "Devis enregistré avec succès.",
        "NumeroDevis": totaux[0],
        "PrimeNette": _nombre(totaux[1]),
        "Accessoire": _nombre(totaux[2]),
        "Taxe": _nombre(totaux[3]),
        "PrimeTtc": _nombre(totaux[4]),
    }


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def enregistrer_devis_vue(request):
    """POST /api/transport/hors-guce/devis/ (IdDevis > 0 : modification)"""
    try:
        resultat = enregistrer_devis(request.data, _id_utilisateur(request))
    except ErreurSaisie as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as erreur:  # message de la base (procédures de numérotation, contraintes)
        return Response({"error": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(resultat, status=status.HTTP_201_CREATED)


# ------------------------------------------------------------------ relecture
@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def lire_devis(request, iddevis):
    """GET /api/transport/hors-guce/devis/<id>/"""
    affaire = AffaireTransport.objects.filter(id_devis=iddevis).first()
    with connection.cursor() as cursor:
        entete = _une_ligne(
            cursor,
            """
            SELECT d.iddevis, d.numerodevis, d.idproduit, d.confirme, COALESCE(d.archive, FALSE), d.idcompagnie,
                   c.raisonsociale, d.idclient, d.idassure, d.dateemission, d.dateeffet, d.dateexpiration,
                   d.numeropolicecompagnie, d.primenette, d.accessoire, d.taxe, d.primettc, d.idavenant
            FROM stddevis d LEFT JOIN stdcompagnie c ON c.idcompagnie = d.idcompagnie
            WHERE d.iddevis = %s
            """,
            [iddevis],
        )
        if not entete or entete[2] != ID_PRODUIT_TRANSPORT:
            return Response({"error": "Devis Transport introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not affaire:
            return Response({"error": "Devis issu d'un bordereau GUCE ou d'une ressortie : il ne se rouvre pas dans la "
                                      "cotation hors GUCE."}, status=status.HTTP_404_NOT_FOUND)
        client, assure = _personne(cursor, entete[7]), _personne(cursor, entete[8])
        contrat = _une_ligne(cursor, "SELECT idcontrat, numeropolice FROM stdcontrat WHERE iddevis = %s", [iddevis])
    return Response({
        "IdDevis": entete[0], "NumeroDevis": entete[1], "Confirme": bool(entete[3]), "Archive": bool(entete[4]),
        "IdCompagnie": entete[5], "Compagnie": entete[6], "Client": client, "Assure": assure,
        "DateEmission": _iso(entete[9]), "DateEffet": _iso(entete[10]), "DateExpiration": _iso(entete[11]),
        "NumeroPoliceCompagnie": entete[12] or "", "PrimeNette": _nombre(entete[13]), "Accessoire": _nombre(entete[14]),
        "Taxe": _nombre(entete[15]), "PrimeTtc": _nombre(entete[16]), "IdAvenant": entete[17],
        "TypePolice": affaire.type_police, "Mode": affaire.mode, "Saisie": affaire.saisie, "Calcul": affaire.calcul,
        "IdContrat": contrat[0] if contrat else None, "NumeroPolice": contrat[1] if contrat else "",
    })


# ------------------------------------------------------------------ polices d'abonnement
def _police_abonnement(cursor, id_contrat, verrou=False):
    """Police d'abonnement (contrat issu d'un devis hors GUCE d'abonnement) : contrat, affaire et période couverte."""
    ligne = _une_ligne(
        cursor,
        f"""
        SELECT c.idcontrat, c.iddevis, c.numeropolice, c.idclient, c.idassure, c.idcompagnie, k.raisonsociale,
               c.dateeffet::date, c.dateexpiration::date, COALESCE(c.idcontratannulation, 0), d.numerodevis,
               d.numeropolicecompagnie, TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, ''))
        FROM stdcontrat c
        JOIN stddevis d ON d.iddevis = c.iddevis
        LEFT JOIN stdcompagnie k ON k.idcompagnie = c.idcompagnie
        LEFT JOIN stdclient cl ON cl.idclient = c.idclient
        WHERE c.idcontrat = %s AND c.idproduit = %s
        {"FOR UPDATE OF c" if verrou else ""}
        """,
        [id_contrat, ID_PRODUIT_TRANSPORT],
    )
    affaire = ligne and AffaireTransport.objects.filter(id_devis=ligne[1], type_police=AffaireTransport.POLICE_ABONNEMENT).first()
    if not affaire:
        raise ErreurSaisie("Cette police n'est pas une police d'abonnement Transport hors GUCE.")
    # Renouvellements éventuels sous le même numéro : la police court jusqu'à la dernière échéance
    fin = _une_ligne(
        cursor,
        """
        SELECT MAX(c.dateexpiration::date) FROM stdcontrat c JOIN stdavenant a ON a.idavenant = c.idavenant
        WHERE c.numeropolice = %s AND c.idproduit = %s AND a.codeavenant IN ('AFN', 'REN')
          AND COALESCE(c.idcontratannulation, 0) = 0
        """,
        [ligne[2], ID_PRODUIT_TRANSPORT],
    )[0]
    return {
        "IdContrat": ligne[0], "IdDevis": ligne[1], "NumeroPolice": ligne[2], "IdClient": ligne[3], "IdAssure": ligne[4],
        "IdCompagnie": ligne[5], "Compagnie": ligne[6] or "", "DateEffet": ligne[7], "DateExpiration": fin or ligne[8],
        "Annulee": bool(ligne[9]), "NumeroDevis": ligne[10], "NumeroPoliceCompagnie": ligne[11] or "", "Client": ligne[12],
        "affaire": affaire,
    }


def _conditions(police):
    """Garanties et taux de la police d'abonnement, appliqués à chaque voyage."""
    saisie = police["affaire"].saisie or {}
    garanties = saisie.get("garanties") or {}
    par_garantie = _par_garantie(toutes=True)  # garantie retirée depuis : la police garde ses conditions
    lignes = [(par_garantie[g["code"]], Decimal(str(g["taux"])))
              for g in [garanties.get("base") or {}] + (garanties.get("extensions") or []) if g.get("code") in par_garantie]
    if not lignes:
        raise ErreurSaisie("Conditions de la police introuvables (garanties et taux).")
    return lignes


def _voyage_json(v):
    return {
        "Id": v.id, "Numero": v.numero, "DateDepart": _iso(v.date_depart), "DateArrivee": _iso(v.date_arrivee),
        "Marchandise": v.marchandise, "Emballage": v.emballage, "Conditionnement": v.conditionnement,
        "LieuDepart": v.lieu_depart, "LieuArrivee": v.lieu_arrivee, "MoyenTransport": v.moyen_transport,
        "DocumentTransport": v.document_transport, "Valeur": _nombre(v.valeur), "TauxTotal": _nombre(v.taux_total),
        "PrimeNette": _nombre(v.prime_nette), "Accessoire": _nombre(v.accessoire), "Taxe": _nombre(v.taxe),
        "PrimeTtc": _nombre(v.prime_ttc), "Garanties": v.garanties, "IdDevisRessortie": v.id_devis_ressortie,
        "Annule": v.annule, "MotifAnnulation": v.motif_annulation, "Mois": v.date_depart.strftime("%Y-%m"),
        "Statut": "Annulé" if v.annule else ("Facturé" if v.id_devis_ressortie else "À facturer"),
    }


def _police_json(police, voyages=None):
    saisie = police["affaire"].saisie or {}
    actifs = [v for v in (voyages or []) if not v.annule]
    a_facturer = [v for v in actifs if not v.id_devis_ressortie]
    return {
        **{k: (_iso(v) if isinstance(v, date) else v) for k, v in police.items() if k != "affaire"},
        "Mode": police["affaire"].mode,
        "LibelleMode": _par_mode().get(police["affaire"].mode, {}).get("Libelle", ""),
        "Plein": saisie.get("valeur") or 0,
        "Marchandise": (saisie.get("marchandise") or {}).get("nature", ""),
        "Trajet": " → ".join(x for x in ((saisie.get("trajet") or {}).get("depart"), (saisie.get("trajet") or {}).get("arrivee")) if x),
        "Garanties": [{"Code": g.get("code"), "Libelle": _par_garantie().get(g.get("code"), {}).get("Libelle", g.get("code")),
                       "Taux": g.get("taux")}
                      for g in [(saisie.get("garanties") or {}).get("base") or {}] + ((saisie.get("garanties") or {}).get("extensions") or [])
                      if g.get("code")],
        "TauxTotal": sum(float(g.get("taux") or 0) for g in [(saisie.get("garanties") or {}).get("base") or {}]
                         + ((saisie.get("garanties") or {}).get("extensions") or [])),
        "ExonereTaxe": bool(saisie.get("exonere_taxe")),
        "Voyages": len(actifs),
        "VoyagesAFacturer": len(a_facturer),
        "MontantAFacturer": _nombre(sum((v.prime_ttc for v in a_facturer), Decimal(0))),
        "MoisAFacturer": sorted({v.date_depart.strftime("%Y-%m") for v in a_facturer}),
    }


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def liste_abonnements(request):
    """GET /api/transport/hors-guce/abonnements/ : polices d'abonnement émises et voyages à facturer."""
    devis = list(AffaireTransport.objects.filter(type_police=AffaireTransport.POLICE_ABONNEMENT).values_list("id_devis", flat=True))
    polices = []
    with connection.cursor() as cursor:
        cursor.execute("SELECT idcontrat FROM stdcontrat WHERE iddevis = ANY(%s) ORDER BY dateeffet DESC, idcontrat DESC", [devis])
        identifiants = [r[0] for r in cursor.fetchall()]
        voyages = {}
        for v in VoyageTransport.objects.filter(id_contrat__in=identifiants):
            voyages.setdefault(v.id_contrat, []).append(v)
        for id_contrat in identifiants:
            try:
                police = _police_abonnement(cursor, id_contrat)
            except ErreurSaisie:
                continue
            polices.append(_police_json(police, voyages.get(id_contrat, [])))
    return Response({"Polices": polices, "Reglages": _reglages()})


def _ressorties(cursor, police):
    cursor.execute(
        """
        SELECT d.iddevis, d.dateeffet::date, d.dateexpiration::date, d.primenette, d.accessoire, d.taxe, d.primettc,
               c.idcontrat, q.idquittance, q.numeroquittance, COALESCE(q.mt_encaisse, 0),
               (SELECT COUNT(*) FROM stddevisdetail x WHERE x.iddevis = d.iddevis)
        FROM stddevis d
        LEFT JOIN stdcontrat c ON c.iddevis = d.iddevis
        LEFT JOIN stdquittance q ON q.idquittance = c.idquittance
        WHERE d.iddevis IN (SELECT DISTINCT v.iddevisressortie FROM lephare_transport_voyage v
                            WHERE v.idcontrat = %s AND v.iddevisressortie IS NOT NULL)
        ORDER BY d.dateeffet DESC
        """,
        [police["IdContrat"]],
    )
    return [{"IdDevis": r[0], "Mois": r[1].strftime("%Y-%m"), "DateEffet": _iso(r[1]), "DateExpiration": _iso(r[2]),
             "PrimeNette": _nombre(r[3]), "Accessoire": _nombre(r[4]), "Taxe": _nombre(r[5]), "PrimeTtc": _nombre(r[6]),
             "IdContrat": r[7], "IdQuittance": r[8], "NumeroQuittance": r[9] or "", "Encaisse": _nombre(r[10]),
             "Voyages": r[11]} for r in cursor.fetchall()]


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def detail_abonnement(request, idcontrat):
    """GET /api/transport/hors-guce/abonnements/<idcontrat>/ : voyages et ressorties de la police."""
    try:
        with connection.cursor() as cursor:
            police = _police_abonnement(cursor, idcontrat)
            voyages = list(VoyageTransport.objects.filter(id_contrat=idcontrat))
            ressorties = _ressorties(cursor, police)
    except ErreurSaisie as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_404_NOT_FOUND)
    return Response({**_police_json(police, voyages), "Saisie": police["affaire"].saisie,
                     "ListeVoyages": [_voyage_json(v) for v in reversed(voyages)], "Ressorties": ressorties,
                     "Reglages": _reglages()})


def declarer_voyage(id_contrat, donnees, id_utilisateur):
    with transaction.atomic(), connection.cursor() as cursor:
        police = _police_abonnement(cursor, id_contrat, verrou=True)
        if police["Annulee"]:
            raise ErreurSaisie("Police annulée ou résiliée : aucun voyage ne peut y être déclaré.")
        depart = _date(donnees.get("DateDepart"), "Date de départ")
        arrivee = _date(donnees.get("DateArrivee"), "Date d'arrivée prévue") if donnees.get("DateArrivee") else None
        if arrivee and arrivee < depart:
            raise ErreurSaisie("La date d'arrivée doit suivre la date de départ.")
        if not police["DateEffet"] <= depart <= police["DateExpiration"]:
            raise ErreurSaisie(f"Départ hors de la période de la police (du {police['DateEffet']:%d/%m/%Y} au "
                               f"{police['DateExpiration']:%d/%m/%Y}).")
        if depart > date_emission_du_jour() + timedelta(days=60):
            raise ErreurSaisie("Départ trop lointain : déclarez le voyage dans les deux mois qui le précèdent.")
        valeur = _decimal(donnees.get("Valeur"), "Valeur de la marchandise")
        if valeur <= 0:
            raise ErreurSaisie("Valeur de la marchandise : à renseigner.")
        champs = {
            "marchandise": _texte(donnees.get("Marchandise")), "lieu_depart": _texte(donnees.get("LieuDepart"), 120),
            "lieu_arrivee": _texte(donnees.get("LieuArrivee"), 120),
        }
        manquants = [l for l, c in (("marchandise", "marchandise"), ("point de départ", "lieu_depart"),
                                    ("point d'arrivée", "lieu_arrivee")) if not champs[c]]
        if manquants:
            raise ErreurSaisie("À renseigner : " + ", ".join(manquants) + ".")
        saisie = police["affaire"].saisie or {}
        calcul = calculer(cursor, AffaireTransport.POLICE_ABONNEMENT, police["affaire"].mode, police["IdCompagnie"], valeur,
                          _conditions(police), None, bool(saisie.get("exonere_taxe")), par_voyage=True)
        dernier = VoyageTransport.objects.filter(id_contrat=id_contrat).order_by("-numero").values_list("numero", flat=True).first()
        voyage = VoyageTransport.objects.create(
            id_contrat=id_contrat, numero_police=police["NumeroPolice"], numero=(dernier or 0) + 1, date_depart=depart,
            date_arrivee=arrivee, emballage=_texte(donnees.get("Emballage"), 120),
            conditionnement=_texte(donnees.get("Conditionnement"), 120), moyen_transport=_texte(donnees.get("MoyenTransport"), 120),
            document_transport=_texte(donnees.get("DocumentTransport"), 80), valeur=valeur, taux_total=calcul["TauxTotal"],
            prime_nette=calcul["PrimeNette"], accessoire=calcul["Accessoire"], taxe=calcul["Taxe"], prime_ttc=calcul["PrimeTtc"],
            garanties=_json(calcul["Lignes"]), cree_par_id=id_utilisateur, **champs,
        )
    plein = Decimal(str(saisie.get("valeur") or 0))
    return {
        **_voyage_json(voyage),
        "Avertissement": (f"Valeur supérieure au plein par expédition de la police ({_nombre(plein):,.0f} F) : "
                          "à signaler à la compagnie.".replace(",", " ")) if plein and valeur > plein else "",
    }


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def declarer_voyage_vue(request, idcontrat):
    """POST /api/transport/hors-guce/abonnements/<idcontrat>/voyages/"""
    try:
        return Response(declarer_voyage(idcontrat, request.data, _id_utilisateur(request)), status=status.HTTP_201_CREATED)
    except ErreurSaisie as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def annuler_voyage(request, idvoyage):
    """POST /api/transport/hors-guce/voyages/<id>/annulation/ : voyage non facturé retiré de la ressortie."""
    motif = _texte(request.data.get("Motif"), 255)
    if not motif:
        return Response({"error": "Indiquez le motif de l'annulation."}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        voyage = VoyageTransport.objects.select_for_update().filter(pk=idvoyage).first()
        if not voyage:
            return Response({"error": "Voyage introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if voyage.annule:
            return Response({"error": "Ce voyage est déjà annulé."}, status=status.HTTP_400_BAD_REQUEST)
        if voyage.id_devis_ressortie:
            return Response({"error": "Voyage déjà facturé par une ressortie : il ne peut plus être annulé ici."},
                            status=status.HTTP_400_BAD_REQUEST)
        voyage.annule, voyage.motif_annulation = True, motif
        voyage.save(update_fields=["annule", "motif_annulation"])
    return Response(_voyage_json(voyage))


def emettre_ressortie(id_contrat, mois, id_utilisateur):
    """Ressortie du mois : devis « Émission de certificat » (une ligne par voyage), contrat sous le numéro de la police
    et quittance, par sp_generation_contrat_transport comme les quinzaines GUCE."""
    try:
        annee, numero_mois = (int(x) for x in str(mois or "").split("-"))
        debut_mois = date(annee, numero_mois, 1)
    except (TypeError, ValueError):
        raise ErreurSaisie("Mois de la ressortie : AAAA-MM attendu.")
    fin_mois = date(annee, numero_mois, calendar.monthrange(annee, numero_mois)[1])
    with transaction.atomic(), connection.cursor() as cursor:
        police = _police_abonnement(cursor, id_contrat, verrou=True)
        voyages = list(VoyageTransport.objects.select_for_update().filter(
            id_contrat=id_contrat, annule=False, id_devis_ressortie__isnull=True,
            date_depart__gte=debut_mois, date_depart__lte=fin_mois,
        ).order_by("numero"))
        if not voyages:
            raise ErreurSaisie(f"Aucun voyage à facturer en {debut_mois:%m/%Y}.")
        affaire = police["affaire"]
        categorie = _categories(cursor).get(affaire.mode) or {"Offres": {}}
        id_offre = (categorie["Offres"].get(AffaireTransport.POLICE_ABONNEMENT) or (None,))[0]
        if not id_offre:
            raise ErreurSaisie("Offre d'abonnement introuvable pour ce mode de transport.")
        date_effet, date_expiration = max(debut_mois, police["DateEffet"]), min(fin_mois, police["DateExpiration"])
        jours = (date_expiration - date_effet).days
        periode, id_duree = _une_ligne(cursor, "SELECT fn_calcul_periode_contrat(%s), fn_calcul_id_duree_contrat(%s)",
                                       [jours, jours])
        totaux = {k: sum((getattr(v, k) for v in voyages), Decimal(0)) for k in ("prime_nette", "accessoire", "taxe", "prime_ttc")}
        part = calculer(cursor, AffaireTransport.POLICE_ABONNEMENT, affaire.mode, police["IdCompagnie"], Decimal(1),
                        _conditions(police), totaux["accessoire"], par_voyage=True)
        taux_commission = part["TauxCommission"]
        commission = _arrondi(totaux["prime_nette"] * taux_commission / CENT)
        cursor.execute("CALL sp_numeroter_avenant(%s, %s, NULL, %s)", [ID_AVENANT_CERTIFICAT, ID_INTERMEDIAIRE, ""])
        numero_avenant = cursor.fetchone()[0]
        cursor.execute(
            """
            INSERT INTO stddevis (idoperateur, idoffre, idintermediaire, idcompagnie, idproduit, idclient, idassure,
                idavenant, numeroavenant, numerodevis, flotte, idaperiteur, coassurance, periode, dateemission, dateeffet,
                dateexpiration, confirme, idduree, numeropolicecompagnie, primeimposee, primeannuelle, primenette, accessoire,
                accessoirecompagnie, accessoireintermediaire, taxe, primettc, commissionintermediaire, fga, cedeao)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s, FALSE, %s, %s, %s, %s, FALSE, %s, %s, FALSE,
                    %s, %s, %s, %s, %s, %s, %s, %s, 0, 0)
            RETURNING iddevis
            """,
            [id_utilisateur, id_offre, ID_INTERMEDIAIRE, police["IdCompagnie"], ID_PRODUIT_TRANSPORT, police["IdClient"],
             police["IdAssure"], ID_AVENANT_CERTIFICAT, numero_avenant, police["NumeroDevis"], police["IdCompagnie"], periode,
             date_emission_du_jour(), date_effet, date_expiration, id_duree, police["NumeroPoliceCompagnie"] or None,
             totaux["prime_nette"], totaux["prime_nette"], totaux["accessoire"], part["AccessoireCompagnie"],
             part["AccessoireIntermediaire"], totaux["taxe"], totaux["prime_ttc"], commission],
        )
        id_devis = cursor.fetchone()[0]
        for v in voyages:
            lignes = [{**l, "Prime": Decimal(str(l["Prime"])), "Taxe": Decimal(str(l["Taxe"]))} for l in v.garanties]
            calcul_voyage = {"Lignes": lignes, "PrimeNette": v.prime_nette, "Taxe": v.taxe,
                             "TaxeAccessoire": v.taxe - sum((l["Taxe"] for l in lignes), Decimal(0))}
            _inserer_detail(cursor, id_devis, id_offre, categorie["IdTarif"], v.valeur, v.date_depart, v.marchandise,
                            f"{v.lieu_depart} - {v.lieu_arrivee}", v.moyen_transport, v.document_transport,
                            f"VOYAGE {v.numero}", f"V{v.numero:04d}", calcul_voyage)
        cursor.execute("CALL sp_generation_contrat_transport(%s, %s, %s)", [id_devis, police["NumeroPolice"], ""])
        message = cursor.fetchone()[0]
        contrat = _une_ligne(cursor, "SELECT idcontrat, idquittance FROM stdcontrat WHERE iddevis = %s", [id_devis])
        if not contrat or not contrat[1]:
            raise ErreurSaisie(message or "Le contrat de la ressortie n'a pas été généré.")
        # sp_generation_contrat_transport ne reprend pas la commission du devis : taux et commission du cabinet posés ici
        cursor.execute("UPDATE stdcontrat SET taux_commission = %s, commissionintermediaire = %s WHERE idcontrat = %s",
                       [taux_commission, commission, contrat[0]])
        cursor.execute("UPDATE stdquittance SET taux_commission = %s WHERE idquittance = %s", [taux_commission, contrat[1]])
        VoyageTransport.objects.filter(pk__in=[v.pk for v in voyages]).update(id_devis_ressortie=id_devis)
        quittance = _une_ligne(cursor, "SELECT numeroquittance, primettc FROM stdquittance WHERE idquittance = %s", [contrat[1]])
    return {
        "IdDevis": id_devis, "IdContrat": contrat[0], "IdQuittance": contrat[1], "NumeroQuittance": quittance[0],
        "PrimeTtc": _nombre(quittance[1]), "Voyages": len(voyages), "Mois": debut_mois.strftime("%Y-%m"),
        "NumeroPolice": police["NumeroPolice"],
        "OutputMessage": f"Ressortie de {debut_mois:%m/%Y} émise : {len(voyages)} voyage(s), quittance {quittance[0]}.",
    }


@api_view(["POST"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def emettre_ressortie_vue(request, idcontrat):
    """POST /api/transport/hors-guce/abonnements/<idcontrat>/ressortie/ {Mois: "AAAA-MM"}"""
    try:
        return Response(emettre_ressortie(idcontrat, request.data.get("Mois"), _id_utilisateur(request)),
                        status=status.HTTP_201_CREATED)
    except ErreurSaisie as erreur:
        return Response({"error": str(erreur)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as erreur:  # message de la base (exercice clos, numérotation des quittances…)
        return Response({"error": str(erreur).split("\n")[0]}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def contrat_transport(request, idcontrat):
    """GET /api/transport/hors-guce/contrat/<idcontrat>/ : ce que la fiche du contrat montre d'une affaire hors GUCE
    (police au voyage, annuelle ou d'abonnement, ou ressortie mensuelle d'une police d'abonnement)."""
    with connection.cursor() as cursor:
        ligne = _une_ligne(cursor, "SELECT iddevis FROM stdcontrat WHERE idcontrat = %s AND idproduit = %s",
                           [idcontrat, ID_PRODUIT_TRANSPORT])
    if not ligne:
        return Response({"HorsGuce": False})
    affaire = AffaireTransport.objects.filter(id_devis=ligne[0]).first()
    if affaire:
        saisie = affaire.saisie or {}
        garanties = saisie.get("garanties") or {}
        return Response({
            "HorsGuce": True, "Nature": "POLICE", "TypePolice": affaire.type_police,
            "LibelleTypePolice": PAR_TYPE.get(affaire.type_police, {}).get("Libelle", ""),
            "Mode": affaire.mode, "LibelleMode": _par_mode().get(affaire.mode, {}).get("Libelle", ""),
            "Marchandise": (saisie.get("marchandise") or {}).get("nature", ""),
            "Conditionnement": (saisie.get("marchandise") or {}).get("conditionnement", ""),
            "Depart": (saisie.get("trajet") or {}).get("depart", ""), "Arrivee": (saisie.get("trajet") or {}).get("arrivee", ""),
            "Chargement": (saisie.get("trajet") or {}).get("chargement", ""), "Valeur": saisie.get("valeur") or 0,
            "Garanties": [{"Libelle": _par_garantie().get(g.get("code"), {}).get("Libelle", g.get("code")), "Taux": g.get("taux")}
                          for g in [garanties.get("base") or {}] + (garanties.get("extensions") or []) if g.get("code")],
            "Franchise": saisie.get("franchise", ""),
            "IdContratPolice": idcontrat if affaire.type_police == AffaireTransport.POLICE_ABONNEMENT else None,
        })
    voyages = list(VoyageTransport.objects.filter(id_devis_ressortie=ligne[0]).order_by("numero"))
    if voyages:
        return Response({
            "HorsGuce": True, "Nature": "RESSORTIE", "IdContratPolice": voyages[0].id_contrat,
            "NumeroPolice": voyages[0].numero_police, "Mois": voyages[0].date_depart.strftime("%Y-%m"),
            "Voyages": [_voyage_json(v) for v in voyages],
        })
    return Response({"HorsGuce": False})
