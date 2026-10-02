import re
from datetime import date, datetime
from decimal import Decimal
from itertools import chain

from django.db import connection
from django.db.models import Q

from .models import (
    Avenant,
    CollegeSante,
    FormuleSecuriteRoutiereParCompagnie,
    GarantiePourOffre,
    GarantieProposee,
    Offre,
    OffreCollegeSante,
    OffreGarantie,
    OffreParProduit,
    OffreSanteParTarif,
    PaysZone,
    TarifParProduit,
    ZoneCouvertureSante,
)


def check_iso_date_format(date_str):
    regex = re.compile("[0-9]{4}\-[0-9]{2}\-[0-9]{2}")
    return re.match(regex, date_str)


def check_f_date_format_1(date_str):
    regex = re.compile("[0-9]{2}/[0-9]{2}/[0-9]{4}")
    return re.match(regex, date_str)


def check_f_date_format_2(date_str):
    regex = re.compile("[0-9]{2}\-[0-9]{2}\-0-9]{4}")
    return re.match(regex, date_str)


def string_to_date(s):
    # print("In string to date", type(s), sep=": ")
    # print("In string to date", len(s), sep=": ")
    # print("In string to date", s)
    if check_f_date_format_1(s):
        return datetime.strptime(s, "%d/%m/%Y").date()
    elif check_f_date_format_2(s):
        return datetime.strptime(s, "%d\-%m\-%Y").date()
    elif check_iso_date_format(s):
        return datetime.strptime(s, "%Y-%m-%d").date()


def compute_rate(bns, date_effet, date_expiration):
    taux = 1
    contract_duration = 365
    year_length = 365
    if isinstance(date_effet, date) and isinstance(date_expiration, date):
        taux = (100.0 - bns) / 100.0
        contract_year = date_effet.year
        contract_duration = (date_expiration - date_effet).days + 1
        year_length = (
            date(contract_year, 12, 31) - date(contract_year, 1, 1)
        ).days + 1
    return Decimal(taux * contract_duration / year_length)


