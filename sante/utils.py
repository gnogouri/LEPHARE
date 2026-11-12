import os
import re
import unicodedata
from collections import OrderedDict
from datetime import date, datetime
from decimal import Decimal
from itertools import chain

from django.conf import settings
from django.db import DatabaseError, connection, transaction
from openpyxl import load_workbook

from core.date_parser import date_emission_du_jour
from core.utils import convert_to_date
from production.models import ComplementDevisDetailSante, DataInsertionResult, DevisDetail
from production.reste_encaissement import reste_a_encaisser

from .avenant import detail_avenant_modification

from .models import (
    Adherent,
    AdherentSanteInsertionResult,
    Affilie,
    AffilieFn,
    AffilieSanteInsertionResult,
    FilialeSanteInsertionResult,
    SaisieDevisSanteEnCours,
)
from .serializers import (
    AdherentSanteInsertionSerializer,
    AffilieSanteInsertionSerializer,
)

importation_col_list = [
    "Nom",
    "Prenom",
    "NumeroCNI",
    "DateNaissance",
    "NumeroCMU",
    "Sexe",
    "NumeroTelephone",
    "Lien",
    "DateDebutConso",
    "DateAdhesion",
    "AdresseAdherent",
    "EmailAdherent",
    "NombreAffections",
    "LibelleAffections",
    "Matricule",
]


def message_erreur_base(error):
    """
    Message d'une erreur de procédure à afficher : certaines procédures Santé lèvent un
    texte de plusieurs lignes commençant par « Got exception: », dont la vraie cause est
    sur la ligne « message: ». Sinon, la première ligne.
    """
    lignes = str(error).splitlines() or [""]
    for ligne in lignes:
        ligne = ligne.strip()
        if ligne.startswith("message:"):
            return ligne[len("message:"):].strip()
    return lignes[0]


def remove_unwanted_keys(data):
    for key in data.keys():
        if key not in importation_col_list:
            del data[key]

    return data


def load_people_data_from_excel(filename, index=0):
    dict_list = []
    # Les indices des lignes et des colonnes commencent par 1
    book = load_workbook(filename, data_only=True, keep_vba=False)
    sheet = book.worksheets[index]

    entetes = [
        str(sheet.cell(row=1, column=col_index).value or "")
        for col_index in range(1, sheet.max_column + 1)
    ]
    colonnes_classique = {
        re.sub(
            r"[^a-z0-9]",
            "",
            unicodedata.normalize("NFKD", entete)
            .encode("ascii", "ignore")
            .decode("ascii")
            .lower(),
        ): col_index
        for col_index, entete in enumerate(entetes, start=1)
    }
    colonnes_requises_classique = {
        "numerodecarte",
        "nom",
        "prenom",
        "datedenaissance",
        "sexe",
        "numerocmu",
        "filiation",
        "datedentree",
    }
    if colonnes_requises_classique.issubset(colonnes_classique):
        for row_index in range(2, sheet.max_row + 1):
            valeurs = {
                nom: sheet.cell(row=row_index, column=colonne).value
                for nom, colonne in colonnes_classique.items()
            }
            nom = str(valeurs["nom"] or "").strip()
            prenom = str(valeurs["prenom"] or "").strip()
            naissance = valeurs["datedenaissance"]

            if not nom and not prenom and not naissance:
                continue
            if (
                re.fullmatch(r"x+", nom, re.IGNORECASE)
                and re.fullmatch(r"x+", prenom, re.IGNORECASE)
                and re.fullmatch(r"x+/x+/x+", str(naissance or ""), re.IGNORECASE)
            ):
                continue

            def valeur(cle):
                cellule = valeurs.get(cle)
                if cellule is None:
                    return "NA"
                if isinstance(cellule, datetime):
                    return cellule.date().isoformat()
                if isinstance(cellule, float) and cellule.is_integer():
                    return str(int(cellule))
                return str(cellule).strip() or "NA"

            # La filiale choisie porte le collège ; les primes sont recalculées à l'enregistrement.
            # Le modèle ne fournit pas de date de début de consommation distincte.
            filiation = valeur("filiation").upper()
            dict_list.append({
                "nom": nom or "NA",
                "prenoms": prenom or "NA",
                "numerocni": "NA",
                "datenaissance": valeur("datedenaissance"),
                "numerocmu": valeur("numerocmu"),
                "sexe": valeur("sexe").upper(),
                "numerotelephone": "NA",
                "lienparente": filiation if filiation != "NA" else "A",
                "dateeffet": "NA",
                "dateentree": valeur("datedentree"),
                "adresseadherent": "NA",
                "emailadherent": "NA",
                "nombreaffection": "0",
                "matricule": valeur("numerodecarte"),
                "groupesanguin": "NS",
                "_ligne": row_index,
            })
        return dict_list

    # Lecture de la ligne d'entête
    column_count = sheet.max_column

    keys = [
        str(sheet.cell(row=1, column=col_index).value).lower()
        for col_index in range(1, column_count + 1)
    ]

    # Read other lines from the second one
    row_count = sheet.max_row

    for row_index in range(2, row_count + 1):
        # empty = all(isinstance(cell, EmptyCell) for cell in row)
        d = OrderedDict(
            {
                keys[col_index - 1]: (
                    "NA"
                    if str(sheet.cell(row_index, col_index).value) == "None"
                    else str(sheet.cell(row_index, col_index).value).strip()
                )
                for col_index in range(1, column_count + 1)
            }
        )

        # Ignore blank lines
        if (d["nom"] in ("NA", "N/A", "N-A")) and (
            d["datenaissance"] in ("NA", "N/A", "N-A")
        ):
            continue

        # Remove unwanted data, especially blank colums
        # d = remove_unwanted_keys(d)

        # Ligne du fichier, pour le compte rendu de l'import
        d["_ligne"] = row_index

        # Keep only the date not the time
        d["datenaissance"] = d["datenaissance"][:10]
        d["dateeffet"] = d["dateeffet"][:10]
        d["dateentree"] = d["dateentree"][:10]

        dict_list.append(d)
    return dict_list


