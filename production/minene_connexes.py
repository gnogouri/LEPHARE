"""
IA et RC chef de famille MINENE rattachées à la police Santé MINENE (compte rendu de la séance du 12-10-2026 :
« leur mode de saisie doit être rattaché à la police santé MINENE »).

GET /api/minene/<idcontrat>/connexes/ : police Santé MINENE du contrat (client, période, nombre d'adhérents)
et devis / contrats IA (offre 66) et RC (offre 67) qui la portent en police connexe. L'écran du contrat Santé
propose d'après cela « Créer l'IA MINENE » / « Créer la RC MINENE », qui ouvrent les écrans IA et RC déjà
renseignés (police connexe, client, dates) ; la base tarife pour chaque adhérent de la police.

GET /api/minene/police/?numero=<police Santé> : la même police lue par son numéro (période la plus récente, une
police renouvelée gardant son numéro), pour que les écrans IA et RC reprennent d'eux-mêmes ce qu'ils ont en commun
avec elle (client, date d'effet, échéance, durée, terme) dès que le numéro est saisi ; ?q=<texte> : jusqu'à 10
polices Santé MINENE dont le numéro ou le client contient le texte, pour les proposer à la saisie.

GET /api/minene/ia/apercu/?police=<police Santé>&effet=AAAA-MM-JJ (et /api/minene/rc/apercu/) : avant
l'enregistrement d'une IA (RC) MINENE, les adhérents de la police Santé qui deviendront les assurés (avec leurs
ayants droit) et les primes que la base calculera, par les mêmes fonctions que sp_finalisation_devis (offre 66) et
sp_creation_devis_risques_divers (offre 67) : par adhérent, prime forfaitaire (fn_get_prime_base_minene_ia /
fn_get_prime_base_minene_rcc), accessoire du barème (fn_get_accessoire), taxe sur prime + accessoire
(fn_get_taux_taxe), frais de gestion MINENE (fn_get_frais_gestion_minene : 1 500 F, fichier « TARIFICATION MINENE
SANTE », compris dans la prime TTC) ; total = unitaire × nombre d'adhérents du contrat Santé. N'écrit rien.
"""

from datetime import date, datetime

from django.db import connection
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from institutionnel.authentication import KnoxOrDemoTokenAuthentication

AUTHENTIFICATION = [KnoxOrDemoTokenAuthentication, BasicAuthentication]
OFFRES_SANTE_MINENE = (17, 18, 19, 20, 21, 22, 175, 176, 181)
OFFRE_IA, OFFRE_RC = 66, 67
ID_COMPAGNIE_MINENE, ID_PRODUIT_IA, ID_PRODUIT_RC = 1, 2, 8
# Produit connexe : produit, offre et prime forfaitaire par adhérent
CONNEXES = {
    "ia": (ID_PRODUIT_IA, OFFRE_IA, "fn_get_prime_base_minene_ia()"),
    "rc": (ID_PRODUIT_RC, OFFRE_RC, "fn_get_prime_base_minene_rcc()"),
}

# Contrats Santé MINENE non annulés (une formule MINENE au détail ou sur une couverture)
SQL_POLICES = f"""
    SELECT c.idcontrat, c.iddevis, c.numeropolice, c.idclient, c.dateeffet::date AS dateeffet,
           c.dateexpiration::date AS dateexpiration, c.idduree, c.idterme,
           TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client,
           (SELECT COUNT(*) FROM stdadherent a WHERE a.iddevis = c.iddevis) AS adherents
    FROM stdcontrat c LEFT JOIN stdclient cl ON cl.idclient = c.idclient
    WHERE c.idproduit = 5 AND COALESCE(c.idcontratannulation, 0) = 0
      AND (EXISTS (SELECT 1 FROM stddevisdetail dd WHERE dd.iddevis = c.iddevis AND dd.idoffre IN {OFFRES_SANTE_MINENE})
           OR EXISTS (SELECT 1 FROM stdfiliale f WHERE f.iddevis = c.iddevis AND f.idoffresante IN {OFFRES_SANTE_MINENE}))
"""

# Contrat le plus récent d'une police : dernière période, puis dernier contrat émis (la date d'effet d'un avenant est au
# choix : un avenant antidaté porte quand même toute la composition)
ORDRE_DERNIER_CONTRAT = """
    ORDER BY (SELECT MAX(b.dateeffet) FROM stdcontrat b JOIN stdavenant ab ON ab.idavenant = b.idavenant
              WHERE b.numeropolice = c.numeropolice AND ab.codeavenant IN ('AFN', 'REN', 'RPP', 'TRP')
                AND b.dateeffet <= c.dateeffet) DESC NULLS LAST, c.idcontrat DESC
"""