def get_garantie_offre(request_data):
    IdCompagnie = 1
    if "IdCompagnie" in request_data:
        if request_data["IdCompagnie"]:
            IdCompagnie = int(request_data["IdCompagnie"])
    DateMec = None
    if "DateMec" in request_data:
        if request_data["DateMec"]:
            DateMec = datetime.strptime(
                request_data["DateMec"], "%d-%m-%Y"
            ).date()
    RemorqueAttelee = False
    if "RemorqueAttelee" in request_data:
        if request_data["RemorqueAttelee"]:
            RemorqueAttelee = bool(request_data["RemorqueAttelee"])
    CodeFormuleSecuriteRoutiere = ""
    if "CodeFormuleSecuriteRoutiere" in request_data:
        if request_data["CodeFormuleSecuriteRoutiere"]:
            CodeFormuleSecuriteRoutiere = str(
                request_data["CodeFormuleSecuriteRoutiere"]
            )
    IdOptionAssistance = 0
    if "IdOptionAssistance" in request_data:
        if request_data["IdOptionAssistance"]:
            IdOptionAssistance = int(request_data["IdOptionAssistance"])

    NombrePlace = 1
    if "NombrePlace" in request_data:
        if request_data["NombrePlace"]:
            NombrePlace = int(request_data["NombrePlace"])

    CodeUsage = 0
    if "CodeUsage" in request_data:
        if request_data["CodeUsage"]:
            CodeUsage = int(request_data["CodeUsage"])

    CarburantAutreMatiere = False
    if "CarburantAutreMatiere" in request_data:
        if request_data["CarburantAutreMatiere"]:
            CarburantAutreMatiere = bool(request_data["CarburantAutreMatiere"])

    TransportEleves = False
    if "TransportEleves" in request_data:
        if request_data["TransportEleves"]:
            TransportEleves = bool(request_data["TransportEleves"])

    TransportEmployes = False
    if "TransportEmployes" in request_data:
        if request_data["TransportEmployes"]:
            TransportEmployes = bool(request_data["TransportEmployes"])

    TansportPassagerSupplementaire = False
    if "TansportPassagerSupplementaire" in request_data:
        if request_data["TansportPassagerSupplementaire"]:
            TansportPassagerSupplementaire = bool(
                request_data["TansportPassagerSupplementaire"]
            )
    NsiaAutoPlus = False
    if "NsiaAutoPlus" in request_data:
        if request_data["NsiaAutoPlus"]:
            NsiaAutoPlus = bool(request_data["NsiaAutoPlus"])
    IdOffre = int(request_data["IdOffre"])
    IdTarif = int(request_data["IdTarif"])
    ValNeuve = Decimal(request_data["ValNeuve"])
    ValVenale = Decimal(request_data["ValVenale"])
    ValAccessoire = Decimal(request_data["ValAccessoire"])
    Puissance = int(request_data["Puissance"])
    CodeCarburant = int(request_data["CodeCarburant"])
    Tonnage = int(request_data["Tonnage"])
    TauxReduction = Decimal(request_data["TauxReduction"])
    CodeAlarme = int(request_data["CodeAlarme"])
    DateEffet = datetime.strptime(request_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        request_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    Bns = Decimal(request_data["Bns"])
    try:
        status = 0
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_garantie_offre",
                [
                    IdCompagnie,
                    IdOffre,
                    IdTarif,
                    ValNeuve,
                    ValVenale,
                    ValAccessoire,
                    Puissance,
                    CodeCarburant,
                    Tonnage,
                    TauxReduction,
                    CodeAlarme,
                    DateEffet,
                    DateExpiration,
                    Bns,
                    DateMec,
                    RemorqueAttelee,
                    CodeFormuleSecuriteRoutiere,
                    IdOptionAssistance,
                    NombrePlace,
                    CodeUsage,
                    CarburantAutreMatiere,
                    TransportEleves,
                    TransportEmployes,
                    TansportPassagerSupplementaire,
                    NsiaAutoPlus,
                ],
            )

            result = cursor.fetchall()
            garantie_proposee_list = []
            for row in result:
                gp = GarantieProposee(
                    IdGarantie=row[0],
                    LibelleGarantie=row[1],
                    IdSousGarantie=row[2],
                    LibelleSousGarantie=row[3],
                    Acquise=row[4],
                    Capital=row[5],
                    NombrePlace=row[6],
                    PrimeAnnuelle=row[7],
                    PrimeNette=row[8],
                    Taxe=row[9],
                    MontantAccessoire=row[10],
                    TauxFranchise=row[11],
                    FranchiseMinimum=row[12],
                    FranchiseMaximum=row[13],
                    TexteFranchise=row[14],
                )
                garantie_proposee_list.append(gp)
            queryset_vide = GarantieProposee.objects.none()
    except Exception as error:
        status = 1
        print(error)

    finally:
        if connection:
            cursor.close()
            connection.close()
    if status == 0:
        return list(chain(queryset_vide, garantie_proposee_list))


def get_garantie_offre_ia(request_data):
    IdCompagnie = 1
    if "IdCompagnie" in request_data:
        if request_data["IdCompagnie"]:
            IdCompagnie = int(request_data["IdCompagnie"])
    IdOffre = int(request_data["IdOffre"])
    CapitalDeces = Decimal(request_data["CapitalDeces"])
    CapitalInfirmite = Decimal(request_data["CapitalInfirmite"])
    CapitalFraisTraitement = Decimal(request_data["CapitalFraisTraitement"])
    TauxReduction = Decimal(request_data["TauxReduction"])
    DateEffet = datetime.strptime(request_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        request_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateNaissance = datetime.strptime(
        request_data["DateNaissance"], "%d-%m-%Y"
    ).date()
    CodeActivite = request_data["CodeActivite"]
    PrimeNette = 0
    if "PrimeNette" in request_data:
        if request_data["PrimeNette"]:
            PrimeNette = Decimal(request_data["PrimeNette"])
    Accessoire = 0
    if "Accessoire" in request_data:
        if request_data["Accessoire"]:
            Accessoire = Decimal(request_data["Accessoire"])
    CapitalFraisTraitement = Decimal(request_data["CapitalFraisTraitement"])
    try:
        status = 0
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_garantie_offre_ia",
                [
                    IdCompagnie,
                    IdOffre,
                    CapitalDeces,
                    CapitalInfirmite,
                    CapitalFraisTraitement,
                    TauxReduction,
                    DateEffet,
                    DateExpiration,
                    CodeActivite,
                    DateNaissance,
                    PrimeNette,
                    Accessoire,
                ],
            )

            result = cursor.fetchall()
            garantie_proposee_list = []
            for row in result:
                gp = GarantieProposee(
                    IdGarantie=row[0],
                    LibelleGarantie=row[1],
                    IdSousGarantie=row[2],
                    LibelleSousGarantie=row[3],
                    Acquise=row[4],
                    Capital=row[5],
                    NombrePlace=row[6],
                    PrimeAnnuelle=row[7],
                    PrimeNette=row[8],
                    Taxe=row[9],
                    MontantAccessoire=row[10],
                )
                garantie_proposee_list.append(gp)
            queryset_vide = GarantieProposee.objects.none()
    except Exception as error:
        status = 1
        print(error)

    finally:
        if connection:
            cursor.close()
            connection.close()
    if status == 0:
        return list(chain(queryset_vide, garantie_proposee_list))


