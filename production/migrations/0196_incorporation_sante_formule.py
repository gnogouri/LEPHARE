# Santé MINENE : incorporation d'une personne dans une famille (demande du 2026-11-02). Une famille dont la formule est
# complète (SOLO 1 personne, FAMILLE 3, FAMILLE PLUS 6, réglés dans Administration > Réglages Santé MINENE) était
# refusée (« Nombre maximum de personnes dépassé pour cette formule ») : il fallait choisir d'avance la nouvelle formule.
# - sp_saisie_affilie_sante v6 : la personne de plus fait passer la famille dans la formule de sa nouvelle taille, de la
#   même offre commerciale (FAMILLE de 3 personnes + 1 : FAMILLE PLUS ; SOLO + 1 : FAMILLE) ; couverture de cette formule
#   reprise dans le devis (même collège et zone) ou créée avec les dates de celle de la famille ; refus seulement si
#   aucune formule de l'offre n'accueille cette taille. Le message de réussite l'annonce.
# Avenant de modification (sante/avenant.py) : la prime de l'incorporation reste l'écart entre la composition nouvelle
# et l'ancienne (sp_creation_devis_sante), soit l'écart entre les deux formules pour la famille qui en change.
# Retour : python manage.py migrate production 0195

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0195_garanties_ajoutees_mrp"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_saisie_affilie_sante", from_version=5, to_version=6)),
    ]
