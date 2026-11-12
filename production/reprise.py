"""
Reprise des affaires antérieures (demande du 2026-10-26 : « une session de saisie des affaires antérieures »).

Les contrats des années passées qui ne sont pas dans LE PHARE (papier, Excel, extranets des compagnies, autres
courtiers) sont repris tels qu'ils ont été émis, sans tarif ni confirmation de devis :
- toute année antérieure, toute compagnie, toute branche ; dates d'effet et d'émission avant le 1er janvier de
  l'année en cours (la production de l'année n'est pas touchée), comptées dans les états de leur année ;
- primes du document (prime nette, accessoires, taxes, TTC exacte : pas d'arrondi à 5 F) ;
- quittance encaissée et commission du cabinet perçue : une affaire antérieure est soldée (consigne du 2026-10-27 :
  « toutes les contrats saisis en affaire antérieure sont encaissés donc commission perçue ») ;
- numéro de police OREOLE de l'année d'origine (série des polices de la compagnie), quittance dans une série
  « R » de son exercice (« 1186/2023/R00001 ») : aucun risque de doublon avec les numéros existants ;
- saisie par tout utilisateur habilité (droit contrats.reprise), sans validation ; une reprise erronée se
  supprime tant que rien n'a été fait dessus (encaissement, avenant, sinistre).

Chaque affaire reprise crée un devis confirmé, son détail, le contrat, son détail et la quittance, comme une
confirmation de devis, et une ligne lephare_reprise (données saisies, mode, lot d'import, commission perçue).
"""

import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction

from .reste_encaissement import reste_a_encaisser

ID_INTERMEDIAIRE = 1
ID_AVENANT_AFFAIRE_NOUVELLE = 1
ID_PRODUIT_AUTO = 1
ID_PRODUIT_SANTE = 5
ID_PRODUIT_VIE = 10
ID_OFFRE_NON_SPECIFIEE = 0
SOURCE_REPRISE = 2
STATUT_QUITTANCE_EN_COURS = 1
ECART_TTC_TOLERE = Decimal("2")
PAIEMENTS = {"PAYEE": "Payée", "PARTIELLE": "Partiellement payée", "IMPAYEE": "Impayée"}


def _champ(cle, libelle, type_="texte", **options):
    return {"Cle": cle, "Libelle": libelle, "Type": type_, **options}


# Import Excel : risque de chaque branche (colonnes du modèle contrôlées ici et reprises dans la description du risque).
# Automobile : colonnes du véhicule (stddevisdetail, stdcontratdetail). Types : texte, entier, nombre, montant, date,
# choix (Choix), liste (référentiel Liste). La saisie à l'écran passe par les écrans de devis (reprendre_devis).
RISQUES = {
    1: {"Court": "Auto", "Etape": "Véhicule", "Champs": [
        _champ("Immatriculation", "Immatriculation", Requis=True, Majuscules=True, Max=50),
        _champ("IdMarque", "Marque", "liste", Liste="Marques"),
        _champ("Modele", "Modèle", Max=30),
        _champ("IdGenre", "Genre", "liste", Liste="Genres"),
        _champ("IdEnergie", "Énergie", "liste", Liste="Energies"),
        _champ("Puissance", "Puissance fiscale", "entier", Unite="CV"),
        _champ("Places", "Places", "entier"),
        _champ("ChargeUtile", "Charge utile", "nombre", Unite="t", Aide="Camionnettes et camions."),
        _champ("ValeurNeuve", "Valeur neuve", "montant"),
        _champ("ValeurVenale", "Valeur vénale", "montant"),
        _champ("DateMec", "Mise en circulation", "date"),
        _champ("NumeroChassis", "N° de châssis", Majuscules=True, Max=50),
    ]},
    2: {"Court": "IA", "Etape": "Assurés et capitaux", "Champs": [
        _champ("Assures", "Nombre d'assurés", "entier"),
        _champ("Activite", "Profession ou activité"),
        _champ("CapitalDeces", "Capital décès", "montant"),
        _champ("CapitalInvalidite", "Capital invalidité", "montant"),
        _champ("FraisMedicaux", "Frais médicaux", "montant"),
        _champ("IndemniteJournaliere", "Indemnité journalière", "montant"),
    ]},
    3: {"Court": "Voyage", "Etape": "Voyage", "Champs": [
        _champ("Destination", "Destination"),
        _champ("DateDepart", "Date de départ", "date"),
        _champ("DateRetour", "Date de retour", "date"),
        _champ("Voyageurs", "Nombre de voyageurs", "entier"),
        _champ("Passeport", "N° de passeport", Majuscules=True, Max=30),
    ]},
    4: {"Court": "MRH", "Etape": "Habitation", "Champs": [
        _champ("TypeHabitation", "Type d'habitation", "choix", Choix=["Villa", "Appartement", "Duplex", "Studio", "Immeuble", "Autre"]),
        _champ("Qualite", "Qualité de l'assuré", "choix", Choix=["Propriétaire occupant", "Locataire", "Propriétaire non occupant"]),
        _champ("Situation", "Situation du risque", Aide="Commune, quartier, lot, îlot."),
        _champ("Pieces", "Nombre de pièces", "entier"),
        _champ("ValeurBatiment", "Valeur du bâtiment", "montant"),
        _champ("ValeurContenu", "Valeur du contenu", "montant"),
        _champ("ObjetsValeur", "Objets de valeur", "montant"),
    ]},
    5: {"Court": "Santé", "Etape": "Couvertures et adhérents", "Champs": [
        _champ("TypeContrat", "Type de contrat", "choix", Choix=["Individuel", "Famille", "Groupe"],
               Aide="Groupe : taxe des contrats groupe."),
        _champ("Formule", "Formule ou offre", Aide="Ex. MINENE FAMILLE, Santé classique 80 %."),
        _champ("Adherents", "Nombre d'adhérents", "entier"),
        _champ("Personnes", "Personnes assurées", "entier", Aide="Adhérents compris."),
        _champ("TauxCouverture", "Taux de couverture", "nombre", Unite="%"),
        _champ("Zone", "Zone de couverture", "choix", Choix=["Côte d'Ivoire", "Afrique", "Monde entier"]),
        _champ("Plafond", "Plafond annuel par personne", "montant"),
    ]},
    6: {"Court": "Transport", "Etape": "Marchandise et trajet", "Champs": [
        _champ("Marchandise", "Marchandise"),
        _champ("Mode", "Mode de transport", "choix", Choix=["Maritime", "Aérien", "Terrestre", "Ferroviaire", "Fluvial"]),
        _champ("Depart", "Lieu de départ"),
        _champ("Arrivee", "Lieu d'arrivée"),
        _champ("ValeurAssuree", "Valeur assurée", "montant"),
        _champ("Reference", "Connaissement, LTA ou facture", Max=60),
    ]},
    7: {"Court": "MRP", "Etape": "Établissement", "Champs": [
        _champ("Activite", "Activité"),
        _champ("Situation", "Situation du risque", Aide="Commune, quartier, lot, îlot."),
        _champ("ValeurBatiment", "Valeur du bâtiment", "montant"),
        _champ("ValeurContenu", "Matériel et marchandises", "montant"),
        _champ("ChiffreAffaires", "Chiffre d'affaires", "montant"),
    ]},
    8: {"Court": "RC", "Etape": "Activité et garanties", "Champs": [
        _champ("Activite", "Activité"),
        _champ("Situation", "Lieu d'exercice"),
        _champ("ChiffreAffaires", "Chiffre d'affaires", "montant"),
        _champ("Effectif", "Effectif", "entier"),
        _champ("Plafond", "Plafond de garantie", "montant"),
    ]},
    9: {"Court": "Dommages", "Etape": "Risque assuré", "Champs": [
        _champ("Nature", "Nature du contrat", "choix", Choix=["Caution", "Tous risques chantier", "Tous risques montage",
                                                               "Bris de machine", "Tous risques informatique", "Autre"]),
        _champ("Objet", "Ouvrage, marché ou matériel"),
        _champ("Beneficiaire", "Bénéficiaire"),
        _champ("Capital", "Capital ou montant garanti", "montant"),
        _champ("Situation", "Lieu du risque"),
    ]},
}
RISQUE_PAR_DEFAUT = {"Court": "Autre", "Etape": "Risque assuré", "Champs": []}
# Référentiels des champs « liste » : table, identifiant, libellé
LISTES = {
    "Marques": ("stdmarque", "idmarque", "libellemarque"),
    "Genres": ("stdgenrevehicule", "idgenre", "libellegenre"),
    "Energies": ("stdenergie", "idenergie", "libelle"),
}