def get_garantie_offre_voyage(request_data):
    IdCompagnie = 1
    if "IdCompagnie" in request_data:
        if request_data["IdCompagnie"]:
            IdCompagnie = int(request_data["IdCompagnie"])
    IdTarif = 0
    if "IdTarif" in request_data:
        if request_data["IdTarif"]:
            IdTarif = int(request_data["IdTarif"])
    IdOffre = int(request_data["IdOffre"])
    IdZoneVoyage = int(request_data["IdZoneVoyage"])
    TauxReduction = Decimal(request_data["TauxReduction"])
    DateEffet = datetime.strptime(request_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        request_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateNaissance = datetime.strptime(
        request_data["DateNaissance"], "%d-%m-%Y"
    ).date()
    try:
        status = 0
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_garantie_offre_voyage",
                [
                    IdCompagnie,
                    IdTarif,
                    IdOffre,
                    IdZoneVoyage,
                    TauxReduction,
                    DateEffet,
                    DateExpiration,
                    DateNaissance,
                ],
            )

            result = cursor.fetchall()
            garantie_proposee_list = []
            for row in result:
                gp = GarantieProposee(
                    IdGarantie=row[0],
                    LibelleGarantie=row[1],
                    IdSousGarantie=row[2],
                    LibelleSousGarantie=row[3],
                    Acquise=row[4],
                    Capital=row[5],
                    NombrePlace=row[6],
                    PrimeAnnuelle=row[7],
                    PrimeNette=row[8],
                    Taxe=row[9],
                    MontantAccessoire=row[10],
                )
                garantie_proposee_list.append(gp)
            queryset_vide = GarantieProposee.objects.none()
    except Exception as error:
        status = 1
        print(error)

    finally:
        if connection:
            cursor.close()
            connection.close()
    if status == 0:
        return list(chain(queryset_vide, garantie_proposee_list))


#############################################################################


def get_garantie_produit(request_data):
    IdOffre = int(request_data["idoffre"])
    IdCompagnie = int(request_data["idcompagnie"])
    IdProduit = int(request_data["idproduit"])

    try:
        status = 0
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_garantie_produit",
                [
                    IdCompagnie,
                    IdProduit,
                    IdOffre,
                ],
            )

            result = cursor.fetchall()
            garantie_proposee_list = []
            for row in result:
                gp = GarantiePourOffre(
                    IdGarantie=row[0],
                    IdSousGarantie=row[1],
                    CodeSousGarantie=row[2],
                    LibelleSousGarantie=row[3],
                    TauxFranchise=row[4],
                    FranchiseMinimum=row[5],
                    FranchiseMaximum=row[6],
                    Choix=row[7],
                )
                garantie_proposee_list.append(gp)
            queryset_vide = GarantiePourOffre.objects.none()
    except Exception as error:
        status = 1
        print(error)

    finally:
        if connection:
            cursor.close()
            connection.close()
    if status == 0:
        return list(chain(queryset_vide, garantie_proposee_list))


