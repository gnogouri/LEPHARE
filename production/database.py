import json
import logging
import re
from datetime import datetime
from decimal import Decimal
from itertools import chain
from typing import cast

from django.db import connection, connections, transaction
from django.db.models import Sum
from django.db.utils import DatabaseError
from rest_framework.exceptions import APIException, ValidationError

from core.date_parser import date_emission_du_jour, parse_date_string
from core.services import ServiceError
from configuration_api.models import ModeEncaissement
from customer.models import Client
from uranus.settings import MAX_LIMIT_FOR_SEARCH

from .iautils import convert_to_date, unpack_ia_quotation_post_data
from .models import (
    AssureIaInfo,
    AssureIaParDevisOuContrat,
    CertificatTransport,
    Cheque,
    ChequeOperation,
    ContractForPremiumCollection,
    Contrat,
    ContratEcheance,
    DataInsertionResult,
    Devis,
    Encaissement,
    ExtendedDevisInfo,
    GarantieContratFlotte,
    GarantieSouscrite,
    InfoVehicule,
    PremiumCollectionInfo,
    PremiumRemittanceInfo,
    QuittanceFn,
    QuotationInsertionResult,
    VehiculeContrat,
)

# Configuration du logging pour tracer les erreurs en production
logger = logging.getLogger(__name__)

DEVIS_NON_CONFIRME = 0
DEVIS_CONFIRME = 1
DEVIS_INEXISTANT = 2

# Termes du contrat (stddevis.idterme) : 1 Tacite reconduction, 2 Ferme, 3 Autre
# (liste de configuration_api.TermeViewSet)
TERMES_CONTRAT = (1, 2, 3)


def enregistrer_terme_devis(id_devis, id_terme):
    """
    Pose le terme du contrat sur un devis non confirmé. sp_creation_devis (auto) et
    sp_creation_devis_mrh le reçoivent ; les procédures des autres produits (IA, risques
    divers, tous dommages, voyage, santé) n'ont pas ce paramètre : il est posé après création.
    """
    try:
        id_devis, id_terme = int(id_devis or 0), int(id_terme or 0)
    except (TypeError, ValueError):
        return
    if id_devis and id_terme in TERMES_CONTRAT:
        Devis.objects.filter(pk=id_devis, confirme=False).update(idterme=id_terme)


def get_devis(iddevis):
    if iddevis == 0:
        return None
    try:
        devis = Devis.objects.get(pk=iddevis)
    except Devis.DoesNotExist:
        return None
    else:
        return devis


def devis_confirme(iddevis):
    devis = get_devis(iddevis)
    if devis:
        return devis.confirme
    return False


def etat_devis(iddevis):
    # Codes de retour:
    # 0: devis existant et non confirmé
    # 1: devis existant et confirmé
    # 2: devis inexistant
    devis = get_devis(iddevis)
    if not devis:
        return DEVIS_INEXISTANT
    elif devis.confirme:
        return DEVIS_CONFIRME
    else:
        return DEVIS_NON_CONFIRME


def check_quote(iddevis):
    msg = ""
    if iddevis != 0:
        etat = etat_devis(iddevis)
        if etat in (DEVIS_INEXISTANT, DEVIS_CONFIRME):
            if etat == DEVIS_INEXISTANT:
                msg = "Devis inexistant. Opération impossible"
            else:
                msg = "Devis déja confirmé. Opération impossible"
    return msg


def check_iso_date_format(date):
    regex = re.compile("[0-9]{4}\-[0-9]{2}\-[0-9]{2}")
    return re.match(regex, date)


def check_f_date_format(date):
    regex = re.compile("[0-9]{2}/[0-9]{2}/[0-9]{4}")
    return re.match(regex, date)


def string_to_date(s):
    if check_f_date_format(s):
        return datetime.strptime(s, "%d/%m/%Y").date()
    elif check_iso_date_format(s):
        return datetime.strptime(s, "%Y-%m-%d").date()


def get_contract_info_for_sms(id_contrat):
    contrat_info = {}
    try:
        contrat = Contrat.objects.get(pk=id_contrat)
        contrat_info["numero_police"] = contrat.numeropolice
        contrat_info["prime_ttc"] = contrat.primettc
        contrat_info["date_effet"] = contrat.dateeffet
        contrat_info["date_expiration"] = contrat.dateexpiration
        id_client = contrat.idclient
        client = Client.objects.get(pk=id_client)
        contrat_info["numero_mobile"] = client.Mobile
    except Contrat.DoesNotExist as error:
        print(error)
    except Client.DoesNotExist as error:
        print(error)

    return contrat_info


def save_contract(input_data):
    sql_output = None
    error_occured = False
    IdDevis = int(input_data["IdDevis"])

    IdContrat = 0
    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()

    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "CALL sp_confirmation_devis(%s, %s, %s);",
                    (IdDevis, IdContrat, OutputMessage),
                )
                row = cursor.fetchone()
                if row:
                    IdContrat = int(row[0])
                    contrat = Contrat.objects.get(pk=IdContrat)
                    devis = Devis.objects.get(pk=IdDevis)
                    contrat.piece_jointe = devis.piece_jointe
                    contrat.save()

                    sql_output = DataInsertionResult(
                        ObjectId=row[0], OutputMessage=row[1]
                    )
                    data_insertion_result_list.append(sql_output)

    except Exception as error:
        error_occured = True
        err_msg = str(error).split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=0, OutputMessage=err_msg)
        data_insertion_result_list.append(sql_output)

    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


# Save quotation IA
def save_quotation_ia(input_data):
    error_occured = False
    sql_output = None
    save_quotation_arg = unpack_ia_quotation_post_data(input_data)
    data_insertion_result_list = []
    assure = Client.objects.get(pk=save_quotation_arg[6])
    donnees_assure = (
        assure.Nom
        + (assure.Prenoms if assure.Prenoms else "")
        + " ("
        + str(save_quotation_arg[19])
        + ")"
    )
    # Accessoire saisi manuellement (index 25 dans save_quotation_arg)
    accessoire_manuel = save_quotation_arg[25]
    queryset_vide = QuotationInsertionResult.objects.none()
    try:
        # status = 0
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_ia(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                save_quotation_arg,
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = QuotationInsertionResult(
                IdDevis=row[0],
                IdDevisDetail=row[1],
                NumeroImmatriculation=donnees_assure,
                OutputMessage=row[2],
            )
            data_insertion_result_list.append(sql_output)

            # Si l'utilisateur a saisi un accessoire manuel, le persister
            # pour éviter le recalcul lors de la confirmation du devis.
            returned_id = row[0]
            if returned_id and accessoire_manuel and accessoire_manuel > 0:
                try:
                    devis_obj = Devis.objects.get(iddevis=returned_id)
                    devis_obj.prime_imposee = True
                    devis_obj.accessoire = accessoire_manuel
                    devis_obj.save(update_fields=["prime_imposee", "accessoire"])
                except Devis.DoesNotExist:
                    pass

    except Exception as error:
        error_occured = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]

        sql_output = QuotationInsertionResult(
            IdDevis=save_quotation_arg[27],
            IdDevisDetail=save_quotation_arg[28],
            NumeroImmatriculation=donnees_assure,
            OutputMessage=err_msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


#########################################################################
def save_insured_ia(input_data):
    sql_output = None
    error_occured = False
    IdAssure = int(input_data["IdAssure"])
    IdOffre = int(input_data["IdOffre"])
    DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        input_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateEmission = date_emission_du_jour()
    CapitalDeces = Decimal(input_data["CapitalDeces"])
    CapitalIpp = Decimal(input_data["CapitalIpp"])
    FraisTraitement = Decimal(input_data["FraisTraitement"])
    TauxReduction = Decimal(input_data["TauxReduction"])
    CodeActivite = str(input_data["CodeActivite"])
    DateNaissance = datetime.strptime(
        input_data["DateNaissance"], "%d-%m-%Y"
    ).date()
    IdDevis = 0
    IdDevisDetail = 0
    if input_data["IdDevis"]:
        IdDevis = int(input_data["IdDevis"])

    if input_data["IdDevisDetail"]:
        IdDevisDetail = int(input_data["IdDevisDetail"])

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        # status = 0
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_assure_ia(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    IdAssure,
                    IdOffre,
                    DateEffet,
                    DateExpiration,
                    DateEmission,
                    CapitalDeces,
                    CapitalIpp,
                    FraisTraitement,
                    TauxReduction,
                    CodeActivite,
                    DateNaissance,
                    IdDevis,
                    IdDevisDetail,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=0, OutputMessage=err_msg)
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


#########################################################################
# save quotation (Travel Insurance)
def save_quotation_voyage(input_data):
    sql_output = None
    error_occured = False
    IdIntermediaire = int(input_data["IdIntermediaire"])
    IdCompagnie = int(input_data["IdCompagnie"])
    IdProduit = int(input_data["IdProduit"])
    IdOffre = int(input_data["IdOffre"])
    IdAvenant = int(input_data["IdAvenant"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])
    Coassurance = bool(input_data["Coassurance"])
    DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        input_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateEmission = date_emission_du_jour()
    IdTarif = int(input_data["IdTarif"])
    TauxReduction = Decimal(input_data["TauxReduction"])
    DateNaissance = datetime.strptime(
        input_data["DateNaissance"], "%d-%m-%Y"
    ).date()

    IdDevis = 0
    if "IdDevis" in input_data:
        if input_data["IdDevis"]:
            IdDevis = int(input_data["IdDevis"])

    IdPaysDestination = 1
    if "IdPaysDestination" in input_data:
        if input_data["IdPaysDestination"]:
            IdPaysDestination = int(input_data["IdPaysDestination"])

    IdPaysVoyageur = 1
    if "IdPaysVoyageur" in input_data:
        if input_data["IdPaysVoyageur"]:
            IdPaysVoyageur = int(input_data["IdPaysVoyageur"])

    ReferenceContrat = ""
    if "ReferenceContrat" in input_data:
        ReferenceContrat = (
            str(input_data["ReferenceContrat"])
            if input_data["ReferenceContrat"]
            else ""
        )

    NumeroAttestation = ""
    if "NumeroAttestation" in input_data:
        NumeroAttestation = (
            str(input_data["NumeroAttestation"])
            if input_data["NumeroAttestation"]
            else ""
        )

    NumeroPasseport = ""
    if "NumeroPasseport" in input_data:
        NumeroPasseport = (
            str(input_data["NumeroPasseport"])
            if input_data["NumeroPasseport"]
            else ""
        )

    Schengen = False
    if "Schengen" in input_data:
        Schengen = (
            bool(input_data["Schengen"]) if input_data["Schengen"] else False
        )

    NumeroPoliceCompagnie = ""
    if "NumeroPoliceCompagnie" in input_data:
        NumeroPoliceCompagnie = (
            str(input_data["NumeroPoliceCompagnie"])
            if input_data["NumeroPoliceCompagnie"]
            else ""
        )

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()

    msg = check_quote(IdDevis)
    if msg:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        )
        return (
            True,
            list(chain(queryset_vide, data_insertion_result_list)),
        )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_voyage(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    IdIntermediaire,
                    IdCompagnie,
                    IdProduit,
                    IdOffre,
                    IdAvenant,
                    IdClient,
                    IdAssure,
                    Flotte,
                    Coassurance,
                    DateEffet,
                    DateExpiration,
                    DateEmission,
                    IdTarif,
                    IdPaysDestination,
                    IdPaysVoyageur,
                    ReferenceContrat,
                    NumeroAttestation,
                    Schengen,
                    NumeroPasseport,
                    TauxReduction,
                    DateNaissance,
                    NumeroPoliceCompagnie,
                    IdDevis,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=0, OutputMessage=err_msg)
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


