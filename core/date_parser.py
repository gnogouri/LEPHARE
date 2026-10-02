from datetime import date, datetime
from typing import Optional

from django.utils import timezone


def date_emission_du_jour() -> date:
    """
    Date d'émission de tout document (devis, contrat, avenant) : elle n'est jamais saisie,
    c'est toujours la date du jour de l'enregistrement (fuseau du serveur, UTC = heure d'Abidjan).
    La date éventuellement envoyée par l'écran est ignorée.
    """
    return timezone.localdate()


def parse_date_string(date_str: str) -> Optional[datetime]:
    """
    Parses a date string into a datetime object, supporting multiple common formats.

    The function attempts to parse the date string using the following formats:
    1. Day/Month/Year (e.g., "31/12/2023")
    2. Day-Month-Year (e.g., "31-12-2023")
    3. Year/Month/Day (e.g., "2023/12/31")
    4. Year-Month-Day (e.g., "2023-12-31")

    Args:
        date_str: The string containing the date to parse.

    Returns:
        A datetime.datetime object if parsing is successful, or None if the
        string does not match any of the supported formats.
    """
    # List of supported date formats, in order of preference/attempt
    date_formats = [
        "%d/%m/%Y",  # d/m/Y (e.g., 31/12/2023)
        "%d-%m-%Y",  # d-m-Y (e.g., 31-12-2023)
        "%Y/%m/%d",  # Y/m/d (e.g., 2023/12/31)
        "%Y-%m-%d"   # Y-m-d (e.g., 2023-12-31)
    ]

    for fmt in date_formats:
        try:
            # datetime.strptime attempts to parse the string using the current format
            
            return datetime.strptime(date_str, fmt)
        except ValueError:
            # If parsing fails for this format, continue to the next one
            continue

    # If the loop finishes without returning, no format matched
    print(f"Error: Date string '{date_str}' did not match any supported formats.")
    return None