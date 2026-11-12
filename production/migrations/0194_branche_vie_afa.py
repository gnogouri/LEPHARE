# Branche Vie séparée de la Santé (demande du 2026-11-02) : produit VIE (10) dans son propre onglet « Vie » du registre,
# avec son formulaire AFA (production/afa.py) au lieu de celui de la Santé ; compagnie proposée gardée (SANLAM, qui gère
# la Vie). Table lephare_afa_assure : qualité, bénéficiaires et acte de chaque assuré d'un devis AFA (nom, naissance,
# capital et prime sont dans stdclient, stddevisdetail et stddevisdetgarantie).
# Placée dans production pour ne pas entraîner la migration configuration_api 0107 (taxes Transport), en attente.
# Retour : python manage.py migrate production 0193 (la Vie revient sous l'onglet Santé, table supprimée)

from django.db import migrations

ID_PRODUIT_VIE = 10

TABLE = """
CREATE TABLE IF NOT EXISTS public.lephare_afa_assure (
    id serial PRIMARY KEY,
    iddevis integer NOT NULL,
    idclient integer NOT NULL,
    ordre integer NOT NULL DEFAULT 0,
    qualite varchar(60) NOT NULL DEFAULT '',
    beneficiaires varchar(500) NOT NULL DEFAULT '',
    acte varchar(30) NOT NULL DEFAULT '',
    UNIQUE (iddevis, idclient)
);
COMMENT ON TABLE public.lephare_afa_assure IS
    'Assurés d''un devis Vie AFA : qualité, bénéficiaires et acte (renouvellement, incorporation, affaire nouvelle)';
"""


def ouvrir(apps, schema_editor):
    ProduitParametre = apps.get_model("configuration_api", "ProduitParametre")
    ProduitParametre.objects.filter(IdProduit=ID_PRODUIT_VIE).update(Onglet="Vie", ModuleSaisie="afa", SaisieOuverte=True)


def fermer(apps, schema_editor):
    ProduitParametre = apps.get_model("configuration_api", "ProduitParametre")
    ProduitParametre.objects.filter(IdProduit=ID_PRODUIT_VIE).update(Onglet="Santé", ModuleSaisie="sante")


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0193_incorporation_flotte_prorata"),
        ("configuration_api", "0106_registre_devis_expires"),
    ]

    operations = [
        migrations.RunSQL(TABLE, "DROP TABLE IF EXISTS public.lephare_afa_assure;"),
        migrations.RunPython(ouvrir, fermer),
    ]
