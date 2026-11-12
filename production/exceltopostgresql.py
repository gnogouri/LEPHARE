import difflib
import hashlib
import os
import unicodedata
from datetime import datetime, timedelta
from itertools import chain

import pandas as pd
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.db import connection
from django.db.models import Q
from rapidfuzz import fuzz

from account.models import UranusUser
from customer.models import STATUT_ARCHIVE, Client, ClientNettoyage

from .excelhandler import (
    ExcelColumnValidator,
    ExcelFileHandler,
    ExcelFileValidator,
)
from .iautils import convert_to_date
from .models import (
    CertificatTransport,
    DataInsertionResult,
    HistoriqueImportationCertificat,
)

os.environ["PYDEVD_WARN_SLOW_RESOLVE_TIMEOUT"] = "1.0"


# Define the mapping of Excel columns to PostgreSQL columns
excel_column_mapping = {
    "Statut": "statut",
    "No. Requête": "numerorequete",
    "Date Requête": "daterequete",
    "Référence Certificat": "referencecertificat",
    "Date Certificat": "datecertificat",
    "Numéro Police d'Assurance": "numeropolice",
    "Numero FDI": "numerofdi",
    "Date FDI": "datefdi",
    "Assureur": "assureur",
    "Adresse Assureur": "adresseassureur",
    "Souscripteur": "nomsouscripteur",
    "Adresse souscripteur": "adressesouscripteur",
    "Assuré": "assure",
    "Adresse Assuré": "adresseassure",
    "Intermediaire": "intermediaire",
    "Moyen de Transport": "moyentransport",
    "Date Debut Voyage": "datedebutvoyage",
    "Voyage": "voyage",
    "Description Commerciale": "descriptioncommerciale",
    "Marque de Colis": "marquecolis",
    "Numero Document Transport": "numerodocumenttransport",
    "Réf. Précédente": "referenceprecedente",
    "Réf. Subséquent": "referencesubsequente",
    "Valeur Assurance": "valeurassurance",
    "Prime Nette": "primenette",
    "Accessories": "accessoire",
    "Montant Taxe": "taxe",
    "Prime Totale": "primettc",
    "Accessoires AFS-CI": "accessoireafsci",
}

date_columns = [
    "Date Requête",
    "Date Certificat",
    "Date FDI",
    "Date Debut Voyage",
]

date_columns_after_mapping = [
    "daterequete",
    "datecertificat",
    "datefdi",
    "datedebutvoyage",
]

excel_expected_columns = [
    "Statut",
    "No. Requête",
    "Date Requête",
    "Référence Certificat",
    "Date Certificat",
    "Numéro Police d'Assurance",
    "Numero FDI",
    "Date FDI",
    "Assureur",
    "Adresse Assureur",
    "Souscripteur",
    "Adresse souscripteur",
    "Assuré",
    "Adresse Assuré",
    "Intermediaire",
    "Moyen de Transport",
    "Date Debut Voyage",
    "Voyage",
    "Description Commerciale",
    "Marque de Colis",
    "Numero Document Transport",
    "Réf. Précédente",
    "Réf. Subséquent",
    "Valeur Assurance",
    "Prime Nette",
    "Accessories",
    "Montant Taxe",
    "Prime Totale",
    "Accessoires AFS-CI",
]

# 🔥 Colonnes à supprimer avant le mapping avec les colonnes dans PostgreSQL:
columns_to_remove = []

max_file_size = 5 * 1024 * 1024


def check_excel_validity(excel_file: InMemoryUploadedFile) -> dict:

    res_dict = {"error_occured": False, "message": ""}
    file_validator = ExcelFileValidator()
    column_validator = ExcelColumnValidator(excel_expected_columns)
    excel_handler = ExcelFileHandler(file_validator, column_validator)
    result = excel_handler.handle(excel_file)

    if result["errors"]:
        res_dict["error_occured"] = True
        res_dict["message"] = " ".join(result["errors"])

    return res_dict


