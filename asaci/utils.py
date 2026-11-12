import json
from openpyxl import load_workbook
from collections import OrderedDict
import requests
from django.db import transaction
from django.db import connection
from django.db.models import Q
from uranus.settings import (
    ASACI_ACCESS_CODE,
    ASACI_INTERMEDIARY_CODE,
    ASACI_OFFICE,
    ASACI_POINT_OF_SALE,
    ASACI_CERTIFICATE_CANCELLATION,
    ASACI_CERTIFICATE_SUSPENSION,
    ASACI_API_BASE_URL,
)
from .models import (
    RetourDemAttestation,
    DetailRetourDemAttestation,
)
from production.models import ContratDetail
from core.utils import round_float_value, check_date_format
from datetime import datetime, date
from urllib.parse import urljoin

APPLY_REQUEST = 1
GET_STATUS_REQUEST = 2
UPDATE_STATUS_REQUEST = 3
GET_APPLICATION_INFO_REQUEST = 4

headers = {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0",
}

# application_url = "https://gk7xb6xytq3v4wglxtzeixikle.apigateway.uk-london-1.oci.customer-oci.com/edition/1.0/Apiediton"
# get_status_url = "https://gk7xb6xytq3v4wglxtzeixikle.apigateway.uk-london-1.oci.customer-oci.com/Verification-statut-demande-edition/1.0/Api-Verification-statut-demande-edition"
# update_status_url = "https://gk7xb6xytq3v4wglxtzeixikle.apigateway.uk-london-1.oci.customer-oci.com/actualisation-du-statut-dattestation/1.0/apiactualisation-statut-attestation"
# get_application_info_url = "https://gk7xb6xytq3v4wglxtzeixikle.apigateway.uk-london-1.oci.customer-oci.com/recuperationAttestation/"

application_url = urljoin(ASACI_API_BASE_URL, "edition/1.0/Apiediton")
get_status_url = urljoin(
    ASACI_API_BASE_URL,
    "Verification-statut-demande-edition/1.0/Api-Verification-statut-demande-edition",
)
update_status_url = urljoin(
    ASACI_API_BASE_URL,
    "actualisation-du-statut-dattestation/1.0/apiactualisation-statut-attestation",
)
get_application_info_url = urljoin(ASACI_API_BASE_URL, "recuperationAttestation/")

apply_return_code_dict = {
    "-36": "Vous n’êtes pas autorisé à utiliser l’API d’édition",
    "-35": "Il existe un doublon en base de donnée",
    "-34": "Erreur sur le code de la zone de circulation",
    "-33": "Erreur sur le code du type de souscripteur",
    "-32": "Erreur sur le code du type d’assuré",
    "-31": "Erreur sur le code de la profession de l’assuré",
    "-30": "Erreur sur le code du type du véhicule",
    "-29": "Erreur sur le code de l’usage du véhicule",
    "-28": "Erreur sur le code du genre du véhicule",
    "-27": "Erreur sur le code de la source d’énergie du véhicule",
    "-26": "Erreur sur le code de la catégorie du véhicule",
    "-25": "Pas de relation entre les l'intermédiaire et la compagnie",
    "-24": "Erreur sur l' adresse mail de l'assuré",
    "-23": "Erreur sur l'adresse mail du souscripteur",
    "-22": "Erreur sur le code de la couleur d'attestation",
    "-21": "Erreur date de souscription inferieure à la date de demande d'édition",
    "-20": "Erreur date d'effet inferieure à la date de souscription",
    "-19": "Erreur sur le format des différentes dates",
    "-18": "Erreur sur les données de la ligne ( X )",
    "-17": "Erreur système",
    "-16": "Erreur de sauvegarde",
    "-15": "Échec de l’édition",
    "-14": "Erreur autorisation d’attestation",
    "-13": "Erreur d’authentification",
    "-12": "Code d’accès incorrect",
    "-11": "Format du fichier invalide",
    "-10": "Structure de fichier invalide",
    "-9": "Données du fichier invalide",
    "-8": "Authentification incorrecte",
    "-7": "Erreur de date d’effet et date d’échéance",
    "-6": "Erreur de durée de contrat",
    "-5": "Erreur de stock d’attestation compagnie",
    "-4": "Erreur de stock d’attestation intermédiaire",
    "-3": "Erreur code intermédiaire",
    "-2": "Erreur code compagnie",
    "-1": "Erreur de doublon",
    "0": "Succès édition",
}

