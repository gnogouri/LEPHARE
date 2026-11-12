"""
Garde centrale de l'API : contrôle des droits côté serveur et journal d'audit automatique.

Branchée une fois pour toutes sur toutes les vues DRF (AutorisationsConfig.ready -> installer),
elle s'applique après l'authentification, quelle que soit la classe de permission de la vue :
masquer un bouton à l'écran ne suffit jamais, l'appel direct d'une route est contrôlé ici.

Pour chaque requête /api/ :
1. route publique (connexion, état du serveur, paramétrage d'affichage) : rien d'autre ;
2. sinon utilisateur authentifié obligatoire, compte non expiré ;
3. la première règle de REGLES qui correspond (méthode + route) donne le droit exigé ; une
   lecture non cartographiée demande seulement d'être connecté, une écriture non cartographiée
   exige « parametrage.technique » (fermé par défaut) ;
4. écriture : motif exigé si le droit le demande (en-tête X-Motif, réglage de l'admin),
   séparation des tâches si réglée (l'auteur de l'objet ne peut pas l'exécuter lui-même),
   instantané « avant » de l'objet ;
5. après la réponse : une ligne du journal d'audit (résultat, objet, valeurs avant / après,
   saisie sans secret, motif, adresse IP). Refus et connexions sont journalisés aussi.

Un nouveau module n'a qu'à déclarer ses droits (catalogue.py) et ses routes ici.
"""

import re
from datetime import timedelta
from urllib.parse import unquote

from django.db import connection
from django.utils import timezone
from rest_framework import exceptions, status

from .journal import RESULTAT_ECHEC, RESULTAT_REFUS, RESULTAT_SUCCES, adresse_ip, journaliser, saisie_journalisable
from .rbac import a_le_droit, compte_expire

LECTURES = {"GET", "HEAD", "OPTIONS"}
ECRITURES = {"POST", "PUT", "PATCH", "DELETE"}
TOUTES = LECTURES | ECRITURES
INTERDIT = "__interdit__"
CONNECTE = None  # droit « être connecté »
ECHECS_AVANT_VERROU = 5
DUREE_VERROU = timedelta(minutes=15)
MOTIF_LONGUEUR_MIN = 5


class MotifRequis(exceptions.APIException):
    status_code = status.HTTP_428_PRECONDITION_REQUIRED
    default_code = "motif_requis"

    def __init__(self, droit):
        super().__init__({
            "error": f"Motif obligatoire pour « {droit.libelle} ».",
            "code": "motif_requis",
            "droit": droit.code,
            "libelle": droit.libelle,
        })


# ------------------------------------------------------------------ instantanés « avant / après »
def _une_ligne(sql, params):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        colonnes = [c[0] for c in cursor.description]
        ligne = cursor.fetchone()
    return dict(zip(colonnes, ligne)) if ligne else None


def instantane_devis(iddevis):
    entete = _une_ligne(
        """
        SELECT iddevis, numerodevis, idproduit, idcompagnie, idclient, confirme, COALESCE(archive, FALSE) AS archive,
               dateeffet, dateexpiration, primeannuelle, primenette, accessoire, taxe, fga, cedeao, primettc,
               primeimposee, idoperateur
        FROM stddevis WHERE iddevis = %s
        """,
        [iddevis],
    )
    if not entete:
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT g.idgarantie, sg.libellesousgarantie, g.acquise, g.capital, g.primeannuelle, g.primenette, g.taxe
            FROM stddevisdetail dd JOIN stddevisdetgarantie g ON g.iddevisdet = dd.iddevisdetail
            LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = g.idgarantie
            WHERE dd.iddevis = %s ORDER BY dd.iddevisdetail, g.idgarantie LIMIT 400
            """,
            [iddevis],
        )
        entete["garanties"] = [
            {"garantie": f"{r[0]} {r[1] or ''}".strip(), "acquise": r[2], "capital": r[3],
             "prime_annuelle": r[4], "prime_nette": r[5], "taxe": r[6]}
            for r in cursor.fetchall()
        ]
    return entete


def instantane_contrat(idcontrat):
    return _une_ligne(
        """
        SELECT idcontrat, numeropolice, idproduit, idcompagnie, idclient, idavenant, dateeffet, dateexpiration,
               primenette, accessoire, taxe, primettc, iddevis
        FROM stdcontrat WHERE idcontrat = %s
        """,
        [idcontrat],
    )


def instantane_contrat_administration(idcontrat):
    from production.models import Contrat, ContratDetail, ContratDetGarantie

    contrat = Contrat.objects.filter(pk=idcontrat).values().first()
    if not contrat:
        return None
    details = list(
        ContratDetail.objects.filter(idcontrat_id=idcontrat)
        .order_by("pk")
        .values()
    )
    garanties = list(
        ContratDetGarantie.objects.filter(
            idcontratdetail__idcontrat_id=idcontrat
        )
        .order_by("pk")
        .values()
    )
    return {"contrat": contrat, "details": details, "garanties": garanties}


def instantane_contrat_suppression(idcontrat):
    """État complet d'un contrat supprimé (contrat, objets, garanties, quittance) : seule trace qui reste, au journal."""
    etat = instantane_contrat_administration(idcontrat)
    if etat:
        etat["quittance"] = _une_ligne(
            """SELECT q.idquittance, q.numeroquittance, q.primettc, q.mt_encaisse FROM stdquittance q
               JOIN stdcontrat c ON c.idquittance = q.idquittance WHERE c.idcontrat = %s""",
            [idcontrat],
        )
    return etat


def auteur_devis(iddevis):
    ligne = _une_ligne("SELECT idoperateur FROM stddevis WHERE iddevis = %s", [iddevis])
    return ligne and ligne["idoperateur"]


def auteur_demande(id_demande):
    ligne = _une_ligne("SELECT demandeur_id FROM autorisations_demandeautorisation WHERE id = %s", [id_demande])
    return ligne and ligne["demandeur_id"]


# ------------------------------------------------------------------ règles
class Regle:
    def __init__(self, methodes, motif, droit, *, lecture=False, objet="", cles=(), instantane=None,
                 auteur=None, action=""):
        self.methodes = TOUTES if methodes == "*" else set(methodes.split(","))
        self.motif = re.compile(motif)
        self.droit = droit
        self.lecture = lecture  # écriture technique sans modification (calcul, recherche) : non journalisée
        self.objet = objet
        self.cles = cles
        self.instantane = instantane
        self.auteur = auteur
        self.action = action

    def correspond(self, methode, chemin):
        return methode in self.methodes and self.motif.match(chemin)


def _devis_creer_ou_modifier(request, view):
    """Enregistrement de devis : création si aucun devis n'est désigné, modification sinon."""
    if request.method in ("PUT", "PATCH", "DELETE") or _valeur(request, view, CLES_DEVIS):
        return "devis.update"
    return "devis.create"