def european_date_parser(date_str):
    """Parses European-formatted dates (DD/MM/YYYY or DD-MM-YYYY) into datetime objects.

    Args:
        date_str: The date string in European format.

    Returns:
        A datetime object representing the parsed date, or None if the format is invalid.
    """

    try:
        # First attempt with '/' separator
        return pd.to_datetime(date_str, format="%d/%m/%Y")
    except ValueError:
        # If the first attempt fails, try with '-' separator
        try:
            return pd.to_datetime(date_str, format="%d-%m-%Y")
        except ValueError:
            # Handle invalid date formats or other exceptions
            print(f"Invalid date format: {date_str}")
            return None


def check_no_overlap(historical_data):

    if len(historical_data) <= 1:
        return True

    sorted_data = sorted(historical_data, key=lambda x: x[1])

    for i in range(1, len(sorted_data)):
        prev_start, prev_end = sorted_data[i - 1]
        curr_start, curr_end = sorted_data[i]

        if curr_start <= prev_end:
            return False

    return True


# def get_customer_id(client_name: str) -> int:
#     client_name = client_name.split("\n")[0].strip('\r" ')
#     customers = Client.objects.filter(Q(Nom__istartswith=client_name)).values(
#         "IdClient"
#     )
#     customer_ids = [customer["IdClient"] for customer in list(customers)]

#     if len(customer_ids) == 0:
#         return 0
#     elif len(customer_ids) == 1:
#         return customer_ids[0]
#     else:
#         return -1


#################################################################################


def normalize_text(value):
    """Nettoie une chaîne : minuscules, suppression accents et espaces invisibles."""
    if pd.isna(value):
        return ""
    text = str(value).strip().lower()
    text = "".join(
        c
        for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )
    text = text.replace("\u00a0", " ").replace("\t", " ")
    return text


def get_customer_id(excel_name: str, threshold: int = 85) -> int:
    excel_norm = normalize_text(excel_name)

    # Pré-filtrage simple : récupérer seulement les clients contenant un mot clé
    keywords = excel_norm.split()
    query = Client.objects.none()
    for kw in keywords[:3]:  # limiter à 3 mots clés
        query = query | Client.objects.filter(Nom__icontains=kw)

    # Un doublon regroupé par le nettoyage n'est plus proposé : sa fiche de référence porte tout
    regroupes = ClientNettoyage.objects.filter(decision=ClientNettoyage.REGROUPE).values("idclient")
    candidates = query.exclude(Statut=STATUT_ARCHIVE, IdClient__in=regroupes).values_list("IdClient", "Nom")

    matches = []
    for client_id, db_name in candidates:
        score = fuzz.token_set_ratio(excel_norm, normalize_text(db_name))
        if score >= threshold:
            matches.append((client_id, db_name, score))

    if len(matches) == 0:
        return 0
    elif len(matches) == 1:
        return matches[0][0]  # (id, nom, score)
    else:
        return -1


#################################################################################


def check_dates_consistent_with_period(certificat_df, start_date, end_date):
    # Convert arguments start_date and end_date into datetime
    dt_start_date = datetime(start_date.year, start_date.month, start_date.day)
    dt_end_date = datetime(end_date.year, end_date.month, end_date.day)

    # Ensure the daterequete and datecertificat column is in datetime format
    certificat_df["daterequete"] = pd.to_datetime(
        certificat_df["daterequete"], errors="coerce"
    )
    certificat_df["datecertificat"] = pd.to_datetime(
        certificat_df["datecertificat"], errors="coerce"
    )

    # Get the min and max values from the column
    requete_min_date = certificat_df["daterequete"].min()
    requete_max_date = certificat_df["daterequete"].max()
    certificat_min_date = certificat_df["datecertificat"].min()
    certificat_max_date = certificat_df["datecertificat"].max()

    if (
        requete_min_date < dt_start_date
        or certificat_min_date < dt_start_date
        or requete_max_date > dt_end_date
        or certificat_max_date > dt_end_date
    ):
        return False

    return True