get_status_return_code_dict = {
    "121": "Attestations de la demande d’édition en attente de génération",
    "122": "Attestations de la demande d’édition en cours de génération",
    "123": "Attestations de la demande d’édition générées et en attente de transfert (mises à disposition)",
    "124": "Attestations de la demande d’édition transférées (mises à dispositions)",
}

update_status_return_code_dict = {
    "-4": "Erreur système (Réessayez ou contactez le support)",
    "-3": "Numéro d’attestation incorrect ou non fourni",
    "-2": "Code demandeur incorrect ou non fourni",
    "-1": "Code d’opération incorrect ou non fourni",
    "0": "Opération effectué avec succès",
}

application_col_list = [
    "code_compagnie",
    "date_demande_edition",
    "date_souscription",
    "date_effet",
    "date_echeance",
    "genre_vehicule",
    "numero_immatriculation",
    "type_vehicule",
    "model_vehicule",
    "categorie_vehicule",
    "usage_vehicule",
    "source_energie",
    "nombre_place",
    "marque_vehicule",
    "numero_chassis",
    "numero_moteur",
    "numero_carte_brune_physique",
    "numero_rccm",
    "bureau_enregistreur",
    "nom_souscripteur",
    "type_souscripteur",
    "adresse_mail_souscripteur",
    "numero_telephone_souscripteur",
    "boite_postale_souscripteur",
    "type_assure",
    "nom_assure",
    "adresse_mail_assure",
    "boite_postale_assure",
    "numero_police",
    "numero_telephone_assure",
    "profession_assure",
    "type_point_vente_compagnie",
    "code_point_vente_compagnie",
    "denomination_point_vente_compagnie",
    "rc",
    "code_nature_attestation",
    "garantie",
    "contrat",
    "zone_circulation",
    "date_premiere_mise_en_circulation",
    "valeur_neuve",
    "valeur_venale",
    "montant_autres_garanties",
    "montant_prime_nette_total",
    "montant_accessoires",
    "montant_taxes",
    "montant_carte_brune",
    "fga",
    "montant_prime_ttc",
]

application_header_key_list = [
    "code_demandeur",
    "code_intermediaire",
    "code_compagnie",
    "code_acces",
    "point_de_vente",
    "bureau",
]