##################################################################################################
# Save Quotation - House Insurance
def save_quotation_mrh(user_id, input_data):
    sql_output = None
    error_occurred = False
    IdIntermediaire = int(input_data["IdIntermediaire"])
    IdCompagnie = int(input_data["IdCompagnie"])
    IdProduit = int(input_data["IdProduit"])
    IdOffre = int(input_data["IdOffre"])
    IdAvenant = int(input_data["IdAvenant"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])
    Coassurance = bool(input_data["Coassurance"])
    DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        input_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateEmission = date_emission_du_jour()
    IdTarif = int(input_data["IdTarif"])
    Gardien = bool(input_data["Gardien"])
    Locataire = bool(input_data["Locataire"])
    TauxReduction = Decimal(input_data["TauxReduction"])
    ValeurCapitalLoyer = Decimal(input_data["ValeurCapitalLoyer"])
    ValeurCapitalContenu = Decimal(input_data["ValeurCapitalContenu"])
    ValeurCapitalObjetPrecieux = Decimal(
        input_data["ValeurCapitalObjetPrecieux"]
    )
    ValeurCapitalMateriel = Decimal(input_data["ValeurCapitalMateriel"])
    ValeurDegatBatiment = Decimal(input_data["ValeurDegatBatiment"])
    ValeurDegatContenu = Decimal(input_data["ValeurDegatContenu"])
    IdDevis = 0
    if "IdDevis" in input_data:
        IdDevis = int(input_data["IdDevis"]) if input_data["IdDevis"] else 0

    Localisation = ""
    if "Localisation" in input_data:
        Localisation = (
            str(input_data["Localisation"])
            if input_data["Localisation"]
            else ""
        )

    IdDuree = 1
    if "IdDuree" in input_data:
        IdDuree = int(input_data["IdDuree"]) if input_data["IdDuree"] else 1

    IdTerme = 1
    if "IdTerme" in input_data:
        IdTerme = int(input_data["IdTerme"]) if input_data["IdTerme"] else 1

    TelephoneAssure = ""
    if "TelephoneAssure" in input_data:
        TelephoneAssure = (
            str(input_data["TelephoneAssure"])
            if input_data["TelephoneAssure"]
            else ""
        )

    NumeroPoliceCompagnie = ""
    if "NumeroPoliceCompagnie" in input_data:
        NumeroPoliceCompagnie = (
            str(input_data["NumeroPoliceCompagnie"])
            if input_data["NumeroPoliceCompagnie"]
            else ""
        )

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    msg = check_quote(IdDevis)
    if msg:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        )
        return (True, list(chain(queryset_vide, data_insertion_result_list)))
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_mrh(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    IdIntermediaire,
                    IdCompagnie,
                    IdProduit,
                    IdOffre,
                    IdAvenant,
                    IdClient,
                    IdAssure,
                    Flotte,
                    Coassurance,
                    DateEffet,
                    DateExpiration,
                    DateEmission,
                    IdTarif,
                    Gardien,
                    Locataire,
                    TauxReduction,
                    ValeurCapitalLoyer,
                    ValeurCapitalContenu,
                    ValeurCapitalObjetPrecieux,
                    ValeurCapitalMateriel,
                    ValeurDegatBatiment,
                    ValeurDegatContenu,
                    Localisation,
                    IdDuree,
                    IdTerme,
                    TelephoneAssure,
                    NumeroPoliceCompagnie,
                    user_id,
                    IdDevis,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occurred = True
        msg = str(error)
        print(error)
        if msg.find("\n"):
            msg = msg.split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


# Save Quotation Damage (IT Risk Insurance)
##################################################################################################
# Save Quotation - Damage Insurance (IT Risk)
def save_quotation_tousrisquesinfo(user_id, input_data):
    sql_output = None
    error_occurred = False
    IdIntermediaire = int(input_data["IdIntermediaire"])
    IdCompagnie = int(input_data["IdCompagnie"])
    IdProduit = int(input_data["IdProduit"])
    IdAvenant = int(input_data["IdAvenant"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])
    Coassurance = bool(input_data["Coassurance"])
    DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        input_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateEmission = date_emission_du_jour()
    IdTarif = int(input_data["IdTarif"])
    TauxPrime = Decimal(input_data["TauxPrime"])
    TauxReduction = Decimal(input_data["TauxReduction"])
    CapitalMaterielInformatique = Decimal(
        input_data["CapitalMaterielInformatique"]
    )
    CapitalFraisReconstitution = Decimal(
        input_data["CapitalFraisReconstitution"]
    )
    CapitalFraisSupplementaire = Decimal(
        input_data["CapitalFraisSupplementaire"]
    )

    CapitalCautionnement = 0
    if (
        "CapitalCautionnement" in input_data
        and input_data["CapitalCautionnement"]
    ):
        CapitalCautionnement = Decimal(input_data["CapitalCautionnement"])

    MontantPrime = Decimal(input_data["MontantPrime"])
    IdDuree = 1
    if "IdDuree" in input_data:
        if input_data["IdDuree"]:
            IdDuree = int(input_data["IdDuree"])

    TelephoneAssure = ""
    if "TelephoneAssure" in input_data:
        TelephoneAssure = (
            str(input_data["TelephoneAssure"])
            if input_data["TelephoneAssure"]
            else ""
        )
    IdDevis = 0
    if "IdDevis" in input_data:
        if input_data["IdDevis"]:
            IdDevis = int(input_data["IdDevis"])

    NumeroPoliceCompagnie = ""
    if "NumeroPoliceCompagnie" in input_data:
        NumeroPoliceCompagnie = (
            str(input_data["NumeroPoliceCompagnie"])
            if input_data["NumeroPoliceCompagnie"]
            else ""
        )

    Accessoire = Decimal("0")
    if "Accessoire" in input_data and input_data["Accessoire"]:
        Accessoire = Decimal(str(input_data["Accessoire"]))

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    msg = check_quote(IdDevis)
    if msg:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        )
        return (
            True,
            list(chain(queryset_vide, data_insertion_result_list)),
        )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_tousrisquesinfo(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    IdIntermediaire,
                    IdCompagnie,
                    IdProduit,
                    IdAvenant,
                    IdClient,
                    IdAssure,
                    Flotte,
                    Coassurance,
                    DateEffet,
                    DateExpiration,
                    DateEmission,
                    IdTarif,
                    TauxPrime,
                    TauxReduction,
                    CapitalMaterielInformatique,
                    CapitalFraisReconstitution,
                    CapitalFraisSupplementaire,
                    # La procédure attend le capital cautionnement ici (25 paramètres) :
                    # sans lui l'appel échouait (« procédure inexistante »)
                    CapitalCautionnement,
                    MontantPrime,
                    IdDuree,
                    TelephoneAssure,
                    NumeroPoliceCompagnie,
                    user_id,
                    IdDevis,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)

            # Si l'utilisateur a saisi un accessoire manuel, le persister
            # pour éviter le recalcul lors de la confirmation du devis.
            returned_id = row[0]
            if returned_id and Accessoire > 0:
                try:
                    devis_obj = Devis.objects.get(iddevis=returned_id)
                    devis_obj.prime_imposee = True
                    devis_obj.accessoire = Accessoire
                    devis_obj.save(update_fields=["prime_imposee", "accessoire"])
                except Devis.DoesNotExist:
                    pass

    except Exception as error:
        error_occurred = True
        print(error)
        msg = str(error)
        if msg.find("\n"):
            msg = msg.split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


# Save Quotation - RC
def save_quotation_risques_divers(user_id: int, input_data: dict):
    sql_output = None
    error_occurred = False

    # Utilitaires pour récupérer les champs avec valeur par défaut
    def get_int(key, default=0):
        return (
            int(input_data.get(key, default))
            if input_data.get(key)
            else default
        )

    def get_str(key, default=""):
        return (
            str(input_data.get(key, default))
            if input_data.get(key)
            else default
        )

    def get_decimal(key, default=Decimal(0)):
        return (
            Decimal(input_data.get(key, default))
            if input_data.get(key)
            else default
        )

    def get_date(key):
        val = input_data.get(key)
        return datetime.strptime(val, "%d-%m-%Y").date() if val else None

    # Préparation des paramètres
    IdIntermediaire = get_int("IdIntermediaire")
    IdCompagnie = get_int("IdCompagnie")
    IdProduit = get_int("IdProduit")
    IdOffre = get_int("IdOffre")
    IdAvenant = get_int("IdAvenant")
    IdClient = get_int("IdClient")
    IdAssure = get_int("IdAssure")
    Flotte = bool(input_data.get("Flotte", False))
    Coassurance = bool(input_data.get("Coassurance", False))
    DateEffet = input_data.get("DateEffet", None)
    DateExpiration = input_data.get("DateExpiration", None)
    DateEmission = date_emission_du_jour()
    DateDebut = input_data.get("DateDebut", None)
    IdDomaineActivite = get_int("IdDomaineActivite")
    Activite = get_str("Activite")
    Localisation = get_str("Localisation")
    IdTarif = get_int("IdTarif")
    TauxPrime = get_decimal("TauxPrime")
    TauxReduction = get_decimal("TauxReduction")
    CapitalDommageCorporel = get_decimal("CapitalDommageCorporel")
    CapitalIntoxicationAlimentaire = get_decimal(
        "CapitalIntoxicationAlimentaire"
    )
    CapitalDommageMateriel = get_decimal("CapitalDommageMateriel")
    AssiettePrime = get_decimal("AssiettePrime")
    NombreParticipants = get_decimal("NombreParticipants")
    IdDuree = get_int("IdDuree", 1)
    TelephoneAssure = get_str("TelephoneAssure")
    AdresseGeographique = get_str("AdresseGeographique")
    NumeroPoliceConnexe = get_str("NumeroPoliceConnexe")
    IdDevis = get_int("IdDevis")
    NumeroPoliceCompagnie = get_str("NumeroPoliceCompagnie")
    PrimeNette = get_decimal("PrimeNette")
    Accessoire = get_decimal("Accessoire")
    Taxe = get_decimal("Taxe")
    PrimeTTC = get_decimal("PrimeTTC")
    liste_garantie = json.dumps(
        input_data.get("ListeGarantie", []), default=str
    )

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()

    msg = check_quote(IdDevis)
    if msg:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        )
        return True, list(chain(queryset_vide, data_insertion_result_list))

    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "CALL sp_creation_devis_risques_divers(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                    (
                        IdIntermediaire,
                        IdCompagnie,
                        IdProduit,
                        IdOffre,
                        IdAvenant,
                        IdClient,
                        IdAssure,
                        Flotte,
                        Coassurance,
                        DateEffet,
                        DateExpiration,
                        DateEmission,
                        IdTarif,
                        AssiettePrime,
                        IdDomaineActivite,
                        Activite,
                        Localisation,
                        DateDebut,
                        NombreParticipants,
                        TauxPrime,
                        TauxReduction,
                        CapitalDommageCorporel,
                        CapitalIntoxicationAlimentaire,
                        CapitalDommageMateriel,
                        IdDuree,
                        TelephoneAssure,
                        AdresseGeographique,
                        NumeroPoliceConnexe,
                        NumeroPoliceCompagnie,
                        user_id,
                        PrimeNette,
                        Accessoire,
                        Taxe,
                        PrimeTTC,
                        liste_garantie,
                        IdDevis,
                        OutputMessage,
                    ),
                )
                row = cursor.fetchone()
                if row:
                    sql_output = DataInsertionResult(
                        ObjectId=row[0], OutputMessage=row[1]
                    )
                    data_insertion_result_list.append(sql_output)

                    # Si prime imposée : persister les valeurs manuelles pour
                    # éviter le recalcul automatique lors de la confirmation.
                    returned_id = row[0]
                    if returned_id and PrimeNette > 0:
                        try:
                            devis_obj = Devis.objects.get(iddevis=returned_id)
                            devis_obj.prime_imposee = True
                            devis_obj.primenette = PrimeNette
                            devis_obj.taxe = Taxe
                            devis_obj.primettc = PrimeTTC
                            update_fields = [
                                "prime_imposee",
                                "primenette",
                                "taxe",
                                "primettc",
                            ]
                            if Accessoire > 0:
                                devis_obj.accessoire = Accessoire
                                update_fields.append("accessoire")
                            devis_obj.save(update_fields=update_fields)
                        except Devis.DoesNotExist:
                            pass

    except Exception as error:
        error_occurred = True
        msg = str(error).split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        data_insertion_result_list.append(sql_output)

    return error_occurred, list(
        chain(queryset_vide, data_insertion_result_list)
    )