def check_date_validity(start_date: datetime, end_date: datetime) -> bool:

    if start_date >= end_date:
        return False

    if (start_date.year != end_date.year) or (
        start_date.month != end_date.month
    ):
        return False

    valid_period_start = start_date.day in (1, 16)
    valid_period_end = (end_date.day == 15) or (
        end_date.month != (end_date + timedelta(days=1)).month
    )
    if not valid_period_start or not valid_period_end:
        return False

    current_period = (start_date, end_date)
    current_year = datetime.now().year
    start_of_current_year = datetime(current_year, 1, 1)
    start_of_last_year = datetime(current_year - 1, 1, 1)
    data = HistoriqueImportationCertificat.objects.filter(
        Q(date_debut_periode__gte=start_of_last_year)
        & Q(date_debut_periode__lt=start_of_current_year + timedelta(days=365))
    ).values_list("date_debut_periode", "date_fin_periode")

    result_list = list(data)
    if current_period not in result_list:
        result_list.append((current_period))

    return check_no_overlap(result_list)


def calculate_sha256(uploaded_file):

    sha256_hash = hashlib.sha256()

    try:
        # Read and update the hash in chunks (default chunk size: 4KB)
        for chunk in uploaded_file.chunks():
            sha256_hash.update(chunk)

    except Exception as error:
        print(error)

    finally:
        return sha256_hash.hexdigest()


def get_historical_export_info(start_date, end_date):
    historical_info_id = 0
    try:
        histo_importation = (
            HistoriqueImportationCertificat.objects.filter(
                Q(date_debut_periode=start_date) & Q(date_fin_periode=end_date)
            )
            .order_by("-date_creation")
            .values()
        )
        if histo_importation:
            historical_info_id = list(histo_importation)[0].id_importation
    except Exception as error:
        print(error)
        historical_info_id = 0
    finally:
        return historical_info_id


# Function to map Excel columns to PostgreSQL table columns
def map_columns(df, column_mapping):
    """
    Maps the DataFrame columns to match the PostgreSQL table's column names.
    column_mapping: Dictionary that maps Excel columns to PostgreSQL columns.
    """
    df = df.rename(columns=column_mapping)
    return df


####################################################################


def locate_header_and_read_excel(
    excel_file,
    expected_columns,
    sheet_name=0,
    date_columns=None,
    tolerance=0.8,
):
    """
    Détecte automatiquement la ligne d'en-tête dans un fichier Excel,
    en tolérant les accents et espaces invisibles.
    Toutes les colonnes attendues doivent être présentes (exactes ou proches).
    Retourne un DataFrame dont les colonnes sont renommées selon expected_columns.
    """

    # 1. Lecture brute
    df_raw = pd.read_excel(
        excel_file,
        sheet_name=sheet_name,
        header=None,
        dtype=str,
    )

    expected_norm = [normalize_text(col) for col in expected_columns]
    header_row_index = None
    matched_columns = {}

    # 2. Détection stricte de l'en-tête
    for idx, row in df_raw.iterrows():
        row_values = [normalize_text(v) for v in row.tolist()]
        all_found = True

        for exp, exp_raw in zip(expected_norm, expected_columns):
            if exp in row_values:
                matched_columns[exp_raw] = exp_raw
            else:
                close = difflib.get_close_matches(
                    exp, row_values, n=1, cutoff=tolerance
                )
                if close:
                    matched_columns[exp_raw] = close[0]
                else:
                    all_found = False
                    break

        if all_found:
            header_row_index = idx
            break

    if header_row_index is None:
        raise ValueError(
            "Impossible de trouver une ligne d'en-tête contenant toutes les colonnes attendues."
        )

    # 3. Relire proprement
    df = pd.read_excel(
        excel_file,
        sheet_name=sheet_name,
        header=header_row_index,
        parse_dates=date_columns,
        date_format="%d/%m/%Y",
        decimal=",",
    )

    # 4. Renommer les colonnes réelles avec les noms attendus
    rename_map = {matched_columns[exp]: exp for exp in expected_columns}
    df.rename(columns=rename_map, inplace=True)

    return df, header_row_index