def risque_branche(id_produit):
    return RISQUES.get(id_produit, RISQUE_PAR_DEFAUT)


class ErreurReprise(Exception):
    """Reprise refusée : message affiché tel quel."""


def normaliser(texte):
    texte = unicodedata.normalize("NFD", str(texte or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texte).strip().upper()


def montant(valeur, libelle, obligatoire=False):
    texte = str(valeur if valeur is not None else "").replace(" ", "").replace("\xa0", "").replace(" ", "").replace(",", ".")
    if texte in ("", "None"):
        if obligatoire:
            raise ErreurReprise(f"{libelle} : montant obligatoire.")
        return Decimal(0)
    try:
        nombre = Decimal(texte)
    except InvalidOperation as erreur:
        raise ErreurReprise(f"{libelle} : nombre attendu (« {valeur} »).") from erreur
    if nombre < 0:
        raise ErreurReprise(f"{libelle} : montant négatif.")
    return nombre


def jour(valeur, libelle, obligatoire=True):
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    texte = str(valeur or "").strip()[:10]
    if not texte or texte in ("None", "NA"):
        if obligatoire:
            raise ErreurReprise(f"{libelle} : date obligatoire.")
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(texte, fmt).date()
        except ValueError:
            continue
    raise ErreurReprise(f"{libelle} : date illisible (« {valeur} »), jj/mm/aaaa attendu.")


def entier(valeur, libelle, obligatoire=False):
    texte = str(valeur if valeur is not None else "").strip()
    if texte in ("", "None"):
        if obligatoire:
            raise ErreurReprise(f"{libelle} : valeur obligatoire.")
        return None
    try:
        return int(Decimal(texte.replace(" ", "").replace(",", ".")))
    except InvalidOperation as erreur:
        raise ErreurReprise(f"{libelle} : nombre entier attendu (« {valeur} »).") from erreur


def _un(cursor, sql, params=None):
    cursor.execute(sql, params or [])
    ligne = cursor.fetchone()
    return ligne[0] if ligne else None


def _franc(valeur):
    return Decimal(valeur or 0).quantize(Decimal(1))


def _texte_montant(valeur):
    return f"{valeur:,.0f}".replace(",", " ") + " F"


def commission_ht(prime_nette, fga, cedeao, taux):
    """Commission du cabinet : prime HT (prime nette hors FGA et CEDEAO) x taux, à la pièce."""
    return _franc((prime_nette - fga - cedeao) * taux / 100)


def _taux_commission(cursor, id_produit, id_compagnie, date_emission):
    return Decimal(str(_un(cursor, "SELECT public.fn_get_taux_commission(%s, %s, %s)", [id_produit, id_compagnie, date_emission]) or 0))


def _details(cursor, d, id_produit):
    """Champs de l'étape du risque de la branche, contrôlés, et leur affichage ([libellé, valeur] des champs remplis).
    Lus dans d["Details"] (écran) ou à la racine (import Excel)."""
    risque = risque_branche(id_produit)
    source = d.get("Details") if isinstance(d.get("Details"), dict) else {}
    details, morceaux = {}, []
    for champ in risque["Champs"]:
        cle, libelle, type_ = champ["Cle"], champ["Libelle"], champ["Type"]
        brut = source.get(cle, d.get(cle))
        affiche = None
        if type_ in ("entier", "liste"):
            valeur = entier(brut, libelle) or None
        elif type_ in ("nombre", "montant"):
            valeur = montant(brut, libelle) or None
        elif type_ == "date":
            valeur = jour(brut, libelle, obligatoire=False)
        else:
            texte = re.sub(r"\s+", " ", str(brut if brut is not None else "")).strip()
            valeur = (normaliser(texte) if champ.get("Majuscules") else texte)[:champ.get("Max", 150)] or None
        if type_ == "choix" and valeur:
            valeur = {normaliser(c): c for c in champ["Choix"]}.get(normaliser(valeur))
            if not valeur:
                raise ErreurReprise(f"{libelle} : {', '.join(champ['Choix'])}.")
        if type_ == "liste" and valeur:
            table, identifiant, colonne = LISTES[champ["Liste"]]
            affiche = _un(cursor, f"SELECT {colonne} FROM {table} WHERE {identifiant} = %s", [valeur])
            if affiche is None:
                raise ErreurReprise(f"{libelle} n° {valeur} introuvable.")
        if champ.get("Requis") and not valeur:
            raise ErreurReprise(f"{risque['Etape']} : {libelle.lower()} obligatoire.")
        details[cle] = valeur
        if valeur:
            if type_ == "montant":
                affiche = _texte_montant(valeur)
            elif type_ == "date":
                affiche = f"{valeur:%d/%m/%Y}"
            elif type_ in ("entier", "nombre"):
                affiche = f"{valeur:f}".rstrip("0").rstrip(".") if isinstance(valeur, Decimal) else str(valeur)
                affiche = f"{affiche} {champ['Unite']}" if champ.get("Unite") else affiche
            morceaux.append([libelle, str(affiche or valeur).strip()])
    return details, morceaux


def controler(cursor, d):
    """Données d'une affaire (écran ou ligne d'import, clés de l'API) contrôlées et complétées. Lève ErreurReprise."""
    debut_annee = date(date.today().year, 1, 1)
    r = {}
    r["IdClient"] = entier(d.get("IdClient"), "Client", obligatoire=True)
    if not _un(cursor, "SELECT 1 FROM stdclient WHERE idclient = %s", [r["IdClient"]]):
        raise ErreurReprise(f"Client n° {r['IdClient']} introuvable.")
    r["IdCompagnie"] = entier(d.get("IdCompagnie"), "Compagnie", obligatoire=True)
    if not _un(cursor, "SELECT 1 FROM stdcompagnie WHERE idcompagnie = %s", [r["IdCompagnie"]]):
        raise ErreurReprise(f"Compagnie n° {r['IdCompagnie']} introuvable.")
    r["IdProduit"] = entier(d.get("IdProduit"), "Branche", obligatoire=True)
    tarifs = {t: c for t, _, c in _tarifs_produit(cursor, r["IdProduit"])}
    if not tarifs:
        raise ErreurReprise("Branche inconnue ou sans catégorie.")
    r["IdTarif"] = entier(d.get("IdTarif"), "Catégorie") or next(iter(tarifs))
    if r["IdTarif"] not in tarifs:
        raise ErreurReprise("La catégorie choisie n'appartient pas à la branche.")
    r["CodeCategorie"] = tarifs[r["IdTarif"]]

    r["NumeroPoliceCompagnie"] = str(d.get("NumeroPoliceCompagnie") or "").strip()[:50]
    if not r["NumeroPoliceCompagnie"]:
        raise ErreurReprise("Numéro de police de la compagnie obligatoire.")
    r["DateEmission"] = jour(d.get("DateEmission"), "Date d'émission")
    r["DateEffet"] = jour(d.get("DateEffet"), "Date d'effet")
    r["DateExpiration"] = jour(d.get("DateExpiration"), "Date d'échéance")
    if r["DateEffet"] >= debut_annee or r["DateEmission"] >= debut_annee:
        raise ErreurReprise(f"Affaire de l'année en cours : seules les affaires antérieures au 01/01/{debut_annee.year} "
                            "se reprennent ici (les autres se saisissent en devis).")
    if r["DateExpiration"] < r["DateEffet"]:
        raise ErreurReprise("La date d'échéance précède la date d'effet.")
    if r["DateEmission"] > r["DateExpiration"]:
        raise ErreurReprise("La date d'émission suit la date d'échéance.")

    r["PrimeNette"] = montant(d.get("PrimeNette"), "Prime nette", obligatoire=True)
    r["Accessoire"] = montant(d.get("Accessoire"), "Accessoires")
    r["Taxe"] = montant(d.get("Taxe"), "Taxes")
    r["Fga"] = montant(d.get("Fga"), "FGA")
    r["Cedeao"] = montant(d.get("Cedeao"), "CEDEAO")
    somme = r["PrimeNette"] + r["Accessoire"] + r["Taxe"]
    ttc = montant(d.get("PrimeTtc"), "Prime TTC")
    r["PrimeTtc"] = ttc if ttc > 0 else somme
    if abs(r["PrimeTtc"] - somme) > ECART_TTC_TOLERE:
        raise ErreurReprise(f"Prime TTC {r['PrimeTtc']:,.0f} différente de prime nette + accessoires + taxes "
                            f"({somme:,.0f}) : la prime nette comprend le FGA et la CEDEAO.".replace(",", " "))
    if r["PrimeTtc"] <= 0:
        raise ErreurReprise("Prime TTC nulle.")

    if r["Fga"] + r["Cedeao"] > r["PrimeNette"]:
        raise ErreurReprise("FGA et CEDEAO sont compris dans la prime nette : ils ne peuvent pas la dépasser.")
    taux = d.get("TauxCommission")
    r["TauxCommission"] = (montant(taux, "Taux de commission") if str(taux if taux is not None else "").strip() not in ("", "None")
                           else _taux_commission(cursor, r["IdProduit"], r["IdCompagnie"], r["DateEmission"]))
    # Commission sur la prime HT (prime nette hors FGA et CEDEAO), comme trg_fn_lephare_commission_courtier
    commission = d.get("Commission")
    r["Commission"] = (montant(commission, "Commission") if str(commission if commission is not None else "").strip() not in ("", "None")
                       else commission_ht(r["PrimeNette"], r["Fga"], r["Cedeao"], r["TauxCommission"]))
    # Affaire antérieure soldée : quittance encaissée, commission perçue (consigne du 2026-10-27)
    r["CommissionPercue"] = True
    r["StatutPaiement"], r["MontantEncaisse"] = "PAYEE", r["PrimeTtc"]

    # Risque : champs de l'étape de la branche (Automobile : véhicule) et précisions libres
    r["Risque"] = str(d.get("Risque") or "").strip()[:500]
    r["Observation"] = str(d.get("Observation") or "").strip()[:500]
    r["PrimeRc"] = montant(d.get("PrimeRc"), "Prime RC")
    # Affichage : [libellé, valeur] de chaque champ renseigné (fiche de la reprise, fiche contrat)
    r["Details"], r["Affichage"] = _details(cursor, d, r["IdProduit"])
    r["Description"] = " ; ".join(filter(None, [" ; ".join(f"{l} : {v}" for l, v in r["Affichage"]), r["Risque"]]))
    v = r["Details"]
    r["Immatriculation"] = v.get("Immatriculation") or ""
    r["IdMarque"] = v.get("IdMarque") or 0
    r["Modele"] = v.get("Modele") or ""
    r["IdGenre"] = v.get("IdGenre")
    r["Puissance"] = v.get("Puissance") or 0
    r["Places"] = v.get("Places") or (5 if r["IdProduit"] == ID_PRODUIT_AUTO else 0)
    r["IdEnergie"] = v.get("IdEnergie") or 0
    r["ChargeUtile"] = v.get("ChargeUtile") or Decimal(0)
    r["ValeurNeuve"] = v.get("ValeurNeuve") or Decimal(0)
    r["ValeurVenale"] = v.get("ValeurVenale") or Decimal(0)
    r["DateMec"] = v.get("DateMec")
    r["NumeroChassis"] = v.get("NumeroChassis") or ""

    _doublon(cursor, r["IdCompagnie"], r["NumeroPoliceCompagnie"], r["DateEffet"])
    return r


def _doublon(cursor, id_compagnie, police_compagnie, date_effet):
    doublon = _un(cursor, """SELECT numeropolice FROM stdcontrat
                            WHERE idcompagnie = %s AND UPPER(TRIM(COALESCE(numeropolicecompagnie, ''))) = %s
                              AND dateeffet::date = %s AND COALESCE(idcontratannulation, 0) = 0 LIMIT 1""",
                  [id_compagnie, police_compagnie.upper(), date_effet])
    if doublon:
        raise ErreurReprise(f"Déjà dans LE PHARE : police compagnie {police_compagnie} du {date_effet:%d/%m/%Y} "
                            f"(police OREOLE {doublon}).")


def _tarifs_produit(cursor, id_produit):
    cursor.execute("SELECT id_tarif, libelle_tarif, TRIM(code_categorie) FROM public.fn_liste_tarif_produit(%s) ORDER BY 3, 1", [id_produit])
    return cursor.fetchall()


def _numero_police(cursor, r):
    """Numéro de police de la série de la compagnie (sp_generer_numero_police), avec l'année d'émission d'origine."""
    cursor.execute("CALL public.sp_generer_numero_police(%s, %s, %s, %s, %s)",
                   [ID_INTERMEDIAIRE, r["IdCompagnie"], r["CodeCategorie"], "", ""])
    numero = (cursor.fetchone() or [""])[0] or ""
    if len(numero) < 10:
        raise ErreurReprise("Numéro de police non généré (série de la compagnie absente).")
    return _police_annee(numero, r["DateEmission"])


def _police_annee(numero, date_emission):
    """Numéro de police (courtier 4 + catégorie 3 + année 2 + série + clé) avec l'année d'émission d'origine."""
    return numero[:7] + f"{date_emission.year % 100:02d}" + numero[9:]


def _numero_quittance(cursor, id_compagnie, date_effet):
    code = (_un(cursor, "SELECT TRIM(COALESCE(codeintermediaire, '0')) FROM stdintermediairecompagnie "
                        "WHERE idintermediaire = %s AND idcompagnie = %s", [ID_INTERMEDIAIRE, id_compagnie]) or "0")[-4:].rjust(4, "0")
    exercice = date_effet.year
    cursor.execute("SELECT pg_advisory_xact_lock(hashtext('lephare_reprise_quittance'))")
    dernier = _un(cursor, "SELECT MAX(SUBSTRING(numeroquittance FROM '/R([0-9]+)$')::int) FROM stdquittance WHERE numeroquittance LIKE %s",
                  [f"{code}/{exercice}/R%"]) or 0
    return f"{code}/{exercice}/R{dernier + 1:05d}"


def enregistrer(cursor, r, utilisateur, mode="saisie", lot=None):
    """Affaire contrôlée (controler) écrite en base, dans la transaction de l'appelant. Renvoie la reprise créée."""
    cursor.execute("SELECT set_config('lephare.reprise', 'on', true)")  # TTC exacte du document (pas d'arrondi à 5 F)
    duree = (r["DateExpiration"] - r["DateEffet"]).days
    periode = _un(cursor, "SELECT public.fn_calcul_periode_contrat(%s)", [duree])
    id_duree = _un(cursor, "SELECT public.fn_calcul_id_duree_contrat(%s)", [duree])
    part = _un(cursor, "SELECT public.fn_lephare_part_accessoires_cabinet(%s)", [r["IdCompagnie"]])
    acc_cabinet = (r["Accessoire"] * Decimal(str(part)) / 100).quantize(Decimal(1)) if part is not None else Decimal(0)
    acc_compagnie = r["Accessoire"] - acc_cabinet
    police = _numero_police(cursor, r)
    pn = r["PrimeNette"]
    entete = dict(
        idintermediaire=ID_INTERMEDIAIRE, idcompagnie=r["IdCompagnie"], idaperiteur=r["IdCompagnie"], idproduit=r["IdProduit"],
        idclient=r["IdClient"], idassure=r["IdClient"], idavenant=ID_AVENANT_AFFAIRE_NOUVELLE, flotte=False, coassurance=False,
        periode=periode, numeroavenant="0000001", dateemission=r["DateEmission"], dateeffet=r["DateEffet"],
        dateexpiration=r["DateExpiration"], primeannuelle=pn, primenette=pn, accessoire=r["Accessoire"],
        accessoirecompagnie=acc_compagnie, accessoireintermediaire=acc_cabinet, taxe=r["Taxe"], fga=r["Fga"], cedeao=r["Cedeao"],
        primettc=r["PrimeTtc"], commissionintermediaire=r["Commission"], idduree=id_duree, idoperateur=utilisateur.id,
        numeropolicecompagnie=r["NumeroPoliceCompagnie"], primeimposee=True, observation="Reprise affaire antérieure",
    )
    colonnes = list(entete)
    cursor.execute(
        f"INSERT INTO stddevis ({', '.join(colonnes)}, numerodevis, idoffre, confirme, renouvelable, statut, datecreation) "
        f"VALUES ({', '.join(['%s'] * len(colonnes))}, %s, %s, true, true, 'ACTIVE', now()) RETURNING iddevis",
        [entete[c] for c in colonnes] + [police, ID_OFFRE_NON_SPECIFIEE],
    )
    id_devis = cursor.fetchone()[0]
    vehicule = dict(
        idtarif=r["IdTarif"], nombreplace=r["Places"], chargeutile=r["ChargeUtile"], valeurneuve=r["ValeurNeuve"],
        valeurvenale=r["ValeurVenale"], valeuraccessoire=0, matricule=r["Immatriculation"], idmarque=r["IdMarque"],
        puissancefiscale=r["Puissance"], modelevehicule=r["Modele"], datemec=r["DateMec"], primeannuelle=pn, primenette=pn,
        taxeenregistrement=r["Taxe"], fga=r["Fga"], idgenrevehicule=r["IdGenre"], numchassis=r["NumeroChassis"],
    )
    cols_v = list(vehicule)
    cursor.execute(
        f"INSERT INTO stddevisdetail (iddevis, {', '.join(cols_v)}, vehicule, idoffre, essence, primeimposee) "
        f"VALUES (%s, {', '.join(['%s'] * len(cols_v))}, 1, %s, %s, true) RETURNING iddevisdetail",
        [id_devis] + [vehicule[c] for c in cols_v] + [ID_OFFRE_NON_SPECIFIEE, r["IdEnergie"]],
    )
    cursor.execute(
        f"INSERT INTO stdcontrat ({', '.join(colonnes)}, iddevis, numeropolice, renouvelable, taux_commission) "
        f"VALUES ({', '.join(['%s'] * len(colonnes))}, %s, %s, true, %s) RETURNING idcontrat",
        [entete[c] for c in colonnes] + [id_devis, police, r["TauxCommission"]],
    )
    id_contrat = cursor.fetchone()[0]
    cursor.execute(
        f"INSERT INTO stdcontratdetail (idcontrat, idproduit, idassure, {', '.join(cols_v)}, idoffre, codecarburant, extincteur, "
        f"sexe, attestation, mt_delegation) VALUES (%s, %s, %s, {', '.join(['%s'] * len(cols_v))}, %s, %s, false, 'M', '', 0)",
        [id_contrat, r["IdProduit"], r["IdClient"]] + [vehicule[c] for c in cols_v]
        + [ID_OFFRE_NON_SPECIFIEE, str(r["IdEnergie"] or "")],
    )
    id_quittance, quittance = _creer_quittance(cursor, id_contrat, r["MontantEncaisse"])
    donnees = _serialisable(r)
    cursor.execute(
        """INSERT INTO lephare_reprise (idcontrat, iddevis, idquittance, mode, lot, donnees, commission_percue, creepar,
                                        idutilisateur, datecreation)
           VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, now()) RETURNING id""",
        [id_contrat, id_devis, id_quittance, mode, lot, _json(donnees), r["CommissionPercue"],
         (getattr(utilisateur, "email", "") or "")[:150], utilisateur.id],
    )
    id_reprise = cursor.fetchone()[0]
    cursor.execute("SELECT set_config('lephare.reprise', 'off', true)")
    return {"Id": id_reprise, "IdContrat": id_contrat, "NumeroPolice": police, "NumeroQuittance": quittance}


def _creer_quittance(cursor, id_contrat, montant_encaisse):
    """Quittance du contrat repris, dans la série « R » de son exercice (année d'effet), encaissée ; détail
    par garantie comme sp_generation_quittance (contrats repris d'un devis). Renvoie (idquittance, numéro)."""
    cursor.execute("""SELECT idcompagnie, dateeffet::date, primettc FROM stdcontrat WHERE idcontrat = %s""", [id_contrat])
    id_compagnie, date_effet, ttc = cursor.fetchone()
    numero = _numero_quittance(cursor, id_compagnie, date_effet)
    cursor.execute(
        """INSERT INTO stdquittance (numeroquittance, idintermediaire, idclient, nature, dateeffet, dateexpiration, exercice, source,
                                     statut, primenette, taxe, accessoire, commission, primettc, encaissee, mt_encaisse, reglee, mt_regle,
                                     numeropolice, idaperiteur, coassurance, idproduit, taux_commission, dateemission, idquittannul)
           SELECT %s, idintermediaire, idclient, 'C', dateeffet, dateexpiration, %s, %s, %s, primenette, taxe, accessoire, 0, primettc,
                  %s, %s, false, 0, numeropolice, idaperiteur, COALESCE(coassurance, false), idproduit, taux_commission, dateemission, NULL
           FROM stdcontrat WHERE idcontrat = %s
           RETURNING idquittance""",
        [numero, date_effet.year, SOURCE_REPRISE, STATUT_QUITTANCE_EN_COURS, reste_a_encaisser(ttc, montant_encaisse) == 0, montant_encaisse,
         id_contrat],
    )
    id_quittance = cursor.fetchone()[0]
    cursor.execute(
        """INSERT INTO stddetquittance (idquittance, idbranchereassurance, tauxtaxe, tauxcommission, primenette, taxe, commission)
           SELECT %s, sg.idgarantie, t.tauxtaxe, cm.tauxcommission, SUM(g.primenette), SUM(g.primenette) * t.tauxtaxe / 100,
                  SUM(g.primenette) * cm.tauxcommission / 100
           FROM stdcontrat c
           JOIN stdcontratdetail d ON d.idcontrat = c.idcontrat
           JOIN stdcontratdetgarantie g ON g.idcontratdetail = d.idcontratdetail
           JOIN stdsousgarantie sg ON sg.idsousgarantie = g.idgarantie
           JOIN stdtauxtaxegarantieproduit t ON t.idgarantie = g.idgarantie AND c.dateeffet::date BETWEEN t.debutvalidite AND t.finvalidite
           JOIN stdcommissionproduitcompagnie cm ON cm.idproduit = t.idproduit AND cm.idproduit = c.idproduit
                AND c.dateeffet::date BETWEEN cm.debutvalidite AND cm.finvalidite
           WHERE c.idcontrat = %s
           GROUP BY sg.idgarantie, t.tauxtaxe, cm.tauxcommission
           HAVING SUM(g.primenette) <> 0""",
        [id_quittance, id_contrat],
    )
    cursor.execute("UPDATE stdcontrat SET idquittance = %s WHERE idcontrat = %s", [id_quittance, id_contrat])
    return id_quittance, numero


# ------------------------------------------------------------------ reprise d'un devis (écrans de la vue Production)
SQL_DEVIS = """
    SELECT d.iddevis, d.numerodevis, d.idproduit, p.libelleproduit AS branche, d.idcompagnie, co.raisonsociale AS compagnie,
           d.idclient, TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client, d.dateemission::date AS dateemission,
           d.dateeffet::date AS dateeffet, d.dateexpiration::date AS dateexpiration, d.primenette, d.accessoire, d.taxe, d.fga,
           d.cedeao, d.primettc, TRIM(COALESCE(d.numeropolicecompagnie, '')) AS numeropolicecompagnie, COALESCE(d.confirme, false) AS confirme,
           COALESCE(d.archive, false) AS archive, a.codeavenant, COALESCE(d.flotte, false) AS flotte, d.datecreation, d.idoperateur
    FROM stddevis d
    JOIN stdavenant a ON a.idavenant = d.idavenant
    LEFT JOIN stdproduit p ON p.idproduit = d.idproduit
    LEFT JOIN stdcompagnie co ON co.idcompagnie = d.idcompagnie
    LEFT JOIN stdclient cl ON cl.idclient = d.idclient
"""
# Devis saisis pour une reprise (marqués dans lephare_reprise_devis), ni confirmés ni archivés
CONDITION_A_FINALISER = """d.iddevis IN (SELECT iddevis FROM lephare_reprise_devis) AND NOT COALESCE(d.confirme, false)
    AND NOT COALESCE(d.archive, false)"""


def _lignes_dict(cursor, sql, params=None):
    cursor.execute(sql, params or [])
    colonnes = [c[0] for c in cursor.description]
    return [dict(zip(colonnes, l)) for l in cursor.fetchall()]


def description_devis(cursor, id_devis, id_produit):
    """Risque d'un devis repris, [libellé, valeur] : véhicules (Automobile), offres, objets assurés, familles (Santé)."""
    lignes = _lignes_dict(cursor, """
        SELECT TRIM(COALESCE(dd.matricule, '')) AS matricule, m.libellemarque AS marque, TRIM(COALESCE(dd.modelevehicule, '')) AS modele,
               dd.puissancefiscale, TRIM(COALESCE(o.libelleoffre, '')) AS offre, TRIM(COALESCE(t.libelle, '')) AS categorie
        FROM stddevisdetail dd
        LEFT JOIN stdmarque m ON m.idmarque = dd.idmarque
        LEFT JOIN stdoffre o ON o.idoffre = dd.idoffre
        LEFT JOIN stdtarif t ON t.idtarif = dd.idtarif
        WHERE dd.iddevis = %s ORDER BY dd.iddevisdetail""", [id_devis])
    affichage = []
    categories = sorted({l["categorie"] for l in lignes if l["categorie"]})
    if categories:
        affichage.append(["Catégorie", ", ".join(categories)])
    offres = sorted({l["offre"] for l in lignes if l["offre"]})
    if offres:
        affichage.append(["Offre", ", ".join(offres)])
    if id_produit == ID_PRODUIT_AUTO:
        for l in lignes[:10]:
            vehicule = " ".join(filter(None, [l["marque"], l["modele"]]))
            puissance = f"{l['puissancefiscale']} CV" if l["puissancefiscale"] else ""
            affichage.append(["Véhicule", ", ".join(filter(None, [l["matricule"], vehicule, puissance]))])
        if len(lignes) > 10:
            affichage.append(["Autres véhicules", str(len(lignes) - 10)])
    elif id_produit == ID_PRODUIT_SANTE:
        familles = _un(cursor, "SELECT COUNT(*) FROM stdadherent WHERE iddevis = %s", [id_devis]) or 0
        personnes = _un(cursor, "SELECT COUNT(*) FROM stdaffilie f JOIN stdadherent a ON a.idadherent = f.idadherent WHERE a.iddevis = %s",
                        [id_devis]) or 0
        if familles:
            affichage.append(["Familles", str(familles)])
        if personnes:
            affichage.append(["Personnes assurées", str(personnes)])
    elif id_produit == ID_PRODUIT_VIE:
        # Vie : offre commerciale du devis et assurés (une ligne par assuré), ou salariés d'un état de cotisations
        from .vie_offres import SAISIE_COTISATION, offre_du_devis

        offre = offre_du_devis(cursor, id_devis)
        affichage.append(["Offre", offre["Libelle"]])
        if offre["Saisie"] == SAISIE_COTISATION:
            salaries = _un(cursor, "SELECT COUNT(*) FROM lephare_vie_cotisant WHERE iddevis = %s", [id_devis]) or 0
            affichage.append(["Salariés", str(salaries)])
        elif lignes:
            affichage.append(["Assurés", str(len(lignes))])
    elif len(lignes) > 1:
        affichage.append(["Objets assurés", str(len(lignes))])
    return affichage


def devis_reprise(cursor, id_devis):
    """Devis à finaliser en affaire antérieure, contrôlé : affaire nouvelle ni confirmée ni archivée, effet avant le
    1er janvier de l'année en cours."""
    lignes = _lignes_dict(cursor, SQL_DEVIS + " WHERE d.iddevis = %s", [id_devis])
    if not lignes:
        raise ErreurReprise("Devis introuvable.")
    v = lignes[0]
    debut_annee = date(date.today().year, 1, 1)
    if v["confirme"]:
        raise ErreurReprise(f"Devis {v['numerodevis']} déjà confirmé en contrat.")
    if v["archive"]:
        raise ErreurReprise(f"Devis {v['numerodevis']} archivé.")
    if v["codeavenant"] != "AFN":
        raise ErreurReprise("Seule une affaire nouvelle se reprend comme affaire antérieure.")
    if not v["dateeffet"] or v["dateeffet"] >= debut_annee:
        raise ErreurReprise(f"Date d'effet du devis {v['dateeffet']:%d/%m/%Y} : une affaire antérieure prend effet avant le "
                            f"01/01/{debut_annee.year}. Modifiez la date d'effet du devis.")
    if not v["primettc"] or Decimal(v["primettc"]) <= 0:
        raise ErreurReprise("Prime TTC du devis nulle.")
    if not v["idclient"]:
        raise ErreurReprise("Devis sans client : ouvrez le devis (Modifier) et choisissez le client.")
    return v


def devis_a_finaliser(cursor):
    return _lignes_dict(cursor, SQL_DEVIS + f" WHERE {CONDITION_A_FINALISER} ORDER BY d.iddevis DESC")


def marquer_devis(id_devis, utilisateur):
    """Devis enregistré en mode reprise : contrôlé (devis_reprise) et noté en attente de finalisation."""
    with connection.cursor() as cursor:
        v = devis_reprise(cursor, id_devis)
        cursor.execute("""INSERT INTO lephare_reprise_devis (iddevis, creepar, idutilisateur, datecreation)
                          VALUES (%s, %s, %s, now()) ON CONFLICT (iddevis) DO NOTHING""",
                       [id_devis, (getattr(utilisateur, "email", "") or "")[:150], utilisateur.id])
    return v


def reprendre_devis(id_devis, d, utilisateur):
    """Devis saisi dans les écrans de la vue Production (mêmes tables, barèmes et garanties) confirmé en affaire antérieure :
    sp_confirmation_devis (contrat, objets assurés, garanties) avec la date d'émission d'origine, police de l'année
    d'origine, quittance encaissée dans la série « R » de son exercice, commission perçue."""
    from .database import verifier_categorie_police

    debut_annee = date(date.today().year, 1, 1)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM stddevis WHERE iddevis = %s FOR UPDATE", [id_devis])
        v = devis_reprise(cursor, id_devis)
        emission = jour(d.get("DateEmission"), "Date d'émission", obligatoire=False) or (
            v["dateemission"] if v["dateemission"] and v["dateemission"] < debut_annee else v["dateeffet"])
        if emission >= debut_annee:
            raise ErreurReprise(f"Date d'émission : avant le 01/01/{debut_annee.year}.")
        if v["dateexpiration"] and emission > v["dateexpiration"]:
            raise ErreurReprise("La date d'émission suit la date d'échéance.")
        police_compagnie = str(d.get("NumeroPoliceCompagnie") or v["numeropolicecompagnie"] or "").strip()[:50]
        if not police_compagnie:
            raise ErreurReprise("Numéro de police de la compagnie obligatoire.")
        _doublon(cursor, v["idcompagnie"], police_compagnie, v["dateeffet"])
        ttc = Decimal(v["primettc"])
        ttc_document = montant(d.get("TtcDocument"), "Prime TTC de la quittance")
        if ttc_document and abs(ttc_document - ttc) > ECART_TTC_TOLERE:
            raise ErreurReprise(f"Prime TTC du devis {ttc:,.0f} différente de celle de la quittance ({ttc_document:,.0f}) : "
                                "imposez la prime dans le devis (Modifier) pour retrouver le document.".replace(",", " "))
        # Affaire antérieure soldée : quittance encaissée, commission perçue (consigne du 2026-10-27)
        statut, encaisse, commission_percue = "PAYEE", ttc, True
        observation = str(d.get("Observation") or "").strip()[:500]

        cursor.execute("UPDATE stddevis SET dateemission = %s, numeropolicecompagnie = %s WHERE iddevis = %s",
                       [emission, police_compagnie, id_devis])
        # Pas de quittance de la séquence de l'année (sp_generation_quittance v2) ni d'arrondi de la TTC
        cursor.execute("SELECT set_config('lephare.reprise', 'on', true)")
        verifier_categorie_police(cursor, id_devis)
        cursor.execute("CALL sp_confirmation_devis(%s, %s, %s)", [id_devis, 0, ""])
        id_contrat = int((cursor.fetchone() or [0])[0] or 0)
        if not id_contrat:
            raise ErreurReprise("Le devis n'a pas pu être confirmé.")
        police = _police_annee(_un(cursor, "SELECT numeropolice FROM stdcontrat WHERE idcontrat = %s", [id_contrat]), emission)
        cursor.execute("""UPDATE stdcontrat SET numeropolice = %s, observation = 'Reprise affaire antérieure',
                                 piece_jointe_id = (SELECT piece_jointe_id FROM stddevis WHERE iddevis = %s)
                          WHERE idcontrat = %s""", [police, id_devis, id_contrat])
        id_quittance, quittance = _creer_quittance(cursor, id_contrat, encaisse)
        affichage = description_devis(cursor, id_devis, v["idproduit"])
        donnees = _serialisable({
            "IdDevis": id_devis, "NumeroDevis": v["numerodevis"], "NumeroPoliceCompagnie": police_compagnie, "DateEmission": emission,
            "StatutPaiement": statut, "MontantEncaisse": encaisse, "CommissionPercue": commission_percue, "Observation": observation,
            "Affichage": affichage, "Description": " ; ".join(f"{l} : {val}" for l, val in affichage),
        })
        cursor.execute(
            """INSERT INTO lephare_reprise (idcontrat, iddevis, idquittance, mode, lot, donnees, commission_percue,
                                            date_commission_percue, creepar, idutilisateur, datecreation)
               VALUES (%s, %s, %s, 'devis', NULL, %s::jsonb, %s, NULL, %s, %s, now()) RETURNING id""",
            [id_contrat, id_devis, id_quittance, _json(donnees), commission_percue,
             (getattr(utilisateur, "email", "") or "")[:150], utilisateur.id],
        )
        id_reprise = cursor.fetchone()[0]
        cursor.execute("SELECT set_config('lephare.reprise', 'off', true)")
    return {"Id": id_reprise, "IdContrat": id_contrat, "NumeroPolice": police, "NumeroQuittance": quittance}


def _json(valeur):
    import json
    return json.dumps(valeur, ensure_ascii=False)


def _serialisable(valeur):
    """Données contrôlées (dates, montants, détails du risque) en JSON : dates ISO, montants en texte."""
    if isinstance(valeur, dict):
        return {k: _serialisable(v) for k, v in valeur.items()}
    if isinstance(valeur, (date, datetime)):
        return valeur.isoformat()[:10]
    if isinstance(valeur, Decimal):
        return str(valeur)
    return valeur


def reprendre(donnees, utilisateur, mode="saisie", lot=None):
    """Contrôle et enregistrement d'une affaire, en une transaction."""
    with transaction.atomic(), connection.cursor() as cursor:
        return enregistrer(cursor, controler(cursor, donnees), utilisateur, mode, lot)


# Tables rattachées aux objets assurés d'un contrat (copiées du devis par sp_confirmation_devis)
COMPLEMENTS_CONTRAT = ("stdcomplementcontratdetailauto", "stdcomplementcontratdetaildommage", "stdcomplementcontratdetailmrh",
                       "stdcomplementcontratdetailrc", "stdcomplementcontratdetailsante", "stdcomplementcontratdetailvoyage",
                       "stdcontratdetgarantie")


def supprimer(id_reprise, utilisateur, peut_tout_supprimer):
    """Reprise erronée retirée (contrat, quittance, solde du client) tant que rien n'a été fait dessus. Saisie ou import :
    le devis créé par la reprise est supprimé ; reprise d'un devis des écrans de la vue Production : le devis revient en
    attente, à corriger (Modifier) puis à finaliser de nouveau."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("""SELECT r.idcontrat, r.iddevis, r.idquittance, r.idutilisateur, r.mode, c.numeropolice,
                                 c.numeropolicecompagnie, c.idclient, q.numeroquittance, q.primettc, q.mt_encaisse
                          FROM lephare_reprise r JOIN stdcontrat c ON c.idcontrat = r.idcontrat
                          JOIN stdquittance q ON q.idquittance = r.idquittance WHERE r.id = %s FOR UPDATE OF r""", [id_reprise])
        ligne = cursor.fetchone()
        if not ligne:
            raise ErreurReprise("Reprise introuvable.")
        (id_contrat, id_devis, id_quittance, auteur, mode, police, police_cie, id_client, numero_quittance, ttc, encaisse) = ligne
        if auteur != utilisateur.id and not peut_tout_supprimer:
            raise ErreurReprise("Seul l'auteur de la reprise (ou un utilisateur habilité à annuler les contrats) peut la supprimer.")
        if _un(cursor, "SELECT 1 FROM stddetailencaissement WHERE numeroquittance = %s LIMIT 1", [numero_quittance]):
            raise ErreurReprise("Un encaissement a été fait sur cette quittance : annulez-le d'abord.")
        if _un(cursor, "SELECT 1 FROM stdcontrat WHERE idoldhist = %s LIMIT 1", [id_contrat]):
            raise ErreurReprise("Un avenant ou un renouvellement a été établi sur ce contrat.")
        if _un(cursor, "SELECT 1 FROM institutionnel_sinistredelegue WHERE police_num IN (%s, %s) LIMIT 1", [police, police_cie or police]):
            raise ErreurReprise("Un sinistre est déclaré sur ce contrat.")
        reste = Decimal(str(ttc or 0)) - Decimal(str(encaisse or 0))
        cursor.execute("DELETE FROM lephare_reprise WHERE id = %s", [id_reprise])
        cursor.execute("UPDATE stdcontrat SET idquittance = NULL WHERE idcontrat = %s", [id_contrat])
        cursor.execute("DELETE FROM stddetquittance WHERE idquittance = %s", [id_quittance])
        cursor.execute("DELETE FROM stdquittance WHERE idquittance = %s", [id_quittance])
        for table in COMPLEMENTS_CONTRAT:
            cursor.execute(f"DELETE FROM {table} WHERE idcontratdetail IN (SELECT idcontratdetail FROM stdcontratdetail "
                           "WHERE idcontrat = %s)", [id_contrat])
        cursor.execute("DELETE FROM stdcontratdetail WHERE idcontrat = %s", [id_contrat])
        cursor.execute("DELETE FROM stdcontrat WHERE idcontrat = %s", [id_contrat])
        if mode == "devis":
            cursor.execute("UPDATE stddevis SET confirme = false WHERE iddevis = %s", [id_devis])
        else:
            cursor.execute("DELETE FROM stddevisdetail WHERE iddevis = %s", [id_devis])
            cursor.execute("DELETE FROM stddevis WHERE iddevis = %s", [id_devis])
        if reste:
            cursor.execute("UPDATE stdclient SET solde = COALESCE(solde, 0) - %s WHERE idclient = %s", [reste, id_client])
        return {"NumeroPolice": police, "NumeroQuittance": numero_quittance}