# Import insured people from Excel File
def import_insured(filename, user_id, id_devis, date_effet, id_filiale, derogation_age=False, details=None, lignes=None):
    """Adhérents et affiliés d'un fichier Excel. date_effet : date d'effet du devis à l'écran, à laquelle s'apprécie
    l'âge ; derogation_age : limites d'âge levées (utilisateur habilité).
    details (liste) reçoit le compte rendu de chaque ligne : {Ligne, Nom, Lien, Statut (importé, dérogation, refusé,
    ignoré), Message} ; lignes : personnes déjà lues dans le fichier (load_people_data_from_excel)."""
    messages = []
    error_count = 0

    def rendre_compte(item, statut, message):
        if details is not None:
            details.append({
                "Ligne": item.get("_ligne"),
                "Nom": " ".join(str(item.get(c, "")).strip() for c in ("nom", "prenoms") if str(item.get(c, "")).strip() not in ("", "NA")),
                "Lien": str(item.get("lienparente", "")).strip(),
                "Statut": statut,
                "Message": message,
            })

    try:
        request_data_list = lignes if lignes is not None else load_people_data_from_excel(
            filename=filename, index=0
        )

        if request_data_list is None or len(request_data_list) == 0:
            error_count += 1
            messages.append(
                {
                    "code_erreur": "-1",
                    "message": "Le fichier Excel ne contient pas de données valides",
                }
            )
            return (error_count, messages)

        # Parcourir les lignes extraites du fichier Excel en vue d'enregistrer les données
        id_adherent = 0
        id_devis = int(id_devis)
        id_filiale = int(id_filiale)
        # filiale_sante = FilialeSante.objects.filter(Q(devis=id_devis)).first()
        # if filiale_sante:
        #     filiale = filiale_sante.idfiliale

        for item in request_data_list:
            current_request_data = {}
            err = False
            qryset = None
            if str(item["lienparente"]).strip() == "A":
                current_request_data["idadherent"] = 0
            else:
                if id_adherent == -1:
                    rendre_compte(item, "ignoré", "Adhérent de la famille refusé : affilié non importé.")
                    continue
                current_request_data["idaffilie"] = 0
                current_request_data["adherent"] = id_adherent
                current_request_data["handicape"] = False

            current_request_data["lien"] = str(item["lienparente"]).strip()
            current_request_data["filiale"] = id_filiale
            current_request_data["nom"] = str(item["nom"]).strip()
            current_request_data["prenom"] = str(item["prenoms"]).strip()
            current_request_data["sexe"] = str(item["sexe"]).strip()
            current_request_data["cni"] = str(item["numerocni"]).strip()
            current_request_data["vip"] = True
            current_request_data["adresse"] = str(
                item["adresseadherent"]
            ).strip()
            current_request_data["mobile1"] = str(
                item["numerotelephone"]
            ).strip()
            current_request_data["mobile2"] = ""
            current_request_data["email"] = str(item["emailadherent"]).strip()
            current_request_data["numerocmu"] = str(item["numerocmu"]).strip()
            current_request_data["devis"] = id_devis
            current_request_data["dateeffet"] = str(
                item["dateentree"]
            )  # Ce choix n'est pas intuitif
            current_request_data["datedebutconsommation"] = str(
                item["dateeffet"]
            )
            current_request_data["datenaissance"] = str(item["datenaissance"])
            current_request_data["matricule"] = str(item["matricule"]).strip()
            # Surprime de la personne (import Santé classique : colonne SURPRIME), conservée sur sa fiche
            surprime = Decimal(str(item.get("montantsurprime") or 0))
            current_request_data["surprimeappliquee"] = surprime > 0
            current_request_data["montantsurprime"] = surprime
            current_request_data["nombrepathologie"] = 0
            item["nombreaffection"] = str(item["nombreaffection"]).strip()
            if item["nombreaffection"].isdigit():
                current_request_data["nombrepathologie"] = int(
                    item["nombreaffection"]
                )

            current_request_data["groupesanguin"] = item["groupesanguin"]

            if current_request_data["lien"] == "A":
                (err, qryset) = enregistrer_adherent_sante(
                    user_id, current_request_data, derogation_age=derogation_age, date_reference=date_effet
                )
                message = AdherentSanteInsertionSerializer(
                    qryset, many=True
                ).data
                if not err:
                    id_adherent = message[0]["idadherent"]
                else:
                    id_adherent = -1
            else:
                (err, qryset) = enregistrer_affilie_sante(
                    user_id, current_request_data, derogation_age=derogation_age, date_reference=date_effet
                )
                message = AffilieSanteInsertionSerializer(
                    qryset, many=True
                ).data
            # Implementation future
            # (err, qryset) = enregistrer_adherent_sante(user_id, fichier_piece, request.POST)
            if err:
                error_count += 1
            texte = (message[0].get("outputmessage") if message else "") or ""
            rendre_compte(item, "refusé" if err else ("dérogation" if "Dérogation" in texte else "importé"), texte)

            messages.append(message)

    except Exception as error:
        print(error)
        message = {
            "statut": "-1000",
            "message": str(error),
        }
        error_count += 1
        messages.append(message)

    return (error_count, messages)


# Save quotation Santé
def save_quotation_sante(user_id, input_data):
    sql_output = None
    error_occurred = False
    parametres = parametres_creation_devis_sante(user_id, input_data)
    IdDevis = parametres[24]
    TauxReductionCommerciale = parametres[18]

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(SQL_CREATION_DEVIS_SANTE, parametres)
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occurred = True
        print(error)
        msg = message_erreur_base(error)
        sql_output = DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()

    # Patch ORM : force la mise à jour de taux_reduction_commerciale après fermeture du curseur raw.
    # Le SP peut ignorer ce champ lorsque le complément existe déjà (ex. renouvellement),
    # donc on s'assure que la valeur envoyée est bien persistée.
    if not error_occurred and sql_output and sql_output.ObjectId and TauxReductionCommerciale != Decimal("0"):
        try:
            det_ids = list(
                DevisDetail.objects.filter(iddevis=sql_output.ObjectId).values_list(
                    "iddevisdetail", flat=True
                )
            )
            if det_ids:
                ComplementDevisDetailSante.objects.filter(
                    devis_detail__in=det_ids
                ).update(taux_reduction_commerciale=TauxReductionCommerciale)
        except Exception as patch_error:
            print(f"ORM patch taux_reduction_commerciale: {patch_error}")

    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


SQL_CREATION_DEVIS_SANTE = "CALL sp_creation_devis_sante(" + ", ".join(["%s"] * 26) + ");"


def parametres_creation_devis_sante(user_id, input_data):
    """Paramètres de sp_creation_devis_sante (ordre de la procédure) depuis les données de l'écran."""
    IdIntermediaire = int(input_data["IdIntermediaire"])
    IdCompagnie = int(input_data["IdCompagnie"])
    IdProduit = int(input_data["IdProduit"])
    IdOffre = int(input_data["IdOffre"])
    IdAvenant = int(input_data["IdAvenant"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])
    Coassurance = bool(input_data["Coassurance"])
    # convert_to_date
    DateEffet = convert_to_date(input_data["DateEffet"])
    DateExpiration = convert_to_date(input_data["DateExpiration"])
    DateEmission = convert_to_date(input_data["DateEmission"])
    # DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    # DateExpiration = datetime.strptime(input_data["DateExpiration"], "%d-%m-%Y").date()
    # DateEmission = datetime.strptime(input_data["DateEmission"], "%d-%m-%Y").date()
    IdTarif = int(input_data["IdTarif"])
    IdDuree = 1
    if "IdDuree" in input_data:
        if input_data["IdDuree"]:
            IdDuree = int(input_data["IdDuree"])
    (
        PrimeFamille,
        PrimeAffilie,
        PrimeGlobale,
        MontantSurprime,
        MontantAccessoireManuel,
        TauxReductionCommerciale,
        TypeContrat,
        GestionnaireSante,
    ) = (
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        "",
    )
    if "PrimeFamille" in input_data:
        if input_data["PrimeFamille"]:
            PrimeFamille = Decimal(input_data["PrimeFamille"])
    if "PrimeAffilie" in input_data:
        if input_data["PrimeAffilie"]:
            PrimeAffilie = Decimal(input_data["PrimeAffilie"])
    if "PrimeGlobale" in input_data:
        if input_data["PrimeGlobale"]:
            PrimeGlobale = Decimal(input_data["PrimeGlobale"])
    if "MontantSuprime" in input_data:
        if input_data["MontantSuprime"]:
            MontantSurprime = Decimal(input_data["MontantSuprime"])
    if "MontantAccessoireManuel" in input_data:
        if input_data["MontantAccessoireManuel"]:
            MontantAccessoireManuel = Decimal(
                input_data["MontantAccessoireManuel"]
            )
    # Lecture du taux d'ajustement envoyé par le frontend sous le nom "TauxReduction"
    # Convention : positif = réduction, négatif = majoration
    TauxReduction = Decimal("0")
    if "TauxReduction" in input_data and input_data["TauxReduction"] not in (None, "", 0, "0"):
        TauxReduction = Decimal(str(input_data["TauxReduction"]))
    elif "TauxReductionCommerciale" in input_data and input_data["TauxReductionCommerciale"] not in (None, "", 0, "0"):
        TauxReduction = Decimal(str(input_data["TauxReductionCommerciale"]))

    # Valeur transmise à la procédure stockée : signée (positif=réduction, négatif=majoration)
    # Le SP applique : prime * (1 - taux/100) → fonctionne pour réduction ET majoration
    TauxReductionCommerciale = TauxReduction

    if "TypeContrat" in input_data:
        if input_data["TypeContrat"]:
            TypeContrat = int(input_data["TypeContrat"])
    if "GestionnaireSante" in input_data:
        if input_data["GestionnaireSante"]:
            GestionnaireSante = str(input_data["GestionnaireSante"])
    IdDevis = int(input_data["IdDevis"])

    NumeroPoliceCompagnie = ""
    if "NumeroPoliceCompagnie" in input_data:
        NumeroPoliceCompagnie = (
            str(input_data["NumeroPoliceCompagnie"])
            if input_data["NumeroPoliceCompagnie"]
            else ""
        )

    return (
        IdIntermediaire, IdCompagnie, IdProduit, IdOffre, IdAvenant, IdClient, IdAssure, Flotte, Coassurance,
        DateEffet, DateExpiration, DateEmission, IdTarif, PrimeFamille, PrimeAffilie, PrimeGlobale, MontantSurprime,
        MontantAccessoireManuel, TauxReductionCommerciale, TypeContrat, GestionnaireSante, IdDuree,
        NumeroPoliceCompagnie, user_id, IdDevis, "",
    )


