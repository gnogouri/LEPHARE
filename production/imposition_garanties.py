"""
Imposition des primes garantie par garantie, pour un devis de toute branche hors Auto (demande du 2026-10-28 : « une
imposition comme [celle de l'Auto] dans toutes les branches, qui permet l'imposition des garanties également »). L'Auto
garde la sienne (formulaire, correctiondevis → sp_correction_devis, propre aux véhicules).

GET  /api/devis/<iddevis>/imposition-garanties/ : lignes du devis (assuré, maison, famille…) et leurs garanties acquises
     (capital, primes, taxe et taux de taxe de la garantie, stdtauxtaxegarantieproduit), taux de taxe du produit
     (fn_get_taux_taxe, appliqué à l'accessoire) et montants du devis.
POST : {"Garanties": [{"Id": iddevisdetgarantie, "PrimeAnnuelle", "PrimeNette"}], "Accessoire", "Taxe", "PrimeTtc"} :
     primes des garanties écrites telles que saisies, taxe de chaque garantie recalculée à son taux, totaux de chaque
     ligne, puis en-tête par sp_maj_manuelle_primes (devis « prime imposée ») ; la ventilation qu'elle appelle ne change
     rien, les garanties retombant déjà sur la prime nette imposée. Taxe ou TTC absentes : calculées (taxes des
     garanties + taxe de l'accessoire au taux du produit ; prime nette + accessoire + taxe + frais de gestion).
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import connection, transaction
from rest_framework import permissions, status
from rest_framework.authentication import BasicAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from institutionnel.authentication import KnoxOrDemoTokenAuthentication

ID_PRODUIT_AUTO = 1
ID_PRODUIT_IA = 2
# Composantes de prime de l'Auto, jamais saisies ici
GARANTIES_HORS_IMPOSITION = (2, 3)


def _nombre(valeur):
    return float(valeur) if valeur is not None else 0


def _entier(valeur):
    return Decimal(valeur).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _montant(valeur, libelle):
    """Montant saisi (nombre ≥ 0) ; None si absent."""
    if valeur is None or valeur == "":
        return None
    try:
        montant = Decimal(str(valeur))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{libelle} : montant invalide.")
    if montant < 0:
        raise ValueError(f"{libelle} : le montant ne peut pas être négatif.")
    return _entier(montant)


def _devis(cursor, iddevis):
    cursor.execute(
        """
        SELECT d.iddevis, d.numerodevis, d.idproduit, d.idcompagnie, d.dateeffet::date, COALESCE(d.confirme, FALSE),
               COALESCE(d.archive, FALSE), d.primeannuelle, d.primenette, d.accessoire, d.taxe, d.primettc,
               COALESCE(d.accessoiregestionnaire, 0), COALESCE(d.primeimposee, FALSE), p.libelleproduit,
               (SELECT dd.idoffre FROM stddevisdetail dd WHERE dd.iddevis = d.iddevis ORDER BY dd.iddevisdetail LIMIT 1)
        FROM stddevis d LEFT JOIN stdproduit p ON p.idproduit = d.idproduit
        WHERE d.iddevis = %s
        """,
        [iddevis],
    )
    return cursor.fetchone()


def _garanties(cursor, iddevis, idproduit, date_effet):
    cursor.execute(
        """
        SELECT dd.iddevisdetail, dd.matricule, dd.observation, cl.nom, cl.prenoms,
               g.iddevisdetgarantie, g.idgarantie, sg.libellesousgarantie, g.capital, g.primeannuelle, g.primenette, g.taxe,
               (SELECT tt.tauxtaxe FROM stdtauxtaxegarantieproduit tt
                 WHERE tt.idgarantie = g.idgarantie AND tt.idproduit = %s AND %s BETWEEN tt.debutvalidite AND tt.finvalidite
                 LIMIT 1) AS taux
        FROM stddevisdetail dd
        JOIN stddevisdetgarantie g ON g.iddevisdet = dd.iddevisdetail
        LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = g.idgarantie
        -- IA : la ligne de chaque assuré porte son identifiant client dans la matricule
        LEFT JOIN stdclient cl ON %s = %s AND cl.idclient = CASE WHEN dd.matricule ~ '^0*[1-9][0-9]{0,17}$' THEN LTRIM(dd.matricule, '0')::bigint END
        WHERE dd.iddevis = %s AND COALESCE(g.acquise, FALSE) AND NOT (g.idgarantie = ANY(%s))
        ORDER BY dd.iddevisdetail, g.iddevisdetgarantie
        """,
        [idproduit, date_effet, idproduit, ID_PRODUIT_IA, iddevis, list(GARANTIES_HORS_IMPOSITION)],
    )
    return cursor.fetchall()


def _taux_produit(cursor, idproduit, idcompagnie, idoffre, date_effet):
    try:
        with transaction.atomic():
            # fn_get_taux_taxe(id_compagnie, id_produit, id_offre, date_effet)
            cursor.execute("SELECT fn_get_taux_taxe(%s, %s, %s, %s)", [idcompagnie, idproduit, idoffre or 0, date_effet])
            ligne = cursor.fetchone()
        return _nombre(ligne[0]) if ligne else None
    except Exception:  # noqa: BLE001 - taux indisponible : la taxe de l'accessoire reste à saisir
        return None


def _taxe_garantie(prime, taux, ancienne_prime, ancienne_taxe):
    """Taxe d'une garantie à son taux ; sans taux connu, au même rapport que la taxe enregistrée."""
    if taux is not None:
        return _entier(prime * Decimal(str(taux)) / 100)
    if ancienne_prime:
        return _entier(prime * Decimal(ancienne_taxe or 0) / Decimal(ancienne_prime))
    return Decimal("0")


