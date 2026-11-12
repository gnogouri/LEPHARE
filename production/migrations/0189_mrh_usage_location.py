# Usage de l'habitation (devis Multirisques Habitation) : « Locataire » remplacé par « Location » (demande du
# 2026-10-28), accordé au féminin : Location Meublée, Location Partielle, Location Totale. Les codes (locataire,
# locataire_meuble, locataire_partiel) ne changent pas : devis, maisons et offres restent rattachés.
# Retour : python manage.py migrate production 0188 (anciens libellés remis)

from django.db import migrations

LIBELLES = [
    # code, libellé, description, ancien libellé, ancienne description
    ("locataire_meuble", "Location Meublée", "Location d'un logement meublé",
     "Locataire Meublé", "Locataire d'un logement meublé"),
    ("locataire_partiel", "Location Partielle", "Location partielle avec capital RVT",
     "Locataire Partiel", "Locataire partiel avec capital RVT"),
    ("locataire", "Location Totale", "Location d'un logement non meublé",
     "Locataire Total", "Locataire d'un logement non meublé"),
]


def _sql(nouveau):
    lignes = []
    for code, libelle, description, ancien_libelle, ancienne_description in LIBELLES:
        valeurs = (libelle, description) if nouveau else (ancien_libelle, ancienne_description)
        lignes.append(
            "UPDATE stdmrh_usage_habitation SET libelle = %s, description = %s WHERE code = %s;"
            % (_texte(valeurs[0]), _texte(valeurs[1]), _texte(code))
        )
    return "\n".join(lignes)


def _texte(valeur):
    return "'" + valeur.replace("'", "''") + "'"


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0188_libelles_sans_tiret_long"),
    ]

    operations = [
        migrations.RunSQL(_sql(True), _sql(False)),
    ]
