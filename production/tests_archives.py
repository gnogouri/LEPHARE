"""Restauration d'un client archivé (page Archives) : il revient dans la liste des clients, même si une autre fiche porte la même identité.
Sans base de données : curseur simulé."""

from contextlib import nullcontext
from unittest import mock

from django.db import IntegrityError
from django.test import SimpleTestCase

from . import views_archives


class CurseurSimule:
    """Répond au SELECT du statut ; refuse la première mise à jour si la clé recalculée est déjà prise."""

    def __init__(self, statut, statut_avant, cle_prise=False):
        self.ligne, self.cle_prise, self.mises_a_jour = (statut, statut_avant) if statut else None, cle_prise, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, parametres=None):
        if sql.lstrip().startswith("UPDATE"):
            if self.cle_prise and "cle_unique" not in sql:
                raise IntegrityError("duplicate key value violates unique constraint \"stdclient_cle_unique_key\"")
            self.mises_a_jour.append((sql, parametres))

    def fetchone(self):
        return self.ligne


class RestaurationClient(SimpleTestCase):
    def restaurer(self, curseur):
        with mock.patch.object(views_archives, "connection") as connexion, mock.patch.object(views_archives.transaction, "atomic", nullcontext):
            connexion.cursor.return_value = curseur
            return views_archives._restaurer_client(42)

    def test_client_restaure_dans_la_liste(self):
        curseur = CurseurSimule("A", "V")
        reponse = self.restaurer(curseur)
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(curseur.mises_a_jour, [("UPDATE stdclient SET statut = %s WHERE idclient = %s", ["V", 42])])
        self.assertIn("liste des clients", reponse.data["Message"])

    def test_statut_d_avant_l_archivage_repris(self):
        curseur = CurseurSimule("A", "S")
        self.restaurer(curseur)
        self.assertEqual(curseur.mises_a_jour[0][1], ["S", 42])
        curseur = CurseurSimule("A", None)
        self.restaurer(curseur)
        self.assertEqual(curseur.mises_a_jour[0][1], ["V", 42])

    def test_identite_deja_prise_cle_propre_au_lieu_d_un_refus(self):
        curseur = CurseurSimule("A", "V", cle_prise=True)
        reponse = self.restaurer(curseur)
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(len(curseur.mises_a_jour), 1)
        self.assertIn("cle_unique = 'CLIENT-' || idclient", curseur.mises_a_jour[0][0])
        self.assertIn("même identité", reponse.data["Message"])

    def test_client_non_archive_ou_introuvable(self):
        self.assertEqual(self.restaurer(CurseurSimule("V", None)).status_code, 400)
        self.assertEqual(self.restaurer(CurseurSimule(None, None)).status_code, 404)
