# MRH : enregistrement d'un devis refusé dès qu'une maison est à l'usage « Propriétaire Non-Occupant Meublé »
# (plainte du 2026-11-10 : 45 maisons non enregistrées en production). Le code de l'usage, gardé dans
# stddevisdetail.modelevehicule puis recopié dans stdcontratdetail à la confirmation, fait 32 caractères pour une
# colonne de 30 : « valeur trop longue pour le type character varying(30) », tout le devis est annulé.
# - modelevehicule : 30 -> 50 caractères (devis et contrat) ;
# - adressecnd (adresse de la maison, saisie libre à l'écran) : 50 -> 150 caractères.
# Élargissement seul : PostgreSQL ne réécrit pas la table. Retour : python manage.py migrate production 0216
# (refusé si une valeur plus longue a été enregistrée entre-temps).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('production', '0216_sante_effectif_situations'),
    ]

    operations = [
        migrations.AlterField(
            model_name='contratdetail',
            name='adressecnd',
            field=models.CharField(blank=True, db_column='adressecnd', default='', max_length=150, null=True),
        ),
        migrations.AlterField(
            model_name='contratdetail',
            name='modelevehicule',
            field=models.CharField(db_column='modelevehicule', default='', max_length=50, verbose_name='Modèle du véhicule'),
        ),
        migrations.AlterField(
            model_name='devisdetail',
            name='adressecnd',
            field=models.CharField(blank=True, default='', max_length=150, null=True),
        ),
        migrations.AlterField(
            model_name='devisdetail',
            name='modelevehicule',
            field=models.CharField(db_column='modelevehicule', default='', max_length=50, verbose_name='Modèle du véhicule'),
        ),
    ]