class RequestDataLoader:
    @staticmethod
    def get_header(user_id, insurer, access_code=""):
        if not access_code:
            access_code = ASACI_ACCESS_CODE

        requester_code = RequestDataLoader.get_requester_code(user_id)

        data = OrderedDict()
        data["code_demandeur"] = requester_code
        data["code_intermediaire"] = ASACI_INTERMEDIARY_CODE
        data["code_compagnie"] = insurer
        data["code_acces"] = access_code
        data["point_de_vente"] = ASACI_POINT_OF_SALE
        data["bureau"] = ASACI_OFFICE

        return data

    @staticmethod
    def get_requester_code(user_id):
        return "2853776057803"

    @staticmethod
    def load_application_data_from_excel(filename, index=0, insurer=""):
        dict_list = []

        # Les indices des lignes et des colonnes commencent par 1
        book = load_workbook(filename, data_only=True, keep_vba=False)
        sheet = book.worksheets[index]

        # Lecture de la ligne d'entête
        column_count = sheet.max_column

        keys = [
            str(sheet.cell(row=1, column=col_index).value)
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
            if (
                (d["date_demande_edition"] == "NA")
                and (d["date_souscription"] == "NA")
                and (d["date_effet"] == "NA")
                and (d["date_echeance"] == "NA")
                and (d["date_premiere_mise_en_circulation"] == "NA")
            ):
                continue

            # Remove unwanted data, especially blank colums
            d = RequestDataLoader.remove_unwanted_keys(d)

            # Keep only the date not the time
            d["date_demande_edition"] = d["date_demande_edition"][:10]
            d["date_souscription"] = d["date_souscription"][:10]
            d["date_effet"] = d["date_effet"][:10]
            d["date_echeance"] = d["date_echeance"][:10]
            d["date_premiere_mise_en_circulation"] = d[
                "date_premiere_mise_en_circulation"
            ][:10]

            f_format = "%d/%m/%Y"
            iso_format = "%Y-%m-%d"

            if not check_date_format(d["date_demande_edition"]):
                d["date_demande_edition"] = str(
                    datetime.strptime(str(d["date_demande_edition"]), f_format).date()
                )
            else:
                d["date_demande_edition"] = str(
                    datetime.strptime(str(["date_demande_edition"]), iso_format).date()
                )

            if not check_date_format(d["date_souscription"]):
                d["date_souscription"] = str(
                    datetime.strptime(str(d["date_souscription"]), f_format).date()
                )
            else:
                d["date_souscription"] = str(
                    datetime.strptime(str(d["date_souscription"]), iso_format).date()
                )

            if not check_date_format(d["date_effet"]):
                d["date_effet"] = str(
                    datetime.strptime(str(d["date_effet"]), f_format).date()
                )
            else:
                d["date_effet"] = str(
                    datetime.strptime(str(d["date_effet"]), iso_format).date()
                )

            if not check_date_format(d["date_echeance"]):
                d["date_echeance"] = str(
                    datetime.strptime(str(d["date_echeance"]), f_format).date()
                )
            else:
                d["date_echeance"] = str(
                    datetime.strptime(str(d["date_echeance"]), iso_format).date()
                )

            if not check_date_format(d["date_premiere_mise_en_circulation"]):
                d["date_premiere_mise_en_circulation"] = str(
                    datetime.strptime(
                        str(d["date_premiere_mise_en_circulation"]), f_format
                    ).date()
                )
            else:
                d["date_premiere_mise_en_circulation"] = str(
                    datetime.strptime(
                        str(d["date_premiere_mise_en_circulation"]), iso_format
                    ).date()
                )

            # If user provides insurer code, then ignore the one which is in the Excel file
            if insurer and "code_compagnie" in d.keys():
                del d["code_compagnie"]

            # Round decimal amounts
            d["valeur_neuve"] = round_float_value(d["valeur_neuve"])
            d["valeur_venale"] = round_float_value(d["valeur_venale"])
            d["montant_autres_garanties"] = round_float_value(
                d["montant_autres_garanties"]
            )
            d["montant_prime_nette_total"] = round_float_value(
                d["montant_prime_nette_total"]
            )
            d["montant_accessoires"] = round_float_value(d["montant_accessoires"])
            d["montant_taxes"] = round_float_value(d["montant_taxes"])
            d["montant_carte_brune"] = round_float_value(d["montant_carte_brune"])
            d["fga"] = round_float_value(d["fga"])
            d["montant_prime_ttc"] = round_float_value(d["montant_prime_ttc"])

            dict_list.append(d)
        return dict_list

    @staticmethod
    def remove_unwanted_keys(data):
        for key in data.keys():
            if key not in application_col_list:
                del data[key]

        return data

    @staticmethod
    def load_application_data_from_db(contract_id, user_id):
        demande_dict = OrderedDict()
        info_list = []
        msg = ""
        try:
            with connection.cursor() as cursor:
                cursor.callproc(
                    "fn_demande_attestation",
                    [
                        contract_id,
                        user_id,
                    ],
                )

                result = cursor.fetchall()
                if len(result) > 0:
                    # En-tête de la demande
                    for index in range(len(application_header_key_list)):
                        # La première colonne des données venant de la base de données est IdCompagnie
                        # que je ne prends pas en compte, ne faisant pas partie des champs d'en-tête
                        demande_dict[application_header_key_list[index]] = result[0][
                            index + 1
                        ]

                    for row in result:
                        item_dict = OrderedDict()
                        item_dict["id_contrat_detail"] = row[0]
                        # Je commence par l'indice 1 car le code_compagnie est déjà dans l'en-tête
                        for index in range(1, len(application_col_list)):
                            # On commence par la colonne 7, les autres étant déjà dans l'en-tête defini plus haut
                            item_dict[application_col_list[index]] = str(row[index + 6])

                        info_list.append(item_dict)
                        print(item_dict)
                    demande_dict["liste_demande"] = info_list

        except Exception as error:
            print(error)
            msg = str(error)

        finally:
            if connection:
                cursor.close()

        return (msg, demande_dict)


class RequestSender:
    """
    Renvoyer le message associé à un code de retour
    """

    @staticmethod
    def get_return_message(status, service_code):
        if service_code == APPLY_REQUEST:
            return apply_return_code_dict[status]
        elif service_code == GET_STATUS_REQUEST:
            return get_status_return_code_dict[status]
        elif service_code == UPDATE_STATUS_REQUEST:
            return update_status_return_code_dict[status]

    """
    Annuler une attestation
    """

    @staticmethod
    def cancel_certificate(user, certificate_list):
        return RequestSender.send_status_update_request(
            user, certificate_list, ASACI_CERTIFICATE_CANCELLATION
        )

    """
    Suspendre une attestation
    """

    @staticmethod
    def suspend_certificate(user, certificate_list):
        return RequestSender.send_status_update_request(
            user, certificate_list, ASACI_CERTIFICATE_SUSPENSION
        )

    """
    Service « Actualisation du statut d’une attestation (Annulation /
    Suspension
    """

    @staticmethod
    def status_update_request(user, certificate_list, operation_code):
        message = {"statut": -999, "message": "", "liste_numero": []}
        requester_code = RequestDataLoader.get_requester_code(user)
        request_data = {
            "code_demandeur": requester_code,
            "numero_attestation": certificate_list,
            "code_operation": str(operation_code),
        }

        try:
            response = requests.post(
                url=update_status_url,
                data=json.dumps(request_data),
                headers=headers,
            )
            status_code = int(response.status_code)
            print("Status_code:", status_code)
            if (status_code >= 200) and (status_code <= 299):
                res = response.json()
                message["statut"] = res["statut"]
                message["message"] = RequestSender.get_return_message(
                    res["statut"], UPDATE_STATUS_REQUEST
                )
                if message["statut"] == 0:
                    cert_list = res["liste_numero_attestation"]
                    for number in cert_list:
                        message["liste_numero"].append(number)
            else:
                message["message"] = (
                    "Code Retour HTTP: "
                    + str(status_code)
                    + json.dumps(response.json())
                )
            print("Résultat de l'appel à l'API:", message["statut"], message["message"])

        except Exception as error:
            print(error)
            message["message"] = str(error)

        return message

    """
    Service « Vérification du statut d’une demande d’édition »
    """

    @staticmethod
    def application_status_check(user, application_number):
        message = {
            "statut": "-999",
            "message": "",
            "reference_demande": application_number,
        }
        requester_code = RequestDataLoader.get_requester_code(user)
        request_data = {
            "code_demandeur": requester_code,
            "reference_demande": application_number,
        }
        try:
            response = requests.post(
                url=get_status_url,
                data=json.dumps(request_data),
                headers=headers,
            )
            status_code = int(response.status_code)
            # print("status_code:", status_code)
            if (status_code >= 200) and (status_code <= 299):
                msg = RequestSender.get_return_message(
                    response.json()["statut"], GET_STATUS_REQUEST
                )
                message["message"] = msg
                message["statut"] = response.json()["statut"]
                message["reference_demande"] = response.json()["reference_demande"]
            else:
                message["message"] = json.dumps(response.json())
            # print(response.json())

        except Exception as error:
            print(error)
            message["message"] = str(error)

        return message

    """
    Service « Récupération des liens des attestations après édition »
    """

    @staticmethod
    def get_application_info_request(user, insurer, application_number):
        message = {
            "statut": -999,
            "message": "",
            "numero_demande": application_number,
            "reference_demande": "",
            "infos": list(),
        }
        requester_code = RequestDataLoader.get_requester_code(user)
        request_data = {
            "code_demandeur": requester_code,
            "code_compagnie": insurer,
            "numero_demande": application_number,
        }
        try:
            response = requests.post(
                url=get_application_info_url,
                data=json.dumps(request_data),
                headers=headers,
            )
            status_code = int(response.status_code)
            # print("Status code:", response.status_code)
            # print("Response:", response.json())
            if status_code == 200:
                res = response.json()
                message["statut"] = res["statut"]
                if message["statut"] == 0:
                    message["message"] = "Données récupérées avec succès"
                message["reference_demande"] = res["reference_demande"]
                info_list = res["infos"]
                for info in info_list:
                    dict_info_item = {
                        "numero_attestation": info["numero_attestation"],
                        "numero_immatriculation": info["numero_immatriculation"],
                        "numero_chassis": info["numero_chassis"],
                        "date_effet": info["date_effet"],
                        "date_echeance": info["date_echeance"],
                        "lien_pdf": info["lien_pdf"],
                        "lien_image": info["lien_image"],
                        "lien_qrcode": info["lien_qrcode"],
                    }
                    message["infos"].append(dict_info_item)
            else:
                message["message"] = "Données non obtenues"

        except Exception as error:
            print(error)
            message["message"] = str(error)

        return message

    """
    Service « EDITION-ATTESTATION » A PARTIR DE BD
    """

    @staticmethod
    def send_certificate_application_from_db(contract_id, user_id):
        messages = []
        (msg, data) = RequestDataLoader.load_application_data_from_db(
            contract_id, user_id
        )
        if msg:
            messages.append(
                {
                    "statut": "-1000",
                    "message": msg,
                    "numero_immatriculation": "",
                    "numero_demande": "",
                    "numero_attestation": "",
                    "lien_pdf": "",
                }
            )
            return messages
        if len(data) == 0:
            messages.append(
                {
                    "statut": "-1000",
                    "message": "Aucune donnée trouvée",
                    "numero_immatriculation": "",
                    "numero_demande": "",
                    "numero_attestation": "",
                    "lien_pdf": "",
                }
            )
            return messages
        try:
            header_data = OrderedDict()
            for index in range(len(application_header_key_list)):
                header_data[application_header_key_list[index]] = data[
                    application_header_key_list[index]
                ]
            info_list = data["liste_demande"]
            for item in info_list:
                temp_header_data = header_data.copy()
                contract_item_id = 0
                if "id_contrat_detail" in item.keys():
                    contract_item_id = item["id_contrat_detail"]
                    del item["id_contrat_detail"]
                temp_header_data["liste_demande"] = [item]
                message = RequestSender.send_application_req(
                    item, temp_header_data, contract_id, contract_item_id
                )
                messages.append(message)

        except Exception as error:
            print(error)
            messages.append(
                {
                    "statut": "-1000",
                    "message": str(error),
                    "numero_immatriculation": "",
                    "numero_demande": "",
                    "numero_attestation": "",
                    "lien_pdf": "",
                }
            )
        finally:
            return messages

    """
    Service « EDITION-ATTESTATION » AVEC FICHIER EXCEL
    """

    @staticmethod
    def send_application_for_certificate(filename, user_id, insurer="", access_code=""):
        messages = []
        try:
            request_data_list = RequestDataLoader.load_application_data_from_excel(
                filename=filename, index=0, insurer=insurer
            )

            if request_data_list is None or len(request_data_list) == 0:
                messages.append(
                    {
                        "statut": "-998",
                        "message": "Le fichier Excel ne contient pas de données valides",
                        "numero_immatriculation": "",
                        "numero_demande": "",
                        "numero_attestation": "",
                        "lien_pdf": "",
                    }
                )
                return messages

            header_data = RequestDataLoader.get_header(user_id, insurer, access_code)

            # if insurer code is not provided by user
            # take it from the Excel file
            if not insurer and ("code_compagnie" in request_data_list[0].keys()):
                header_data["code_compagnie"] = request_data_list[0]["code_compagnie"]

            if not header_data["code_compagnie"]:
                messages.append(
                    {
                        "statut": "-999",
                        "message": "Le paramètre code_compagnie n'a pas été fourni",
                        "numero_immatriculation": "",
                        "numero_demande": "",
                        "numero_attestation": "",
                        "lien_pdf": "",
                    }
                )
                return messages

            # Parcourir les lignes extraites du fichier Excel en vue d'envoyer les requêtes à l'API
            for item in request_data_list:
                current_request_data = header_data.copy()
                if "code_compagnie" in item.keys():
                    del item["code_compagnie"]
                info_list = []
                info_list.append(item)
                current_request_data["liste_demande"] = info_list

                # Test avec httpbin
                # response = requests.post(
                #     url="https://httpbin.org/post",
                #     data=json.dumps(temp_param_data),
                #     headers=headers,
                # )
                message = RequestSender.send_application_req(item, current_request_data)

                messages.append(message)

        except Exception as error:
            print(error)
            message = {
                "statut": "-1000",
                "message": str(error),
                "numero_immatriculation": "",
                "numero_demande": "",
                "numero_attestation": "",
                "lien_pdf": "",
            }
            messages.append(message)

        return messages

    @staticmethod
    def send_application_req(item, request_data, contract_id=0, contract_item_id=0):
        print("Données transmises:")
        print(json.dumps(request_data))
        response = requests.post(
            url=application_url,
            data=json.dumps(request_data),
            headers=headers,
        )
        print("Status code: ", response.status_code)
        print("Printing Entire Post Response")
        print(response.json())
        print("###########################################################")
        # Le serveur de la plateforme a indiqué que la requête HTTP a été bien reçue.
        # Mais notre demande est-elle conforme aux exigences de l'ASACI?
        message = {
            "statut": "",
            "message": "",
            "numero_immatriculation": item["numero_immatriculation"],
            "numero_demande": "",
            "numero_attestation": "",
            "lien_pdf": "",
        }
        if str(response.status_code)[0] == "2":
            # Si la requête a été validée par l'ASACI, on sauvegarde les données de retour
            statut = int(response.json()["statut"])
            if statut == 0:
                ResponseLogger.save_log_in_db(
                    response.json(), contract_id, contract_item_id
                )
                message = RequestSender.retrieve_some_results(
                    response.json(), item["numero_immatriculation"]
                )
            else:
                # Ajouter le numéro avant la réponse du serveur car en cas d'erreur le serveur ne renvoie pas d'informations sur le véhicule.
                message["statut"] = statut
                message["message"] = RequestSender.get_return_message(
                    str(statut), APPLY_REQUEST
                )
        else:
            message["statut"] = -1001
            message["message"] = response.status_code
        return message

    @staticmethod
    def retrieve_some_results(response_data, num_immat=""):
        numero_demande = ""
        numero_attestation = ""
        numero_immatriculation = num_immat
        lien_pdf = ""
        statut = int(response_data["statut"])
        if statut == 0:
            numero_demande = response_data["numero_demande"]
            infos = response_data["infos"]
            if len(infos) >= 1:
                numero_attestation = infos[0]["numero_attestation"]
                numero_immatriculation = infos[0]["numero_immatriculation"]
                lien_pdf = infos[0]["lien_pdf"]
        d = {
            "statut": str(statut),
            "message": "Demande traitée avec succès",
            "numero_immatriculation": numero_immatriculation,
            "numero_demande": numero_demande,
            "numero_attestation": numero_attestation,
            "lien_pdf": lien_pdf,
        }
        return d


class ResponseLogger:
    @staticmethod
    def save_log_in_file_system(response_data):
        pass

    @staticmethod
    def save_log_in_db(response_data, contract_id=0, contract_item_id=0):
        try:
            with transaction.atomic():
                statut = int(response_data["statut"])
                if statut == 0:
                    numero_demande = response_data["numero_demande"]
                    res = RetourDemAttestation(
                        date_creation=date.today(),
                        numero_demande=numero_demande,
                        statut=statut,
                    )
                    res.save()
                    infos = response_data["infos"]
                    for info in infos:
                        numero_attestation = info["numero_attestation"]
                        numero_immatriculation = info["numero_immatriculation"]
                        numero_chassis = info["numero_chassis"]
                        date_effet = info["date_effet"]
                        date_echeance = info["date_echeance"]
                        lien_pdf = info["lien_pdf"]
                        lien_image = info["lien_image"]
                        lien_qrcode = info["lien_qrcode"]
                        detail_reponse = DetailRetourDemAttestation(
                            numero_demande=numero_demande,
                            id_demande=res,
                            statut=statut,
                            numero_attestation=numero_attestation,
                            numero_immatriculation=numero_immatriculation,
                            numero_chassis=numero_chassis,
                            date_effet=date_effet,
                            date_echeance=date_echeance,
                            lien_pdf=lien_pdf,
                            lien_image=lien_image,
                            lien_qrcode=lien_qrcode,
                        )
                        detail_reponse.save()
                        if contract_id > 0:
                            if contract_item_id > 0:
                                contrat_detail = ContratDetail.objects.get(
                                    pk=contract_item_id
                                )
                            else:
                                contrat_detail = ContratDetail.objects.filter(
                                    Q(idcontrat=contract_id)
                                    & Q(matricule=numero_immatriculation)
                                ).first()
                            contrat_detail.attestation = numero_attestation
                            contrat_detail.save()
        except Exception as error:
            print(error)
            return False

        return True

    @staticmethod
    def read_log_from_file_system():
        pass

    @staticmethod
    def read_log_from_db():
        pass


class DoubleQuoteDict(dict):
    def __str__(self):
        return json.dumps(self)

    def __repr__(self):
        return json.dumps(self)


def get_param_data(compagnie, acces):
    data = OrderedDict()
    data["code_demandeur"] = "2853776057803"
    data["code_intermediaire"] = "ASACI_CRT_146"
    data["code_compagnie"] = compagnie
    data["code_acces"] = acces
    data["point_de_vente"] = "LE PHARE"
    data["bureau"] = "LE PHARE"

    return data


def get_request_data_openpyxl(filename, index=0, insurer=""):
    dict_list = []

    # Les indices des lignes et des colonnes commencent par 1
    book = load_workbook(filename, data_only=True, keep_vba=False)
    sheet = book.worksheets[index]

    # Lecture de la ligne d'entête
    column_count = sheet.max_column

    keys = [
        str(sheet.cell(row=1, column=col_index).value)
        for col_index in range(1, column_count + 1)
    ]

    # Read other lines from the second one
    row_count = sheet.max_row

    for row_index in range(2, row_count + 1):
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

        # Keep only the date not the time
        d["date_demande_edition"] = d["date_demande_edition"][:10]
        d["date_souscription"] = d["date_souscription"][:10]
        d["date_effet"] = d["date_effet"][:10]
        d["date_echeance"] = d["date_echeance"][:10]
        d["date_premiere_mise_en_circulation"] = d["date_premiere_mise_en_circulation"][
            :10
        ]

        f_format = "%d/%m/%Y"
        iso_format = "%Y-%m-%d"

        if not check_date_format(d["date_demande_edition"]):
            d["date_demande_edition"] = str(
                datetime.strptime(str(d["date_demande_edition"]), f_format).date()
            )
        else:
            d["date_demande_edition"] = str(
                datetime.strptime(str(["date_demande_edition"]), iso_format).date()
            )

        if not check_date_format(d["date_souscription"]):
            d["date_souscription"] = str(
                datetime.strptime(str(d["date_souscription"]), f_format).date()
            )
        else:
            d["date_souscription"] = str(
                datetime.strptime(str(d["date_souscription"]), iso_format).date()
            )

        if not check_date_format(d["date_effet"]):
            d["date_effet"] = str(
                datetime.strptime(str(d["date_effet"]), f_format).date()
            )
        else:
            d["date_effet"] = str(
                datetime.strptime(str(d["date_effet"]), iso_format).date()
            )

        if not check_date_format(d["date_echeance"]):
            d["date_echeance"] = str(
                datetime.strptime(str(d["date_echeance"]), f_format).date()
            )
        else:
            d["date_echeance"] = str(
                datetime.strptime(str(d["date_echeance"]), iso_format).date()
            )

        if not check_date_format(d["date_premiere_mise_en_circulation"]):
            d["date_premiere_mise_en_circulation"] = str(
                datetime.strptime(
                    str(d["date_premiere_mise_en_circulation"]), f_format
                ).date()
            )
        else:
            d["date_premiere_mise_en_circulation"] = str(
                datetime.strptime(
                    str(d["date_premiere_mise_en_circulation"]), iso_format
                ).date()
            )

        # If user provides insurer code, then ignore the one which is in the Excel file
        if insurer and "code_compagnie" in d.keys:
            del d["code_compagnie"]

        dict_list.append(d)
    return dict_list


def get_request_data_manual():
    req = '{"code_demandeur":"5062493223128","code_intermediaire": "2000","code_compagnie": "NSIA","code_acces": "100824","point_de_vente": "BUREAU DIRECT SIEG","bureau": "NA","liste_demande": [{"date_demande_edition": "2022-12-26","date_souscription": "2022-12-26","date_effet": "2023-01-01","date_echeance": "2023-12-31","genre_vehicule": "Voiture (4 Roues)","numero_immatriculation": "DEMAG75","type_vehicule": "Ambulance","model_vehicule": "NA","categorie_vehicule": "01","usage_vehicule": "UV01","source_energie": "SEES","nombre_place": "5","marque_vehicule": " DEMAG","numero_chassis": "NA","numero_moteur": "NA","numero_carte_brune_physique": "NA","numero_rccm": "CNI010203","bureau_enregistreur": "NA","nom_souscripteur": "A  G  C  I ","type_souscripteur": "TSPM","adresse_mail_souscripteur": "ouattaradro@yahoo.fr","numero_telephone_souscripteur": "","boite_postale_souscripteur": "225","nom_assure": "A  G  C  I ","type_assure":"TAPP","adresse_mail_assure": "ouattaradro@gmail.com","boite_postale_assure": "225","numero_police": "20002012203184S","numero_telephone_assure": "NA","profession_assure": "ST12","type_point_vente_compagnie": "BUREAUX DIRECTS","code_point_vente_compagnie": "2000","denomination_point_vente_compagnie": "BUREAU DIRECT SIEGE","rc": "114693","code_nature_attestation": "JAUN","garantie": "NA","contrat": "NA","zone_circulation": "CIV002","date_premiere_mise_en_circulation": "2022-11-22","valeur_neuve": "0","valeur_venale": "0","montant_autres_garanties": "7950","montant_prime_nette_total": "124937","montant_accessoires": "7500","montant_taxes": "18871","montant_carte_brune": "0","fga": "2294","montant_prime_ttc": "151308"}]}'
    req_dict = json.loads(req)

    """
    data = dict()
    data["code_demandeur"] = ""
    data["code_intermediaire"] = ""
    data["code_compagnie"] = ""
    data["code_acces"] = ""
    data["point_de_vente"] = ""
    data["bureau"] = ""
    # data["liste_demande"] = list()
    liste_demande = list()
    item_demande = dict()
    item_demande["date_demande_edition"] = "2022-12-26"
    item_demande["date_souscription"] = ""
    item_demande["date_effet"] = ""
    item_demande["date_echeance"] = ""
    item_demande["genre_vehicule"] = ""
    item_demande["numero_immatriculation"] = ""
    item_demande["type_vehicule"] = ""
    item_demande["model_vehicule"] = ""
    item_demande["categorie_vehicule"] = ""
    item_demande["usage_vehicule"] = ""
    item_demande["source_energie"] = ""
    item_demande["nombre_place"] = ""
    item_demande["marque_vehicule"] = ""
    item_demande["numero_chassis"] = ""
    item_demande["numero_moteur"] = ""
    item_demande["numero_carte_brune_physique"] = ""
    item_demande["numero_rccm"] = ""
    item_demande["bureau_enregistreur"] = ""
    item_demande["nom_souscripteur"] = ""
    item_demande["type_souscripteur"] = ""
    item_demande["adresse_mail_souscripteur"] = ""
    item_demande["numero_telephone_souscripteur"] = ""
    item_demande["boite_postale_souscripteur"] = ""
    item_demande["type_assure"] = ""
    item_demande["nom_assure"] = ""
    item_demande["adresse_mail_assure"] = ""
    item_demande["boite_postale_assure"] = ""
    item_demande["numero_police"] = ""
    item_demande["numero_telephone_assure"] = ""
    item_demande["profession_assure"] = ""
    item_demande["type_point_vente_compagnie"] = ""
    item_demande["code_point_vente_compagnie"] = ""
    item_demande["denomination_point_vente_compagnie"] = ""
    item_demande["rc"] = ""
    item_demande["code_nature_attestation"] = ""
    item_demande["garantie"] = ""
    item_demande["contrat"] = ""
    item_demande["zone_circulation"] = ""
    item_demande["date_premiere_mise_en_circulation"] = ""
    item_demande["valeur_neuve"] = ""
    item_demande["valeur_venale"] = ""
    item_demande["montant_autres_garanties"] = ""
    item_demande["montant_prime_nette_total"] = ""
    item_demande["montant_accessoires"] = ""
    item_demande["montant_taxes"] = ""
    item_demande["montant_carte_brune"] = ""
    item_demande["fga"] = ""
    item_demande["montant_prime_ttc"] = ""
    liste_demande.append(item_demande)
    data["liste_demande"] = liste_demande
    """
    return req_dict


def modelToDictionnary(demande):
    return dict()


def dictionnarytoModel(demande):
    # return DemandeAttestation()
    pass