####################################################################
# def locate_header_and_read_excel(
#     excel_file,
#     expected_columns,
#     sheet_name=0,
#     date_columns=None,
# ):
#     """
#     Détecte automatiquement la ligne d'en-tête dans un fichier Excel
#     contenant des lignes parasites avant la zone de données.
#     """

#     # 1. Lire le fichier sans typer, sans parser les dates
#     df_raw = pd.read_excel(
#         excel_file,
#         sheet_name=sheet_name,
#         header=None,  # On lit tout brut
#         dtype=str,  # On évite les conversions automatiques
#     )

#     # Normalisation des colonnes attendues
#     expected_lower = [col.lower().strip() for col in expected_columns]

#     header_row_index = None

#     # 2. Parcourir chaque ligne pour trouver l'en-tête
#     for idx, row in df_raw.iterrows():
#         row_values = [str(v).strip().lower() for v in row.tolist()]

#         # Vérifier si cette ligne contient toutes les colonnes attendues
#         if all(col in row_values for col in expected_lower):
#             header_row_index = idx
#             break

#     if header_row_index is None:
#         raise ValueError(
#             "Impossible de trouver la ligne d'en-tête dans le fichier Excel."
#         )

#     # Dtypes spécifiques pour éviter les conversions automatiques
#     forced_dtypes = {
#         "Référence Certificat": str,
#         "Numero FDI": str,
#         "Numero Document Transport": str,
#     }

#     # 3. Relire proprement le fichier à partir de la bonne ligne
#     df = pd.read_excel(
#         excel_file,
#         sheet_name=sheet_name,
#         header=header_row_index,
#         parse_dates=date_columns,
#         date_format="%d/%m/%Y",
#         decimal=",",
#         dtype=forced_dtypes,
#     )

#     return df, header_row_index


# Function to upsert data using psycopg3 within Django
def upsert_data_psycopg3(table_name, data_row, unique_column):
    """
    Performs an upsert (insert or update) for the given data row.
    table_name: Name of the PostgreSQL table.
    data_row: Dictionary containing the row data to insert or update.
    unique_column: The column used to check if the row already exists.
    """
    message = ""
    try:
        with connection.cursor() as cursor:
            # Check if the record exists
            check_query = (
                f"SELECT * FROM {table_name} WHERE {unique_column} = %s"
            )
            cursor.execute(check_query, (data_row[unique_column],))
            result = cursor.fetchone()

            if result:
                # Perform an update
                update_query = (
                    f"UPDATE {table_name} SET "
                    + ", ".join(
                        [
                            f"{col} = %s"
                            for col in data_row.keys()
                            if col != unique_column
                        ]
                    )
                    + f" WHERE {unique_column} = %s"
                )

                values = tuple(
                    data_row[col]
                    for col in data_row.keys()
                    if col != unique_column
                )
                cursor.execute(
                    update_query, values + (data_row[unique_column],)
                )
            else:
                # Perform an insert
                insert_query = f"INSERT INTO {table_name} ({', '.join(data_row.keys())}) VALUES ({', '.join(['%s'] * len(data_row))})"
                cursor.execute(insert_query, tuple(data_row.values()))

            connection.commit()
    except Exception as error:
        print(error)
        message = str(error)
    finally:
        return message