def _banque_creation(request, view):
    """Banque créée depuis la caisse (bouton « + » de la banque émettrice) par qui peut encaisser, sinon depuis
    l'administration (paramétrage général)."""
    return "encaissements.create" if a_le_droit(request.user, "encaissements.create") else "parametrage.update"


def _correction_encaissement(request, view):
    """Correction d'un encaissement : droit des responsables s'il est accordé, sinon celui de la caisse (l'auteur corrige sa saisie
    du jour ; production/corrections_encaissement.droits le vérifie)."""
    return "encaissements.cancel" if a_le_droit(request.user, "encaissements.cancel") else "encaissements.create"


CLES_DEVIS = ("iddevis", "IdDevis", "id_devis", "devis_id", "idDevis")
CLES_CONTRAT = ("idcontrat", "IdContrat", "id_contrat", "contrat_id")
R = Regle
# Chemins sans le préfixe /api/ ; première règle applicable retenue.
REGLES = [
    # ---- sécurité : utilisateurs, rôles, journal (autorisations/views_securite.py)
    R("GET", r"securite/moi/", CONNECTE),
    # Cockpit opérationnel : accordé rôle par rôle (Administration > Rôles), puis chaque bloc n'est calculé qu'avec le
    # droit de lecture de son module (views_cockpit.py)
    R("GET", r"cockpit/?$", "cockpit.view"),
    # Alertes de la cloche : chaque bloc selon le droit de lecture de son module (views_cockpit.alertes)
    R("GET", r"alertes/?$", CONNECTE),
    # Tableau de bord de la direction et suivi commercial : chiffres réservés au droit de la page (vérifié aussi dans la vue)
    R("GET", r"tableau-de-bord/?$", "reporting.view"),
    R("GET", r"suivi-commercial/?$", "crm.view"),
    # Conventions avec les compagnies : primes à reverser et commissions par compagnie, réservées au droit de la page
    R("GET", r"conventions-compagnies/", "parametrage.update"),
    R("PUT", r"conventions-compagnies/\d+/?$", "parametrage.update", objet="parametre", cles=("id_compagnie",)),
    R("POST", r"securite/moi/mot-de-passe/", CONNECTE, objet="utilisateur", action="securite.mot_de_passe"),
    R("GET", r"securite/utilisateurs/", "users.view"),
    R("POST", r"securite/utilisateurs/$", "users.create", objet="utilisateur"),
    R("POST", r"securite/utilisateurs/(?P<pk>\d+)/(activer|desactiver)/", "users.disable", objet="utilisateur", cles=("pk",)),
    R("POST", r"securite/utilisateurs/(?P<pk>\d+)/mot-de-passe/", "users.password", objet="utilisateur", cles=("pk",)),
    R("PATCH,PUT", r"securite/utilisateurs/(?P<pk>\d+)/", "users.update", objet="utilisateur", cles=("pk",)),
    R("GET", r"securite/(roles|droits)", "roles.view"),
    R("POST,PATCH,PUT,DELETE", r"securite/(roles|droits)", "roles.manage", objet="role", cles=("pk", "code")),
    R("GET", r"securite/journal/export", "audit.export"),
    R("GET", r"securite/journal", "audit.view"),
    # ---- comptes (routes d'URANUS)
    R("GET", r"users/(user|gethostname)", CONNECTE),
    R("POST", r"users/(logout|logoutall)", CONNECTE, action="securite.deconnexion"),
    R("POST", r"users/(changepassword|initiatepasswordchange)", CONNECTE, objet="utilisateur", action="securite.mot_de_passe"),
    R("POST", r"users/register", "users.create", objet="utilisateur"),
    R("POST", r"users/resetpassword", "users.password", objet="utilisateur"),
    R("GET", r"users/profile", "users.view"),
    R("PUT,PATCH", r"users/profile", "users.update", objet="profil", cles=("pk",)),
    R("*", r"admin/(groups|users)/", "roles.manage"),
    R("POST", r"derogations/create", "approbations.decider", objet="derogation"),
    R("GET,POST", r"derogations/check", CONNECTE, lecture=True),
    R("PUT,PATCH", r"derogations/(?P<pk>\d+)/consume", CONNECTE, objet="derogation", cles=("pk",),
      action="approbations.utiliser_derogation"),
    # ---- journal d'audit : lecture seule pour tout le monde
    R("GET", r"compliance/audit-trail/(kpis|etats_cima)", "reporting.view"),
    R("GET", r"compliance/audit-trail", "audit.view"),
    R("POST,PUT,PATCH,DELETE", r"compliance/audit-trail", INTERDIT),
    # ---- clients
    R("GET", r"(client|clientrestreint|clientrecherche|client-depuis-police-sante)(/|$)", "clients.view"),
    R("GET", r"crm/clients/", "clients.view"),
    R("POST", r"(client|clientrestreint)/$", "clients.create", objet="client"),
    R("PUT,PATCH", r"(client|clientrestreint)/(?P<pk>\d+)", "clients.update", objet="client", cles=("pk",)),
    R("DELETE", r"(client|clientrestreint)/(?P<pk>\d+)", "clients.delete", objet="client", cles=("pk",)),
    # ---- devis : calculs et recherches sans enregistrement
    R("POST", r"(calculprime/|calculrepartitionprimesante/|offregarantie(ia|voyage|mrh|rc|mrp)?$|garantieparproduit$|"
              r"dommages/calcul/|devisvoyage/ligne-tarif/|mrh/calcul/maison/|mrh/validate-parameters/|mrh/devis/accessoire/)",
      "devis.view", lecture=True),
    # Domaine d'activité RC ajouté depuis le formulaire de devis (« + », comme dans URANUS)
    R("POST", r"domaineactiviterc/?$", "devis.create", objet="domaine_activite_rc"),
    # ---- devis : primes (sensible)
    R("POST", r"majrecapprimes/", "devis.primes", objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    R("POST", r"correctiondevis/?$", "devis.primes", objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    R("POST", r"devis/(?P<pk>\d+)/imposition-garanties/?$", "devis.primes", objet="devis", cles=("pk",),
      instantane=instantane_devis),
    R("POST,DELETE", r"mrh/devis/(?P<devis_id>\d+)/(maisons/\d+/)?(imposer-prime|imposition-prime)/", "devis.primes",
      objet="devis", cles=("devis_id",), instantane=instantane_devis),
    R("POST", r"mrh/devis/(?P<devis_id>\d+)/repartir-garanties/", "devis.primes", objet="devis", cles=("devis_id",),
      instantane=instantane_devis),
    # ---- suppression définitive, par habilitation (production/suppression.py) : préparation sans écriture, puis suppression
    R("GET", r"devis/\d+/suppression/?$", "devis.delete"),
    R("DELETE", r"devis/(?P<iddevis>\d+)/suppression/?$", "devis.delete", objet="devis", cles=("iddevis",),
      instantane=instantane_devis),
    R("GET", r"contrat/\d+/suppression/?$", "contrats.delete"),
    R("DELETE", r"contrat/(?P<idcontrat>\d+)/suppression/?$", "contrats.delete", objet="contrat", cles=("idcontrat",),
      instantane=instantane_contrat_suppression),
    # ---- devis : transformation en contrat, archivage
    R("POST", r"confirmationdevis/?$", "devis.validate", objet="devis", cles=CLES_DEVIS, instantane=instantane_devis,
      auteur=auteur_devis),
    R("POST", r"(archivagedevis|annulationsaisiedevis)/?$", "devis.cancel", objet="devis",
      cles=CLES_DEVIS, instantane=instantane_devis),
    # Restauration d'un élément archivé : un droit à part, accordé dans Administration > Rôles
    R("POST", r"desarchivagedevis/?$", "archives.restore", objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    R("POST", r"archives/(?P<type_objet>\w+)/(?P<pk>\d+)/restauration/?$", "archives.restore", objet="archive", cles=("pk",)),
    R("DELETE", r"mrh/devis/(?P<devis_id>\d+)/$", "devis.delete", objet="devis", cles=("devis_id", "pk"),
      instantane=instantane_devis),
    # ---- devis : saisie (création ou modification selon le devis désigné)
    R("POST", r"(enregistrementdevis(ia|mrh|rc|mrp|sante|voyage|tousrisquesinfo|globaledebanque)?|finalisationdevis(auto|ia)|"
              r"enregistrementassureia|saisieayantdroitia|saisie(adherent|affilie|filiale)sante|"
              r"annulationsaisie(vehicule|adherent|affilie|filiale))/?$",
      _devis_creer_ou_modifier, objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    # Reprise des affaires antérieures (production/views_reprise.py) : tout utilisateur qui a le droit saisit, sans
    # validation ; l'analyse d'un fichier n'écrit rien. Devis à finaliser : lecture d'un devis, droit du registre des devis
    R("GET", r"reprise/devis/", "devis.view"),
    R("GET", r"reprise/", "contrats.view"),
    R("POST", r"reprise/import/analyse/?$", "contrats.reprise", lecture=True),
    # Devis des écrans de la vue Production confirmé en affaire antérieure (contrat et quittance « R »)
    R("POST", r"reprise/devis/(?P<id_devis>\d+)/?$", "contrats.reprise", objet="devis", cles=("id_devis",)),
    # Devis enregistré en mode reprise noté en attente de finalisation (marque technique, sans effet sur le devis)
    R("POST", r"reprise/devis/(?P<id_devis>\d+)/attente/?$", "contrats.reprise", lecture=True),
    R("POST,PATCH,DELETE", r"reprise/", "contrats.reprise", objet="contrat", cles=("pk",)),
    # Avenant Santé d'un contrat en cours (changement de formule, incorporation) : préparation et devis d'avenant
    # (avant les règles générales de devissante/)
    R("GET", r"devissante/avenant/\d+/?$", "contrats.view"),
    R("POST", r"devissante/avenant/(?P<idcontrat>\d+)/?$", "contrats.avenant", objet="contrat", cles=("idcontrat",),
      instantane=instantane_contrat),
    # Import des adhérents et affiliés Santé (avant la règle générale de devissante/)
    R("POST", r"devissante/importation/", "imports.excel", objet="import"),
    # Aperçu des primes Santé : calcul sans écriture (point de sauvegarde annulé)
    R("POST", r"devissante/apercu/?$", "devis.view", lecture=True),
    # Un collègue continue la saisie d'un autre : la saisie change de propriétaire, droit explicite (avant la règle générale)
    R("POST", r"devissante/(?P<iddevis>\d+)/continuer/?$", "devis.update", objet="devis", cles=("iddevis",), instantane=instantane_devis),
    R("POST", r"(devisia/enregistrement/|devisvoyage/enregistrement/|dommages/devis/$|devissante/|garantiesvehiculeflotte/|"
              r"creer-devis-ia-minene/|transformer-sante-en-ia/|consolidationdevis/)",
      _devis_creer_ou_modifier, objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    R("POST,PUT,PATCH,DELETE", r"mrh/devis/", _devis_creer_ou_modifier, objet="devis", cles=("devis_id", "pk"),
      instantane=instantane_devis),
    R("POST,PUT,PATCH,DELETE", r"brouillons/", "devis.create", objet="brouillon", cles=("pk",)),
    R("POST,PUT,PATCH,DELETE", r"devisdetgarantie/", "devis.update", objet="garantie_devis", cles=("pk",)),
    R("POST", r"devis/(?P<pk>\d+)/attacher_piece_jointe", "devis.update", objet="devis", cles=("pk",)),
    # ---- imports
    R("POST", r"verifier-fichier/", "imports.excel", lecture=True),
    R("POST", r"flotte/import/analyse/", "imports.excel", lecture=True),
    # Vie : liste AFA ou état des cotisations Retraite complémentaire, lus et contrôlés sans écriture
    R("POST", r"afa/(import|retraite)/analyse/?$", "imports.excel", lecture=True),
    R("POST", r"mrh/import/analyse/?$", "imports.excel", lecture=True),
    # Oreole Santé : calcul et lecture du classeur sans écriture, devis liés, émission groupée
    R("POST", r"oreole/apercu/?$", "devis.view", lecture=True),
    # Cartes d'assurance : vérification de l'historique sans écriture ; carte facturée sur une police émise : l'avenant sort aussitôt
    R("POST", r"oreole/cartes/verification/?$", "devis.view", lecture=True),
    R("POST", r"oreole/contrat/(?P<idcontrat>\d+)/cartes/?$", "devis.validate", objet="contrat", cles=("idcontrat",), instantane=instantane_contrat),
    R("POST", r"oreole/import/analyse/?$", "imports.excel", lecture=True),
    R("POST", r"oreole/devis/?$", _devis_creer_ou_modifier, objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    R("POST", r"oreole/devis/(?P<iddevis>\d+)/emission/?$", "devis.validate", objet="devis", cles=("iddevis",), instantane=instantane_devis),
    R("POST", r"oreole/contrat/(?P<idcontrat>\d+)/emission/?$", "devis.validate", objet="contrat", cles=("idcontrat",), instantane=instantane_contrat),
    R("POST", r"oreole/devis/(?P<iddevis>\d+)/encaissement/?$", "encaissements.create", objet="encaissement", cles=("iddevis",)),
    # Consommations santé (sante/consommations.py) : données de santé, droits dédiés ; l'analyse d'un relevé n'écrit rien
    R("POST", r"consommations/import/analyse/?$", "consommations.import", lecture=True),
    R("POST", r"consommations/import/?$", "consommations.import", objet="releve_sante"),
    R("POST", r"consommations/entreprises/lien/?$", "consommations.import", objet="lien_entreprise_police"),
    R("POST", r"consommations/souscriptions/?$", "consommations.import", objet="effectif_sante"),
    R("POST", r"consommations/fraude/(?P<matricule>\d+)/instruction/?$", "consommations.fraude", objet="suspicion_fraude", cles=("matricule",)),
    R("GET", r"consommations/fraude", "consommations.fraude"),
    R("GET", r"consommations/", "consommations.view"),
    # Branche RAFAS (sante/rafas.py) : données de santé et fonds du souscripteur, droits dédiés ; l'analyse d'un fichier n'écrit rien
    R("POST", r"rafas/conventions/(?P<idconvention>\d+)/import/analyse/?$", "rafas.import", lecture=True),
    R("POST", r"rafas/conventions/(?P<idconvention>\d+)/import/?$", "rafas.import", objet="releve_rafas", cles=("idconvention",)),
    R("DELETE", r"rafas/conventions/(?P<idconvention>\d+)/imports/(?P<idimport>\d+)/?$", "rafas.import", objet="releve_rafas", cles=("idimport",)),
    R("POST,PUT,PATCH,DELETE", r"rafas/", "rafas.manage", objet="rafas"),
    R("GET", r"rafas/", "rafas.view"),
    R("POST", r"afa/devis/?$", _devis_creer_ou_modifier, objet="devis", cles=CLES_DEVIS, instantane=instantane_devis),
    R("POST", r"(importationassureia/|importationaffilie)", "imports.excel", objet="import"),
    # Transport hors GUCE : décompte sans écriture, devis, voyages déclarés et ressortie d'une police d'abonnement
    R("POST", r"transport/hors-guce/calcul/$", "devis.view", lecture=True),
    R("POST", r"transport/hors-guce/devis/$", _devis_creer_ou_modifier, objet="devis", cles=CLES_DEVIS,
      instantane=instantane_devis),
    R("POST", r"transport/hors-guce/abonnements/(?P<idcontrat>\d+)/(voyages|ressortie)/$", "contrats.avenant",
      objet="contrat", cles=("idcontrat",)),
    R("POST", r"transport/hors-guce/voyages/(?P<idvoyage>\d+)/annulation/$", "contrats.avenant", objet="voyage_transport",
      cles=("idvoyage",)),
    R("GET", r"transport/hors-guce/(catalogue|devis)/", "devis.view"),
    R("GET", r"transport/hors-guce/(abonnements|contrat)/", "contrats.view"),
    R("POST", r"transport/guce/analyse/", "imports.guce", lecture=True),
    R("POST", r"(transport/guce/import/|importationfichierguce|certificattransport/)", "imports.guce", objet="import"),
    R("GET", r"(imports-historique|imports-statistiques)", "devis.view"),
    # ---- contrat Dommages : pièces de production (avant la lecture des devis, qui couvre dommages/)
    R("GET", r"dommages/contrat/\d+/documents/?$", "contrats.view"),
    # ---- devis : lectures
    R("GET", r"(devis|devisdetail|devisclient|infodevis|infodevisrecherche|garantiesouscritedevis|quittanceproposition|"
             r"listevehiculedevis|reductionflottedevis|devisvoyage|devisia|devisrisquesdivers|devissante|dommages|"
             r"assureiainfo|assureiapardevis|adherents-sante-pour-devis-ia|saisiesanteencours|numerosaisiesante|"
             r"(adherent|affilie|filiale)(liste)?ensaisie|listeaffiliesante|ayantdroitia|ayantdroitminene|mrh/devis|"
             r"brouillons|devisdetgarantie|valeursusuelles)(/|$)", "devis.view"),
    # ---- contrats
    R("GET", r"renouvellement/\d+/?$", "contrats.view"),
    R("GET", r"incorporation/\d+/?$", "contrats.view"),
    R("GET", r"incorporation/devis/\d+/?$", "devis.view"),
    R("GET", r"afa/", "devis.view"),
    R("GET", r"oreole/caisse/?$", "encaissements.view"),
    R("GET", r"oreole/contrat/", "contrats.view"),
    R("GET", r"oreole/", "devis.view"),
    R("GET", r"minene/\d+/connexes/?$", "contrats.view"),
    R("GET", r"minene/(ia|rc)/apercu/?$", "devis.view"),
    R("GET", r"minene/police/?$", "devis.view"),
    R("POST", r"renouvellement/(?P<pk>\d+)/?$", "contrats.avenant", objet="contrat", cles=("pk",), instantane=instantane_contrat),
    R("POST", r"incorporation/(?P<pk>\d+)/?$", "contrats.avenant", objet="contrat", cles=("pk",), instantane=instantane_contrat),
    R("POST", r"avenant/annulation", "contrats.cancel", objet="contrat", cles=CLES_CONTRAT, instantane=instantane_contrat),
    R("POST", r"avenant/", "contrats.avenant", objet="contrat", cles=CLES_CONTRAT, instantane=instantane_contrat),
    R("GET", r"contrat/administration/?$", "contrats.admin_update"),
    R("GET", r"contrat/\d+/administration/?$", "contrats.admin_update"),
    R("PATCH", r"contrat/(?P<pk>\d+)/administration/?$", "contrats.admin_update",
      objet="contrat", cles=("pk",), instantane=instantane_contrat_administration),
    R("POST", r"contrat/(?P<pk>\d+)/attacher_piece_jointe", "contrats.update", objet="contrat", cles=("pk",)),
    R("POST,PUT,PATCH,DELETE", r"contratdetgarantie/", "contrats.update", objet="garantie_contrat", cles=("pk",)),
    R("GET", r"(contrat|contratdetail|garantiecontrat|garantiesouscritecontrat|quittancecontrat|listevehiculecontrat|"
             r"infovehicule|assureiaparcontrat|listecontratclient|listecontratperiode|contratvoyage|transport/|"
             r"certificattransport|quittance|contratdetgarantie)(/|$)", "contrats.view"),
    # ---- caisse
    R("POST", r"(contratpourencaissement/|encaissementrecherche/)", "encaissements.view", lecture=True),
    R("POST", r"(encaissement/(?P<pk>\d+)/annuler/|cheques/(?P<id_cheque>\d+)/decaissement/)", "encaissements.cancel",
      objet="encaissement", cles=("pk", "id_cheque")),
    # Décaissement de tout autre règlement : même droit et même motif que le chèque impayé
    R("POST", r"caisse/reglements/(?P<id_encaissement>\d+)/decaissement/?$", "encaissements.cancel", objet="encaissement", cles=("id_encaissement",)),
    R("GET", r"caisse/(reglements|decaissements)/?$", "encaissements.view"),
    # Correction d'un encaissement saisi par erreur (production/corrections_encaissement.py) : l'auteur le jour même, sinon un
    # responsable ; la vue vérifie lequel des deux
    R("POST", r"caisse/encaissements/(?P<id_encaissement>\d+)/correction/(references|annulation)/?$", _correction_encaissement,
      objet="encaissement", cles=("id_encaissement",)),
    R("GET", r"caisse/encaissements/(du-jour|\d+/correction)/?$", "encaissements.view"),
    R("DELETE", r"cheques/(?P<id_cheque>\d+)/", "encaissements.cancel", objet="cheque", cles=("id_cheque",)),
    R("PUT,PATCH,DELETE", r"encaissement/(?P<pk>\d+)", "encaissements.cancel", objet="encaissement", cles=("pk",)),
    R("POST", r"(enregistrementencaissement|cheques/echeancier/|initiationpaiementmobile|quittances-cima/$|encaissement/$|"
              r"encaissement/(?P<pk>\d+)/demander_annulation/)", "encaissements.create", objet="encaissement",
      cles=("pk", "IdQuittance", "idquittance")),
    R("GET", r"(encaissement|encaissementrecherche|infoencaissement|listedetailencaissement|cheques|finance/encaissements|"
             r"paiementmobileinfo|distripaytransaction|quittances-cima|contratpourencaissement)(/|$)", "encaissements.view"),
    # Banques : création depuis la caisse ou l'administration, modification et suppression depuis l'administration
    R("POST", r"banque/?$", _banque_creation, objet="banque", cles=("idbanque",)),
    R("PUT,PATCH,DELETE", r"banque/(?P<pk>\d+)/?$", "parametrage.update", objet="banque", cles=("pk",)),
    # ---- reversements
    # Bordereaux et courriers au modèle d'OREOLE (production/views_bordereaux.py) : émission (un bordereau de
    # réclamation est payé d'office, chèques du client transmis), décharge, ordre d'un règlement, police de la
    # compagnie ; annulation d'un bordereau = droit de validation
    R("POST", r"finance/bordereaux/(?P<id_reversement>\d+)/annuler/", "reversements.validate", objet="reversement",
      cles=("id_reversement",)),
    R("POST", r"finance/bordereaux/(?P<id_reversement>\d+)/decharge/", "reversements.create", objet="reversement",
      cles=("id_reversement",)),
    R("POST", r"finance/bordereaux/$", "reversements.create", objet="reversement"),
    R("GET", r"finance/(bordereaux|tableau-reversement)", "reversements.view"),
    R("POST", r"(validationreversement|finance/reversements/(?P<id_reversement>\d+)/valider/|reversements-cima/(?P<pk>\d+)/valider/)",
      "reversements.validate", objet="reversement", cles=("id_reversement", "pk", "IdReversement", "idreversement")),
    R("PUT,PATCH,DELETE", r"(reversement|reversementnonvalide|reversements-cima)/(?P<pk>\d+)", "reversements.validate",
      objet="reversement", cles=("pk",)),
    R("POST", r"(enregistrementreversement|finance/reversements/$|reversement/$|reversementnonvalide/$|reversements-cima/$)",
      "reversements.create", objet="reversement"),
    R("GET", r"(reversement|reversementnonvalide|inforeversement|listedetailreversement|contratpourreversement|"
             r"finance/reversements|reversements-cima)(/|$)", "reversements.view"),
    # ---- apporteurs d'affaires (production/apporteurs.py) ; la fiche : configuration_api, route apporteurs/
    R("POST,PUT,PATCH", r"apporteurs(/|$)", "apporteurs.update", objet="apporteur", cles=("pk",)),
    R("POST", r"finance/apporteurs/rattachements/$", "apporteurs.rattacher", objet="affaire_apporteur", cles=("IdDevis", "IdContrat")),
    R("PATCH", r"finance/apporteurs/rattachements/(?P<id_rattachement>\d+)/$", "apporteurs.rattacher", objet="affaire_apporteur", cles=("id_rattachement",)),
    R("POST", r"finance/apporteurs/rattachements/(?P<id_rattachement>\d+)/retrait/", "apporteurs.rattacher", objet="affaire_apporteur", cles=("id_rattachement",)),
    R("POST", r"finance/apporteurs/reglements/$", "apporteurs.payer", objet="reglement_apporteur", cles=("IdApporteur",)),
    R("POST", r"finance/apporteurs/reglements/(?P<id_reglement>\d+)/annulation/", "apporteurs.cancel", objet="reglement_apporteur", cles=("id_reglement",)),
    R("POST", r"finance/apporteurs/commissions/(?P<id_commission>\d+)/annulation/", "apporteurs.cancel", objet="commission_apporteur", cles=("id_commission",)),
    R("PATCH", r"finance/apporteurs/commissions/(?P<id_commission>\d+)/$", "apporteurs.rattacher", objet="commission_apporteur", cles=("id_commission",)),
    R("GET", r"finance/apporteurs/", "apporteurs.view"),
    # ---- commissions
    R("POST", r"commissions/(affaires-commission/rechercher_pour_paiement|details-paiement-commission/verifier_selection|"
              r"notifications/marquer_toutes_lues|dashboard/invalider_cache)", "commissions.view", lecture=True),
    R("POST", r"(finance/commissions/reclamations/(?P<id_reclamation>\d+)/annuler/|commissions/details-paiement-commission/"
              r"(\d+/annuler|annuler_selection)|commissions/annulations-commission/)", "commissions.cancel",
      objet="commission", cles=("id_reclamation",)),
    # Enregistrer un paiement de commission reçu (lot, en-tête) = encaisser une commission, comme le règlement d'un
    # bordereau
    R("POST", r"(finance/commissions/reclamations/(?P<id_reclamation>\d+)/paiements/|commissions/paiements-commission/\d+/valider/|"
              r"commissions/(paiements-batch|paiements-commission)/$)",
      "commissions.validate", objet="commission", cles=("id_reclamation",)),
    R("POST", r"(finance/commissions/reclamations/$|commissions/)", "commissions.create", objet="commission"),
    R("PUT,PATCH,DELETE", r"commissions/", "commissions.validate", objet="commission", cles=("pk",)),
    R("GET", r"(commissions/|finance/commissions)", "commissions.view"),
    # ---- sinistres
    # Règlement et émission de la quittance subrogative ; la consultation de la quittance (GET) est une lecture
    R("POST", r"sinistres/(?P<pk>\d+)/(reglement|quittance_subrogative)/", "sinistres.settle", objet="sinistre",
      cles=("pk",)),
    R("POST", r"sinistres/$", "sinistres.create", objet="sinistre"),
    R("POST,PUT,PATCH,DELETE", r"sinistres/", "sinistres.update", objet="sinistre", cles=("pk",)),
    R("GET", r"sinistres", "sinistres.view"),
    # ---- dérogations et approbations (autorisations)
    R("GET", r"autorisations/(demandes/mes_demandes|jetons/mes_jetons|permissions/mes_permissions)", CONNECTE),
    R("POST", r"autorisations/demandes/$", CONNECTE, objet="demande_autorisation", action="approbations.demander"),
    R("POST", r"autorisations/jetons/verifier/", CONNECTE, lecture=True),
    R("POST", r"autorisations/demandes/(?P<pk>\d+)/(approuver|rejeter)/", "approbations.decider",
      objet="demande_autorisation", cles=("pk",), auteur=auteur_demande),
    R("POST,PUT,PATCH,DELETE", r"autorisations/permissions/", "roles.manage", objet="approbateur", cles=("pk",)),
    R("POST,PUT,PATCH,DELETE", r"autorisations/", "approbations.decider", objet="demande_autorisation", cles=("pk",)),
    R("GET", r"autorisations/", "approbations.view"),
    # ---- suivi commercial, documents, ASACI, états
    R("GET", r"crm/", "crm.view"),
    # Lecture d'un questionnaire rempli avant son dépôt (rien n'est enregistré) : réservée à qui peut le déposer
    R("POST", r"crm/questionnaires/analyse/$", "crm.update", lecture=True),
    R("POST,PUT,PATCH,DELETE", r"crm/", "crm.update", objet="crm", cles=("pk",)),
    R("GET", r"(ged/|pieces-jointes)", "documents.view"),
    R("POST,PUT,PATCH,DELETE", r"(ged/|pieces-jointes)", "documents.update", objet="document", cles=("pk",)),
    R("POST", r"asaci/(verificationstatutdemande|obtentioninfo)", "asaci.attestations", lecture=True),
    R("POST,PUT,PATCH,DELETE", r"asaci/", "asaci.attestations", objet="attestation", cles=("pk",)),
    R("GET", r"asaci/", "contrats.view"),
    R("POST", r"bordereaurecapemission", "reporting.view", lecture=True),
    R("GET", r"(cimaetate1|cimaetate2|etatdecisionnel|bordereaurecapemission)", "reporting.view"),
    R("POST,PUT,PATCH,DELETE", r"etatdecisionnel", "reporting.view", objet="etat", cles=("pk",)),
    # ---- tarifs et barèmes
    R("POST,PUT,PATCH,DELETE", r"(parametrage/dommages/|parametrage/sante/|parametrage/oreole/|parametrage/auto/|parametrage/transport/|parametrage/ia/|parametrage/mrh/|parametrage/vie/|grillesvoyage/)", "tarifs.update", objet="bareme",
      cles=("id_tarif", "id_compagnie", "id_ligne", "id_offre", "id_pays", "cle", "id_repartition", "code")),
    # Valeur vénale d'après le tableau de dépréciation, primes d'un tarif à lecture directe (calculs sans écriture,
    # écrans de devis)
    R("POST", r"auto/(valeur-venale|tarif-direct)/?$", "devis.view", lecture=True),
    R("POST,PUT,PATCH,DELETE", r"(tauxtaxegarantie|commissionproduit|accessoire|accessoirecourtier|reductionflotte|"
                               r"formulesecuriteroutiere|offre|offregarantie|enregistrementoffregarantie|garantie|sousgarantie|"
                               r"garantierisque|tarif|tarifdetail|tarifecran|offredetail|offrecollegesante|repartitionprimesante|"
                               r"collegesante|zonevoyage|zonecouverturesante|zonecouvertureoffre|typereduction|typecontratsante|"
                               r"risque|filialesante|delaiavisecheance)(/|$)", "tarifs.update", objet="bareme", cles=("pk",)),
    # ---- paramétrage
    R("POST,PUT,PATCH,DELETE", r"(parametrage/|conventions)", "parametrage.update", objet="parametre",
      cles=("pk", "cle", "id_compagnie", "id_produit")),
    R("POST,PUT,PATCH,DELETE", r"(menu|menuparent|utilisateur|groupeutilisateur|numero|parametresite|intermediaire|"
                               r"periodictaskschedule|crontabschedule|intervalschedule|solarschedule|clockedschedule|"
                               r"detailquittance|detailencaissement|detailreversement|quittance|systemesecurite|"
                               r"distripaytransaction)(/|$)", "parametrage.technique", objet="table_technique", cles=("pk",)),
]
# Routes ouvertes sans connexion
PUBLIQUES = [
    Regle("POST", r"users/login/?$", CONNECTE, action="securite.connexion"),
    Regle("GET", r"etat-serveur/?$", CONNECTE),
]
OBJETS_PAR_MODULE = {
    "clients": "client", "devis": "devis", "contrats": "contrat", "encaissements": "encaissement",
    "reversements": "reversement", "commissions": "commission", "sinistres": "sinistre", "tarifs": "bareme",
    "parametrage": "parametre", "users": "utilisateur", "roles": "role",
}


# ------------------------------------------------------------------ outils
def _chemin(request):
    chemin = getattr(request, "path", "") or ""
    return chemin[5:] if chemin.startswith("/api/") else None


def _regle(liste, methode, chemin):
    for regle in liste:
        correspondance = regle.correspond(methode, chemin)
        if correspondance:
            return regle, correspondance
    return None, None


def _donnees(request):
    """Saisie de la requête. Le corps est d'abord mis en cache par Django (request.body) : sans cela,
    l'analyse DRF consommerait le flux et les vues d'URANUS qui relisent le corps elles-mêmes
    (JSONParser().parse(request), json.loads(request.body)) le trouveraient vide. Les envois de
    fichiers (multipart) ne sont pas mis en cache : DRF transmet POST et FILES à la requête Django."""
    brut = getattr(request, "_request", None)
    if brut is not None and not getattr(brut, "_read_started", False) \
            and not (brut.META.get("CONTENT_TYPE") or "").lower().startswith("multipart/"):
        try:
            brut.body  # noqa: B018 - lecture mise en cache par Django
        except Exception:
            pass
    try:
        return request.data
    except Exception:
        return {}


def _valeur(request, view, cles, correspondance=None, reponse=None):
    """Premier identifiant trouvé : route, paramètres d'URL, corps de la requête, réponse."""
    sources = []
    if correspondance is not None:
        sources.append({k: v for k, v in correspondance.groupdict().items() if v})
    sources.append(getattr(view, "kwargs", {}) or {})
    donnees = _donnees(request)
    if isinstance(donnees, list) and donnees and isinstance(donnees[0], dict):
        donnees = donnees[0]
    if hasattr(donnees, "get"):
        sources.append(donnees)
    if reponse is not None:
        corps = getattr(reponse, "data", None)
        if isinstance(corps, list) and corps and isinstance(corps[0], dict):
            corps = corps[0]
        if isinstance(corps, dict):
            sources.append(corps)
    for source in sources:
        for cle in cles:
            valeur = source.get(cle) if hasattr(source, "get") else None
            if valeur not in (None, "", 0, "0"):
                return valeur
    return None


def _valeurs(request, view, cles, correspondance=None):
    """Tous les identifiants distincts désignés par la requête (route, paramètres d'URL, corps)."""
    sources = []
    if correspondance is not None:
        sources.append({k: v for k, v in correspondance.groupdict().items() if v})
    sources.append(getattr(view, "kwargs", {}) or {})
    donnees = _donnees(request)
    if isinstance(donnees, list):
        sources.extend(d for d in donnees if isinstance(d, dict))
    elif hasattr(donnees, "get"):
        sources.append(donnees)
    valeurs = set()
    for source in sources:
        for cle in cles:
            valeur = source.get(cle) if hasattr(source, "get") else None
            if valeur not in (None, "", 0, "0"):
                valeurs.add(str(valeur).strip())
    return valeurs


def _id_reponse(reponse):
    corps = getattr(reponse, "data", None)
    if isinstance(corps, list) and corps and isinstance(corps[0], dict):
        corps = corps[0]
    if isinstance(corps, dict):
        for cle in ("ObjectId", "IdDevis", "iddevis", "IdContrat", "idcontrat", "id", "pk", "code"):
            valeur = corps.get(cle)
            if valeur not in (None, "", 0):
                return valeur
    return None


def _droit(code):
    from .models import Droit

    if not code or code == INTERDIT:
        return None
    return Droit.objects.filter(code=code).first()


def _motif(request):
    brut = request.META.get("HTTP_X_MOTIF", "") if hasattr(request, "META") else ""
    try:
        return unquote(brut).strip()[:2000]
    except Exception:
        return brut.strip()[:2000]


def _module_vue(view, request):
    """Module qui définit la vue (pour une vue-fonction @api_view : celui de la fonction)."""
    module = view.__class__.__module__
    if module.startswith("rest_framework"):
        gestionnaire = getattr(view, (request.method or "get").lower(), None)
        module = getattr(gestionnaire, "__module__", "") or module
    return module


def _avant_generique(view):
    """Objet d'un ViewSet modifié ou supprimé, tel qu'enregistré avant l'opération."""
    if not hasattr(view, "get_object") or not hasattr(view, "get_serializer"):
        return None
    kwargs = getattr(view, "kwargs", {}) or {}
    cle = getattr(view, "lookup_url_kwarg", None) or getattr(view, "lookup_field", "pk")
    if cle not in kwargs and "pk" not in kwargs:
        return None
    try:
        return view.get_serializer(view.get_object()).data
    except Exception:
        return None


def _refuser(request, code, message, *, regle=None, objet_id=None, journal=True):
    if journal:
        journaliser(
            request=request, module=(code or "securite").split(".")[0], action=code or "",
            description=message, objet_type=(regle.objet if regle else ""), objet_id=objet_id or "",
            resultat=RESULTAT_REFUS, statut_http=403, details={"saisie": saisie_journalisable(_donnees(request), _chemin(request))},
            motif=_motif(request),
        )
    raise exceptions.PermissionDenied(message)


# ------------------------------------------------------------------ connexion : verrouillage et journal
def _securite(email):
    from account.models import UranusUser

    from .models import SecuriteUtilisateur

    utilisateur = UranusUser.objects.filter(email__iexact=(email or "").strip()).first()
    if not utilisateur:
        return None, None
    securite, _ = SecuriteUtilisateur.objects.get_or_create(utilisateur=utilisateur)
    return utilisateur, securite


def _avant_connexion(request):
    email = (_donnees(request) or {}).get("email", "") if hasattr(_donnees(request), "get") else ""
    utilisateur, securite = _securite(email)
    request._lephare_connexion = {"email": email, "utilisateur": utilisateur, "securite": securite}
    if not utilisateur:
        return
    maintenant = timezone.now()
    if securite.verrouille_jusqua and securite.verrouille_jusqua > maintenant:
        heure = timezone.localtime(securite.verrouille_jusqua).strftime("%H:%M")
        journaliser(request=request, utilisateur=utilisateur, module="securite", action="securite.connexion",
                    description="Connexion refusée : compte verrouillé après des échecs répétés.",
                    objet_type="utilisateur", objet_id=utilisateur.pk, resultat=RESULTAT_REFUS, statut_http=403)
        request._lephare_connexion = None
        raise exceptions.PermissionDenied(f"Compte verrouillé après plusieurs échecs : réessayez après {heure}.")
    if compte_expire(utilisateur):
        journaliser(request=request, utilisateur=utilisateur, module="securite", action="securite.connexion",
                    description="Connexion refusée : compte expiré.", objet_type="utilisateur",
                    objet_id=utilisateur.pk, resultat=RESULTAT_REFUS, statut_http=403)
        request._lephare_connexion = None
        raise exceptions.PermissionDenied("Compte expiré : adressez-vous à l'administrateur.")


def _apres_connexion(request, reponse):
    contexte = getattr(request, "_lephare_connexion", None)
    if not contexte:
        return
    utilisateur, securite = contexte["utilisateur"], contexte["securite"]
    reussie = reponse.status_code < 400
    if securite is not None:
        if reussie:
            securite.echecs_connexion = 0
            securite.verrouille_jusqua = None
            securite.derniere_connexion_ip = adresse_ip(request)
            utilisateur.last_login = timezone.now()
            utilisateur.save(update_fields=["last_login"])
        else:
            securite.echecs_connexion += 1
            if securite.echecs_connexion >= ECHECS_AVANT_VERROU:
                securite.verrouille_jusqua = timezone.now() + DUREE_VERROU
                securite.echecs_connexion = 0
        securite.save()
    journaliser(
        request=request, utilisateur=utilisateur if reussie else None,
        auteur=(getattr(utilisateur, "email", "") or contexte["email"] or "inconnu"),
        module="securite", action="securite.connexion",
        description="Connexion réussie." if reussie else (
            "Échec de connexion" + (" : compte verrouillé 15 minutes." if securite and securite.verrouille_jusqua else ".")),
        objet_type="utilisateur", objet_id=getattr(utilisateur, "pk", "") or "",
        resultat=RESULTAT_SUCCES if reussie else RESULTAT_ECHEC, statut_http=reponse.status_code,
    )


# ------------------------------------------------------------------ points d'entrée
def droit_exige(view, request):
    """Droit que la garde exige pour cette requête (None : être connecté ; INTERDIT : refusée), pour les classes de
    permission des vues qui veulent le vérifier elles aussi (autorisations.permissions.DroitDeLaRoute)."""
    chemin = _chemin(request)
    if chemin is None:
        return None
    regle, _ = _regle(REGLES, request.method, chemin)
    if regle is None:
        if request.method not in ECRITURES:
            return None
        return ("parametrage.update" if _module_vue(view, request).startswith("configuration_api")
                else "parametrage.technique")
    return regle.droit(request, view) if callable(regle.droit) else regle.droit


def controler(view, request):
    """Appelée après l'authentification DRF, avant la vue. Lève 401 / 403 / 428 si besoin."""
    chemin = _chemin(request)
    if chemin is None or request.method == "OPTIONS":
        return
    regle_publique, _ = _regle(PUBLIQUES, request.method, chemin)
    if regle_publique is not None:
        if regle_publique.action == "securite.connexion":
            _avant_connexion(request)
        return

    utilisateur = getattr(request, "user", None)
    if not utilisateur or not getattr(utilisateur, "is_authenticated", False):
        raise exceptions.NotAuthenticated("Connexion requise.")
    if compte_expire(utilisateur):
        raise exceptions.AuthenticationFailed("Compte expiré : adressez-vous à l'administrateur.")

    regle, correspondance = _regle(REGLES, request.method, chemin)
    ecriture = request.method in ECRITURES and not (regle and regle.lecture)
    if regle is None:
        if not ecriture:
            return
        # Écriture non cartographiée : listes de référence (configuration_api) -> paramétrage général ;
        # ailleurs, réservée au paramétrage technique (fermé par défaut)
        code = ("parametrage.update" if _module_vue(view, request).startswith("configuration_api")
                else "parametrage.technique")
    else:
        code = regle.droit(request, view) if callable(regle.droit) else regle.droit

    objet_id = _valeur(request, view, regle.cles if regle else ("pk", "id"), correspondance)
    if code == INTERDIT:
        _refuser(request, "audit.view", "Le journal d'audit est en lecture seule.", regle=regle, objet_id=objet_id)
    if code and not a_le_droit(utilisateur, code):
        droit = _droit(code)
        libelle = droit.libelle if droit else code
        _refuser(request, code, f"Droit insuffisant : « {libelle} » ({code}).", regle=regle, objet_id=objet_id,
                 journal=ecriture)
    if not ecriture:
        return

    droit = _droit(code)
    motif = _motif(request)
    if droit and droit.motif_obligatoire and len(motif) < MOTIF_LONGUEUR_MIN:
        raise MotifRequis(droit)
    if droit and droit.separation_taches and regle is not None and regle.auteur:
        # Tous les identifiants présents sont contrôlés : la vue peut lire un autre nom de clé que le
        # premier trouvé ici. Plusieurs objets différents, ou un auteur introuvable : refus (contrôle strict).
        candidats = _valeurs(request, view, regle.cles, correspondance)
        if len(candidats) > 1:
            _refuser(request, code, "Séparation des tâches : la demande désigne plusieurs objets différents.",
                     regle=regle, objet_id=objet_id)
        for candidat in candidats:
            auteur = None
            try:
                auteur = regle.auteur(candidat)
            except Exception:
                _refuser(request, code, "Séparation des tâches : contrôle de l'auteur impossible.",
                         regle=regle, objet_id=candidat)
            if auteur and str(auteur) == str(utilisateur.pk):
                _refuser(request, code, f"Séparation des tâches : vous ne pouvez pas exécuter « {droit.libelle} » "
                                        "sur une opération que vous avez saisie vous-même.", regle=regle, objet_id=candidat)

    avant = None
    if regle is not None and regle.instantane and objet_id:
        try:
            avant = regle.instantane(objet_id)
        except Exception:
            avant = None
    elif request.method in ("PUT", "PATCH", "DELETE"):
        avant = _avant_generique(view)
    request._lephare_audit = {
        "code": code, "regle": regle, "droit": droit, "objet_id": objet_id, "avant": avant, "motif": motif,
        "module_vue": _module_vue(view, request), "cartographiee": regle is not None,
    }


def apres_reponse(view, request, reponse):
    """Appelée sur toute réponse DRF : journalise l'opération d'écriture contrôlée."""
    chemin = _chemin(request)
    if chemin is None:
        return
    if getattr(request, "_lephare_connexion", None):
        _apres_connexion(request, reponse)
        return
    contexte = getattr(request, "_lephare_audit", None)
    if not contexte:
        return
    request._lephare_audit = None
    regle, droit, code = contexte["regle"], contexte["droit"], contexte["code"]
    reussie = reponse.status_code < 400
    objet_id = contexte["objet_id"] or (_valeur(request, view, regle.cles, reponse=reponse) if regle else None) \
        or _id_reponse(reponse)
    apres = None
    if reussie and regle is not None and regle.instantane and objet_id:
        try:
            apres = regle.instantane(objet_id)
        except Exception:
            apres = None
    if apres is None and request.method != "DELETE":
        apres = getattr(reponse, "data", None)
    action = (regle.action if regle and regle.action else code) or "operation"
    module = (action or "").split(".")[0] if "." in (action or "") else "securite"
    libelle = droit.libelle if droit else {
        "securite.deconnexion": "Déconnexion", "securite.mot_de_passe": "Changement de mot de passe",
        "approbations.demander": "Demande d'autorisation",
        "approbations.utiliser_derogation": "Utilisation d'une dérogation",
    }.get(action, action)
    message = ""
    if not reussie:
        corps = getattr(reponse, "data", None)
        if isinstance(corps, dict):
            message = str(corps.get("error") or corps.get("detail") or corps.get("message") or "")[:500]
        elif isinstance(corps, list) and corps:
            message = str(corps[0])[:500]
    # Précisions apportées par la vue elle-même (completer_audit) : description, objet, avant / après
    complements = contexte.get("complements") or {}
    description = complements.get("description") or libelle
    journaliser(
        request=request, module=module, action=action,
        description=f"{description}{' - échec : ' + message if message else ''}"
                    f"{'' if contexte['cartographiee'] else ' (route non cartographiée : ' + contexte['module_vue'] + ')'}",
        objet_type=complements.get("objet_type") or (regle.objet if regle and regle.objet else OBJETS_PAR_MODULE.get(module, "")),
        objet_id=complements.get("objet_id") or objet_id or "", resultat=RESULTAT_SUCCES if reussie else RESULTAT_ECHEC,
        avant=complements.get("avant", contexte["avant"]),
        apres=complements.get("apres", apres) if reussie else None, motif=contexte["motif"],
        statut_http=reponse.status_code, details={"saisie": saisie_journalisable(_donnees(request), _chemin(request))},
    )


def installer():
    """Branche la garde sur toutes les vues DRF (une seule fois)."""
    from rest_framework.views import APIView

    if getattr(APIView, "_garde_lephare", False):
        return
    initial_origine = APIView.initial
    finaliser_origine = APIView.finalize_response

    def initial(self, request, *args, **kwargs):
        initial_origine(self, request, *args, **kwargs)
        controler(self, request)

    def finalize_response(self, request, response, *args, **kwargs):
        response = finaliser_origine(self, request, response, *args, **kwargs)
        try:
            apres_reponse(self, request, response)
        except Exception:  # le journal ne bloque jamais la réponse
            import logging

            logging.getLogger("lephare.audit").exception("Journalisation de la réponse impossible")
        return response

    APIView.initial = initial
    APIView.finalize_response = finalize_response
    APIView._garde_lephare = True