def _lignes(cursor, sql, params):
    cursor.execute(sql, params)
    colonnes = [c[0] for c in cursor.description]
    return [dict(zip(colonnes, l)) for l in cursor.fetchall()]


def _iso(valeur):
    return valeur.isoformat() if valeur else None


def _devis_lies(cursor, numero_police):
    """Devis et contrats IA (offre 66) et RC (offre 67) portant la police Santé en police connexe."""
    lies = _lignes(cursor, """
        SELECT d.iddevis, d.numerodevis, COALESCE(d.confirme, FALSE) AS confirme, d.primettc,
               COALESCE((SELECT MAX(dd.idoffre) FROM stddevisdetail dd WHERE dd.iddevis = d.iddevis), d.idoffre) AS idoffre,
               ct.idcontrat, ct.numeropolice, d.dateeffet::date AS dateeffet
        FROM stddevis d
        LEFT JOIN stdcontrat ct ON ct.iddevis = d.iddevis AND COALESCE(ct.idcontratannulation, 0) = 0
        WHERE TRIM(d.numeropoliceconnexe) = %s AND d.idproduit IN (2, 8)
        ORDER BY d.iddevis DESC
    """, [str(numero_police or "").strip()])

    def resume(offre):
        return [{
            "IdDevis": l["iddevis"], "NumeroDevis": l["numerodevis"], "Confirme": l["confirme"],
            "IdContrat": l["idcontrat"], "NumeroPolice": l["numeropolice"], "PrimeTtc": float(l["primettc"] or 0),
            "DateEffet": _iso(l["dateeffet"]),
        } for l in lies if l["idoffre"] == offre]

    return {"IA": resume(OFFRE_IA), "RC": resume(OFFRE_RC)}


def _police(c):
    return {
        "IdContrat": c["idcontrat"], "NumeroPolice": c["numeropolice"], "IdClient": c["idclient"], "Client": c["client"],
        "DateEffet": _iso(c["dateeffet"]), "DateExpiration": _iso(c["dateexpiration"]),
        "IdDuree": c["idduree"], "IdTerme": c["idterme"], "Adherents": c["adherents"],
    }


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def connexes(request, pk):
    with connection.cursor() as cursor:
        contrats = _lignes(cursor, f"""
            SELECT c.idcontrat, c.iddevis, c.numeropolice, c.idproduit, c.idclient, c.dateeffet::date AS dateeffet,
                   c.dateexpiration::date AS dateexpiration,
                   TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client,
                   EXISTS (SELECT 1 FROM stddevisdetail dd WHERE dd.iddevis = c.iddevis AND dd.idoffre IN {OFFRES_SANTE_MINENE})
                   OR EXISTS (SELECT 1 FROM stdfiliale f WHERE f.iddevis = c.iddevis AND f.idoffresante IN {OFFRES_SANTE_MINENE}) AS minene,
                   (SELECT COUNT(*) FROM stdadherent a WHERE a.iddevis = c.iddevis) AS adherents
            FROM stdcontrat c LEFT JOIN stdclient cl ON cl.idclient = c.idclient
            WHERE c.idcontrat = %s
        """, [pk])
        if not contrats:
            return Response({"error": "Contrat introuvable."}, status=status.HTTP_404_NOT_FOUND)
        c = contrats[0]
        if c["idproduit"] != 5 or not c["minene"]:
            return Response({"Minene": False})
        lies = _devis_lies(cursor, c["numeropolice"])

    return Response({
        "Minene": True,
        "NumeroPolice": c["numeropolice"], "IdClient": c["idclient"], "Client": c["client"],
        "DateEffet": c["dateeffet"].isoformat(), "DateExpiration": c["dateexpiration"].isoformat(),
        "Adherents": c["adherents"],
        **lies,
    })


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def police(request):
    numero = str(request.query_params.get("numero") or "").strip()
    texte = str(request.query_params.get("q") or "").strip()
    with connection.cursor() as cursor:
        if numero:
            polices = _lignes(cursor, SQL_POLICES + " AND TRIM(c.numeropolice) = %s" + ORDRE_DERNIER_CONTRAT + " LIMIT 1",
                              [numero])
            if not polices:
                return Response({"error": f"Aucun contrat Santé MINENE pour la police {numero}."},
                                status=status.HTTP_404_NOT_FOUND)
            return Response({**_police(polices[0]), **_devis_lies(cursor, polices[0]["numeropolice"])})
        if len(texte) < 3:
            return Response({"Resultats": []})
        motif = f"%{texte}%"
        polices = _lignes(cursor, SQL_POLICES + """
            AND (c.numeropolice ILIKE %s OR (COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) ILIKE %s)
        """ + ORDRE_DERNIER_CONTRAT + " LIMIT 30", [motif, motif])
    # Une ligne par police (la période la plus récente)
    vues, resultats = set(), []
    for p in polices:
        cle = str(p["numeropolice"] or "").strip()
        if cle in vues:
            continue
        vues.add(cle)
        resultats.append(_police(p))
    return Response({"Resultats": resultats[:10]})