################################################################################


# Save Quotation - Damage Insurance (Bank Risk)
def save_quotation_globaledebanque(user_id, input_data):
    sql_output = None
    error_occurred = False
    IdIntermediaire = int(input_data["IdIntermediaire"])
    IdCompagnie = int(input_data["IdCompagnie"])
    IdProduit = int(input_data["IdProduit"])
    IdAvenant = int(input_data["IdAvenant"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])
    Coassurance = bool(input_data["Coassurance"])
    DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        input_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateEmission = date_emission_du_jour()
    IdTarif = int(input_data["IdTarif"])
    TauxPrime = Decimal(input_data["TauxPrime"])
    TauxReduction = Decimal(input_data["TauxReduction"])
    CapitalDetournementUsageFaux = Decimal(
        input_data["CapitalDetournementUsageFaux"]
    )
    CapitalDommagesConfondus = Decimal(input_data["CapitalDommagesConfondus"])
    CapitalDeteriorationImmobiliere = Decimal(
        input_data["CapitalDeteriorationImmobiliere"]
    )
    MontantPrime = Decimal(input_data["MontantPrime"])

    IdDuree = 1
    if "IdDuree" in input_data:
        if input_data["IdDuree"]:
            IdDuree = int(input_data["IdDuree"])

    TelephoneAssure = ""
    if "TelephoneAssure" in input_data:
        TelephoneAssure = (
            str(input_data["TelephoneAssure"])
            if input_data["TelephoneAssure"]
            else ""
        )

    IdDevis = 0
    if "IdDevis" in input_data:
        if input_data["IdDevis"]:
            IdDevis = int(input_data["IdDevis"])

    NumeroPoliceCompagnie = ""
    if "NumeroPoliceCompagnie" in input_data:
        NumeroPoliceCompagnie = (
            str(input_data["NumeroPoliceCompagnie"])
            if input_data["NumeroPoliceCompagnie"]
            else ""
        )

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    msg = check_quote(IdDevis)
    if msg:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        )
        return (
            True,
            list(chain(queryset_vide, data_insertion_result_list)),
        )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_globaledebanque(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    IdIntermediaire,
                    IdCompagnie,
                    IdProduit,
                    IdAvenant,
                    IdClient,
                    IdAssure,
                    Flotte,
                    Coassurance,
                    DateEffet,
                    DateExpiration,
                    DateEmission,
                    IdTarif,
                    TauxPrime,
                    TauxReduction,
                    CapitalDetournementUsageFaux,
                    CapitalDommagesConfondus,
                    CapitalDeteriorationImmobiliere,
                    MontantPrime,
                    IdDuree,
                    TelephoneAssure,
                    NumeroPoliceCompagnie,
                    user_id,
                    IdDevis,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occurred = True
        print(error)
        msg = str(error)
        if msg.find("\n"):
            msg = msg.split("\n")[0]
        sql_output = DataInsertionResult(ObjectId=IdDevis, OutputMessage=msg)
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


# Save quotation
def save_quotation(input_data):
    print(input_data)
    error_occurred = False
    sql_output = None
    IdIntermediaire = int(input_data["IdIntermediaire"])
    IdCompagnie = int(input_data["IdCompagnie"])
    IdProduit = int(input_data["IdProduit"])
    IdOffre = int(input_data["IdOffre"])
    IdAvenant = int(input_data["IdAvenant"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])
    Coassurance = bool(input_data["Coassurance"])
    DateEffet = datetime.strptime(input_data["DateEffet"], "%d-%m-%Y").date()
    DateExpiration = datetime.strptime(
        input_data["DateExpiration"], "%d-%m-%Y"
    ).date()
    DateEmission = date_emission_du_jour()
    IdTarif = int(input_data["IdTarif"])
    CodeUsage = int(input_data["CodeUsage"])
    IdCarrosserie = int(input_data["IdCarrosserie"])
    CodeCarburant = int(input_data["CodeCarburant"])
    Puissance = int(input_data["Puissance"])
    NombrePlace = int(input_data["NombrePlace"])
    Charge = int(input_data["Charge"])
    ValeurNeuve = Decimal(input_data["ValeurNeuve"])
    ValeurVenale = Decimal(input_data["ValeurVenale"])
    ValeurAccessoire = Decimal(input_data["ValeurAccessoire"])
    TauxReduction = Decimal(input_data["TauxReduction"])
    CodeAlarme = int(input_data["CodeAlarme"])
    Bns = Decimal(input_data["Bns"])
    DateMec = datetime.strptime(input_data["DateMec"], "%d-%m-%Y").date()

    NomConducteur = ""
    if "NomConducteur" in input_data:
        if input_data["NomConducteur"]:
            NomConducteur = str(input_data["NomConducteur"])

    AdresseConducteur = ""
    if "AdresseConducteur" in input_data:
        if input_data["AdresseConducteur"]:
            AdresseConducteur = str(input_data["AdresseConducteur"])

    IdDuree = 1
    if "IdDuree" in input_data:
        if input_data["IdDuree"]:
            IdDuree = int(input_data["IdDuree"])

    IdTerme = 1
    if "IdTerme" in input_data:
        if input_data["IdTerme"]:
            IdTerme = int(input_data["IdTerme"])

    NumMoteur = ""
    if "NumMoteur" in input_data:
        NumMoteur = (
            str(input_data["NumMoteur"]) if input_data["NumMoteur"] else ""
        )

    NumChassis = ""
    if "NumChassis" in input_data:
        NumChassis = (
            str(input_data["NumChassis"]) if input_data["NumChassis"] else ""
        )

    IdTypeVehicule = int(input_data["IdTypeVehicule"])
    IdMarque = int(input_data["IdMarque"])
    Matricule = str(input_data["Matricule"])

    NumPermisConduire = ""
    if "NumPermisConduire" in input_data:
        if input_data["NumPermisConduire"]:
            NumPermisConduire = str(input_data["NumPermisConduire"])

    IdGenreVehicule = int(input_data["IdGenreVehicule"])

    NumCarteBrunePhysique = ""
    if "NumCarteBrunePhysique" in input_data:
        NumCarteBrunePhysique = (
            str(input_data["NumCarteBrunePhysique"])
            if input_data["NumCarteBrunePhysique"]
            else ""
        )

    ModeleVehicule = ""
    if "ModeleVehicule" in input_data:
        ModeleVehicule = (
            str(input_data["ModeleVehicule"])
            if input_data["ModeleVehicule"]
            else ""
        )

    RemorqueAttelee = False
    if "RemorqueAttelee" in input_data:
        RemorqueAttelee = (
            bool(input_data["RemorqueAttelee"])
            if input_data["RemorqueAttelee"]
            else False
        )

    CodeFormuleSecuriteRoutiere = ""
    if "CodeFormuleSecuriteRoutiere" in input_data:
        CodeFormuleSecuriteRoutiere = (
            str(input_data["CodeFormuleSecuriteRoutiere"])
            if input_data["CodeFormuleSecuriteRoutiere"]
            else ""
        )

    IdOptionAssistance = 0
    if "IdOptionAssistance" in input_data:
        IdOptionAssistance = (
            int(input_data["IdOptionAssistance"])
            if input_data["IdOptionAssistance"]
            else 0
        )
    CarburantAutreMatiere = False
    if "CarburantAutreMatiere" in input_data:
        if input_data["CarburantAutreMatiere"]:
            CarburantAutreMatiere = bool(input_data["CarburantAutreMatiere"])

    TransportEleves = False
    if "TransportEleves" in input_data:
        if input_data["TransportEleves"]:
            TransportEleves = bool(input_data["TransportEleves"])

    TransportEmployes = False
    if "TransportEmployes" in input_data:
        if input_data["TransportEmployes"]:
            TransportEmployes = bool(input_data["TransportEmployes"])

    TansportPassagerSupplementaire = False
    if "TansportPassagerSupplementaire" in input_data:
        if input_data["TansportPassagerSupplementaire"]:
            TansportPassagerSupplementaire = bool(
                input_data["TansportPassagerSupplementaire"]
            )

    NsiaAutoPlus = False
    if "NsiaAutoPlus" in input_data:
        if input_data["NsiaAutoPlus"]:
            NsiaAutoPlus = bool(input_data["NsiaAutoPlus"])
    IdDevis = 0
    IdDevisDetail = 0
    if input_data["IdDevis"]:
        IdDevis = int(input_data["IdDevis"])

    if input_data["IdDevisDetail"]:
        IdDevisDetail = int(input_data["IdDevisDetail"])

    NumeroPoliceCompagnie = ""
    if "NumeroPoliceCompagnie" in input_data:
        NumeroPoliceCompagnie = (
            str(input_data["NumeroPoliceCompagnie"])
            if input_data["NumeroPoliceCompagnie"]
            else ""
        )

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = QuotationInsertionResult.objects.none()
    if IdDevis != 0:
        etat = etat_devis(IdDevis)
        if etat in (DEVIS_INEXISTANT, DEVIS_CONFIRME):
            error_occurred = True
            if etat == DEVIS_INEXISTANT:
                msg = "Devis inexistant. Opération impossible"
            else:
                msg = "Devis déja confirmé. Opération impossible"
            data_insertion_result_list.append(
                QuotationInsertionResult(
                    IdDevis=IdDevis,
                    IdDevisDetail=IdDevisDetail,
                    NumeroImmatriculation=Matricule,
                    OutputMessage=msg,
                )
            )
            return (
                error_occurred,
                list(chain(queryset_vide, data_insertion_result_list)),
            )

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    IdIntermediaire,
                    IdCompagnie,
                    IdProduit,
                    IdOffre,
                    IdAvenant,
                    IdClient,
                    IdAssure,
                    Flotte,
                    Coassurance,
                    DateEffet,
                    DateExpiration,
                    DateEmission,
                    IdTarif,
                    CodeUsage,
                    IdCarrosserie,
                    CodeCarburant,
                    Puissance,
                    NombrePlace,
                    Charge,
                    ValeurNeuve,
                    ValeurVenale,
                    ValeurAccessoire,
                    TauxReduction,
                    CodeAlarme,
                    Bns,
                    NomConducteur,
                    AdresseConducteur,
                    DateMec,
                    NumMoteur,
                    NumChassis,
                    IdTypeVehicule,
                    IdMarque,
                    Matricule,
                    NumPermisConduire,
                    IdGenreVehicule,
                    NumCarteBrunePhysique,
                    ModeleVehicule,
                    RemorqueAttelee,
                    CodeFormuleSecuriteRoutiere,
                    IdOptionAssistance,
                    CarburantAutreMatiere,
                    TransportEleves,
                    TransportEmployes,
                    TansportPassagerSupplementaire,
                    NsiaAutoPlus,
                    NumeroPoliceCompagnie,
                    IdDuree,
                    IdTerme,
                    IdDevis,
                    IdDevisDetail,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = QuotationInsertionResult(
                IdDevis=row[0],
                IdDevisDetail=row[1],
                NumeroImmatriculation=Matricule,
                OutputMessage=row[2],
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occurred = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = QuotationInsertionResult(
            IdDevis=IdDevis,
            IdDevisDetail=IdDevisDetail,
            NumeroImmatriculation=Matricule,
            OutputMessage=err_msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occurred,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


# Finalize Quotation ( Auto & Individuelle Accident)
def quotation_completion(input_data):
    sql_output = None
    error_occured = False
    IdDevis = int(input_data["IdDevis"])
    IdClient = int(input_data["IdClient"])
    IdAssure = int(input_data["IdAssure"])
    Flotte = bool(input_data["Flotte"])

    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_finalisation_devis(%s, %s, %s, %s, %s);",
                (
                    IdDevis,
                    IdClient,
                    IdAssure,
                    Flotte,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=IdDevis,
                OutputMessage=row[0],
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = DataInsertionResult(
            ObjectId=IdDevis,
            OutputMessage=err_msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


################################################################################
# Archive Quote
def archive_quote(input_data, user_id):
    sql_output = None
    error_occured = False
    IdDevis = int(input_data["IdDevis"])
    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_archivage_devis(%s, %s, %s);",
                (
                    IdDevis,
                    user_id,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=IdDevis,
                OutputMessage=row[0],
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = DataInsertionResult(
            ObjectId=IdDevis,
            OutputMessage=err_msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


def unarchive_quote(input_data, user_id):
    sql_output = None
    error_occured = False
    IdDevis = int(input_data["IdDevis"])
    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_desarchivage_devis(%s, %s, %s);",
                (
                    IdDevis,
                    user_id,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=IdDevis,
                OutputMessage=row[0],
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        print(error)
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = DataInsertionResult(
            ObjectId=IdDevis,
            OutputMessage=err_msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


###################################################################
# Delete car from fleet
def cancel_car_input(input_data):
    sql_output = None
    error_occured = False
    IdDevisDetail = int(input_data["IdDevisDetail"])
    OutputMessage = ""
    data_deletion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_suppression_vehicule(%s, %s);",
                (
                    IdDevisDetail,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=IdDevisDetail,
                OutputMessage=row[0],
            )
            data_deletion_result_list.append(sql_output)
    except Exception as error:
        print(error)
        error_occured = True
        err_msg = str(error)
        if err_msg.find("\n") > 0:
            err_msg = err_msg.split("\n")[0]
        sql_output = DataInsertionResult(
            ObjectId=IdDevisDetail,
            OutputMessage=err_msg,
        )
        data_deletion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return (
        error_occured,
        list(chain(queryset_vide, data_deletion_result_list)),
    )


################################################################################
# Enregistrer les ayant-droits
def enregistrer_ayant_droit(input_data):
    sql_output = None
    IdAssure = int(input_data["IdAssure"])
    IdQualiteAyantDroit = int(input_data["IdQualiteAyantDroit"])
    NomAyantDroit = str(input_data["NomAyantDroit"])
    PrenomsAyantDroit = str(input_data["PrenomsAyantDroit"])
    Part = Decimal(input_data["Part"])
    IdAyantDroit = 0
    OutputMessage = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        # status = 0
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_saisie_ayant_droit_ia(%s, %s, %s, %s, %s, %s, %s);",
                (
                    IdAssure,
                    IdQualiteAyantDroit,
                    NomAyantDroit,
                    PrenomsAyantDroit,
                    Part,
                    IdAyantDroit,
                    OutputMessage,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        print(error)
        sql_output = DataInsertionResult(ObjectId=0, OutputMessage=str(error))
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()
    return list(chain(queryset_vide, data_insertion_result_list))


def get_quotation_info(iddevis):
    msg = ""
    res = QuittanceFn.objects.none()
    quittance_proposition_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_quittance_proposition",
                [
                    iddevis,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                qp = QuittanceFn(
                    IdDevis=row[0],
                    RaisonSociale=row[1],
                    LibelleIntermediaire=row[2],
                    IdClient=row[3],
                    NumeroDevis=row[4],
                    NumeroAvenant=row[5],
                    NomClient=row[6],
                    AdresseClient=row[7],
                    DateEffet=row[8],
                    DateExpiration=row[9],
                    DateEmission=row[10],
                    Duree=row[11],
                    PrimeNette=row[12],
                    PrimeNetteHorsFga=row[13],
                    Fga=row[14],
                    Accessoire=row[15],
                    AccessoireCompagnie=row[16],
                    AccessoireIntermediaire=row[17],
                    TaxeEnregistrement=row[18],
                    PrimeTtc=row[19],
                    Confirme=row[20],
                    LibelleProduit=row[21],
                    LibelleCategorie=row[22],
                    CommissionIntermediaire=row[23],
                    CommissionGestionnaire=row[24],
                    CommissionAperition=row[25],
                    TitreClient=row[26],
                    ProfessionClient=row[27],
                    TypeAssure=row[28],
                    TypeSouscripteur=row[29],
                    TelephoneClient=row[30],
                    MobileClient=row[31],
                    AdresseGeographique=row[32],
                    EmailClient=row[33],
                    Cedeao=row[34],
                    LibelleMouvement=row[35],
                    NomAssure=row[36],
                    AdresseAssure=row[37],
                    LibelleOffre=row[38],
                    LibelleBareme=row[39],
                    CodeCategorie=row[40],
                    FraisGestion=row[41],
                    NumeroPoliceConnexe=row[42],
                    CodeIntermediaire=row[43],
                    DateNaissanceClient=row[44],
                    DateNaissanceAssure=row[45],
                    NumeroFacture=row[46],
                )
                quittance_proposition_list.append(qp)
                # print(qp)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(quittance_proposition_list) > 0:
            res = list(chain(res, quittance_proposition_list))

    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


#########################################################################
def get_liste_assure_ia(id, statut):
    msg = ""
    res = AssureIaParDevisOuContrat.objects.none()
    assure_ia_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_assure_ia",
                [
                    id,
                    statut,
                ],
            )

            result = cursor.fetchall()

            # Récupération en lot de Client.Fonction pour tous les assurés
            id_assures = [row[7] for row in result]
            fonctions_map = {}
            if id_assures:
                fonctions_map = {
                    c.IdClient: c.Fonction or ""
                    for c in Client.objects.filter(
                        IdClient__in=id_assures
                    ).only("IdClient", "Fonction")
                }

            for row in result:
                id_assure = row[7]
                # Priorité à Client.Fonction (valeur saisie ou importée depuis le fichier)
                fonction = fonctions_map.get(id_assure, "")
                assure = AssureIaParDevisOuContrat(
                    Nom=row[0],
                    Prenoms=row[1],
                    AdressePostale=row[2],
                    AdresseGeographique=row[3],
                    DateNaissance=row[4],
                    LieuNaissance=row[5],
                    Profession=fonction if fonction else row[6],
                    IdAssure=id_assure,
                    IdDetail=row[8],
                    CapitalDeces=row[9],
                    CapitalInfirmite=row[10],
                    CapitalFraisTraitement=row[11],
                )
                assure_ia_list.append(assure)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(assure_ia_list) > 0:
            res = list(chain(res, assure_ia_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


###############################################################################
def get_taux_reduction_flotte(iddevis):
    taux_reduction = -1
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_taux_reduction_flotte",
                [
                    iddevis,
                ],
            )

            row = cursor.fetchone()
            taux_reduction = row[0]
            # print(taux_reduction)
    except Exception as error:
        print(error)
    finally:
        if connection:
            cursor.close()
            connection.close()

    return taux_reduction


###############################################################################
def get_assure_ia(iddevis):
    msg = ""
    res = AssureIaInfo.objects.none()
    assure_ia_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_assure_ia_info",
                [
                    iddevis,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                assure = AssureIaInfo(
                    id_devis=row[0],
                    id_devis_detail=row[1],
                    id_assure=row[2],
                    nom=row[3],
                    prenoms=row[4],
                    date_naissance=row[5],
                    id_profession=row[6],
                    libelle_profession=row[7],
                    capital_deces=row[8],
                    capital_infirmite=row[9],
                    capital_frais_traitement=row[10],
                    telephone=row[11],
                    adresse_geographique=row[12],
                    lieu_naissance=row[13],
                    prime_nette=row[14],
                    accessoire=row[15],
                    taxe=row[16],
                )
                assure_ia_list.append(assure)
                # print(assure)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(assure_ia_list) > 0:
            res = list(chain(res, assure_ia_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


###############################################################################
def get_encaissement_info_for_sms(idencaissement):
    encaissement_info_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_encaissement_info_pour_sms",
                [
                    idencaissement,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                encaissement_info = {
                    "idclient": row[0],
                    "nomclient": row[1],
                    "mobileclient": row[2],
                    "numeropolice": row[3],
                    "montantencaissement": row[4],
                    "dateencaissement": row[5],
                    "numerorecu": row[6],
                    "solde": row[7],
                }
                encaissement_info_list.append(encaissement_info)
    except Exception as error:
        print(error)
        msg = str(error)
        encaissement_info_list = []
    finally:
        if connection:
            cursor.close()
            connection.close()

    return encaissement_info_list


###############################################################################
### Quittance Contrat
def get_contract_info(idcontrat):
    msg = ""
    res = QuittanceFn.objects.none()
    quittance_contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_quittance_contrat",
                [
                    idcontrat,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                quittance = QuittanceFn(
                    IdContrat=row[0],
                    RaisonSociale=row[1],
                    LibelleIntermediaire=row[2],
                    IdClient=row[3],
                    NumeroPolice=row[4],
                    NumeroAvenant=row[5],
                    NomClient=row[6],
                    AdresseClient=row[7],
                    DateEffet=row[8],
                    DateExpiration=row[9],
                    DateEmission=row[10],
                    Duree=row[11],
                    PrimeNette=row[12],
                    PrimeNetteHorsFga=row[13],
                    Fga=row[14],
                    Accessoire=row[15],
                    AccessoireCompagnie=row[16],
                    AccessoireIntermediaire=row[17],
                    TaxeEnregistrement=row[18],
                    PrimeTtc=row[19],
                    # Confirme=row[20],
                    LibelleProduit=row[21],
                    LibelleCategorie=row[22],
                    CommissionIntermediaire=row[23],
                    CommissionGestionnaire=row[24],
                    CommissionAperition=row[25],
                    TitreClient=row[26],
                    ProfessionClient=row[27],
                    TypeAssure=row[28],
                    TypeSouscripteur=row[29],
                    TelephoneClient=row[30],
                    MobileClient=row[31],
                    AdresseGeographique=row[32],
                    EmailClient=row[33],
                    Cedeao=row[34],
                    LibelleMouvement=row[35],
                    NomAssure=row[36],
                    AdresseAssure=row[37],
                    NumeroQuittance=row[38],
                    LibelleOffre=row[39],
                    LibelleBareme=row[40],
                    IdDevis=row[41],
                    CodeCategorie=row[42],
                    FraisGestion=row[43],
                    NumeroPoliceConnexe=row[44],
                    CodeIntermediaire=row[45],
                    DateNaissanceClient=row[46],
                    DateNaissanceAssure=row[47],
                    NumeroFacture=row[48],
                )
                quittance_contrat_list.append(quittance)
                # print(quittance)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(quittance_contrat_list) > 0:
            res = list(chain(res, quittance_contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


###############################################################################
# GarantieContratFlotteSerializer
def get_contract_coverage(idcontrat):
    msg = ""
    res = GarantieContratFlotte.objects.none()
    garantie_contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_garantie_contrat",
                [
                    idcontrat,
                ],
            )

            result = cursor.fetchall()
            for row in result:
                garantie = GarantieContratFlotte(
                    IdContrat=row[0],
                    NatureRisque=row[1],
                    Garantie=row[2],
                    SommeMaxGarantie=row[3],
                    Franchise=row[4],
                    PrimeNette=row[5],
                )
                garantie_contrat_list.append(garantie)
                # print(garantie)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(garantie_contrat_list) > 0:
            res = list(chain(res, garantie_contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


def get_garantie_souscrite(id_entite, type_entite):
    msg = ""
    res = GarantieSouscrite.objects.none()
    garantie_souscrite_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_garanties_souscrites",
                [
                    id_entite,
                    type_entite,
                ],
            )
            rows = cursor.fetchall()
            for row in rows:
                gs = GarantieSouscrite(
                    idsousgarantie=row[0],
                    libellesousgarantie=row[1],
                    capital=row[2],
                    primeannuelle=row[3],
                    primenette=row[4],
                    textefranchise=row[5],
                    deces=row[6],
                    ipp=row[7],
                    ft=row[8],
                    libelleoption=row[9],
                    entite=type_entite,
                    souscrite=row[10],
                    textegarantiexclusunu=row[11],
                    textecapitalsunu=row[12],
                    texteprimeannuellesunu=row[13],
                    texteprimenettesunu=row[14],
                    reductioncommerciale=row[15],
                    reductionbns=row[16],
                )
                garantie_souscrite_list.append(gs)
                # print(gs)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(garantie_souscrite_list) > 0:
            res = list(chain(res, garantie_souscrite_list))

    finally:
        if connection:
            cursor.close()
            connection.close()
    return (msg, res)


###############################################################################""""
# get_contract_car_list
def get_contract_car_list(id, contrat=True):
    msg = ""
    res = VehiculeContrat.objects.none()
    vehicule_contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_vehicule_flotte",
                [id, contrat],
            )

            result = cursor.fetchall()
            for row in result:
                vehicule = VehiculeContrat(
                    IdContrat=row[0],
                    LibelleTarif=row[1],
                    LibelleCategorie=row[2],
                    IdMarque=row[3],
                    LibelleMarque=row[4],
                    IdTypeVehicule=row[5],
                    LibelleTypeVehicule=row[6],
                    ChargeUtile=row[7],
                    Puissance=row[8],
                    Immatriculation=row[9],
                    DateMec=row[10],
                    CodeEnergie=row[11],
                    LibelleEnergie=row[12],
                    ValeurNeuve=row[13],
                    ValeurVenale=row[14],
                    NombrePlace=row[15],
                    Rc=row[16],
                    Fga=row[17],
                    Cedeao=row[18],
                    Recours=row[19],
                    RecoursAnticipe=row[20],
                    RecoursExpress=row[21],
                    Dommages=row[22],
                    Collision=row[23],
                    BrisDeGlaces=row[24],
                    Incendie=row[25],
                    Explosion=row[26],
                    VolSimple=row[27],
                    VolMainsArmees=row[28],
                    Vandalisme=row[29],
                    VolAccessoires=row[30],
                    IndividuelleChauffeur=row[31],
                    InfirmitePermanente=row[32],
                    IncapaciteTemporaire=row[33],
                    Deces=row[34],
                    FraisTraitement=row[35],
                    Immobilisation=row[36],
                    NsiaAssistCar=row[37],
                    PersonnesTransportees=row[38],
                    RecoursTiersIncendie=row[39],
                    SecuriteRoutiere=row[40],
                    PrimeHorsTaxes=row[41],
                    Reduction=row[42],
                    PrimeNette=row[43],
                )
                vehicule_contrat_list.append(vehicule)
                # print(vehicule)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(vehicule_contrat_list) > 0:
            res = list(chain(res, vehicule_contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


#################################################################################
def get_contract_list_for_pc(referenceclient, referencecontrat):
    msg = ""
    if referenceclient is None:
        referenceclient = ""
    if referencecontrat is None:
        referencecontrat = ""

    res = ContractForPremiumCollection.objects.none()
    contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_contrat_encaissement",
                [
                    referenceclient,
                    referencecontrat,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                contrat = ContractForPremiumCollection(
                    IdContrat=row[0],
                    IdClient=row[1],
                    LibelleCategorie=row[2],
                    NumeroPolice=row[3],
                    NumeroPoliceInterne=row[4],
                    NumeroAvenant=row[5],
                    NumeroQuittance=row[6],
                    NomClient=row[7],
                    DateEffet=row[8],
                    DateExpiration=row[9],
                    DateEmission=row[10],
                    Duree=row[11],
                    PrimeNette=row[12],
                    TaxeEnregistrement=row[13],
                    Commission=row[14],
                    Accessoire=row[15],
                    PrimeTTC=row[16],
                    MontantEncaisse=row[17],
                    Solde=row[18],
                )
                contrat_list.append(contrat)
                # print(contrat)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(contrat_list) > 0:
            res = list(chain(res, contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


########################################################################
def get_contract_list_for_customer(
    nom_client=None,
    telephone_client=None,
    numero_police=None,
    id_produit=0,
    id_client=0,
):
    msg = ""
    if nom_client is None:
        nom_client = ""
    if telephone_client is None:
        telephone_client = ""
    if numero_police is None:
        numero_police = ""

    res = ContractForPremiumCollection.objects.none()
    contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_contrat_client",
                [
                    nom_client,
                    telephone_client,
                    numero_police,
                    id_produit,
                    id_client,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                contrat = ContractForPremiumCollection(
                    IdContrat=row[0],
                    IdClient=row[1],
                    LibelleCategorie=row[2],
                    NumeroPolice=row[3],
                    NumeroAvenant=row[4],
                    NumeroQuittance=row[5],
                    NomClient=row[6],
                    DateEffet=row[7],
                    DateExpiration=row[8],
                    DateEmission=row[9],
                    Duree=row[10],
                    PrimeNette=row[11],
                    TaxeEnregistrement=row[12],
                    Commission=row[13],
                    Accessoire=row[14],
                    PrimeTTC=row[15],
                    MontantEncaisse=row[16],
                    Solde=row[17],
                    Flotte=row[18],
                    LibelleAvenant=row[19],
                    Confirme=row[20],
                )
                contrat_list.append(contrat)
                # print(contrat)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(contrat_list) > 0:
            res = list(chain(res, contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


#############################################################################
def get_certificat_transport(start_date=None, end_date=None, customer_id=None):

    filters = {}

    # Add filter conditions only if they are provided
    if start_date:
        try:
            start_date = convert_to_date(start_date)
            filters["date_debut_periode__gte"] = start_date
        except ValueError as error:
            print(error)
            start_date = None

    if end_date:
        try:
            end_date = convert_to_date(end_date)
            filters["date_fin_periode__lte"] = end_date
        except ValueError as error:
            print(error)
            end_date = None

    if customer_id:
        try:
            customer_id = int(customer_id)
            filters["id_client_uranus"] = customer_id
        except ValueError as error:
            print(error)
            customer_id = None

    return CertificatTransport.objects.filter(**filters).order_by(
        "-date_fin_periode"
    )


########################################################################
def get_encaissement_recherche(referenceclient, referencecontrat):
    msg = ""
    if referenceclient is None:
        referenceclient = ""
    if referencecontrat is None:
        referencecontrat = ""

    res = Encaissement.objects.none()
    detail_encaissement_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_detail_encaissement_police_client",
                [
                    referenceclient,
                    referencecontrat,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                detail_encaissement_list.append(int(row[0]))
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        res = Encaissement.objects.filter(
            idencaissement__in=detail_encaissement_list
        ).order_by("-dateencaissement")
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


##################################################################################
def get_contract_premium_remittance(idcompagnie):
    msg = ""
    res = ContractForPremiumCollection.objects.none()
    contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_liste_quittance_reversement",
                [
                    idcompagnie,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                contrat = ContractForPremiumCollection(
                    IdContrat=row[0],
                    IdClient=row[1],
                    LibelleCategorie=row[2],
                    NumeroPolice=row[3],
                    NumeroAvenant=row[4],
                    NumeroQuittance=row[5],
                    NomClient=row[6],
                    DateEffet=row[7],
                    DateExpiration=row[8],
                    DateEmission=row[9],
                    Duree=row[10],
                    PrimeNette=row[11],
                    TaxeEnregistrement=row[12],
                    Commission=row[13],
                    Accessoire=row[14],
                    PrimeTTC=row[15],
                    MontantEncaisse=row[16],
                    MontantAReverser=row[17],
                    IdDetailEncaissement=row[18],
                    MontantReverse=row[19],
                )
                contrat_list.append(contrat)
                # print(contrat)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(contrat_list) > 0:
            res = list(chain(res, contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


################################################################################
# get_info_encaissement
def get_info_encaissement(detailencaissement):
    msg = ""
    res = PremiumCollectionInfo.objects.none()
    info_enc_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_info_encaissement",
                [
                    detailencaissement,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                infoencaissement = PremiumCollectionInfo(
                    NumeroRecu=row[0],
                    DateEncaissement=row[1],
                    NumeroCheque=row[2],
                    NomTireurCheque=row[3],
                    LibelleBanque=row[4],
                    LibelleModePaiement=row[5],
                    Reference=row[6],
                    MontantEncaissement=row[7],
                    NumeroPolice=row[8],
                    DateEffet=row[9],
                    DateExpiration=row[10],
                    NomCompagnie=row[11],
                    NomAssure=row[12],
                    PrenomsAssure=row[13],
                    TelephoneAssure=row[14],
                    NumeroAvenant=row[15],
                    LibelleProduit=row[16],
                    PrimeTotale=row[17],
                    VersementAnterieur=row[18],
                    TotalVersement=row[19],
                    Solde=row[20],
                    MontantEncaissementEnLettres=row[21],
                )
                info_enc_list.append(infoencaissement)
                # print(infoencaissement)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(info_enc_list) > 0:
            res = list(chain(res, info_enc_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


################################################################################
# get_info_vehicule
def get_info_vehicule(idcontrat):
    msg = ""
    res = InfoVehicule.objects.none()
    info_vehicule_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_get_info_vehicule",
                [
                    idcontrat,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                infovehicule = InfoVehicule(
                    idcontrat=row[0],
                    raisonsociale=row[1],
                    adressecompagnie=row[2],
                    idclient=row[3],
                    numeropolice=row[4],
                    numeroavenant=row[5],
                    nomclient=row[6],
                    adresseclient=row[7],
                    dateeffet=row[8],
                    dateexpiration=row[9],
                    dateemission=row[10],
                    duree=row[11],
                    numeroimmatriculation=row[12],
                    numeromoteur=row[13],
                    numerochassis=row[14],
                    libellecategorie=row[15],
                    libellemarque=row[16],
                    libellecarrosserie=row[17],
                    titreclient=row[18],
                    professionclient=row[19],
                    typeassure=row[20],
                    typesouscripteur=row[21],
                    telephoneclient=row[22],
                    mobileclient=row[23],
                    adressegeographique=row[24],
                    emailclient=row[25],
                    nomassure=row[26],
                    adressepostaleassure=row[27],
                    adressegeographiqueassure=row[28],
                )
                info_vehicule_list.append(infovehicule)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(info_vehicule_list) > 0:
            res = list(chain(res, info_vehicule_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


#################################################################################
# get_info_reversement
#################################################################################
def get_info_reversement(reversement):
    msg = ""
    res = PremiumRemittanceInfo.objects.none()
    info_reversement_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_info_reversement",
                [
                    reversement,
                ],
            )

            f_resultset = cursor.fetchall()
            for row in f_resultset:
                inforeversement = PremiumRemittanceInfo(
                    NumeroReversement=row[0],
                    MontantReversement=row[1],
                    DateReversement=row[2],
                    NomClient=row[3],
                    LibelleProduit=row[4],
                    NomCompagnie=row[5],
                    NumeroPolice=row[6],
                    NumeroAvenant=row[7],
                    DateEffet=row[8],
                    DateExpiration=row[9],
                    PrimeHT=row[10],
                    PrimeTTC=row[11],
                    MontantEncaissement=row[12],
                    AccessoireIntermediaire=row[13],
                    TauxCommission=row[14],
                    Commission=row[15],
                    FraisGestion=row[16],
                    CommissionDeduite=row[17],
                    FraisDeduit=row[18],
                    AccessoireDeduit=row[19],
                )
                info_reversement_list.append(inforeversement)
                # print(inforeversement)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(info_reversement_list) > 0:
            res = list(chain(res, info_reversement_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


#################################################################################""
# get_extended_quotation_info  -- ExtendedDevisInfo
def get_extended_quotation_info(
    iddevis,
    numeropolice,
    nomclient,
    datedebut,
    datefin,
    idproduit,
    limit=50,
    offset=0,
):
    msg = ""
    results = []
    total_count = 0

    sql_query = """
        SELECT *
        FROM fn_get_devis(%s, %s, %s, %s, %s, %s, %s, %s)
    """
    is_client_search = bool(nomclient.strip())

    current_limit = limit
    current_offset = offset

    if is_client_search:
        # Si l'utilisateur recherche par nom, annuler la pagination.
        # Nous voulons tous les résultats pour CE client.
        current_limit = MAX_LIMIT_FOR_SEARCH
        current_offset = 0
    params = [
        iddevis if iddevis != 0 else None,
        numeropolice.strip(),
        nomclient.strip(),
        datedebut,
        datefin,
        idproduit,
        current_limit,
        current_offset,
    ]

    try:
        with connection.cursor() as cursor:
            # Exécuter la procédure stockée
            cursor.execute(sql_query, params)

            # Récupérer les noms de colonnes pour les utiliser comme clés de dictionnaire
            columns = [col[0] for col in cursor.description]

            # Récupérer toutes les lignes (seulement 50 grâce au LIMIT de la PS)
            rows = cursor.fetchall()

            if rows:
                # 1. Récupération du total (doit être fait avant de mapper)
                total_count = rows[0][-1]

                # 2. OPTIMISATION : Utilisation de la Compréhension de Liste pour le mapping
                results = [dict(zip(columns, row)) for row in rows]
            else:
                results = []

    except Exception as error:
        print(f"Erreur SQL/DB Connection: {error}")
        msg = str(error)
        # Retourne des valeurs sûres en cas d'échec
        return (msg, [], 0)

    return ("", results, total_count)


def get_quotation_counts(idproduit):
    """Compte exact des devis (en attente) et contrats (confirmés) d'un produit.

    Même périmètre que fn_get_devis (non archivés, émis sur les 3 dernières
    années) mais sans pagination, pour alimenter les cartes de synthèse.
    """
    sql_query = """
        SELECT
            COUNT(*) FILTER (WHERE confirme IS NOT TRUE) AS nb_devis,
            COUNT(*) FILTER (WHERE confirme IS TRUE) AS nb_contrats
        FROM public.vue_devis
        WHERE idproduit = %s
            AND NOT archive
            AND dateemission::date BETWEEN CURRENT_DATE - INTERVAL '3 years' AND CURRENT_DATE
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql_query, [idproduit])
            nb_devis, nb_contrats = cursor.fetchone()
    except Exception as error:
        print(f"Erreur SQL/DB Connection: {error}")
        return (str(error), 0, 0)
    return ("", nb_devis or 0, nb_contrats or 0)


#####################################################################
# Save premium collection
def save_premium_collection(user, input_data):
    def texte(cle):
        return str(input_data.get(cle) or "").strip()

    mode_encaissement = int(input_data["mode_encaissement"])
    mode = ModeEncaissement.objects.filter(
        idmodeencaissement=mode_encaissement
    ).first()
    abrege = (mode.abregereglement or "").strip().upper() if mode else ""
    compensation = bool(mode and mode.compensation)

    banque = 1
    if input_data.get("banque"):
        banque = int(input_data["banque"])

    montant_total = Decimal(input_data["montant_total"])
    # Numéro du chèque, du virement ou de la traite selon le mode
    numero_cheque = texte("numero_cheque")
    # Seuls les chèques passent par le portefeuille (stdcheque) : un virement ou une traite
    # garde son numéro sur l'encaissement sans y créer de chèque
    utilisation_cheque = abrege == "CHQ" and banque != 1 and numero_cheque != ""
    montant_initial_cheque = None
    if input_data.get("montant_initial_cheque"):
        montant_initial_cheque = Decimal(input_data["montant_initial_cheque"])

    reference_encaissement = texte("reference_encaissement")
    # Paiement mobile saisi à la caisse : le reçu remis par l'opérateur tient lieu de
    # référence (sp_enregistrement_encaissement v4 ne vérifie DistriPay que sur un UUID)
    numero_recu_operateur = texte("numero_recu_operateur") if abrege == "PYM" else ""
    if numero_recu_operateur:
        reference_encaissement = numero_recu_operateur
    numero_bordereau = texte("numero_bordereau") if abrege == "ESP" else ""
    reference_compensation = texte("reference_compensation")
    motif_compensation = texte("motif_compensation") if compensation else ""
    reference_reencaissement = texte("reference_reencaissement")
    id_cheque_impaye = input_data.get("id_cheque_impaye")

    if compensation and not motif_compensation:
        raise ValidationError("Le motif de la compensation doit être précisé.")
    if numero_recu_operateur and Encaissement.objects.filter(
        numero_recu_operateur__iexact=numero_recu_operateur, piece_annulee=False
    ).exists():
        raise ValidationError(
            "Ce numéro de reçu de l'opérateur a déjà servi pour un autre encaissement."
        )

    nom_emetteur = str(input_data["nom_emetteur"])
    date_encaissement = datetime.strptime(
        input_data["date_encaissement"], "%d-%m-%Y"
    ).date()
    liste_quittance = list(input_data["liste_quittance"])
    liste_q = ";".join([d["numero_quittance"] for d in liste_quittance])
    liste_m = ";".join(
        [str(d["montant_encaissement"]) for d in liste_quittance]
    )

    id_encaissement = 0
    output_message = ""
    cheque = None

    with transaction.atomic():
        # Réencaissement d'un chèque impayé : ses références sont obligatoires
        cheque_impaye = None
        if id_cheque_impaye:
            cheque_impaye = (
                Cheque.objects.select_for_update()
                .filter(id_cheque=int(id_cheque_impaye), statut=Cheque.Statut.IMPAYE)
                .first()
            )
            if not cheque_impaye:
                raise ValidationError(
                    "Chèque impayé introuvable ou déjà réencaissé."
                )
            if not reference_reencaissement:
                raise ValidationError(
                    "Les références du réencaissement doivent être renseignées."
                )

        # 1. Tentative de récupération ou création du chèque
        # On verrouille la ligne pour éviter les accès concurrents (select_for_update)
        if utilisation_cheque:
            cheque = (
                Cheque.objects.select_for_update()
                .filter(numero_cheque=numero_cheque, banque_id=banque)
                .first()
            )
            if cheque and cheque.statut == Cheque.Statut.IMPAYE:
                raise ValidationError(
                    "Ce chèque est revenu impayé : il ne peut plus régler de quittance."
                )

            if not cheque:
                # Premier usage : le montant_initial est obligatoire
                m_initial = montant_initial_cheque
                if not m_initial or float(m_initial) <= 0:
                    raise ValidationError(
                        "Le montant initial est requis pour le premier usage de ce chèque."
                    )

                cheque = Cheque.objects.create(
                    numero_cheque=numero_cheque,
                    banque_id=banque,
                    montant_initial=m_initial,
                    solde_disponible=m_initial,
                )

            # 2. Vérification de la suffisance du solde
            if cheque.solde_disponible < montant_total:
                raise ValidationError(
                    f"Solde du chèque insuffisant. Restant: {cheque.solde_disponible}"
                )
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_enregistrement_encaissement(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    user.id,
                    mode_encaissement,
                    date_encaissement,
                    banque,
                    montant_total,
                    numero_cheque,
                    reference_encaissement,
                    reference_compensation,
                    nom_emetteur,
                    liste_q,
                    liste_m,
                    id_encaissement,
                    output_message,
                ),
            )
            row = cursor.fetchone()
        if row:
            id_enc_genere = row[0]
            msg_retour = row[1]

        if id_enc_genere == 0:
            raise ServiceError(detail=msg_retour)

        # 3. Compléments de saisie que la procédure ne connaît pas
        Encaissement.objects.filter(idencaissement=id_enc_genere).update(
            numero_bordereau=numero_bordereau or None,
            numero_recu_operateur=numero_recu_operateur or None,
            motif_compensation=motif_compensation or None,
            reference_reencaissement=reference_reencaissement or None,
            cheque_impaye=cheque_impaye,
        )

        # 4. Mise à jour du chèque et enregistrement de l'opération
        if utilisation_cheque:
            cheque.solde_disponible -= montant_total
            # Chèque de l'échéancier : il est déposé et encaissé ce jour
            if cheque.statut == Cheque.Statut.A_DEPOSER:
                cheque.statut = Cheque.Statut.ENCAISSE
            if not cheque.date_depot:
                cheque.date_depot = date_encaissement
            cheque.save()

            ChequeOperation.objects.create(
                cheque=cheque,
                id_encaissement=id_enc_genere,
                utilisateur=user,
                montant_operation=montant_total,
                date_operation=date_encaissement,
            )

        # 5. Chèque impayé entièrement réencaissé
        if cheque_impaye:
            reencaisse = Encaissement.objects.filter(
                cheque_impaye=cheque_impaye,
                piece_annulee=False,
                montantencaissement__gt=0,
            ).aggregate(total=Sum("montantencaissement"))["total"] or Decimal("0")
            if reencaisse >= (cheque_impaye.montant_impaye or Decimal("0")):
                cheque_impaye.statut = Cheque.Statut.REENCAISSE
                cheque_impaye.save(update_fields=["statut"])

    res_dict = {
        "id_encaissement": id_enc_genere,
        "message": msg_retour,
    }
    if utilisation_cheque:
        res_dict["solde_restant_cheque"] = cheque.solde_disponible
    return res_dict


def decaisser_cheque_impaye(user, id_cheque, motif, date_decaissement):
    """
    Chèque revenu impayé : annule chacun des encaissements qu'il a réglés
    (sp_annulation_encaissement : contre-passation, quittances de nouveau à encaisser,
    solde client rétabli) et le marque impayé avec le motif du décaissement.
    """
    motif = str(motif or "").strip()
    if not motif:
        raise ValidationError("Le motif du décaissement doit être précisé.")
    with transaction.atomic():
        cheque = Cheque.objects.select_for_update().filter(id_cheque=id_cheque).first()
        if not cheque:
            raise ValidationError("Chèque introuvable.")
        if cheque.statut != Cheque.Statut.ENCAISSE:
            raise ValidationError(
                f"Ce chèque est « {cheque.get_statut_display()} » : décaissement impossible."
            )
        ids = list(cheque.operations.values_list("id_encaissement", flat=True))
        encaissements = list(
            Encaissement.objects.filter(idencaissement__in=ids, piece_annulee=False)
        )
        if not encaissements:
            raise ValidationError(
                "Aucun encaissement en cours n'a été réglé par ce chèque."
            )
        montant = Decimal("0")
        for encaissement in encaissements:
            with connection.cursor() as cursor:
                cursor.execute(
                    "CALL sp_annulation_encaissement(%s, %s, %s, %s, %s, %s);",
                    (
                        encaissement.idencaissement,
                        user.id,
                        date_decaissement,
                        f"Chèque impayé : {motif}"[:255],
                        0,
                        "",
                    ),
                )
                row = cursor.fetchone()
            if not row or not row[0]:
                raise ServiceError(
                    detail=(row[1] if row and row[1] else "Annulation de l'encaissement impossible.")
                )
            montant += encaissement.montantencaissement
        cheque.statut = Cheque.Statut.IMPAYE
        cheque.motif_decaissement = motif
        cheque.date_decaissement = date_decaissement
        cheque.montant_impaye = montant
        cheque.solde_disponible = Decimal("0")
        cheque.save()
    return {
        "id_cheque": cheque.id_cheque,
        "montant_impaye": montant,
        "encaissements_annules": len(encaissements),
        "message": f"Chèque déclaré impayé : {len(encaissements)} encaissement(s) annulé(s).",
    }


def enregistrer_echeancier_cheques(id_client, id_banque, cheques, observation=""):
    """
    Chèques remis d'avance par un client, à déposer à des dates précises : ils entrent au
    portefeuille « à déposer » et servent ensuite à l'encaissement par leur numéro.
    """
    if not cheques:
        raise ValidationError("Saisissez au moins un chèque.")
    if not Client.objects.filter(IdClient=id_client).exists():
        raise ValidationError("Client introuvable.")
    crees = []
    with transaction.atomic():
        for ligne in cheques:
            numero = str(ligne.get("numero_cheque") or "").strip()
            montant = Decimal(str(ligne.get("montant") or 0))
            echeance = ligne.get("date_echeance")
            if not numero or montant <= 0 or not echeance:
                raise ValidationError(
                    "Chaque chèque doit avoir un numéro, un montant et une date de dépôt."
                )
            if Cheque.objects.filter(numero_cheque=numero, banque_id=id_banque).exists():
                raise ValidationError(
                    f"Le chèque n° {numero} de cette banque est déjà enregistré."
                )
            crees.append(
                Cheque.objects.create(
                    numero_cheque=numero,
                    banque_id=id_banque,
                    montant_initial=montant,
                    solde_disponible=montant,
                    statut=Cheque.Statut.A_DEPOSER,
                    client_id=id_client,
                    date_echeance=echeance,
                    observation=str(observation or "").strip() or None,
                )
            )
    return crees


#####################################################################
# Save premium collection
def save_premium_collection_cancellation(user_id, input_data):
    sql_output = None
    error_occured = False
    id_encaissement = int(input_data["id_encaissement"])
    date_annulation = input_data["date_annulation"]
    motif_annulation = str(input_data["motif_annulation"])
    id_nouvel_encaissement = 0
    output_message = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_annulation_encaissement(%s, %s, %s, %s, %s, %s);",
                (
                    id_encaissement,
                    user_id,
                    date_annulation,
                    motif_annulation,
                    id_nouvel_encaissement,
                    output_message,
                ),
            )
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0],
                OutputMessage=row[1],
            )
            data_insertion_result_list.append(sql_output)
    except Exception:
        raise

    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


#####################################################################
# Save plate number
def save_plate_number(user_id, input_data):
    sql_output = None
    error_occured = False
    date_emission = date_emission_du_jour()
    date_effet = datetime.strptime(input_data["date_effet"], "%d-%m-%Y").date()
    id_devis_ancien = int(input_data["id_devis_ancien"])
    id_devis_detail_ancien = int(input_data["id_devis_detail_ancien"])
    numero_immatriculation = str(input_data["numero_immatriculation"])
    numero_carte_brune_physique = str(
        input_data["numero_carte_brune_physique"]
    )
    (id_devis, id_devis_detail, id_produit, id_avenant) = (0, 0, 1, 10)
    if "id_devis" in input_data:
        if input_data["id_devis"]:
            id_devis = int(input_data["id_devis"])

    if "id_devis_detail" in input_data:
        if input_data["id_devis_detail"]:
            id_devis_detail = int(input_data["id_devis_detail"])

    if "id_produit" in input_data:
        if input_data["id_produit"]:
            id_produit = int(input_data["id_produit"])

    if "id_avenant" in input_data:
        if input_data["id_avenant"]:
            id_avenant = int(input_data["id_avenant"])

    output_message = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_changement_immatriculation(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    user_id,
                    id_devis_ancien,
                    id_devis_detail_ancien,
                    id_produit,
                    id_avenant,
                    numero_carte_brune_physique,
                    numero_immatriculation,
                    date_emission,
                    date_effet,
                    id_devis,
                    id_devis_detail,
                    output_message,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0],
                OutputMessage=row[2],
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        msg = str(error)
        print(msg)
        if msg.find("\n") > 0:
            msg = msg.split("\n")[0]
        sql_output = DataInsertionResult(
            ObjectId=id_devis,
            OutputMessage=msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


#####################################################################
# Save policy cancellation or renewal or change effective date
def policy_modification(user_id, input_data):

    sql_output = None
    error_occured = False
    date_emission = date_emission_du_jour()

    date_effet = None
    if "date_effet" in input_data and input_data["date_effet"]:
        date_effet = parse_date_string(input_data["date_effet"])
        if date_effet:
            date_effet = date_effet.date()

    date_expiration = None
    if "date_expiration" in input_data and input_data["date_expiration"]:
        date_expiration = parse_date_string(input_data["date_expiration"])
        if date_expiration:
            date_expiration = date_expiration.date()

    id_contrat = int(input_data["id_contrat"])
    id_avenant = int(input_data["id_avenant"])
    motif_annulation = ""
    if "motif_annulation" in input_data:
        if input_data["motif_annulation"]:
            motif_annulation = str(input_data["motif_annulation"])
    output_message = ""
    id_devis = 0
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    print(f"valeur dans le CALL : {user_id}, {id_contrat}, {id_avenant}, {date_emission}, {date_effet}, {date_expiration}, {motif_annulation}, {id_devis}, {output_message}")
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_avenant_initiation(%s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    user_id,
                    id_contrat,
                    id_avenant,
                    date_emission,
                    date_effet,
                    date_expiration,
                    motif_annulation,
                    id_devis,
                    output_message,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0],
                OutputMessage=row[1],
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_occured = True
        msg = str(error)
        print(msg)
        if msg.find("\n") > 0:
            msg = msg.split("\n")[0]
        sql_output = DataInsertionResult(
            ObjectId=id_devis,
            OutputMessage=msg,
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )


#####################################################################


##########################################################################
# Save Premium Remittance
def save_premium_remittance(user_id, input_data):

    compagnie = input_data["compagnie"]
    mode_reversement = input_data.get("mode_reversement")
    banque = input_data.get("banque", 1)
    montant_total = input_data["montant_total"]
    numero_cheque = input_data.get("numero_cheque", "")
    nom_emetteur = input_data.get("nom_emetteur", "")
    reference_reversement = input_data.get("reference_reversement", "")
    reference_compensation = input_data.get("reference_compensation", "")
    date_reversement = input_data.get("date_reversement")

    # Ici, on garde les listes telles quelles
    liste_enc = [
        d["identifiant_encaissement"] for d in input_data["liste_encaissement"]
    ]
    liste_mont = [
        Decimal(d["montant_reversement"])
        for d in input_data["liste_encaissement"]
    ]

    id_reversement = 0
    output_message = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_enregistrement_reversement(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    user_id,
                    compagnie,
                    liste_enc,
                    liste_mont,
                    mode_reversement,
                    date_reversement,
                    banque,
                    montant_total,
                    numero_cheque,
                    nom_emetteur,
                    reference_reversement,
                    reference_compensation,
                    id_reversement,
                    output_message,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=row[0], OutputMessage=row[1]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        sql_output = DataInsertionResult(
            ObjectId=id_reversement, OutputMessage=str(error)
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()

    return list(chain(queryset_vide, data_insertion_result_list))


##########################################################################
# Save Premium Remittance
def premium_remittance_validation(user_id, input_data):
    id_reversement = input_data["id_reversement"]
    mode_reversement = input_data["mode_reversement"]
    date_reversement = input_data["date_reversement"]
    reference_reversement = input_data["reference_reversement"]
    banque = input_data.get("banque", 1)
    numero_cheque = input_data.get("numero_cheque", "")
    nom_emetteur = input_data.get("nom_emetteur", "")
    reference_compensation = input_data.get("reference_compensation", "")
    output_message = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    error_occured = False
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL public.sp_validation_reversement(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
                (
                    user_id,
                    id_reversement,
                    mode_reversement,
                    date_reversement,
                    banque,
                    numero_cheque,
                    nom_emetteur,
                    reference_reversement,
                    reference_compensation,
                    output_message,
                ),
            )
            connection.commit()
            row = cursor.fetchone()
            sql_output = DataInsertionResult(
                ObjectId=id_reversement, OutputMessage=row[0]
            )
            data_insertion_result_list.append(sql_output)
    except Exception as error:
        error_message = str(error).split("\n")[0]
        error_occured = True
        sql_output = DataInsertionResult(
            ObjectId=id_reversement, OutputMessage=error_message
        )
        data_insertion_result_list.append(sql_output)
    finally:
        if connection:
            cursor.close()
            connection.close()

    return error_occured, list(
        chain(queryset_vide, data_insertion_result_list)
    )


#################################################################################
# get_extended_quotation_info  -- ExtendedDevisInfo
def get_contrat_echeance():
    msg = ""
    res = ContratEcheance.objects.none()
    contrat_list = []
    try:
        with connection.cursor() as cursor:
            cursor.callproc(
                "fn_contrat_avis_echeance",
                [],
            )

            result = cursor.fetchall()
            for row in result:
                contrat = ContratEcheance(
                    id_contrat=row[0],
                    numero_police=row[1],
                    numero_mobile=row[2],
                    date_expiration=row[3],
                    libelle_produit=row[4],
                )
                contrat_list.append(contrat)
    except Exception as error:
        print(error)
        msg = str(error)
    else:
        if len(contrat_list) > 0:
            res = list(chain(res, contrat_list))
    finally:
        if connection:
            cursor.close()
            connection.close()

    return (msg, res)


def correction_devis(data):
    """
    Appelle une procédure stockée sp_correction_devis en lui passant les données JSON.
    Gère les erreurs et retourne un dictionnaire de résultat.
    """
    output_message = ""
    try:
        data_dict = cast(dict, data)
        # Récupérer l'ID du produit s'il est présent
        id_produit = 0
        if "id_produit" in data:
            id_produit = data_dict.pop("id_produit", 0)

        # Date d'émission imposée : celle du jour de la correction
        data_dict["date_emission"] = date_emission_du_jour()

        # Convertir les données validées du sérialiseur en une chaîne JSON
        json_data = json.dumps(data, default=str)

        placeholder = "()"
        params = []
        # Le nom de ta procédure stockée et ses paramètres
        if id_produit == 1:
            procedure_name = "sp_correction_devis"
            placeholder = "(%s, %s)"
            params = [
                json_data,
                output_message,
            ]
        elif id_produit == 2:
            procedure_name = "sp_correction_devis_ia"
            id_devis = data_dict["id_devis"]
            prime_annuelle = data_dict["prime_annuelle"]
            prime_nette = data_dict["prime_nette"]
            placeholder = "(%s, %s, %s, %s)"
            params = [id_devis, prime_annuelle, prime_nette, output_message]

        # Utilise une transaction atomique pour garantir que l'opération est réussie ou échouée
        with transaction.atomic():
            with connection.cursor() as cursor:
                # Exécuter la procédure stockée avec la chaîne JSON en paramètre
                cursor.execute(
                    f"CALL {procedure_name}{placeholder};",
                    params,
                )

        # Si tout s'est bien passé, retourne le succès
        return {"success": True, "message": output_message}

    except DatabaseError as e:
        # En cas d'erreur de la base de données (ex: violation de contrainte)
        print(e)
        message_part = str(e).split("\n")[0]
        return {
            "success": False,
            "message": "Erreur de base de données : " + message_part,
        }
    except Exception as e:
        # Pour toutes les autres exceptions (ex: erreur de sérialisation)
        return {
            "success": False,
            "message": f"Une erreur inattendue est survenue : {e}",
        }


def appliquer_garanties_vehicule_flotte(id_devis, id_devis_detail, garanties):
    """
    Garanties d'un seul véhicule d'une flotte : la liste reçue remplace celles du véhicule
    (stddevisdetgarantie), puis les totaux du véhicule et du devis sont recalculés
    (sp_finalisation_devis).

    Reprend, pour ce seul véhicule, la boucle de sp_correction_devis : celle-ci ignore
    l'id_devis_detail de chaque garantie et appliquerait la liste à tous les véhicules du devis.
    Comme elle, le FGA (2) n'est jamais une ligne de garantie et la CEDEAO (3) n'est jamais retirée.
    Une garantie absente de la liste est supprimée : le serveur additionne toutes les lignes
    d'un véhicule, acquises ou non.

    garanties : [{"id_garantie", "prime_annuelle", "prime_nette", "capital" (None = inchangé)}]
    Renvoie les primes enregistrées du véhicule et du devis.
    """
    ids = [int(g["id_garantie"]) for g in garanties]
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT idclient, idassure, dateeffet FROM stddevis WHERE iddevis = %s FOR UPDATE;",
                [id_devis],
            )
            id_client, id_assure, date_effet = cursor.fetchone()

            cursor.execute(
                "SELECT idgarantie FROM stddevisdetgarantie WHERE iddevisdet = %s;",
                [id_devis_detail],
            )
            existantes = {row[0] for row in cursor.fetchall()}

            cursor.execute(
                "DELETE FROM stddevisdetgarantie"
                " WHERE iddevisdet = %s AND idgarantie NOT IN (2, 3) AND NOT (idgarantie = ANY(%s));",
                [id_devis_detail, ids],
            )

            for g in garanties:
                id_garantie = int(g["id_garantie"])
                if id_garantie == 2:
                    continue
                capital = g.get("capital")
                if id_garantie in existantes:
                    cursor.execute(
                        "UPDATE stddevisdetgarantie"
                        " SET primeannuelle = %s, primenette = %s, acquise = true, capital = COALESCE(%s, capital)"
                        " WHERE iddevisdet = %s AND idgarantie = %s;",
                        [g["prime_annuelle"], g["prime_nette"], capital, id_devis_detail, id_garantie],
                    )
                else:
                    cursor.execute(
                        "INSERT INTO stddevisdetgarantie(iddevisdet, idgarantie, acquise, capital, franchise, formule,"
                        " primenette, old_acquise, old_capital, old_franchise, old_formule, old_places, old_primenette,"
                        " deces, ipp, fraismed, hosp, minfranchise, maxfranchise, primeannuelle, taxe, textefranchise)"
                        " VALUES (%s, %s, true, %s, 0, 0, %s, '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, %s, 0, 'NEANT');",
                        [id_devis_detail, id_garantie, capital or 0, g["prime_nette"], g["prime_annuelle"]],
                    )

            # Taxe de chaque garantie reçue au taux du produit Automobile (comme sp_correction_devis)
            cursor.execute(
                "UPDATE stddevisdetgarantie AS dd"
                " SET taxe = ROUND((dd.primenette * tt.tauxtaxe) / 100, 0)"
                " FROM stdtauxtaxegarantieproduit AS tt"
                " WHERE tt.idgarantie = dd.idgarantie AND tt.idproduit = 1"
                " AND %s BETWEEN tt.debutvalidite AND tt.finvalidite"
                " AND dd.iddevisdet = %s AND dd.idgarantie <> 2 AND dd.idgarantie = ANY(%s);",
                [date_effet, id_devis_detail, ids],
            )

            # Totaux du véhicule : FGA = 2 % de la RC, primes et taxes sommées sur ses garanties
            cursor.execute(
                "UPDATE stddevisdetail AS dd"
                " SET primeannuelle = m.primeannuelle + m.fgaannuelle, primenette = m.primenette,"
                " fga = m.fganette, taxeenregistrement = m.taxe"
                " FROM (SELECT iddevisdet, SUM(primeannuelle) AS primeannuelle, SUM(primenette) AS primenette,"
                " SUM(CASE WHEN idgarantie = 1 THEN ROUND(primenette * 0.02, 0) ELSE 0 END) AS fganette,"
                " SUM(CASE WHEN idgarantie = 1 THEN ROUND(primeannuelle * 0.02, 0) ELSE 0 END) AS fgaannuelle,"
                " SUM(taxe) AS taxe"
                " FROM stddevisdetgarantie WHERE iddevisdet = %s AND idgarantie <> 2 GROUP BY iddevisdet) AS m"
                " WHERE m.iddevisdet = dd.iddevisdetail;",
                [id_devis_detail],
            )

            cursor.execute(
                "CALL sp_finalisation_devis(%s, %s, %s, %s, %s);",
                [id_devis, id_client, id_assure, True, ""],
            )
            # Primes saisies à la main, comme après sp_correction_devis
            cursor.execute("UPDATE stddevis SET primeimposee = true WHERE iddevis = %s;", [id_devis])

            cursor.execute(
                "SELECT primeannuelle, primenette, fga, taxeenregistrement FROM stddevisdetail WHERE iddevisdetail = %s;",
                [id_devis_detail],
            )
            pa_vehicule, pn_vehicule, fga_vehicule, taxe_vehicule = cursor.fetchone()
            cursor.execute(
                "SELECT primeannuelle, primenette, fga, cedeao, taxe, accessoire, primettc FROM stddevis WHERE iddevis = %s;",
                [id_devis],
            )
            pa, pn, fga, cedeao, taxe, accessoire, ttc = cursor.fetchone()

    return {
        "vehicule": {
            "prime_annuelle": pa_vehicule,
            "prime_nette": pn_vehicule,
            "fga": fga_vehicule,
            "taxe": taxe_vehicule,
        },
        "devis": {
            "prime_annuelle": pa,
            "prime_nette": pn,
            "fga": fga,
            "cedeao": cedeao,
            "taxe": taxe,
            "accessoire": accessoire,
            "prime_ttc": ttc,
        },
    }


def execute_maj_manuelle_primes(
    p_numero_devis: str,
    p_prime_annuelle: float,
    p_prime_nette: float,
    p_accessoire: float,
    p_taxe: float,
    p_fga: float,
    p_cedeao: float,
    p_prime_ttc: float,
):
    """
    Executes the public.maj_manuelle_primes stored procedure.
    """
    # Get the default database connection
    with connections["default"].cursor() as cursor:
        sql = """
            CALL public.sp_maj_manuelle_primes(%s, %s, %s, %s, %s, %s, %s, %s);
        """

        # The arguments must be provided as a tuple
        params = (
            p_numero_devis,
            p_prime_annuelle,
            p_prime_nette,
            p_accessoire,
            p_taxe,
            p_fga,
            p_cedeao,
            p_prime_ttc,
        )

        # Execute the stored procedure
        cursor.execute(sql, params)


def consolider_devis_db(user_id, devis_ids):
    """
    Appelle la procédure stockée PostgreSQL pour consolider plusieurs devis.

    Args:
        user_id: ID de l'utilisateur consolidant les devis
        devis_ids (list): Liste des IDs de devis à consolider

    Returns:
        int: ID du devis consolidé créé

    Raises:
        Exception: En cas d'erreur lors de l'appel à la procédure stockée
    """
    id_devis_consolide = 0
    try:
        with connection.cursor() as cursor:
            # Préparation des paramètres pour la procédure stockée
            # Format: ARRAY[id1, id2, id3, ...]
            devis_ids_array = "{" + ",".join(map(str, devis_ids)) + "}"

            # Appel de la procédure stockée
            cursor.execute(
                "CALL sp_consolidation_devis(%s, %s, %s)",
                [user_id, devis_ids_array, id_devis_consolide],
            )

            # Récupération de l'ID du devis consolidé
            connection.commit()
            result = cursor.fetchone()
            id_devis_consolide = result[0] if result else None

            if not id_devis_consolide:
                raise Exception(
                    "La procédure stockée n'a pas retourné d'ID de devis consolidé."
                )

            return id_devis_consolide

    except Exception as e:
        print(e)
        raise Exception(
            f"Erreur lors de l'appel à la procédure stockée: {str(e)}"
        )


def obtenir_nouveau_numero_devis(
    id_intermediaire: int, id_compagnie: int, code_categorie: str
) -> str:
    """
    Appelle la procédure stockée PostgreSQL et retourne le numéro de devis.
    Lève une exception explicite en cas d'échec.
    """
    # Initialisation des variables de retour
    numero_devis_genere: str = ""
    message_retour: str = ""
    code_categorie = (
        code_categorie.strip() if code_categorie else code_categorie
    )

    try:
        if not code_categorie:
            raise DatabaseError("Categorie non indiquée!")

        with connection.cursor() as cursor:
            cursor.execute(
                "CALL public.sp_generer_numero_devis(%s, %s, %s, %s, %s)",
                [
                    id_intermediaire,
                    id_compagnie,
                    code_categorie,
                    numero_devis_genere,
                    message_retour,
                ],
            )

            # On récupère les valeurs mises à jour par le CALL
            resultat = cursor.fetchone()

            if resultat:
                numero_devis_genere, message_retour = resultat

                # Vérification de la logique métier (si out_message contient 'ERREUR')
                message_retour = message_retour.strip()
                if len(message_retour):
                    raise ValueError(f"Erreur SQL : {message_retour}")

                return numero_devis_genere
            else:
                raise DatabaseError(
                    "La procédure n'a retourné aucun résultat."
                )

    except (DatabaseError, ValueError) as e:
        logger.error(f"Échec de génération du numéro de devis: {e}")
        # On relève l'exception pour que la couche supérieure décide quoi faire
        raise


def obtenir_code_categorie(id_tarif: int) -> str:
    from configuration_api.models import Tarif

    code_categorie = ""

    try:
        tarif = Tarif.objects.get(pk=id_tarif)
        code_categorie = tarif.CodeCategorie
    except Exception as error:
        if code_categorie == "":
            logger.error(f"Échec de récupération du code catégorie: {error}")

    return code_categorie


def offre_mrh_compatible(id_offre: int, code_usage_mrh: str) -> bool:
    from configuration_api.models import UsageHabitation

    offre_compatible = False
    try:
        usage_mrh = UsageHabitation.objects.get(code=code_usage_mrh)
        if usage_mrh and usage_mrh.offre:
            offre_compatible = usage_mrh.offre.pk == id_offre
    except UsageHabitation.DoesNotExist:
        pass
    return offre_compatible
