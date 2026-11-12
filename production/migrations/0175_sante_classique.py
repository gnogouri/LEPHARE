# Santé classique (offre commerciale 85) et Santé micro (86), vérifiées contre URANUS :
#   - formules MONDE ENTIER sans garantie (classique 61-63, tiers-payants 58-60) : le devis sortait à prime nette 0
#     et TTC 2 700 F (accessoire cabinet seul) ; elles reçoivent les garanties de leur formule CÔTE D'IVOIRE
#     (98 principale, 99 surprime affection, 100 surprime extension, NSIA) ;
#   - fn_get_taux_taxe_sante v2 : taux de la garantie principale Santé au lieu d'une ligne du produit prise au hasard ;
#   - sp_creation_devis_sante v7 : accessoire manuel appliqué hors MINENE, seuils du contrat groupe réglables
#     (configuration_api 0103).
# Retour : python manage.py migrate production 0174 (retire aussi les garanties des formules 58-63).

from django.db import migrations

from uranus.utils.migrations import load_sql_version

GARANTIES_MONDE_ENTIER = """
INSERT INTO public.stdoffregarantie (idoffregarantie, idoffre, idsousgarantie, franchisemaximum, franchiseminimum,
                                     idcompagnie, tauxfranchise, ordreaffichage)
SELECT (SELECT COALESCE(MAX(idoffregarantie), 0) FROM public.stdoffregarantie)
           + ROW_NUMBER() OVER (ORDER BY m.cible, g.idsousgarantie, g.idcompagnie),
       m.cible, g.idsousgarantie, g.franchisemaximum, g.franchiseminimum, g.idcompagnie, g.tauxfranchise, g.ordreaffichage
FROM (VALUES (61, 29), (62, 30), (63, 31), (58, 14), (59, 15), (60, 16)) AS m(cible, modele)
JOIN public.stdoffregarantie AS g ON g.idoffre = m.modele
WHERE NOT EXISTS (SELECT 1 FROM public.stdoffregarantie AS x WHERE x.idoffre = m.cible);
"""

RETRAIT_GARANTIES_MONDE_ENTIER = "DELETE FROM public.stdoffregarantie WHERE idoffre IN (58, 59, 60, 61, 62, 63);"


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0174_partage_accessoires_reglable"),
        ("configuration_api", "0103_reglages_sante_groupe"),
    ]

    operations = [
        migrations.RunSQL(GARANTIES_MONDE_ENTIER, RETRAIT_GARANTIES_MONDE_ENTIER),
        migrations.RunSQL(
            load_sql_version(__file__, "functions/fn_get_taux_taxe_sante", 2),
            load_sql_version(__file__, "functions/fn_get_taux_taxe_sante", 1),
        ),
        migrations.RunSQL(
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 7),
            load_sql_version(__file__, "procedures/sp_creation_devis_sante", 6),
        ),
    ]