def upsert_importation_history(
    start_date, end_date, file_path, file_sha256_hash, user_id
):
    upsert_error = False
    message = ""
    already_exists = False
    importation_histo_id = 0
    importation_history = HistoriqueImportationCertificat.objects.filter(
        Q(date_debut_periode=start_date) & Q(date_fin_periode=end_date)
    ).first()
    try:
        importation_operator = UranusUser.objects.get(pk=user_id)
        if importation_history:
            already_exists = True
            importation_histo_id = importation_history.id_importation
            importation_history.nom_fichier_excel = file_path
            importation_history.sha256_hash = file_sha256_hash
            importation_history.operateur = importation_operator
            importation_history.date_debut_periode = start_date
            importation_history.date_fin_periode = end_date
            # importation_history.update(
            #     nom_fichier_excel=file_path,
            #     sha256_hash=file_sha256_hash,
            #     operateur=importation_operator,
            #     date_debut_periode=start_date,
            #     date_fin_periode=end_date,
            # )
        else:
            importation_history = HistoriqueImportationCertificat(
                nom_fichier_excel=file_path,
                sha256_hash=file_sha256_hash,
                operateur=importation_operator,
                date_debut_periode=start_date,
                date_fin_periode=end_date,
            )
        importation_history.save()
        if not already_exists:
            importation_histo_id = importation_history.id_importation
    except UranusUser.DoesNotExist as error_not_found:
        print(error_not_found)
        message = str(error_not_found)
        upsert_error = True
    except Exception as other_error:
        print(other_error)
        message = str(other_error)
        upsert_error = True
    finally:
        return upsert_error, message, importation_histo_id


# Main function to read Excel, map columns, and export to PostgreSQL using psycopg3 in Django
def export_excel_to_postgres(
    excel_file,
    start_date,
    end_date,
    sheet_name,
    table_name,
    column_mapping,
    unique_column,
):
    message = ""
    error_occured = False

    if excel_file.size > max_file_size:
        return (
            True,
            f"La taille du fichier excède {max_file_size / (1024 * 1024):.2f} Mo.",
        )

    try:
        # Save the current position of the file pointer (usually 0)
        initial_position = excel_file.tell()

        # Détection automatique de la ligne d'en-tête + lecture propre
        df, header_index = locate_header_and_read_excel(
            excel_file,
            expected_columns=excel_expected_columns,
            sheet_name=sheet_name,
            date_columns=date_columns,
        )

        # Reset the file pointer to the initial position
        excel_file.seek(initial_position)
    except Exception as error:
        # Reset the file pointer to the initial position
        excel_file.seek(initial_position)
        return True, f"Erreur lors de la lecture du fichier : {error}"

    # Vérification stricte des colonnes
    actual_columns = [col.strip() for col in df.columns]
    expected_lower = {col.lower() for col in excel_expected_columns}
    actual_lower = {col.lower() for col in actual_columns}

    if actual_lower != expected_lower:
        unknown = actual_lower - expected_lower
        missing = expected_lower - actual_lower

        msg = "Erreur dans les colonnes du fichier Excel.\n"
        if unknown:
            msg += f"Colonnes inconnues : {', '.join(unknown)}\n"
        if missing:
            msg += f"Colonnes manquantes : {', '.join(missing)}"
        return True, msg

    # Supprimer les colonnes parasites avant le mapping
    # Normalisation des colonnes du DataFrame pour faire le mapping de manière insensible à la casse et aux espaces
    df_columns_lower = {col.lower(): col for col in df.columns}
    columns_to_remove_lower = [c.lower() for c in columns_to_remove]

    # Colonnes réellement présentes (matching insensible à la casse)
    columns_found = [
        df_columns_lower[c]
        for c in columns_to_remove_lower
        if c in df_columns_lower
    ]

    # Suppression des colonnes parasites
    df = df.drop(columns=columns_found)

    # Map the Excel columns to the PostgreSQL table columns
    try:
        df = map_columns(df, column_mapping)
    except Exception as error:
        return True, f"Erreur lors du mapping des colonnes : {error}"

    # check if dates in the file are consistent with the period given by the end_user
    if not check_dates_consistent_with_period(df, start_date, end_date):
        return (
            True,
            "Les dates contenues dans le fichier sont incompatibles avec la periode fournie.",
        )

    # Drop all rows where Request ID is NaN
    df.dropna(subset=["numerorequete"], inplace=True)

    # Redimensionnement des colonnes de type texte après suppression des colonnes parasites
    from django.db import models

    char_fields = [
        (field.db_column, field.max_length)
        for field in CertificatTransport._meta.fields
        if isinstance(field, models.CharField)
    ]
    for column_name, column_max_length in char_fields:
        if column_name in df.columns:
            df[column_name] = (
                df[column_name].astype(str).str[:column_max_length]
            )

    # Insert two new columns for start_date and end_date
    df.insert(0, "datefinperiode", end_date)
    df.insert(0, "datedebutperiode", start_date)

    df["idclienturanus"] = df["nomsouscripteur"].apply(get_customer_id)
    # Iterate over the DataFrame rows and upsert data into the database
    for index, row in df.iterrows():
        data_row = row.to_dict()
        if data_row["idclienturanus"] == 0:
            error_occured = True
            message = (
                "Client '"
                + data_row["nomsouscripteur"].split("\n")[0].strip()
                + "' introuvable!"
            )
            break
        elif data_row["idclienturanus"] == -1:
            error_occured = True
            message = (
                "Impossible d'identifier le client '"
                + data_row["nomsouscripteur"].split("\n")[0].strip()
                + "' avec précision!"
            )
            break
        if pd.isna(data_row[unique_column]):
            break
        for key in data_row:
            # if key in date_columns_after_mapping and pd.isna(data_row[key]):
            if pd.isna(data_row[key]):
                data_row[key] = None
        message = upsert_data_psycopg3(table_name, data_row, unique_column)
        if message:
            error_occured = True
            break
    # if not error_occured:
    #     message = "Importation réalisée avec succès."
    return (error_occured, message)


