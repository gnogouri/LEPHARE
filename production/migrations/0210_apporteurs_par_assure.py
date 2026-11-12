# Commission d'apporteur au montant par assuré (demande du 2026-11-05 : apporteurs payés par assuré, un taux ou un montant, jamais les deux).
# - lephare_affaire_apporteur : assiette PAR_ASSURE, le montant par assuré est dans montantforfait ; taux et montant exclusifs.
# - lephare_commission_apporteur : montant par assuré de la ligne, nombre d'assurés corrigé à la main.
# Retour : python manage.py migrate production 0209 (refusé s'il existe des rattachements par assuré : à retirer d'abord).

from django.db import migrations

AVANT = """
ALTER TABLE public.lephare_affaire_apporteur DROP CONSTRAINT IF EXISTS lephare_affaire_apporteur_assiette_check;
ALTER TABLE public.lephare_affaire_apporteur ADD CONSTRAINT lephare_affaire_apporteur_assiette_check
    CHECK (assiette IN ('COMMISSION', 'PRIME_NETTE', 'PAR_ASSURE', 'FORFAIT'));
ALTER TABLE public.lephare_affaire_apporteur ADD CONSTRAINT lephare_affaire_apporteur_taux_ou_montant
    CHECK (NOT (taux > 0 AND montantforfait > 0));
ALTER TABLE public.lephare_commission_apporteur ADD COLUMN montantunitaire numeric(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.lephare_commission_apporteur ADD COLUMN assuresmanuel integer;
COMMENT ON COLUMN public.lephare_commission_apporteur.assuresmanuel IS 'Nombre d''assurés corrigé à la main, quand la police n''a pas la liste des assurés';
"""

ARRIERE = """
ALTER TABLE public.lephare_commission_apporteur DROP COLUMN IF EXISTS assuresmanuel;
ALTER TABLE public.lephare_commission_apporteur DROP COLUMN IF EXISTS montantunitaire;
ALTER TABLE public.lephare_affaire_apporteur DROP CONSTRAINT IF EXISTS lephare_affaire_apporteur_taux_ou_montant;
ALTER TABLE public.lephare_affaire_apporteur DROP CONSTRAINT IF EXISTS lephare_affaire_apporteur_assiette_check;
ALTER TABLE public.lephare_affaire_apporteur ADD CONSTRAINT lephare_affaire_apporteur_assiette_check
    CHECK (assiette IN ('COMMISSION', 'PRIME_NETTE', 'FORFAIT'));
"""


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0209_brouillon_devis_ia"),
    ]

    operations = [migrations.RunSQL(AVANT, ARRIERE)]
