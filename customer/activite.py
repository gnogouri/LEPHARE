"""Activité commerciale des clients (devis et contrats), calculée en base.

Règles, reprises du Registre des Devis et du Portefeuille des Contrats :
- un contrat est résilié ou annulé quand idcontratannulation est différent de 0 ;
- une police a une ligne stdcontrat par émission (affaire nouvelle, renouvellement,
  avenant) : les polices se comptent par numéro de police distinct ;
- un contrat est en vigueur tant que sa date d'expiration n'est pas passée ;
- un devis en cours n'est ni confirmé (converti en police) ni archivé.
"""

from django.db.models import Count, DecimalField, IntegerField, Max, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from production.models import Contrat, Devis

CONTRAT_NON_ANNULE = Q(idcontratannulation=0)
DEVIS_NON_ARCHIVE = Q(archive=False) | Q(archive__isnull=True)


def _total_par_client(queryset, champ_client, agregat, output_field):
    """Sous-requête corrélée : un total par client, 0 quand il n'a aucune ligne."""
    sous_requete = (
        queryset.filter(**{champ_client: OuterRef("pk")})
        .order_by()
        .values(champ_client)
        .annotate(total=agregat)
        .values("total")[:1]
    )
    return Coalesce(Subquery(sous_requete, output_field=output_field), Value(0), output_field=output_field)


def annotations_activite():
    """Annotations du répertoire des clients, en une seule requête pour toute la liste.

    Un annotate(Count(...), Sum(...)) sur les deux relations (devis et contrats) joindrait
    les deux tables à la fois : chaque devis serait répété autant de fois que le client a de
    contrats, et inversement, ce qui fausse les totaux. Chaque total est donc une
    sous-requête indépendante (index sur stddevis.idclient et stdcontrat.idclient).
    """
    maintenant = timezone.now()
    entier = IntegerField()
    montant = DecimalField(max_digits=19, decimal_places=4)
    return {
        "devis_en_cours": _total_par_client(
            Devis.objects.filter(DEVIS_NON_ARCHIVE, confirme=False), "client", Count("iddevis"), entier
        ),
        "contrats_actifs": _total_par_client(
            Contrat.objects.filter(CONTRAT_NON_ANNULE, dateexpiration__gte=maintenant),
            "idclient",
            Count("numeropolice", distinct=True),
            entier,
        ),
        # Primes TTC émises sur toutes les polices du client (hors annulations)
        "total_primes": _total_par_client(
            Contrat.objects.filter(CONTRAT_NON_ANNULE), "idclient", Sum("primettc"), montant
        ),
    }


def _entier(valeur):
    return int(round(valeur or 0))


def synthese_commerciale(client):
    """Synthèse de la fiche client : une requête d'agrégat par table, sans jointure croisée."""
    maintenant = timezone.now()
    devis = Devis.objects.filter(DEVIS_NON_ARCHIVE, client=client).aggregate(
        nombre=Count("iddevis"),
        en_cours=Count("iddevis", filter=Q(confirme=False)),
        total=Sum("primettc"),
        dernier=Max("dateemission"),
    )
    en_vigueur = Q(dateexpiration__gte=maintenant)
    contrats = Contrat.objects.filter(CONTRAT_NON_ANNULE, idclient=client).aggregate(
        polices=Count("numeropolice", distinct=True),
        polices_en_vigueur=Count("numeropolice", distinct=True, filter=en_vigueur),
        primes_en_vigueur=Sum("primettc", filter=en_vigueur),
        total_primes=Sum("primettc"),
        dernier=Max("dateemission"),
    )
    return {
        "nombre_devis": devis["nombre"],
        "devis_en_cours": devis["en_cours"],
        "total_devis": _entier(devis["total"]),
        "dernier_devis": devis["dernier"],
        "nombre_polices": contrats["polices"],
        "polices_en_vigueur": contrats["polices_en_vigueur"],
        "primes_en_vigueur": _entier(contrats["primes_en_vigueur"]),
        "total_primes": _entier(contrats["total_primes"]),
        "dernier_contrat": contrats["dernier"],
    }