# Formules MINENE (limite d'âge des adultes : sp_saisie_adherent_sante, sp_saisie_affilie_sante)
OFFRES_MINENE = (17, 18, 19, 20, 21, 22, 175, 176, 181)


def _decimal(valeur):
    return Decimal(str(valeur or 0))


def _familles_minene(cursor, parametres, par_operateur=True):
    """Détail par famille d'un devis MINENE, avec les fonctions de la base et les règles de sp_creation_devis_sante (v8) :
    formule de la couverture de la famille, prime de base du barème (ou prime saisie), surprime d'âge (adhérent et
    conjoint, âge à la date d'effet), surprime d'affection (ou surprime saisie, répartie entre les familles), taux
    d'ajustement de l'an dernier (renouvellement) puis de l'année, accessoire du barème de la famille.
    Montants « Avant » : avant l'ajustement de l'année ; Ajustement : réduction (négative) ou majoration (positive)
    de la famille, différence entre sa prime Santé et sa prime Santé avant ajustement. par_operateur : seulement les
    adhérents saisis par l'utilisateur (écran en saisie) ; False pour relire un devis enregistré (bordereau)."""
    (_, _, _, id_offre, id_avenant, _, _, _, _, date_effet, _, _, _, prime_famille, prime_affilie, prime_globale,
     montant_surprime, accessoire_manuel, taux, _, _, _, _, user_id, id_devis, _) = parametres
    prime_famille, prime_affilie, prime_globale = _decimal(prime_famille), _decimal(prime_affilie), _decimal(prime_globale)
    montant_surprime, taux = _decimal(montant_surprime), _decimal(taux)
    cursor.execute("SELECT codeavenant FROM stdavenant WHERE idavenant = %s", [id_avenant])
    code_avenant = (cursor.fetchone() or [""])[0]
    # Taux de l'an dernier (renouvellement) et date des âges : avenant de modification tarifé comme le contrat de la période
    # (sp_creation_devis_sante v9 : âges à sa date d'effet, taux de l'an dernier si ce contrat est un renouvellement)
    devis_taux_precedent, applique_prev, date_age = id_devis, code_avenant == "REN", date_effet
    if code_avenant == "MOD":
        cursor.execute(
            """SELECT b.iddevis, a.codeavenant, b.dateeffet::date FROM stddevis d JOIN stddevis b ON b.iddevis = d.idoldhist
               JOIN stdavenant a ON a.idavenant = b.idavenant WHERE d.iddevis = %s""", [id_devis])
        ligne_base = cursor.fetchone()
        if ligne_base:
            devis_taux_precedent, applique_prev, date_age = ligne_base[0], ligne_base[1] == "REN", ligne_base[2]
    cursor.execute(
        f"""
        SELECT AD.idadherent, TRIM(COALESCE(AD.nom, '') || ' ' || COALESCE(AD.prenom, '')) AS adherent,
               CASE WHEN F.idoffresante = ANY(%(minene)s) THEN F.idoffresante ELSE %(offre)s END AS idoffre,
               AF.idaffilie, AF.lien, TRIM(COALESCE(AF.nom, '') || ' ' || COALESCE(AF.prenom, '')) AS personne,
               EXTRACT(YEAR FROM AGE(%(effet)s, AF.datenaissance))::int AS age, COALESCE(AF.nombrepathologie, 0) AS pathologies,
               CASE WHEN COALESCE(AF.surprimeappliquee, FALSE) THEN COALESCE(AF.montantsurprime, 0) ELSE 0 END AS imposee
        FROM stdadherent AS AD
        JOIN stdaffilie AS AF ON AF.idadherent = AD.idadherent AND AF.iddevis = AD.iddevis
        LEFT JOIN stdfiliale AS F ON F.idfiliale = AD.idfiliale
        WHERE AD.iddevis = %(devis)s {"AND AD.idoperateur = %(user)s" if par_operateur else ""}
        ORDER BY AD.idadherent, CASE AF.lien WHEN 'A' THEN 0 WHEN 'C' THEN 1 ELSE 2 END, AF.idaffilie
        """,
        {"minene": list(OFFRES_MINENE), "offre": id_offre, "effet": date_age, "devis": id_devis, "user": user_id},
    )
    lignes = cursor.fetchall()
    if not lignes:
        return []
    prev = Decimal(0)
    if applique_prev:
        cursor.execute(
            """SELECT COALESCE(C.tauxreductioncommerciale, 0) FROM stddevis SD
               JOIN stddevisdetail DD ON DD.iddevis = SD.idoldhist
               JOIN stdcomplementdevisdetailsante C ON C.iddevisdetail = DD.iddevisdetail
               WHERE SD.iddevis = %s LIMIT 1""", [devis_taux_precedent])
        prev = _decimal((cursor.fetchone() or [0])[0])
    familles = {}
    for idadherent, adherent, idoffre, idaffilie, lien, personne, age, pathologies, imposee in lignes:
        f = familles.setdefault(idadherent, {"IdAdherent": idadherent, "Adherent": adherent, "IdOffre": idoffre, "Personnes": []})
        f["Personnes"].append({"IdAffilie": idaffilie, "Lien": lien, "Nom": personne, "Age": age, "Pathologies": pathologies,
                               "Imposee": _decimal(imposee)})
    nombre = len(familles)
    sans_prime = prime_famille == 0 and prime_affilie == 0 and prime_globale == 0
    facteur_prev = (1 - prev / 100) if applique_prev else Decimal(1)
    # Taux de l'année : positif = réduction, négatif = majoration (convention URANUS)
    facteur = 1 - taux / 100
    resultat = []
    for f in familles.values():
        cursor.execute("SELECT o.libelleoffre, fn_get_prime_base_minene_sante(o.idoffre) FROM stdoffre o WHERE o.idoffre = %s", [f["IdOffre"]])
        libelle, base_bareme = cursor.fetchone() or ("", 0)
        if prime_globale > 0:
            base_avant = prime_globale / nombre
        else:
            base_avant = _decimal(base_bareme) * facteur_prev if sans_prime else (prime_famille if prime_famille > 0 else prime_affilie)
        base = base_avant * facteur
        age_avant = affection_avant = Decimal(0)
        for p in f["Personnes"]:
            s_age = s_affection = Decimal(0)
            # Surprime imposée (case cochée et montant) : remplace la surprime calculée de la personne, sans le taux de l'an dernier
            if prime_globale == 0 and p["Imposee"] > 0:
                s_affection_imposee = p["Imposee"]
            else:
                s_affection_imposee = Decimal(0)
            if prime_globale == 0 and not s_affection_imposee:
                cursor.execute(
                    "SELECT CASE WHEN %s IN ('A', 'C') THEN fn_get_surprime_age_minene_sante(%s, %s) ELSE 0 END, "
                    "CASE WHEN %s > 0 THEN 0 ELSE fn_get_surprime_affection_minene_sante(%s, %s) END",
                    [p["Lien"], f["IdOffre"], p["Age"], montant_surprime, f["IdOffre"], p["Pathologies"]],
                )
                brut_age, brut_affection = cursor.fetchone()
                s_age = _decimal(brut_age) * facteur_prev
                s_affection = _decimal(brut_affection) * facteur_prev
            s_affection += s_affection_imposee
            p.update({"SurprimeAge": round(float(s_age * facteur)), "SurprimeAffection": round(float(s_affection * facteur)),
                      "SurprimeAgeAvant": round(float(s_age)), "SurprimeAffectionAvant": round(float(s_affection)),
                      "SurprimeImposee": bool(s_affection_imposee)})
            age_avant += s_age
            affection_avant += s_affection
        saisie_avant = montant_surprime / nombre
        prime_sante_avant = base_avant + age_avant + affection_avant + saisie_avant
        prime_sante = prime_sante_avant * facteur
        cursor.execute("SELECT accessoire_compagnie, taxe_sur_accessoire FROM fn_get_accessoire_sante_minene(%s, %s, %s, 1)",
                       [f["IdOffre"], round(prime_sante), accessoire_manuel])
        accessoire, taxe_accessoire = cursor.fetchone() or (0, 0)
        resultat.append({
            "IdAdherent": f["IdAdherent"], "Adherent": f["Adherent"], "IdOffre": f["IdOffre"], "Formule": libelle,
            "NombrePersonnes": len(f["Personnes"]), "PrimeBase": round(float(base)), "SurprimeAge": round(float(age_avant * facteur)),
            "SurprimeAffection": round(float(affection_avant * facteur)), "SurprimeSaisie": round(float(saisie_avant * facteur)),
            "PrimeSante": round(float(prime_sante)), "Accessoire": float(accessoire or 0), "TaxeAccessoire": float(taxe_accessoire or 0),
            "PrimeBaseAvant": round(float(base_avant)), "SurprimeAgeAvant": round(float(age_avant)),
            "SurprimeAffectionAvant": round(float(affection_avant)), "SurprimeSaisieAvant": round(float(saisie_avant)),
            "PrimeSanteAvant": round(float(prime_sante_avant)),
            "Ajustement": round(float(prime_sante)) - round(float(prime_sante_avant)), "TauxAjustement": float(-taux),
            "Personnes": f["Personnes"],
        })
    return resultat


