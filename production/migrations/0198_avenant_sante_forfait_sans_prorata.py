# Santé MINENE : avenant de modification (incorporation, changement de formule) sans prorata (demande du 2026-11-02 :
# « les tarifs forfaitaires ne sont pas proratisables », famille YEBOUA de la police 1186123263204W : l'enfant qui fait
# passer la famille de FAMILLE à FAMILLE PLUS doit 200 000 F, soit 800 000 - 600 000 F TTC du fichier TARIFICATION
# MINENE SANTE.xlsx, et non 32 875 F au prorata de 60 jours sur 365).
# - sp_creation_devis_sante v11 : quand les familles du devis sont couvertes par des formules MINENE (lephare_sante_formule),
#   l'avenant porte l'écart annuel entier ; les autres offres Santé gardent le prorata des jours restants.
# Retour : python manage.py migrate production 0197

from django.db import migrations

from uranus.utils.migrations import load_sql_upgrade


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0197_sequence_banques"),
    ]

    operations = [
        migrations.RunSQL(*load_sql_upgrade(__file__, "procedures/sp_creation_devis_sante", from_version=10, to_version=11)),
    ]