def _date(valeur):
    return valeur.date().isoformat() if valeur else None


def dossier_client(client):
    """Dossier 360° : devis en cours et contrats du client (souscripteur), du plus récent au plus
    ancien, filtrés en base par l'index idclient.

    Un devis confirmé n'est pas repris (il figure sous la forme de sa police). Chaque émission
    d'une police (affaire nouvelle, renouvellement, avenant) est une ligne de contrat ; son
    encaissement est celui de sa quittance.
    """
    maintenant = timezone.now()
    devis = (
        Devis.objects.filter(DEVIS_NON_ARCHIVE, client=client, confirme=False)
        .select_related("produit", "compagnie")
        .order_by("-dateemission", "-iddevis")
    )
    contrats = (
        Contrat.objects.filter(CONTRAT_NON_ANNULE, idclient=client)
        .select_related("idproduit", "idcompagnie", "idavenant", "idquittance")
        .order_by("-dateemission", "-idcontrat")
    )

    def encaissement(quittance):
        if quittance is None:
            return {"statut": "Sans quittance", "montant": 0}
        montant = _entier(quittance.mt_encaisse)
        if quittance.encaissee:
            statut = "Soldé"
        elif montant > 0:
            statut = "Partiel"
        else:
            statut = "À encaisser"
        return {"statut": statut, "montant": montant}

    return {
        "devis": [
            {
                "id": d.iddevis,
                "numero": d.numerodevis,
                "branche": getattr(d.produit, "libelle_produit", "") or "",
                "compagnie": getattr(d.compagnie, "RaisonSociale", "") or "",
                "flotte": bool(d.flotte),
                "date_emission": _date(d.dateemission),
                "date_effet": _date(d.dateeffet),
                "date_expiration": _date(d.dateexpiration),
                "prime_ttc": _entier(d.primettc),
                "expire": bool(d.dateexpiration and d.dateexpiration < maintenant),
            }
            for d in devis
        ],
        "contrats": [
            {
                "id": c.idcontrat,
                "numero_police": c.numeropolice,
                "avenant": getattr(c.idavenant, "LibelleAvenant", "") or "",
                "branche": getattr(c.idproduit, "libelle_produit", "") or "",
                "compagnie": getattr(c.idcompagnie, "RaisonSociale", "") or "",
                "flotte": bool(c.flotte),
                "date_emission": _date(c.dateemission),
                "date_effet": _date(c.dateeffet),
                "date_expiration": _date(c.dateexpiration),
                "prime_ttc": _entier(c.primettc),
                "en_vigueur": bool(c.dateexpiration and c.dateexpiration >= maintenant),
                "numero_quittance": getattr(c.idquittance, "numeroquittance", "") or "",
                "encaissement": encaissement(c.idquittance),
            }
            for c in contrats
        ],
    }


def dernieres_operations(client, nombre=5):
    """Derniers devis en cours et contrats du client, du plus récent au plus ancien.

    Un devis confirmé n'est pas repris : il figure déjà sous la forme de sa police.
    """
    devis = (
        Devis.objects.filter(DEVIS_NON_ARCHIVE, client=client, confirme=False)
        .select_related("produit")
        .order_by("-dateemission")[:nombre]
    )
    contrats = (
        Contrat.objects.filter(CONTRAT_NON_ANNULE, idclient=client)
        .select_related("idproduit")
        .order_by("-dateemission")[:nombre]
    )
    operations = [
        {
            "nature": "Devis",
            "numero": d.numerodevis,
            "branche": getattr(d.produit, "libelle_produit", "") or "",
            "date": d.dateemission,
            "prime_ttc": _entier(d.primettc),
        }
        for d in devis
    ] + [
        {
            "nature": "Contrat",
            "numero": c.numeropolice,
            "branche": getattr(c.idproduit, "libelle_produit", "") or "",
            "date": c.dateemission,
            "prime_ttc": _entier(c.primettc),
        }
        for c in contrats
    ]
    # Une opération sans date d'émission passe en dernier
    operations.sort(key=lambda o: (o["date"] is not None, o["date"] or 0), reverse=True)
    return operations[:nombre]