FILIATIONS = {"A": "ASSURÉ PRINCIPAL", "C": "CONJOINT", "E": "ENFANT"}


def bordereau_primes_sante(id_devis, periode=None):
    """Bordereau récapitulatif des primes par assuré d'un devis Santé enregistré (ou du devis d'un contrat), sur le
    modèle de l'état des assurés de la compagnie : une ligne par personne (carte, filiation, formule, identité, date
    d'entrée, prime de base, surprimes, réduction ou majoration de l'année, prime nette), puis le récapitulatif
    (effectifs, prime nette avant ajustement, ajustement, prime nette, accessoires, taxes, prime TTC).
    MINENE : calcul par famille de sp_creation_devis_sante (prime de base de la famille sur l'assuré principal,
    surprimes sur chaque personne, ajustement réparti au prorata). Autres offres : prime par famille sur l'assuré
    principal, par affilié sur chacun, prime globale au récapitulatif seulement ; surprime de chaque personne.
    periode (production.periode_contrat) : documents d'un contrat à jour des avenants de sa période (demande du
    2026-11-02) ; id_devis est alors le devis des familles en vigueur (incorporations comprises), les primes et les
    encaissements sont ceux de la période (contrat et avenants), et non ceux d'un avenant."""
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT d.idavenant, d.dateeffet::date, dd.idoffre, COALESCE(c.primefamille, 0), COALESCE(c.primeaffilie, 0),
                      COALESCE(c.primeglobale, 0), COALESCE(c.montantsurprime, 0), COALESCE(c.montantaccessoiremanuel, 0),
                      COALESCE(c.tauxreductioncommerciale, 0), d.primenette, d.accessoire, d.taxe, COALESCE(d.accessoiregestionnaire, 0),
                      d.primettc, d.numerodevis, d.dateexpiration::date
               FROM stddevis d
               JOIN stddevisdetail dd ON dd.iddevis = d.iddevis
               LEFT JOIN stdcomplementdevisdetailsante c ON c.iddevisdetail = dd.iddevisdetail
               WHERE d.iddevis = %s ORDER BY dd.iddevisdetail LIMIT 1""", [id_devis])
        ligne = cursor.fetchone()
        if not ligne:
            return None
        (id_avenant, effet, id_offre, prime_famille, prime_affilie, prime_globale, montant_surprime, accessoire_manuel, taux,
         pn, acc, taxe, frais, ttc, numero, expiration) = ligne
        # Période d'un contrat : ses dates et ses primes (contrat et avenants), le devis ne donnant que les familles
        debut_etat, fin_etat = effet, expiration
        if periode:
            t = periode["Totaux"]
            pn, acc, taxe, frais, ttc = t["PrimeNette"], t["Accessoire"], t["TaxeEnregistrement"], t["FraisGestionMinene"], t["PrimeTtc"]
            debut_etat, fin_etat = date.fromisoformat(periode["DateEffet"]), date.fromisoformat(periode["DateExpiration"])
        cursor.execute(
            """SELECT AF.idaffilie, AF.idadherent, TRIM(COALESCE(AF.lien, '')), AF.nom, AF.prenom, AF.datenaissance::date,
                      AF.sexe, NULLIF(TRIM(COALESCE(AF.matricule, '')), 'NA'), NULLIF(TRIM(COALESCE(AF.numerocmu, '')), 'NA'),
                      AF.dateadhesion::date, COALESCE(AF.montantsurprime, 0), F.idoffresante, O.libelleoffre, SF.option
               FROM stdaffilie AF
               JOIN stdadherent AD ON AD.idadherent = AF.idadherent AND AD.iddevis = AF.iddevis
               LEFT JOIN stdfiliale F ON F.idfiliale = AD.idfiliale
               LEFT JOIN stdoffre O ON O.idoffre = F.idoffresante
               LEFT JOIN lephare_sante_formule SF ON SF.idoffre = F.idoffresante
               WHERE AF.iddevis = %s
               ORDER BY AD.idadherent, CASE AF.lien WHEN 'A' THEN 0 WHEN 'C' THEN 1 ELSE 2 END, AF.idaffilie""", [id_devis])
        personnes = cursor.fetchall()
        minene = id_offre in OFFRES_MINENE or any(p[11] in OFFRES_MINENE for p in personnes)
        familles = {}
        if minene:
            parametres = (None, None, None, id_offre, id_avenant, None, None, None, None, effet, None, None, None, prime_famille,
                          prime_affilie, prime_globale, montant_surprime, accessoire_manuel, taux, None, None, None, None, None,
                          id_devis, None)
            familles = {f["IdAdherent"]: f for f in _familles_minene(cursor, parametres, par_operateur=False)}
    facteur = 1 - _decimal(taux) / 100 if minene else Decimal(1)
    lignes, deja = [], set()
    for (idaffilie, idadherent, lien, nom, prenom, naissance, sexe, carte, cmu, entree, surprime_personne, offre, libelle,
         option) in personnes:
        principal = idadherent not in deja
        deja.add(idadherent)
        base = age = affection = Decimal(0)
        if minene and idadherent in familles:
            f = familles[idadherent]
            p = next((x for x in f["Personnes"] if x["IdAffilie"] == idaffilie), {})
            base = Decimal(f["PrimeBaseAvant"]) if principal else Decimal(0)
            age = Decimal(p.get("SurprimeAgeAvant", 0))
            affection = Decimal(p.get("SurprimeAffectionAvant", 0)) + (Decimal(f["SurprimeSaisieAvant"]) if principal else Decimal(0))
        elif not minene:
            if _decimal(prime_famille) > 0:
                base = _decimal(prime_famille) if principal else Decimal(0)
            elif _decimal(prime_affilie) > 0:
                base = _decimal(prime_affilie)
            affection = _decimal(surprime_personne)
        brut = base + age + affection
        lignes.append({
            "Numero": len(lignes) + 1, "IdAdherent": idadherent, "Carte": carte or "", "Filiation": FILIATIONS.get(lien, lien),
            "Lien": lien, "Formule": option or libelle or "", "LibelleOffre": libelle or "", "Nom": nom or "", "Prenoms": prenom or "",
            "DateNaissance": naissance.isoformat() if naissance else None, "Sexe": sexe or "", "NumeroCmu": cmu or "",
            "DateEntree": entree.isoformat() if entree else None, "PrimeBase": round(float(base)), "SurprimeAge": round(float(age)),
            "SurprimeAffection": round(float(affection)), "Ajustement": round(float(brut * facteur - brut)),
            "PrimeNette": 0,
        })
    # Ajustement de chaque famille réparti sur ses personnes, l'écart d'arrondi sur l'assuré principal
    for id_adherent, f in familles.items():
        membres = [l for l in lignes if l["IdAdherent"] == id_adherent]
        if membres:
            membres[0]["Ajustement"] += f["Ajustement"] - sum(l["Ajustement"] for l in membres)
    for l in lignes:
        l["PrimeNette"] = l["PrimeBase"] + l["SurprimeAge"] + l["SurprimeAffection"] + l["Ajustement"]
    ajustement = sum(l["Ajustement"] for l in lignes)
    total_lignes = sum(l["PrimeNette"] for l in lignes)
    global_saisi = not minene and _decimal(prime_globale) > 0
    # Détail recalculé avec les règles en vigueur ; écart avec la prime enregistrée (devis tarifé avec d'anciennes
    # règles, contrat émis) signalé au lieu d'être réparti
    # Avenant de modification : les lignes sont la nouvelle composition, comparée à sa prime annuelle ; les montants de
    # l'avenant (écart au prorata, accessoire, taxes) sont rendus à part
    with connection.cursor() as cursor:
        avenant = None if periode else detail_avenant_modification(cursor, id_devis)
    reference = avenant["PrimeAnnuelle"] if avenant else float(pn or 0)
    ecart = round(reference) - total_lignes if (minene or not global_saisi) and lignes else 0
    if avenant:
        avenant.update({"PrimeNette": float(pn or 0), "Accessoire": float(acc or 0), "Taxe": float(taxe or 0),
                        "FraisGestion": float(frais or 0), "PrimeTtc": float(ttc or 0)})
    # État des cotisations MINENE (modèle d'OREOLE) : TTC Santé répartie par famille si le détail retrouve la prime
    etat = None
    if minene and familles and lignes and not avenant:
        with connection.cursor() as cursor:
            etat = _etat_cotisations(cursor, id_devis, familles, lignes, debut_etat, fin_etat, float(ttc or 0),
                                     conforme=abs(ecart) <= len(lignes), periode=periode)
    return {
        "NumeroDevis": numero or "", "Minene": minene, "PrimeGlobale": global_saisi,
        "TauxAjustement": float(-_decimal(taux)) if minene else 0.0, "Lignes": lignes,
        "Recap": {
            "Effectif": len(lignes), "AssuresPrincipaux": sum(1 for l in lignes if l["Lien"] == "A"),
            "Conjoints": sum(1 for l in lignes if l["Lien"] == "C"), "Enfants": sum(1 for l in lignes if l["Lien"] == "E"),
            "PrimeNetteAvantAjustement": float(total_lignes - ajustement), "Ajustement": ajustement, "TotalLignes": total_lignes,
            "PrimeNette": reference, "Ecart": ecart if abs(ecart) > len(lignes) else 0,
            "Accessoire": 0.0 if avenant else float(acc or 0), "Taxe": 0.0 if avenant else float(taxe or 0),
            "FraisGestion": 0.0 if avenant else float(frais or 0), "PrimeTtc": 0.0 if avenant else float(ttc or 0),
        },
        "Avenant": avenant,
        "Etat": etat,
    }


def _etat_cotisations(cursor, id_devis, familles, lignes, effet, expiration, ttc_enregistree, conforme, periode=None):
    """État des cotisations MINENE Santé d'un devis ou d'un contrat, au modèle d'OREOLE (« ETATS DES COTISATIONS MINENE
    SANTE », demande du 2026-10-27) : un bloc par famille (souscripteur = adhérent, assurés et dates de naissance,
    option, effectif, période, prime de base, surprimes pour pathologie, d'âge et pour enfants supplémentaires, puis la
    réduction ou la majoration de l'année, colonne ajoutée au modèle, prime nette totale, primes TTC Santé, IA et RC chef
    de famille, prime totale TTC), puis l'encaissement, sa nature, le solde et le statut du contrat.
    TTC Santé d'une famille : prime TTC enregistrée répartie au prorata de sa prime nette et de son accessoire, quand le
    détail retrouve la prime enregistrée (conforme) ou pour un contrat émis (le solde suit ce qui a été facturé) ; sinon
    taxe de la base appliquée au détail recalculé (devis à réenregistrer). IA et RC : forfait MINENE par adhérent
    (production.minene_connexes.forfait_adherent).
    periode : contrat de base de la période (statut), quittances et encaissements du contrat et de ses avenants."""
    from production.minene_connexes import _devis_lies, forfait_adherent

    blocs = []
    for id_adherent, f in familles.items():
        membres = [l for l in lignes if l["IdAdherent"] == id_adherent]
        if not membres:
            continue
        base, age = f["PrimeBaseAvant"], f["SurprimeAgeAvant"]
        pathologie = f["SurprimeAffectionAvant"] + f["SurprimeSaisieAvant"]
        blocs.append({
            "IdAdherent": id_adherent, "Souscripteur": f["Adherent"], "Option": membres[0]["Formule"],
            "Assures": [{"Nom": f"{l['Nom']} {l['Prenoms']}".strip(), "DateNaissance": l["DateNaissance"]} for l in membres],
            "Effectif": len(membres), "PrimeBase": base, "SurprimePathologie": pathologie, "SurprimeAge": age,
            # Aucune surprime pour enfant supplémentaire au barème MINENE (taille des formules) : colonne du modèle à 0
            "SurprimeEnfants": 0, "Ajustement": f["Ajustement"], "PrimeNette": base + pathologie + age + f["Ajustement"],
            "Accessoire": f["Accessoire"],
        })
    # Contrat issu du devis (période : contrat de base) : statut, quittances Santé, IA et RC de la police, encaissements
    cursor.execute(f"""SELECT c.idcontrat, c.numeropolice, c.dateeffet, COALESCE(c.idcontratannulation, 0),
                              q.numeroquittance, COALESCE(q.mt_encaisse, 0)
                       FROM stdcontrat c LEFT JOIN stdquittance q ON q.idquittance = c.idquittance
                       WHERE {"c.idcontrat" if periode else "c.iddevis"} = %s ORDER BY c.idcontrat DESC LIMIT 1""",
                   [periode["IdContratBase"] if periode else id_devis])
    contrat = cursor.fetchone()
    # Prime TTC Santé de chaque famille
    cursor.execute("""SELECT d.idcompagnie, d.idproduit, dd.idoffre FROM stddevis d JOIN stddevisdetail dd ON dd.iddevis = d.iddevis
                      WHERE d.iddevis = %s ORDER BY dd.iddevisdetail LIMIT 1""", [id_devis])
    id_compagnie, id_produit, id_offre = cursor.fetchone()
    assiettes = [b["PrimeNette"] + b["Accessoire"] for b in blocs]
    if ttc_enregistree and sum(assiettes) > 0 and (conforme or contrat):
        reste = round(ttc_enregistree)
        for i, b in enumerate(blocs):
            b["PrimeTtcSante"] = reste if i == len(blocs) - 1 else round(ttc_enregistree * assiettes[i] / sum(assiettes))
            reste -= b["PrimeTtcSante"]
    else:
        cursor.execute("SELECT fn_get_taux_taxe(%s, %s, %s, %s)", [id_compagnie, id_produit, id_offre, effet])
        taux_taxe = float(cursor.fetchone()[0] or 0)
        for b, assiette in zip(blocs, assiettes):
            b["PrimeTtcSante"] = round(assiette * (1 + taux_taxe / 100))
    # IA et RC chef de famille : forfait par adhérent (MINENE : trois assurances indissociables)
    forfaits = {produit: forfait_adherent(cursor, produit, effet)[1]["PrimeTtc"] for produit in ("ia", "rc")}
    for b in blocs:
        b["PrimeTtcIa"], b["PrimeTtcRc"] = forfaits["ia"], forfaits["rc"]
        b["PrimeTotaleTtc"] = b["PrimeTtcSante"] + b["PrimeTtcIa"] + b["PrimeTtcRc"]

    resultat = {"Annee": effet.year if effet else None, "DateEffet": effet.isoformat() if effet else None,
                "DateExpiration": expiration.isoformat() if expiration else None, "Familles": blocs,
                "Contrat": None, "Encaissement": None, "Nature": "", "Solde": None,
                "Statut": "Devis non confirmé", "PolicesIa": [], "PolicesRc": []}
    total = sum(b["PrimeTotaleTtc"] for b in blocs)
    if not contrat:
        resultat["Solde"] = total
        return resultat
    id_contrat, police, debut, annule, quittance_sante, encaisse_sante = contrat
    lies = _devis_lies(cursor, police)
    contrats_lies = [l for cle in ("IA", "RC") for l in lies[cle] if l["IdContrat"]]
    resultat["PolicesIa"] = [l["NumeroPolice"] for l in lies["IA"] if l["IdContrat"]]
    resultat["PolicesRc"] = [l["NumeroPolice"] for l in lies["RC"] if l["IdContrat"]]
    quittances, encaisse = [quittance_sante] if quittance_sante else [], float(encaisse_sante or 0)
    if periode:
        quittances, encaisse = list(periode["Quittances"]), float(periode["Encaisse"])
    if contrats_lies:
        cursor.execute("""SELECT q.numeroquittance, COALESCE(q.mt_encaisse, 0) FROM stdcontrat c
                          JOIN stdquittance q ON q.idquittance = c.idquittance WHERE c.idcontrat = ANY(%s)""",
                       [[l["IdContrat"] for l in contrats_lies]])
        for numero_quittance, montant_encaisse in cursor.fetchall():
            quittances.append(numero_quittance)
            encaisse += float(montant_encaisse or 0)
    # Nature : mode et date de chaque encaissement (« Espèces du 15/04/2024 »)
    cursor.execute("""SELECT DISTINCT e.dateencaissement::date, INITCAP(TRIM(COALESCE(m.libellemodepaiement, '')))
                      FROM stddetailencaissement de JOIN stdencaissement e ON e.idencaissement = de.idencaissement
                      LEFT JOIN stdmodeencaissement m ON m.idmodeencaissement = e.idmodepaiement
                      WHERE de.numeroquittance = ANY(%s) AND NOT COALESCE(e.piece_annulee, FALSE)
                      ORDER BY 1""", [quittances])
    resultat["Nature"] = " / ".join(f"{mode or 'Encaissement'} du {jour:%d/%m/%Y}" for jour, mode in cursor.fetchall())
    # Statut comme le portefeuille des contrats : annulé, résilié, renouvelé (année du renouvellement), échu, en cours
    cursor.execute("""SELECT a.codeavenant, MIN(EXTRACT(YEAR FROM c.dateeffet))::int FROM stdcontrat c
                      JOIN stdavenant a ON a.idavenant = c.idavenant
                      WHERE TRIM(c.numeropolice) = TRIM(%s) AND COALESCE(c.idcontratannulation, 0) = 0 AND c.dateeffet > %s
                        AND a.codeavenant IN ('REN', 'RES') GROUP BY 1""", [police, debut])
    suivants = dict(cursor.fetchall())
    if annule:
        statut = "Contrat annulé"
    elif "RES" in suivants:
        statut = "Contrat résilié"
    elif "REN" in suivants:
        statut = f"Contrat renouvelé en {suivants['REN']}"
    elif expiration and expiration < date.today():
        statut = "Contrat échu"
    else:
        statut = "Contrat en cours"
    # Solde : un reliquat de moins de 5 F compte comme nul
    resultat.update({"Contrat": police, "Encaissement": encaisse, "Solde": float(reste_a_encaisser(total, encaisse)),
                     "Statut": statut})
    return resultat


def apercu_devis_sante(user_id, input_data):
    """Primes du devis en saisie calculées par sp_creation_devis_sante sans rien enregistrer (point de sauvegarde
    annulé : ni numéro de devis ni montant écrit), avec le détail par famille des devis MINENE. Renvoie
    (message d'erreur de la base, données)."""
    parametres = parametres_creation_devis_sante(user_id, input_data)
    id_devis = parametres[24]
    with transaction.atomic():
        point = transaction.savepoint()
        try:
            with connection.cursor() as cursor:
                cursor.execute(SQL_CREATION_DEVIS_SANTE, parametres)
                cursor.execute(
                    """SELECT primenette, accessoire, taxe, primettc, COALESCE(accessoiregestionnaire, 0),
                              commissionintermediaire, COALESCE(primeimposee, false)
                       FROM stddevis WHERE iddevis = %s""", [id_devis])
                pn, acc, taxe, ttc, frais, commission, imposee = cursor.fetchone()
                cursor.execute(
                    """SELECT g.idgarantie, s.libellesousgarantie, g.primenette, g.taxe
                       FROM stddevisdetgarantie g JOIN stddevisdetail d ON d.iddevisdetail = g.iddevisdet
                       LEFT JOIN stdsousgarantie s ON s.idsousgarantie = g.idgarantie
                       WHERE d.iddevis = %s AND g.primenette <> 0 ORDER BY g.idgarantie""", [id_devis])
                garanties = [{"IdGarantie": g, "Libelle": lib, "PrimeNette": float(n or 0), "Taxe": float(t or 0)}
                             for g, lib, n, t in cursor.fetchall()]
                familles = _familles_minene(cursor, parametres) if int(parametres[3]) in OFFRES_MINENE else []
                # Avenant de modification : primes annuelles (nouvelle et précédente composition) et prorata appliqué
                avenant = detail_avenant_modification(cursor, id_devis)
        except DatabaseError as error:
            transaction.savepoint_rollback(point)
            return message_erreur_base(error), None
        transaction.savepoint_rollback(point)
    ajustement = sum(f["Ajustement"] for f in familles)
    return "", {
        "Totaux": {"PrimeNette": float(pn or 0), "Accessoire": float(acc or 0), "Taxe": float(taxe or 0),
                   "FraisGestion": float(frais or 0), "PrimeTtc": float(ttc or 0), "Commission": float(commission or 0),
                   "PrimeImposee": bool(imposee), "Ajustement": float(ajustement),
                   "TauxAjustement": familles[0]["TauxAjustement"] if familles else 0.0,
                   "PrimeNetteAvantAjustement": float(pn or 0) - float(ajustement)},
        "Garanties": garanties,
        "Familles": familles,
        "Avenant": avenant,
    }


def _date_iso(valeur):
    """Date AAAA-MM-JJ d'une date saisie, ou '' si absente ou illisible."""
    if valeur in (None, "", "NA", "N/A", "N-A"):
        return ""
    try:
        return convert_to_date(valeur).isoformat()
    except (TypeError, ValueError):
        return ""


def _poser_derogation_age(cursor, derogation_age, date_reference=None):
    """Lues par les procédures de saisie Santé, posées pour l'appel puis retirées : dérogation aux limites d'âge
    (utilisateur habilité, droit devis.derogation_age : lephare.derogation_age) et date d'effet du devis saisie à
    l'écran, à laquelle s'apprécie l'âge (lephare.date_effet_age ; à défaut, celle de la couverture)."""
    cursor.execute(
        "SELECT set_config('lephare.derogation_age', %s, false), set_config('lephare.date_effet_age', %s, false);",
        ["on" if derogation_age else "", _date_iso(date_reference)],
    )


def assures_hors_limites_age(id_devis, date_effet):
    """Assurés d'un devis Santé au-delà des limites d'âge des conditions à la date d'effet, mêmes règles que la
    saisie : adhérent et conjoint MINENE (69 ans), enfant (21 ans, 25 avec certificat). [(nom, âge, limite)]."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT fn_lephare_parametre_nombre('sante.minene.age_max_adulte', 69)::int,"
            " fn_lephare_parametre_nombre('sante.minene.age_max_enfant', 21)::int,"
            " fn_lephare_parametre_nombre('sante.minene.age_max_enfant_certificat', 25)::int;"
        )
        adulte, enfant, enfant_certificat = cursor.fetchone()
        cursor.execute(
            "SELECT TRIM(AF.nom || ' ' || COALESCE(AF.prenom, '')), AF.lien, COALESCE(AF.certificat, false),"
            " EXTRACT(YEAR FROM AGE(%s::date, AF.datenaissance))::int, SF.idoffresante"
            " FROM stdaffilie AS AF"
            " INNER JOIN stdadherent AS AD ON AD.idadherent = AF.idadherent"
            " INNER JOIN stdfiliale AS SF ON SF.idfiliale = AD.idfiliale"
            " WHERE AF.iddevis = %s AND AF.datenaissance IS NOT NULL ORDER BY AF.idadherent, AF.idaffilie;",
            [date_effet, id_devis],
        )
        lignes = cursor.fetchall()
    hors = []
    for nom, lien, certificat, age, offre in lignes:
        lien = (lien or "").strip()
        if lien in ("A", "C") and offre in OFFRES_MINENE and age > adulte:
            hors.append((nom, age, adulte))
        elif lien == "E" and age > enfant_certificat:
            hors.append((nom, age, enfant_certificat))
        elif lien == "E" and age > enfant and not certificat:
            hors.append((nom, age, enfant))
    return hors


def enregistrer_adherent_sante(user_id, input_data, fichier_piece=None, derogation_age=False, date_reference=None):
    sql_output = None
    error_occurred = False
    # print(type(input_data))
    # print("Données de l'adhérent:",input_data)

    try:
        idadherent = int(input_data["idadherent"])
        filiale = int(input_data["filiale"])
        nom = str(input_data["nom"])
        prenom = str(input_data["prenom"])
        sexe = str(input_data["sexe"])
        cni = ""
        if "cni" in input_data:
            if input_data["cni"]:
                cni = str(input_data["cni"])
        vip = str(input_data["vip"])
        adresse = ""
        if "adresse" in input_data:
            if input_data["adresse"]:
                adresse = str(input_data["adresse"])
        mobile1 = str(input_data["mobile1"])
        mobile2 = str(input_data["mobile2"])
        email = str(input_data["email"])
        devis = int(input_data["devis"])
        # convert_to_date
        dateeffet = None
        if str(input_data["dateeffet"]) not in ("NA", "N/A", "N-A"):
            dateeffet = convert_to_date(input_data["dateeffet"])

        datedebutconsommation = None
        if str(input_data["datedebutconsommation"]) not in (
            "NA",
            "N/A",
            "N-A",
        ):
            datedebutconsommation = convert_to_date(
                input_data["datedebutconsommation"]
            )

        datenaissance = None
        if "datenaissance" in input_data:
            if input_data["datenaissance"] and input_data[
                "datenaissance"
            ] not in (
                "NA",
                "N/A",
                "N-A",
            ):
                datenaissance = convert_to_date(input_data["datenaissance"])

        matricule = ""
        if "matricule" in input_data:
            if input_data["matricule"]:
                matricule = str(input_data["matricule"])

        surprimeappliquee = False
        if "surprimeappliquee" in input_data:
            if input_data["surprimeappliquee"]:
                surprimeappliquee = bool(input_data["surprimeappliquee"])

        montantsurprime = 0
        if "montantsurprime" in input_data:
            if input_data["montantsurprime"]:
                montantsurprime = Decimal(input_data["montantsurprime"])

        nombrepathologie = 0
        if "nombrepathologie" in input_data:
            if input_data["nombrepathologie"]:
                nombrepathologie = int(input_data["nombrepathologie"])

        # Donner la possibilité d'utiliser également nombrepathologies (au pluriel) comme champ de l'objet JSON
        if not nombrepathologie and "nombrepathologies" in input_data:
            if input_data["nombrepathologies"]:
                nombrepathologie = int(input_data["nombrepathologies"])

        numerocmu = ""
        if "numerocmu" in input_data:
            if input_data["numerocmu"]:
                numerocmu = str(input_data["numerocmu"])

        groupesanguin = ""
        if "groupesanguin" in input_data:
            if input_data["groupesanguin"]:
                groupesanguin = str(input_data["groupesanguin"])

        outputmessage = ""
        data_insertion_result_list = []
        queryset_vide = AdherentSanteInsertionResult.objects.none()

        with connection.cursor() as cursor:
            _poser_derogation_age(cursor, derogation_age, date_reference)
            cursor.execute(
                "CALL sp_saisie_adherent_sante(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    nom,
                    prenom,
                    sexe,
                    cni,
                    vip,
                    adresse,
                    mobile1,
                    mobile2,
                    email,
                    datenaissance,
                    dateeffet,
                    filiale,
                    datedebutconsommation,
                    matricule,
                    surprimeappliquee,
                    montantsurprime,
                    nombrepathologie,
                    numerocmu,
                    groupesanguin,
                    user_id,
                    idadherent,
                    devis,
                    outputmessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            _poser_derogation_age(cursor, False)
            sql_output = AdherentSanteInsertionResult(
                idadherent=row[0], devis=row[1], outputmessage=row[2]
            )
            data_insertion_result_list.append(sql_output)
            # Gestion du fichier joint
            if int(row[0]) and fichier_piece:
                adherent = Adherent.objects.get(pk=int(row[0]))
                old_path = None
                # old_path = adherent.fichier_piece.path
                if adherent.fichier_piece:
                    old_path = adherent.fichier_piece.path
                if old_path and os.path.isfile(old_path):
                    adherent.fichier_piece.name = (
                        "uploads/adherents/" + fichier_piece.name
                    )
                    new_path = (
                        settings.MEDIA_ROOT + adherent.fichier_piece.name
                    )
                    os.rename(old_path, new_path)
                else:
                    adherent.fichier_piece = fichier_piece
                adherent.save()
    except Exception as error:
        error_occurred = True
        print(error)
        msg = message_erreur_base(error)
        sql_output = AdherentSanteInsertionResult(
            idadherent=idadherent, devis=devis, outputmessage=msg
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


#########################################################################
#
# Enregistrer les affiliés
def enregistrer_affilie_sante(userid, input_data, fichier_piece=None, derogation_age=False, date_reference=None):
    sql_output = None
    error_occurred = False
    # print(type(input_data))
    # print("Données de l'affilié:",input_data)

    try:
        idaffilie = int(input_data["idaffilie"])
        adherent = int(input_data["adherent"])
        lien = str(input_data["lien"])
        nom = str(input_data["nom"])
        prenom = str(input_data["prenom"])
        # cni = str(input_data["cni"])
        cni = ""
        if "cni" in input_data:
            if input_data["cni"]:
                cni = str(input_data["cni"])
        # convert_to_date
        datenaissance = None
        if str(input_data["datenaissance"]) not in ("NA", "N/A", "N-A"):
            datenaissance = convert_to_date(input_data["datenaissance"])

        # datenaissance = datetime.strptime(input_data["datenaissance"], "%d-%m-%Y").date()
        certificat = False
        if "certificat" in input_data:
            if input_data["certificat"]:
                certificat = bool(input_data["certificat"])

        matricule = ""
        if "matricule" in input_data:
            if input_data["matricule"]:
                matricule = str(input_data["matricule"])

        # observations = str(input_data["observations"])
        if "observations" in input_data:
            observations = (
                str(input_data["observations"])
                if input_data["observations"]
                else ""
            )
        else:
            observations = "RAS"

        handicape = False
        if "handicape" in input_data:
            if input_data["handicape"]:
                handicape = bool(input_data["handicape"])

        sexe = str(input_data["sexe"])
        devis = int(input_data["devis"])
        # convert_to_date
        dateeffet = None
        if str(input_data["dateeffet"]) not in ("NA", "N/A", "N-A"):
            dateeffet = convert_to_date(input_data["dateeffet"])

        datedebutconsommation = None
        if str(input_data["datedebutconsommation"]) not in (
            "NA",
            "N/A",
            "N-A",
        ):
            datedebutconsommation = convert_to_date(
                input_data["datedebutconsommation"]
            )

        surprimeappliquee = bool(input_data["surprimeappliquee"])
        montantsurprime = Decimal(input_data["montantsurprime"])

        nombrepathologie = 0
        if "nombrepathologie" in input_data:
            if input_data["nombrepathologie"]:
                nombrepathologie = int(input_data["nombrepathologie"])
        # Donner la possibilité d'utiliser également nombrepathologies (au pluriel) comme champ de l'objet JSON
        if not nombrepathologie and "nombrepathologies" in input_data:
            if input_data["nombrepathologies"]:
                nombrepathologie = int(input_data["nombrepathologies"])

        numerocmu = ""
        if "numerocmu" in input_data:
            if input_data["numerocmu"]:
                numerocmu = str(input_data["numerocmu"])

        groupesanguin = ""
        if "groupesanguin" in input_data:
            if input_data["groupesanguin"]:
                groupesanguin = str(input_data["groupesanguin"])

        mobile1 = ""
        mobile2 = ""
        if lien.upper() in ("A", "C"):
            if "mobile1" in input_data:
                if input_data["mobile1"]:
                    mobile1 = str(input_data["mobile1"])
            if "mobile2" in input_data:
                if input_data["mobile2"]:
                    mobile2 = str(input_data["mobile2"])
        outputmessage = ""
        data_insertion_result_list = []
        queryset_vide = AffilieSanteInsertionResult.objects.none()

        with connection.cursor() as cursor:
            _poser_derogation_age(cursor, derogation_age, date_reference)
            cursor.execute(
                "CALL sp_saisie_affilie_sante(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    nom,
                    prenom,
                    datenaissance,
                    sexe,
                    mobile1,
                    mobile2,
                    cni,
                    lien,
                    dateeffet,
                    certificat,
                    matricule,
                    observations,
                    handicape,
                    datedebutconsommation,
                    surprimeappliquee,
                    montantsurprime,
                    nombrepathologie,
                    numerocmu,
                    groupesanguin,
                    userid,
                    idaffilie,
                    adherent,
                    devis,
                    outputmessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            _poser_derogation_age(cursor, False)
            sql_output = AffilieSanteInsertionResult(
                idaffilie=row[0],
                adherent=row[1],
                devis=row[2],
                outputmessage=row[3],
            )
            data_insertion_result_list.append(sql_output)
            # Gestion du fichier joint
            if int(row[0]) and fichier_piece:
                affilie = Affilie.objects.get(pk=int(row[0]))
                old_path = None
                # old_path = adherent.fichier_piece.path
                if affilie.fichier_piece:
                    old_path = affilie.fichier_piece.path
                if old_path and os.path.isfile(old_path):
                    affilie.fichier_piece.name = (
                        "uploads/affilies/" + fichier_piece.name
                    )
                    new_path = settings.MEDIA_ROOT + affilie.fichier_piece.name
                    os.rename(old_path, new_path)
                else:
                    affilie.fichier_piece = fichier_piece
                affilie.save()
    except Exception as error:
        error_occurred = True
        print(error)
        msg = message_erreur_base(error)
        sql_output = AffilieSanteInsertionResult(
            idaffilie=idaffilie,
            adherent=adherent,
            devis=devis,
            outputmessage=msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


######################################################################################
# Enregistrer les filiales


def enregistrer_filiale_sante(userid, input_data):
    sql_output = None
    error_occurred = False
    idfiliale = int(input_data["idfiliale"])
    devis = int(input_data["devis"])
    college = int(input_data["college"])
    offresante = int(input_data["offresante"])
    zonecouverture = int(input_data["zonecouverture"])
    date_emission = date_emission_du_jour()
    date_effet = datetime.strptime(input_data["date_effet"], "%d-%m-%Y").date()
    date_expiration = datetime.strptime(
        input_data["date_expiration"], "%d-%m-%Y"
    ).date()
    source = str(input_data["source"])

    outputmessage = ""
    data_insertion_result_list = []
    queryset_vide = FilialeSanteInsertionResult.objects.none()
    try:
        # status = 0
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_saisie_filiale_sante(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    college,
                    offresante,
                    zonecouverture,
                    date_effet,
                    date_expiration,
                    date_emission,
                    source,
                    userid,
                    idfiliale,
                    devis,
                    outputmessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = FilialeSanteInsertionResult(
                idfiliale=row[0], devis=row[1], outputmessage=row[2]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occurred = True
        print(error)
        msg = message_erreur_base(error)
        sql_output = FilialeSanteInsertionResult(
            idfiliale=idfiliale,
            devis=devis,
            outputmessage=msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


def get_quotation_id(userid):
    msg = ""
    id_devis = 0
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_initialisation_devis_sante(%s, %s, %s);",
                (
                    userid,
                    id_devis,
                    msg,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            id_devis = row[0]
            msg = row[1]
    except Exception as error:
        print(error)
        id_devis = 0
        msg = message_erreur_base(error)
    finally:
        if connection:
            cursor.close()
    return (msg, id_devis)


def get_saisie_sante_en_cours(user_id):
    msg = ""
    res = SaisieDevisSanteEnCours.objects.none()
    saisie_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_saisie_sante_en_cours",
                [
                    user_id,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                dev = SaisieDevisSanteEnCours(
                    devis=row[0],
                    identifiant_devis=row[1],
                    utilisateur=row[2],
                )
                saisie_list.append(dev)
                # print(dev)
    except Exception as error:
        print(error)
        msg = message_erreur_base(error)
    else:
        if len(saisie_list) > 0:
            res = list(chain(res, saisie_list))

    finally:
        if connection:
            cursor.close()

    return (msg, res)


def get_liste_affilie_sante(iddevis):
    msg = ""
    res = AffilieFn.objects.none()
    affilie_sante_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_affilie_sante",
                [
                    iddevis,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                aff = AffilieFn(
                    iddevis=row[0],
                    idaffilie=row[1],
                    idadherent=row[2],
                    nom=row[3],
                    prenom=row[4],
                    lien=row[5],
                    lienparente=row[6],
                    datenaissance=row[7],
                    sexe=row[8],
                    numerocni=row[9],
                    numerocmu=row[10],
                    groupesanguin=row[11],
                )
                affilie_sante_list.append(aff)
                # print(qp)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(affilie_sante_list) > 0:
            res = list(chain(res, affilie_sante_list))

    finally:
        if connection:
            cursor.close()

    return (msg, res)