def _lecture(cursor, iddevis):
    d = _devis(cursor, iddevis)
    lignes = {}
    for (iddetail, matricule, observation, nom, prenoms, idg, idgarantie, libelle, capital, pa, pn, taxe, taux) in _garanties(
        cursor, iddevis, d[2], d[4]
    ):
        ligne = lignes.setdefault(iddetail, {
            "IdDevisDetail": iddetail,
            "Libelle": " ".join(x for x in (nom, prenoms) if x).strip()
            or str(observation or "").strip() or str(matricule or "").strip(),
            "Garanties": [],
        })
        ligne["Garanties"].append({
            "Id": idg,
            "IdGarantie": idgarantie,
            "Libelle": libelle or f"Garantie {idgarantie}",
            "Capital": _nombre(capital),
            "PrimeAnnuelle": _nombre(pa),
            "PrimeNette": _nombre(pn),
            "Taxe": _nombre(taxe),
            "TauxTaxe": _nombre(taux) if taux is not None else None,
        })
    return {
        "Devis": {
            "IdDevis": d[0], "NumeroDevis": d[1], "IdProduit": d[2], "Produit": d[14] or "",
            "PrimeAnnuelle": _nombre(d[7]), "PrimeNette": _nombre(d[8]), "Accessoire": _nombre(d[9]),
            "Taxe": _nombre(d[10]), "PrimeTtc": _nombre(d[11]), "FraisGestion": _nombre(d[12]), "PrimeImposee": d[13],
        },
        "TauxTaxeProduit": _taux_produit(cursor, d[2], d[3], d[15], d[4]),
        "Lignes": list(lignes.values()),
    }