def export_excel(uploaded_excel_file, user_id, start_date, end_date):
    message = ""
    messages = []
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    importation_histo_id = 0
    error_occured = False

    try:
        start_date, end_date = convert_to_date(start_date), convert_to_date(
            end_date
        )
    except ValueError as error:
        print(error)
        error_occured = True
        data_insertion_result_list.append(
            DataInsertionResult(
                ObjectId=0, OutputMessage="Mauvais format de date!"
            )
        )
        return (
            error_occured,
            list(chain(queryset_vide, data_insertion_result_list)),
        )

    error_occured = not check_date_validity(start_date, end_date)
    if error_occured:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=0, OutputMessage="Période invalide!")
        )
        return (
            error_occured,
            list(chain(queryset_vide, data_insertion_result_list)),
        )

    error_occured, message = export_excel_to_postgres(
        excel_file=uploaded_excel_file,
        start_date=start_date,
        end_date=end_date,
        sheet_name=0,
        table_name="stdcertificattransport",
        column_mapping=excel_column_mapping,
        unique_column="numerorequete",
    )

    if error_occured:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=0, OutputMessage=message)
        )
        return (
            error_occured,
            list(chain(queryset_vide, data_insertion_result_list)),
        )

    # file_sha256_hash = calculate_sha256(uploaded_excel_file)
    file_sha256_hash = None
    error_occured, message, importation_histo_id = upsert_importation_history(
        start_date,
        end_date,
        uploaded_excel_file,
        file_sha256_hash,
        user_id,
    )

    if error_occured:
        data_insertion_result_list.append(
            DataInsertionResult(ObjectId=0, OutputMessage=message)
        )
        return (
            error_occured,
            list(chain(queryset_vide, data_insertion_result_list)),
        )

    error_occured, messages = create_transport_insurance_quote(
        importation_histo_id,
        start_date,
        end_date,
        user_id,
    )
    return (error_occured, messages)


def create_transport_insurance_quote(
    export_histo_id, start_date, end_date, user_id
):
    id_devis = 0
    output_message = ""
    data_insertion_result_list = []
    queryset_vide = DataInsertionResult.objects.none()
    error_occured = False
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "CALL sp_creation_devis_transport(%s,%s, %s, %s, %s, %s);",
                (
                    export_histo_id,
                    start_date,
                    end_date,
                    user_id,
                    id_devis,
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

    return (
        error_occured,
        list(chain(queryset_vide, data_insertion_result_list)),
    )
