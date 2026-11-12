"""
Accès de secours depuis la console du serveur : définir le mot de passe d'un compte (repris d'URANUS
ou nouveau), le réactiver, le déverrouiller et lui attribuer des rôles.

    python manage.py acces_lephare prenom.nom@oreole-ci.com --role ADMIN_TECH
    python manage.py acces_lephare nouveau@oreole-ci.com --nom "NOM Prénom" --role DEVELOPPEUR --provisoire

Le mot de passe est demandé au clavier (jamais en argument, jamais affiché ni écrit en clair) ;
l'opération est inscrite au journal d'audit.
"""

import getpass
import os

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from knox.models import AuthToken

from account.models import UranusUser
from autorisations.journal import journaliser
from autorisations.models import Role, SecuriteUtilisateur, UtilisateurRole


class Command(BaseCommand):
    help = "Définit le mot de passe d'un compte LE PHARE, le réactive et lui attribue des rôles (accès de secours)."

    def add_arguments(self, parser):
        parser.add_argument("email", help="Adresse e-mail de connexion")
        parser.add_argument("--nom", default="", help="Nom affiché (obligatoire pour créer un compte)")
        parser.add_argument("--role", action="append", default=[], help="Code du rôle à ajouter (répétable)")
        parser.add_argument("--provisoire", action="store_true",
                            help="Mot de passe à changer à la prochaine connexion")

    def handle(self, *args, email, nom, role, provisoire, **options):
        email = email.strip().lower()
        roles = list(Role.objects.filter(code__in=[r.strip().upper() for r in role]))
        inconnus = {r.strip().upper() for r in role} - {r.code for r in roles}
        if inconnus:
            raise CommandError(f"Rôle inconnu : {', '.join(sorted(inconnus))} "
                               f"(rôles : {', '.join(Role.objects.values_list('code', flat=True))}).")
        utilisateur = UranusUser.objects.filter(email__iexact=email).first()
        if utilisateur is None and not nom.strip():
            raise CommandError("Compte inexistant : indiquez --nom pour le créer.")
        if utilisateur is None and not roles:
            raise CommandError("Compte inexistant : indiquez au moins un --role.")

        mot_de_passe = getpass.getpass("Nouveau mot de passe : ")
        if mot_de_passe != getpass.getpass("Confirmation : "):
            raise CommandError("La confirmation ne correspond pas.")
        try:
            validate_password(mot_de_passe, utilisateur)
        except ValidationError as erreur:
            raise CommandError(" ".join(erreur.messages))

        operateur = f"console serveur ({os.environ.get('USERNAME') or os.environ.get('USER') or 'inconnu'})"
        with transaction.atomic():
            cree = utilisateur is None
            if cree:
                utilisateur = UranusUser.objects.create_user(email=email, password=mot_de_passe, name=nom.strip()[:110])
            else:
                utilisateur.set_password(mot_de_passe)
                if nom.strip():
                    utilisateur.name = nom.strip()[:110]
                utilisateur.is_active = True
                utilisateur.save()
                AuthToken.objects.filter(user=utilisateur).delete()
            for r in roles:
                UtilisateurRole.objects.get_or_create(utilisateur=utilisateur, role=r, defaults={"attribue_par": operateur})
            SecuriteUtilisateur.objects.update_or_create(utilisateur=utilisateur, defaults={
                "doit_changer_mot_de_passe": provisoire, "echecs_connexion": 0, "verrouille_jusqua": None,
            })
            journaliser(
                utilisateur=utilisateur, auteur=operateur, module="users",
                action="users.create" if cree else "users.password",
                description=f"{'Création' if cree else 'Mot de passe redéfini et compte réactivé'} depuis la console "
                            f"du serveur : {email}" + (f" - rôles ajoutés : {', '.join(r.code for r in roles)}" if roles else ""),
                objet_type="utilisateur", objet_id=utilisateur.pk,
                apres={"email": email, "roles": [r.code for r in roles], "doit_changer_mot_de_passe": provisoire},
            )
        self.stdout.write(self.style.SUCCESS(
            f"{'Compte créé' if cree else 'Compte mis à jour'} : {email} "
            f"(rôles : {', '.join(utilisateur.roles_lephare.values_list('role__libelle', flat=True)) or 'aucun'}"
            f"{', administrateur' if utilisateur.is_admin else ''})."
        ))
