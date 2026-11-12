# Consommations santé, mouvements de l'effectif (critique d'OREOLE du 2026-11-09 sur le rapport : « le tableau 2 relatif aux effectifs consolidés
# ne présente aucun effectif sortant ; à l'issue des analyses du premier semestre : 542 sortants, 263 nouveaux entrants, 1 233 maintenus,
# 1 496 au total »). Comme dans l'analyse d'OREOLE, les mouvements se comptent en comparant l'effectif de l'exercice précédent à l'effectif actuel :
# - lephare_sante_releve.situation : date de situation de l'effectif importé (« Effectif à jour au ») ; les effectifs déjà importés prennent
#   leur date d'import ;
# - lephare_sante_effectif_situation : bénéficiaires de chaque effectif importé, gardés tels quels (effectif de référence d'une période).
# Retour : python manage.py migrate production 0215 (efface la table et la colonne).

from django.db import migrations

CREATION = """
ALTER TABLE public.lephare_sante_releve ADD COLUMN IF NOT EXISTS situation date;
UPDATE public.lephare_sante_releve SET situation = dateimport::date WHERE nature = 'EFFECTIF' AND situation IS NULL;
COMMENT ON COLUMN public.lephare_sante_releve.situation IS 'Date de situation de l''effectif importé (Effectif à jour au)';

CREATE TABLE public.lephare_sante_effectif_situation (
    idreleve integer NOT NULL REFERENCES public.lephare_sante_releve (idreleve) ON DELETE CASCADE,
    matricule_beneficiaire bigint NOT NULL,
    matricule_assure bigint,
    garant varchar(60) NOT NULL DEFAULT '',
    police varchar(150) NOT NULL DEFAULT '',
    statut char(1) NOT NULL DEFAULT '',
    PRIMARY KEY (idreleve, matricule_beneficiaire)
);
CREATE INDEX lephare_sante_effectif_situation_garant ON public.lephare_sante_effectif_situation (garant);
COMMENT ON TABLE public.lephare_sante_effectif_situation IS 'Bénéficiaires de chaque effectif santé importé, à sa date de situation (mouvements de l''effectif)';
"""

SUPPRESSION = """
DROP TABLE IF EXISTS public.lephare_sante_effectif_situation;
ALTER TABLE public.lephare_sante_releve DROP COLUMN IF EXISTS situation;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0215_sante_cotisations_tableau_de_bord"),
    ]

    operations = [migrations.RunSQL(CREATION, SUPPRESSION)]