@api_view(["GET", "POST"])
@authentication_classes([KnoxOrDemoTokenAuthentication, BasicAuthentication])
@permission_classes([permissions.IsAuthenticated])
def imposition_garanties(request, pk):
    with connection.cursor() as cursor:
        d = _devis(cursor, pk)
        if not d or d[6]:
            return Response({"message": "Devis introuvable ou archivé."}, status=status.HTTP_404_NOT_FOUND)
        if d[2] == ID_PRODUIT_AUTO:
            return Response({"message": "Devis automobile : imposez la prime depuis le formulaire du devis (« Imposer la prime »)."},
                            status=status.HTTP_400_BAD_REQUEST)
        if request.method == "GET":
            return Response(_lecture(cursor, pk))
        if d[5]:
            return Response({"message": f"Le devis {d[1]} est déjà confirmé : ses primes ne peuvent plus être imposées."},
                            status=status.HTTP_400_BAD_REQUEST)

        donnees = request.data or {}
        try:
            saisies = {}
            for g in donnees.get("Garanties") or []:
                pn = _montant(g.get("PrimeNette"), "Prime nette d'une garantie")
                pa = _montant(g.get("PrimeAnnuelle"), "Prime annuelle d'une garantie")
                saisies[int(g.get("Id") or 0)] = (pa, pn)
            accessoire = _montant(donnees.get("Accessoire"), "Accessoire")
            taxe_saisie = _montant(donnees.get("Taxe"), "Taxe")
            ttc_saisie = _montant(donnees.get("PrimeTtc"), "Prime TTC")
        except (ValueError, TypeError) as err:
            return Response({"message": str(err)}, status=status.HTTP_400_BAD_REQUEST)

        garanties = _garanties(cursor, pk, d[2], d[4])
        connues = {g[5] for g in garanties}
        inconnues = [i for i in saisies if i not in connues]
        if inconnues:
            return Response({"message": "Garantie étrangère à ce devis ou non acquise."}, status=status.HTTP_400_BAD_REQUEST)
        if accessoire is None:
            accessoire = Decimal(d[9] or 0)

        with transaction.atomic():
            # Garanties non saisies : montants enregistrés gardés tels quels (sans arrondi) ; prime nette du devis = somme
            # des garanties, ce qui laisse sans effet la ventilation de sp_maj_manuelle_primes
            total_pa = total_pn = ecart_taxes = Decimal("0")
            par_ligne = {}
            for (iddetail, _m, _o, _n, _p, idg, _ig, _l, _c, pa, pn, taxe, taux) in garanties:
                pa_finale, pn_finale, taxe_finale = Decimal(pa or 0), Decimal(pn or 0), Decimal(taxe or 0)
                if idg in saisies:
                    nouvelle_pa, nouvelle_pn = saisies[idg]
                    if nouvelle_pn is not None:
                        # Prime annuelle non saisie : même rapport à la prime nette qu'avant (prorata de la durée)
                        if nouvelle_pa is None:
                            nouvelle_pa = _entier(nouvelle_pn * pa_finale / pn_finale) if pn_finale else nouvelle_pn
                        taxe_finale = _taxe_garantie(nouvelle_pn, taux, pn, taxe)
                        pn_finale = nouvelle_pn
                    if nouvelle_pa is not None:
                        pa_finale = nouvelle_pa
                    ecart_taxes += taxe_finale - Decimal(taxe or 0)
                    cursor.execute(
                        "UPDATE stddevisdetgarantie SET primenette = %s, primeannuelle = %s, taxe = %s WHERE iddevisdetgarantie = %s",
                        [pn_finale, pa_finale, taxe_finale, idg],
                    )
                cumul = par_ligne.setdefault(iddetail, [Decimal("0"), Decimal("0"), Decimal("0")])
                cumul[0] += pa_finale
                cumul[1] += pn_finale
                cumul[2] += taxe_finale
                total_pa += pa_finale
                total_pn += pn_finale
            for iddetail, (pa, pn, taxe) in par_ligne.items():
                cursor.execute(
                    "UPDATE stddevisdetail SET primeannuelle = %s, primenette = %s, taxeenregistrement = %s WHERE iddevisdetail = %s",
                    [pa, pn, taxe, iddetail],
                )
            if total_pn <= 0:
                transaction.set_rollback(True)
                return Response({"message": "La prime nette du devis doit être supérieure à 0."}, status=status.HTTP_400_BAD_REQUEST)
            taux_produit = _taux_produit(cursor, d[2], d[3], d[15], d[4])
            # Taxe non saisie : celle du devis, corrigée de l'écart des garanties modifiées et de la taxe de l'écart
            # d'accessoire au taux du produit (une taxe enregistrée qui ne retombe pas sur les garanties est gardée)
            ecart_accessoire = accessoire - Decimal(d[9] or 0)
            taxe = taxe_saisie if taxe_saisie is not None else _entier(Decimal(d[10] or 0) + ecart_taxes + (
                ecart_accessoire * Decimal(str(taux_produit)) / 100 if taux_produit else Decimal("0")))
            ttc = ttc_saisie if ttc_saisie is not None else total_pn + accessoire + taxe + _entier(d[12] or 0)
            cursor.execute(
                "CALL public.sp_maj_manuelle_primes(%s, %s, %s, %s, %s, %s, %s, %s)",
                [d[1], total_pa, total_pn, accessoire, taxe, 0, 0, ttc],
            )
        return Response(_lecture(cursor, pk))