def forfait_adherent(cursor, produit, effet):
    """Prime d'un adhérent de l'IA (« ia ») ou de la RC chef de famille (« rc ») MINENE à la date d'effet, par les
    fonctions de sp_finalisation_devis / sp_creation_devis_risques_divers : prime forfaitaire, accessoire du barème,
    taxe sur prime + accessoire, frais de gestion. Renvoie (taux de taxe, montants unitaires)."""
    id_produit, id_offre, prime_base = CONNEXES[produit]
    cursor.execute(f"""
        SELECT {prime_base}, a.*, fn_get_taux_taxe(%s, %s, %s, %s), fn_get_frais_gestion_minene(%s)
        FROM fn_get_accessoire({prime_base}, %s, %s, %s, %s) AS a
    """, [ID_COMPAGNIE_MINENE, id_produit, id_offre, effet, id_produit,
          id_produit, id_offre, ID_COMPAGNIE_MINENE, effet])
    ligne = cursor.fetchone()
    prime = float(ligne[0] or 0)
    accessoire = float(ligne[1] or 0) + float(ligne[2] or 0)
    taux = float(ligne[4] or 0)
    frais = float(ligne[5] or 0)
    taxe = round((prime + accessoire) * taux / 100)
    return taux, {"PrimeNette": prime, "Accessoire": accessoire, "FraisGestion": frais, "Taxe": taxe,
                  "PrimeTtc": prime + accessoire + taxe + frais}


def _apercu(request, produit):
    id_produit = CONNEXES[produit][0]
    police_sante = str(request.query_params.get("police") or "").strip()
    if not police_sante:
        return Response({"error": "Numéro de police Santé MINENE à renseigner."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        effet = datetime.strptime(str(request.query_params.get("effet") or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        effet = date.today()
    with connection.cursor() as cursor:
        contrats = _lignes(cursor, """
            SELECT c.iddevis, c.numeropolice, TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, '')) AS client
            FROM stdcontrat c LEFT JOIN stdclient cl ON cl.idclient = c.idclient
            WHERE c.idproduit = 5 AND TRIM(c.numeropolice) = %s
        """ + ORDRE_DERNIER_CONTRAT + " LIMIT 1", [police_sante])
        if not contrats:
            return Response({"error": f"Aucun contrat Santé pour la police {police_sante}."}, status=status.HTTP_404_NOT_FOUND)
        c = contrats[0]
        adherents = _lignes(cursor, """
            SELECT a.idadherent, TRIM(COALESCE(a.nom, '') || ' ' || COALESCE(a.prenom, '')) AS nom,
                   a.datenaissance::date AS datenaissance, COALESCE(a.actif, TRUE) AS actif,
                   (SELECT COUNT(*) FROM stdaffilie x WHERE x.idadherent = a.idadherent AND x.lien <> 'A'
                      AND COALESCE(x.actif, TRUE)) AS ayants
            FROM stdadherent a WHERE a.iddevis = %s ORDER BY a.idadherent
        """, [c["iddevis"]])
        taux, unitaire = forfait_adherent(cursor, produit, effet)
        # TTC du devis = somme des adhérents, arrondie à l'enregistrement (fn_lephare_arrondi_montant)
        cursor.execute("SELECT fn_lephare_arrondi_montant(%s, %s)", [unitaire["PrimeTtc"] * len(adherents), id_produit])
        ttc_arrondie = float(cursor.fetchone()[0] or 0)
    nombre = len(adherents)
    return Response({
        "Police": c["numeropolice"], "Client": c["client"], "Nombre": nombre,
        "Adherents": [{
            "IdAdherent": a["idadherent"], "Nom": a["nom"], "Actif": a["actif"], "AyantsDroit": a["ayants"],
            "DateNaissance": _iso(a["datenaissance"]),
        } for a in adherents],
        "TauxTaxe": taux, "Unitaire": unitaire,
        "Totaux": {**{k: v * nombre for k, v in unitaire.items()}, "PrimeTtc": ttc_arrondie},
    })


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def apercu_ia(request):
    return _apercu(request, "ia")


@api_view(["GET"])
@authentication_classes(AUTHENTIFICATION)
@permission_classes([permissions.IsAuthenticated])
def apercu_rc(request):
    return _apercu(request, "rc")
