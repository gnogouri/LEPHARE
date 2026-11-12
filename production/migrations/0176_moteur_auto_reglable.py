# Automobile : montants et taux écrits dans le moteur (RC du tracteur routier, surprimes remorque, matières
# inflammables et places transportées, FGA, défense-recours, capitaux, taux dommages / incendie / vol / bris de glace
# d'AMSA et de SUNU, franchises, grille vol et incendie par tranche de valeur de la catégorie 3, accessoire des deux
# roues…) lus dans les réglages « Montants du moteur » (configuration_api 0104) par fn_lephare_auto_constante.
# Valeurs d'origine identiques : 2 064 calculs (86 offres NSIA, AMSA, SUNU × 6 véhicules × 4 durées) inchangés.
# Retour : python manage.py migrate production 0175

from django.db import migrations

from uranus.utils.migrations import load_sql_version

# (fonction, version actuelle) : la migration charge version + 1
FONCTIONS = [
    ("fn_garantie_offre_cat1_nsia", 4), ("fn_garantie_offre_cat2_nsia", 4), ("fn_garantie_offre_cat3_nsia", 4),
    ("fn_garantie_offre_cat5_nsia", 1),
    ("fn_garantie_offre_cat1_amsa", 1), ("fn_garantie_offre_cat2_amsa", 1), ("fn_garantie_offre_cat3_amsa", 1),
    ("fn_garantie_offre_cat5_amsa", 1),
    ("fn_garantie_offre_cat1_sunu", 1), ("fn_garantie_offre_cat2_sunu", 1), ("fn_garantie_offre_cat3_sunu", 1),
    ("fn_garantie_offre_cat5_sunu", 1),
    ("fn_get_accessoire_moto", 1),
]


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0175_sante_classique"),
        ("configuration_api", "0104_reglages_moteur_auto"),
    ]

    operations = [
        migrations.RunSQL(
            load_sql_version(__file__, "functions/fn_lephare_auto_constante", 1),
            "DROP FUNCTION IF EXISTS public.fn_lephare_auto_constante(integer, character varying, character varying, numeric);",
        ),
        *[
            migrations.RunSQL(
                load_sql_version(__file__, f"functions/{nom}", version + 1),
                load_sql_version(__file__, f"functions/{nom}", version),
            )
            for nom, version in FONCTIONS
        ],
    ]