#############################################################################
def get_liste_avenant_produit(id_produit, flotte):
    try:
        msg = ""
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_avenant_produit",
                [
                    id_produit,
                    flotte,
                ],
            )
            result = cursor.fetchall()
            avenant_propose_list = []
            for row in result:
                avenant_propose_list.append(row[0])
            avenants = Avenant.objects.filter(
                IdAvenant__in=avenant_propose_list
            )
    except Exception as error:
        print(error)
        msg = str(error)
        if msg.find("\n") > 0:
            msg = msg.split("\n")[0]
        avenants = Avenant.objects.none()
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (msg, avenants)


#############################################################################
# Save coverage for an offer
def save_offre_garantie(input_data):
    idcompagnie = int(input_data["idcompagnie"])
    # idproduit = int(input_data["idproduit"])
    idoffre = int(input_data["idoffre"])

    liste_sous_garantie = list(input_data["liste_sous_garantie"])
    liste_id = ";".join(
        [str(d["idsousgarantie"]) for d in liste_sous_garantie]
    )
    liste_taux = ";".join(
        [str(d["tauxfranchise"]) for d in liste_sous_garantie]
    )
    liste_min = ";".join(
        [str(d["franchiseminimum"]) for d in liste_sous_garantie]
    )
    liste_max = ";".join(
        [str(d["franchisemaximum"]) for d in liste_sous_garantie]
    )

    code_retour = 0
    output_message = ""
    query_set = OffreGarantie.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_enregistrement_offre_garantie(%s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    idcompagnie,
                    idoffre,
                    liste_id,
                    liste_taux,
                    liste_min,
                    liste_max,
                    code_retour,
                    output_message,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            code_retour = row[0]
            output_message = row[1]

    except Exception as error:
        print(error)
        code_retour = -1
        output_message = str(error)
    else:
        query_set = OffreGarantie.objects.filter(
            Q(IdOffre=idoffre) & Q(IdCompagnie=idcompagnie)
        )
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (code_retour, output_message, query_set)


#############################################################################
def get_garantie_offre_mrh(request_data):
    IdCompagnie = 1
    if "IdCompagnie" in request_data:
        if request_data["IdCompagnie"]:
            IdCompagnie = int(request_data["IdCompagnie"])
    IdOffre = int(request_data["IdOffre"])
    ValeurCapitalLoyer = Decimal(request_data["ValeurCapitalLoyer"])
    ValeurCapitalContenu = Decimal(request_data["ValeurCapitalContenu"])
    ValeurCapitalObjetPrecieux = Decimal(
        request_data["ValeurCapitalObjetPrecieux"]
    )
    ValeurCapitalMateriel = Decimal(request_data["ValeurCapitalMateriel"])
    ValeurDegatBatiment = Decimal(request_data["ValeurDegatBatiment"])
    ValeurDegatContenu = Decimal(request_data["ValeurDegatContenu"])
    TauxReduction = Decimal(request_data["TauxReduction"])
    DateEffet = datetime.strptime(request_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        request_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    Gardien = bool(request_data["Gardien"])
    Locataire = bool(request_data["Locataire"])

    res = GarantieProposee.objects.none()
    garantie_proposee_list = []
    try:
        status = 0
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_garantie_offre_mrh",
                [
                    IdCompagnie,
                    IdOffre,
                    ValeurCapitalLoyer,
                    ValeurCapitalContenu,
                    ValeurCapitalObjetPrecieux,
                    ValeurCapitalMateriel,
                    ValeurDegatBatiment,
                    ValeurDegatContenu,
                    TauxReduction,
                    DateEffet,
                    DateExpiration,
                    Gardien,
                    Locataire,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                gp = GarantieProposee(
                    IdGarantie=row[0],
                    LibelleGarantie=row[1],
                    IdSousGarantie=row[2],
                    LibelleSousGarantie=row[3],
                    Acquise=row[4],
                    Capital=row[5],
                    NombrePlace=row[6],
                    PrimeAnnuelle=row[7],
                    PrimeNette=row[8],
                    Taxe=row[9],
                    MontantAccessoire=row[10],
                )
                garantie_proposee_list.append(gp)
    except Exception as error:
        print(error)
    else:
        if len(garantie_proposee_list) > 0:
            res = list(chain(res, garantie_proposee_list))
    finally:
        if connection:
            cursor.close()
            connection.close()
    return res


# get_garantie_offre_risques_divers
#############################################################################
def get_garantie_offre_risques_divers(id_produit, request_data):
    IdCompagnie = 1
    if "IdCompagnie" in request_data:
        if request_data["IdCompagnie"]:
            IdCompagnie = int(request_data["IdCompagnie"])
    IdDevis = 0
    if "IdDevis" in request_data:
        if request_data["IdDevis"]:
            IdDevis = int(request_data["IdDevis"])
    IdOffre = int(request_data["IdOffre"])
    CapitalDommageCorporel = Decimal(
        request_data.get("CapitalDommageCorporel", 0)
    )
    CapitalDommageMateriel = Decimal(
        request_data.get("CapitalDommageMateriel", 0)
    )
    CapitalIntoxicationAlimentaire = Decimal(
        request_data.get("CapitalIntoxicationAlimentaire", 0)
    )
    AssiettePrime = Decimal(request_data.get("AssiettePrime", 0))
    TauxPrime = Decimal(request_data.get("TauxPrime", 0))
    TauxReduction = Decimal(request_data.get("TauxReduction", 0))
    DateEffet = datetime.strptime(
        request_data.get("DateEffet"), "%d-%m-%Y"
    ).date()
    DateExpiration = datetime.strptime(
        request_data["DateExpiration"], "%d-%m-%Y"
    ).date()

    res = GarantieProposee.objects.none()
    garantie_proposee_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_garantie_offre_risques_divers",
                [
                    IdCompagnie,
                    IdOffre,
                    TauxPrime,
                    CapitalDommageCorporel,
                    CapitalIntoxicationAlimentaire,
                    CapitalDommageMateriel,
                    AssiettePrime,
                    TauxReduction,
                    DateEffet,
                    DateExpiration,
                    id_produit,
                    IdDevis,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                gp = GarantieProposee(
                    IdGarantie=row[0],
                    LibelleGarantie=row[1],
                    IdSousGarantie=row[2],
                    LibelleSousGarantie=row[3],
                    Acquise=row[4],
                    Capital=row[5],
                    NombrePlace=row[6],
                    PrimeAnnuelle=row[7],
                    PrimeNette=row[8],
                    Taxe=row[9],
                    MontantAccessoire=row[10],
                    TauxFranchise=row[11],
                    FranchiseMinimum=row[12],
                    FranchiseMaximum=row[13],
                    MontantFranchise=row[14],
                    TexteFranchise=row[15],
                )
                garantie_proposee_list.append(gp)
    except Exception as error:
        print(error)
    else:
        if len(garantie_proposee_list) > 0:
            res = list(chain(res, garantie_proposee_list))
    finally:
        if connection:
            cursor.close()
            connection.close()
    return res


# Proposée par l'IA, mais je ne l'utilise pas
def get_garanties_offre_rc(
    id_compagnie,
    id_offre,
    taux_prime,
    capital_dommage_corporel,
    capital_intoxication_alimentaire,
    capital_dommage_materiel,
    assiette_prime,
    taux_reduction,
    date_effet,
    date_expiration,
    id_devis=0,
):
    """
    Appelle fn_garantie_offre_rc puis, si id_devis != 0,
    fusionne les données du devis existant sur le résultat.
    """

    # ----------------------------------------------------------
    # Étape 1 : appel de la fonction SQL toujours avec id_devis=0
    # On obtient ainsi les lignes de base (capitaux, franchises…)
    # sans que la branche UPDATE buggée ne s'exécute.
    # ----------------------------------------------------------
    sql_fn = """
        SELECT
            idgarantie, libellegarantie, idsousgarantie, libellesousgarantie,
            acquise, capital, nombreplace, primeannuelle, primenette, taxe,
            montantaccessoire, tauxfranchise, franchiseminimum, franchisemaximum,
            franchisetexte
        FROM public.fn_garantie_offre_rc(
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0
        )
    """
    params_fn = [
        id_compagnie,
        id_offre,
        taux_prime,
        capital_dommage_corporel,
        capital_intoxication_alimentaire,
        capital_dommage_materiel,
        assiette_prime,
        taux_reduction,
        date_effet,
        date_expiration,
    ]

    with connection.cursor() as cursor:
        cursor.execute(sql_fn, params_fn)
        colonnes = [col[0] for col in cursor.description]
        lignes = [dict(zip(colonnes, row)) for row in cursor.fetchall()]

    # ----------------------------------------------------------
    # Étape 2 : si id_devis != 0, on fusionne les données du devis
    # ----------------------------------------------------------
    if id_devis != 0:

        # 2a. Détail des garanties du devis
        sql_det = """
            SELECT
                SDG.idgarantie      AS idsousgar,
                SDG.primeannuelle,
                SDG.primenette,
                SDG.taxe,
                SDG.capital,
                SDG.minfranchise,
                SDG.maxfranchise,
                SDG.textefranchise
            FROM public.stddevisdetgarantie AS SDG
            WHERE SDG.iddevisdet IN (
                SELECT SDD.iddevisdetail
                FROM public.stddevisdetail AS SDD
                WHERE SDD.iddevis = %s
            )
        """

        # 2b. Totaux du devis (ligne de cumul)
        sql_devis = """
            SELECT
                primeannuelle,
                primenette,
                taxe,
                accessoirecompagnie,
                accessoireintermediaire
            FROM public.stddevis
            WHERE iddevis = %s
        """

        with connection.cursor() as cursor:

            cursor.execute(sql_det, [id_devis])
            cols_det = [col[0] for col in cursor.description]
            # Dictionnaire indexé par idsousgar pour une fusion O(1)
            details_devis = {
                row[0]: dict(zip(cols_det, row)) for row in cursor.fetchall()
            }

            cursor.execute(sql_devis, [id_devis])
            row_devis = cursor.fetchone()

        # 2c. Fusion ligne par ligne sur les garanties (idgarantie != 0)
        for ligne in lignes:
            if ligne["idgarantie"] == 0:
                # La ligne de cumul est traitée séparément ci-dessous
                continue

            det = details_devis.get(ligne["idsousgarantie"])
            if det:
                ligne["acquise"] = True
                ligne["primeannuelle"] = det["primeannuelle"] or Decimal(0)
                ligne["primenette"] = det["primenette"] or Decimal(0)
                ligne["taxe"] = det["taxe"] or Decimal(0)
                ligne["franchiseminimum"] = det["minfranchise"] or Decimal(0)
                ligne["franchisemaximum"] = det["maxfranchise"] or Decimal(0)
                ligne["franchisetexte"] = det["textefranchise"] or ""
                if det["capital"]:
                    ligne["capital"] = det["capital"]

        # 2d. Mise à jour de la ligne de cumul (idgarantie = 0)
        if row_devis:
            (pan, pne, tx, acc_comp, acc_inter) = row_devis
            for ligne in lignes:
                if ligne["idgarantie"] == 0:
                    ligne["primeannuelle"] = pan or Decimal(0)
                    ligne["primenette"] = pne or Decimal(0)
                    ligne["taxe"] = tx or Decimal(0)
                    ligne["montantaccessoire"] = (acc_comp or Decimal(0)) + (
                        acc_inter or Decimal(0)
                    )
                    break

    return lignes


def get_offre_par_produit(idproduit, idtarif=None):
    msg = ""
    liste_offre_produit = []
    cursor = None
    if idtarif is None:
        idtarif = 0
    queryset_vide = OffreParProduit.objects.none()
    try:
        (idproduit, idtarif) = (int(idproduit), int(idtarif))
        if idproduit == 1 and idtarif == 0:
            raise Exception("Le tarif n'a pas été spécifié.")

        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_offre_produit",
                [
                    idproduit,
                    idtarif,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                lop = OffreParProduit(
                    IdOffre=row[0],
                    LibelleOffre=row[1],
                )
                liste_offre_produit.append(lop)
    #                print(lop)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()

    return (msg, list(chain(queryset_vide, liste_offre_produit)))


def get_offre_voyage(idcompagnie, idtarif, idzone):
    msg = ""
    liste_offre_voyage = []
    cursor = None
    queryset_vide = OffreParProduit.objects.none()
    try:
        idcompagnie, idtarif, idzone = (
            int(idcompagnie),
            int(idtarif),
            int(idzone),
        )
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_offre_voyage",
                [
                    idcompagnie,
                    idtarif,
                    idzone,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                lop = OffreParProduit(
                    IdOffre=row[0],
                    LibelleOffre=row[1],
                )
                liste_offre_voyage.append(lop)
    #                print(lop)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()

    return (msg, list(chain(queryset_vide, liste_offre_voyage)))


#####################################################################
def get_offre_sante_par_tarif(idtarif):
    msg = ""
    liste_offre_tarif = []
    queryset_vide = OffreSanteParTarif.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_offre_sante_tarif",
                [
                    idtarif,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                lot = OffreSanteParTarif(
                    IdOffre=row[0],
                    LibelleOffre=row[1],
                    IdZoneCouverture=row[2],
                )
                liste_offre_tarif.append(lot)
                # print(lot)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, list(chain(queryset_vide, liste_offre_tarif)))


def get_college_sante_par_offre(id_offre):
    colleges = CollegeSante.objects.none()
    msg = ""
    try:
        colleges_dans_offre = OffreCollegeSante.objects.filter(
            offre=Offre.objects.get(pk=id_offre)
        )
        if colleges_dans_offre:
            colleges = CollegeSante.objects.filter(
                pk__in=[
                    offre_college.college.idcollege
                    for offre_college in colleges_dans_offre
                ]
            )
    except Offre.DoesNotExist as error:
        print(error)
        msg = "Offre inexistante!"
    except Offre.MultipleObjectsReturned as error:
        print(error)
        msg = "Erreur logicielle. Plusieurs offres ont le même identifiant!"
    except Exception as error:
        print(error)
        msg = "Erreur inattendue!"

    return (msg, colleges)


####################################################################
def get_zone_couverture_sante(idzone):
    msg = ""
    liste_zone = []
    queryset_vide = ZoneCouvertureSante.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_zone_couverture",
                [
                    idzone,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                zone = ZoneCouvertureSante(
                    idzone=row[0],
                    codezone=row[1],
                    libellezone=row[2],
                )
                liste_zone.append(zone)
                # print(zone)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, list(chain(queryset_vide, liste_zone)))


####################################################################
def get_formule_securite_routiere(idcompagnie):
    msg = ""
    liste_formule = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_formule_securite_routiere_compagnie",
                [
                    idcompagnie,
                ],
            )
            result = cursor.fetchall()
            for row in result:
                formule = FormuleSecuriteRoutiereParCompagnie(
                    idcompagnie=row[0],
                    codeformule=row[1],
                    libellelongformule=row[2],
                )
                liste_formule.append(formule)
                # print(formule)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, liste_formule)


def get_tarif_par_produit(idproduit):
    msg = ""
    liste_tarif_produit = []
    queryset_vide = TarifParProduit.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_tarif_produit",
                [
                    idproduit,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                ltp = TarifParProduit(
                    IdTarif=row[0],
                    LibelleTarif=row[1],
                    CodeCategorie=row[2],
                )
                liste_tarif_produit.append(ltp)
                # print(ltp)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, list(chain(queryset_vide, liste_tarif_produit)))


def get_tarif_voyage(idcompagnie):
    msg = ""
    liste_tarif_voyage = []
    queryset_vide = TarifParProduit.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_tarif_voyage",
                [
                    idcompagnie,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                ltp = TarifParProduit(
                    IdTarif=row[0],
                    LibelleTarif=row[1],
                    CodeCategorie=row[2],
                )
                liste_tarif_voyage.append(ltp)
                # print(ltp)
    except Exception as error:
        print(error)
        msg = str(error)

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, list(chain(queryset_vide, liste_tarif_voyage)))


def get_liste_pays_voyage(idcompagnie):
    msg = ""
    liste_pays_voyage = []
    queryset_vide = PaysZone.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_pays_voyage",
                [
                    idcompagnie,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                lpv = PaysZone(
                    id_pays=row[0],
                    libelle_pays=row[1],
                    nationalite=row[2],
                    id_zone=row[3],
                )
                liste_pays_voyage.append(lpv)
    except Exception as error:
        print(error)
        msg = str(error)
        if msg.find("\n") > 0:
            msg = msg.split("\n")[0]

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, list(chain(queryset_vide, liste_pays_voyage)))
