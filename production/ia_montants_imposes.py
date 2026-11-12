"""
Individuelle Accidents : montants exacts de chaque assuré (demande du 2026-11-06 : « au renouvellement tu fais un calcul et à l'import du fichier
Excel tu ne prends pas les montants exacts du fichier »).

Constat : la base ne reprend la prime reçue que pour les offres personnalisées (173, 174, fn_garantie_offre_ia) ; toute autre offre est recalculée
au forfait ou au tarif. La finalisation des tarifs CGA et CI-ENERGIES recalcule en plus l'accessoire au barème assuré par assuré et arrondit la
taxe garantie par garantie : 6 001 F au lieu des 6 000 F du fichier. Au renouvellement, l'écran renvoyait chaque assuré sans sa prime : retarifé.

Règle : les montants connus d'un assuré sont gardés (lephare_ia_montants_imposes) et réappliqués après chaque calcul du devis :
- FICHIER : PRIME HT et PRIME TTC du fichier ; accessoire = TTC / (1 + taux de taxe) - HT, au franc ; taxe = TTC - HT - accessoire ;
- RENOUVELLEMENT : montants de l'assuré sur le contrat renouvelé (ceux du fichier s'ils sont connus, sinon sa part du contrat).
Application : la prime nette de la ligne est répartie sur ses garanties (au prorata des primes calculées), la taxe de chaque garantie suit son
taux ; si tous les assurés du devis ont un montant gardé, l'en-tête prend exactement les totaux (sp_maj_manuelle_primes, devis « prime imposée »),
sinon les autres assurés y comptent pour leur prime au tarif et l'accessoire du barème calculé sur leur prime. Une ligne dont les capitaux ou l'offre changent, ou dont la prime est saisie, perd son montant gardé.
La confirmation ne refinalise pas : le contrat garde ces montants. Ce sont des montants convenus : l'arrondi automatique de la TTC à 5 F ne s'y
applique pas (même exception que pour la reprise des affaires antérieures, réglage de session lephare.reprise).
"""

from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

from django.db import transaction

from .imposition_garanties import _taxe_garantie

ID_PRODUIT_IA = 2
# Tarifs CGA et CI-ENERGIES : accessoire du barème par assuré (sp_finalisation_devis)
TARIFS_ACCESSOIRE_PAR_ASSURE = (145, 76)
# IA MINENE (66) : tarif fixe par formule, frais de gestion et prime multipliée par les adhérents propres à la finalisation ; recalculée à
# l'identique, elle reste hors de ce mécanisme (demande du 2026-11-06, police 1186118263203U : la taxe absorbait les frais de gestion)
OFFRES_HORS_MONTANTS_GARDES = (66,)
UN_FRANC = Decimal("1")
CENTIME = Decimal("0.01")


def _franc(valeur):
    return Decimal(valeur).quantize(UN_FRANC, ROUND_HALF_UP)


def _decimal(valeur):
    try:
        return Decimal(str(valeur if valeur not in (None, "") else 0))
    except Exception:
        return Decimal("0")


def decomposer(prime_ht, prime_ttc, taux_taxe):
    """(prime nette, accessoire, TTC) d'un assuré d'après les primes du fichier, ou None s'il manque l'une des deux."""
    pn, ttc = _decimal(prime_ht).quantize(CENTIME, ROUND_HALF_UP), _decimal(prime_ttc).quantize(CENTIME, ROUND_HALF_UP)
    if pn <= 0 or ttc <= 0:
        return None
    taux = _decimal(taux_taxe)
    accessoire = _franc(ttc / (1 + taux / 100) - pn) if taux >= 0 else Decimal("0")
    accessoire = max(accessoire, Decimal("0"))
    if pn + accessoire > ttc:
        accessoire = max(ttc - pn, Decimal("0"))
    return pn, accessoire, ttc


def repartir(total, poids, pas=UN_FRANC):
    """Montant réparti au prorata des poids (à parts égales s'ils sont nuls), la somme tombant juste (plus forts restes)."""
    if not poids:
        return []
    poids = [_decimal(p) for p in poids]
    somme = sum(poids)
    if somme <= 0:
        poids, somme = [Decimal(1)] * len(poids), Decimal(len(poids))
    total = _decimal(total)
    bruts = [total * p / somme for p in poids]
    parts = [(b / pas).to_integral_value(ROUND_FLOOR) * pas for b in bruts]
    reste = int(((total - sum(parts)) / pas).to_integral_value(ROUND_HALF_UP))
    for i in sorted(range(len(bruts)), key=lambda i: bruts[i] - parts[i], reverse=True)[:max(reste, 0)]:
        parts[i] += pas
    return parts


_TABLE_PRESENTE = False


def table_presente(cursor):
    """Migration production 0214 appliquée ? Sans elle, l'IA fonctionne comme avant (montants recalculés) au lieu d'échouer. Le test précède
    toute écriture : une erreur SQL interromprait la transaction de l'import."""
    global _TABLE_PRESENTE
    if not _TABLE_PRESENTE:
        cursor.execute("SELECT to_regclass('public.lephare_ia_montants_imposes') IS NOT NULL")
        _TABLE_PRESENTE = bool(cursor.fetchone()[0])
    return _TABLE_PRESENTE


MESSAGE_MIGRATION = ("Montants du fichier non repris exactement : la migration production 0214 n'est pas appliquée sur cette base "
                     "(python manage.py migrate production). Primes calculées comme avant.")


def taux_taxe(cursor, id_compagnie, id_offre, date_effet):
    cursor.execute("SELECT fn_get_taux_taxe(%s, %s, %s, %s)", [id_compagnie, ID_PRODUIT_IA, id_offre or 0, date_effet])
    ligne = cursor.fetchone()
    return _decimal(ligne[0] if ligne else 0)


def enregistrer(cursor, id_devis, lignes, source):
    """lignes : [{Matricule, PrimeNette, Accessoire, PrimeTtc, CapitalDeces, CapitalInfirmite, IdOffre}]. Renvoie False sans la migration 0214."""
    if not table_presente(cursor):
        return False
    for l in lignes:
        cursor.execute(
            """INSERT INTO lephare_ia_montants_imposes (iddevis, matricule, primenette, accessoire, primettc, capitaldeces, capitalinfirmite, idoffre, source)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (iddevis, matricule) DO UPDATE SET primenette = EXCLUDED.primenette, accessoire = EXCLUDED.accessoire, primettc = EXCLUDED.primettc,
                   capitaldeces = EXCLUDED.capitaldeces, capitalinfirmite = EXCLUDED.capitalinfirmite, idoffre = EXCLUDED.idoffre, source = EXCLUDED.source,
                   datecreation = now()""",
            [id_devis, str(l["Matricule"]).strip(), l["PrimeNette"], l["Accessoire"], l["PrimeTtc"], l.get("CapitalDeces"), l.get("CapitalInfirmite"),
             l.get("IdOffre"), source],
        )
    return True


def gardes(cursor, id_devis):
    if not table_presente(cursor):
        return {}
    cursor.execute("""SELECT matricule, primenette, accessoire, primettc, capitaldeces, capitalinfirmite, idoffre, source
                      FROM lephare_ia_montants_imposes WHERE iddevis = %s""", [id_devis])
    return {m.strip(): {"PrimeNette": pn, "Accessoire": acc, "PrimeTtc": ttc, "CapitalDeces": cd, "CapitalInfirmite": ci, "IdOffre": o, "Source": s}
            for m, pn, acc, ttc, cd, ci, o, s in cursor.fetchall()}


def oublier_si_change(cursor, id_devis, matricule, capital_deces, capital_infirmite, id_offre, prime_saisie):
    """Ligne renvoyée au calcul : son montant gardé tombe si les capitaux, l'offre changent ou si une prime est saisie à la main."""
    if not table_presente(cursor):
        return False
    cursor.execute("""SELECT capitaldeces, capitalinfirmite, idoffre, primenette FROM lephare_ia_montants_imposes WHERE iddevis = %s AND matricule = %s""",
                   [id_devis, matricule])
    ligne = cursor.fetchone()
    if not ligne:
        return False
    # Prime saisie identique au montant gardé (tarif personnalisé rechargé) : ce n'est pas un changement
    prime_saisie = _decimal(prime_saisie)
    meme = ((prime_saisie <= 0 or _franc(prime_saisie) == _franc(ligne[3])) and (ligne[0] is None or _franc(ligne[0]) == _franc(capital_deces))
            and (ligne[1] is None or _franc(ligne[1]) == _franc(capital_infirmite)) and (ligne[2] is None or int(ligne[2]) == int(id_offre or 0)))
    if not meme:
        cursor.execute("DELETE FROM lephare_ia_montants_imposes WHERE iddevis = %s AND matricule = %s", [id_devis, matricule])
    return not meme


def appliquer(cursor, id_devis):
    """Montants gardés réappliqués sur le devis (non confirmé). Renvoie le nombre de lignes concernées, ou 0."""
    with transaction.atomic():
        return _appliquer(cursor, id_devis)


def _appliquer(cursor, id_devis):
    cursor.execute("""SELECT numerodevis, idproduit, idcompagnie, dateeffet::date, dateemission::date, COALESCE(confirme, FALSE), idclient, idassure,
                             COALESCE(flotte, FALSE), primenette, COALESCE(accessoiregestionnaire, 0)
                      FROM stddevis WHERE iddevis = %s""", [id_devis])
    devis = cursor.fetchone()
    if not devis or devis[1] != ID_PRODUIT_IA or devis[5]:
        return 0
    cursor.execute("SELECT 1 FROM stddevisdetail WHERE iddevis = %s AND idoffre = ANY(%s) LIMIT 1", [id_devis, list(OFFRES_HORS_MONTANTS_GARDES)])
    if cursor.fetchone():
        return 0
    montants = gardes(cursor, id_devis)
    if not montants:
        return 0
    numero, _p, id_compagnie, date_effet, date_emission, _c, _client, _assure, _flotte, _pn, frais_gestion = devis
    cursor.execute("SELECT iddevisdetail, TRIM(matricule) FROM stddevisdetail WHERE iddevis = %s ORDER BY iddevisdetail", [id_devis])
    lignes = cursor.fetchall()
    concernees = []
    for iddetail, matricule in lignes:
        if matricule not in montants:
            continue
        m = montants[matricule]
        cursor.execute("""SELECT g.iddevisdetgarantie, g.idgarantie, COALESCE(g.primeannuelle, 0), COALESCE(g.primenette, 0), COALESCE(g.taxe, 0),
                                 (SELECT tt.tauxtaxe FROM stdtauxtaxegarantieproduit tt WHERE tt.idgarantie = g.idgarantie AND tt.idproduit = %s
                                    AND %s BETWEEN tt.debutvalidite AND tt.finvalidite LIMIT 1)
                          FROM stddevisdetgarantie g WHERE g.iddevisdet = %s AND COALESCE(g.acquise, FALSE) AND g.idgarantie NOT IN (2, 3)
                          ORDER BY g.iddevisdetgarantie""", [ID_PRODUIT_IA, date_effet, iddetail])
        garanties = cursor.fetchall()
        if not garanties:
            continue  # ligne sans garantie (pas encore calculée) : laissée telle quelle
        concernees.append((iddetail, m))
        cible = _decimal(m["PrimeNette"])
        parts = repartir(cible, [g[3] for g in garanties], CENTIME if cible != cible.to_integral_value() else UN_FRANC)
        total_pa = total_taxe = Decimal("0")
        for (idg, _ig, pa, pn, taxe, taux), part in zip(garanties, parts):
            pa_finale = (part * pa / pn).quantize(CENTIME, ROUND_HALF_UP) if pn else part
            taxe_finale = _taxe_garantie(part, taux, pn, taxe)
            cursor.execute("UPDATE stddevisdetgarantie SET primenette = %s, primeannuelle = %s, taxe = %s WHERE iddevisdetgarantie = %s",
                           [part, pa_finale, taxe_finale, idg])
            total_pa += pa_finale
            total_taxe += taxe_finale
        cursor.execute("UPDATE stddevisdetail SET primenette = %s, primeannuelle = %s, taxeenregistrement = %s, chargeutile = %s WHERE iddevisdetail = %s",
                       [cible, total_pa, total_taxe, _decimal(m["Accessoire"]), iddetail])
    if not concernees:
        return 0
    cursor.execute("SELECT fn_get_taux_commission(%s, %s, %s)", [ID_PRODUIT_IA, id_compagnie, date_emission or date_effet])
    taux_commission = _decimal((cursor.fetchone() or [0])[0])
    # En-tête : montants gardés des assurés qui en ont, montants calculés des autres (prime au tarif, accessoire au barème de la ligne)
    gardees = {iddetail for iddetail, _m in concernees}
    contributions = _contributions(cursor, id_devis, id_compagnie, date_effet, {iddetail: m for iddetail, m in concernees})
    pn = sum((c[0] for c in contributions.values()), Decimal("0"))
    accessoire = sum((c[2] for c in contributions.values()), Decimal("0"))
    ttc = sum((c[3] for c in contributions.values()), Decimal("0"))
    # Frais de gestion du devis comptés à part : la taxe n'est que le reste de la TTC
    taxe = ttc - pn - accessoire - _decimal(frais_gestion)
    pa = sum((c[1] for c in contributions.values()), Decimal("0"))
    # Montants convenus : pas d'arrondi automatique de la TTC à 5 F (exception de session, limitée à cette écriture)
    cursor.execute("SELECT set_config('lephare.reprise', 'on', true)")
    cursor.execute("CALL public.sp_maj_manuelle_primes(%s, %s, %s, %s, %s, %s, %s, %s)", [numero, pa, pn, accessoire, taxe, 0, 0, ttc])
    cursor.execute("SELECT set_config('lephare.reprise', '', true)")
    compagnie = _franc(accessoire / 2)
    cursor.execute("""UPDATE stddevis SET accessoirecompagnie = %s, accessoireintermediaire = %s, commissionintermediaire = %s WHERE iddevis = %s""",
                   [compagnie, accessoire - compagnie, _franc(pn * taux_commission / 100), id_devis])
    return len(concernees)


def _contributions(cursor, id_devis, id_compagnie, date_effet, gardees):
    """Part de chaque ligne du devis : (prime nette, prime annuelle, accessoire, TTC). Ligne gardée : ses montants. Autre ligne : prime et taxe
    de ses garanties, plus l'accessoire du barème (fn_get_accessoire, comme la finalisation) : par assuré pour les tarifs CGA et CI-ENERGIES,
    sur le total des autres lignes, réparti au prorata de leurs primes, pour les autres tarifs."""
    cursor.execute("""SELECT dd.iddevisdetail, dd.idtarif, dd.idoffre, COALESCE(dd.primenette, 0), COALESCE(dd.primeannuelle, 0), COALESCE(dd.taxeenregistrement, 0)
                      FROM stddevisdetail dd WHERE dd.iddevis = %s ORDER BY dd.iddevisdetail""", [id_devis])
    lignes = cursor.fetchall()

    def bareme(prime, id_offre):
        cursor.execute("SELECT accessoire_compagnie + accessoire_intermediaire, taxe_sur_accessoire FROM fn_get_accessoire(%s, 2, %s, %s, %s)",
                       [prime, id_offre, id_compagnie, date_effet])
        acc, taxe_acc = cursor.fetchone() or (0, 0)
        return _decimal(acc), _decimal(taxe_acc)

    resultat, groupe = {}, []
    for iddetail, id_tarif, id_offre, pn, pa, taxe in lignes:
        if iddetail in gardees:
            m = gardees[iddetail]
            resultat[iddetail] = (_decimal(m["PrimeNette"]), _decimal(pa), _decimal(m["Accessoire"]), _decimal(m["PrimeTtc"]))
        elif id_tarif in TARIFS_ACCESSOIRE_PAR_ASSURE:
            acc, taxe_acc = bareme(pn, id_offre)
            resultat[iddetail] = (_decimal(pn), _decimal(pa), acc, _decimal(pn) + _decimal(taxe) + acc + taxe_acc)
        else:
            groupe.append((iddetail, id_offre, _decimal(pn), _decimal(pa), _decimal(taxe)))
    if groupe:
        acc, taxe_acc = bareme(sum((g[2] for g in groupe), Decimal("0")), groupe[0][1])
        for (iddetail, _o, pn, pa, taxe), part_acc, part_taxe in zip(groupe, repartir(acc, [g[2] for g in groupe]), repartir(taxe_acc, [g[2] for g in groupe])):
            resultat[iddetail] = (pn, pa, part_acc, pn + taxe + part_acc + part_taxe)
    return resultat


def ttc_par_ligne(cursor, id_devis, lignes):
    """TTC de chaque ligne (iddevisdetail -> TTC) quand le devis a des montants gardés et que les parts retombent sur sa TTC, sinon None."""
    montants = gardes(cursor, id_devis)
    if not montants:
        return None
    cursor.execute("SELECT idcompagnie, dateeffet::date, primettc FROM stddevis WHERE iddevis = %s", [id_devis])
    id_compagnie, date_effet, ttc = cursor.fetchone()
    cursor.execute("SELECT iddevisdetail, TRIM(matricule) FROM stddevisdetail WHERE iddevis = %s", [id_devis])
    gardees = {iddetail: montants[m] for iddetail, m in cursor.fetchall() if m in montants}
    parts = _contributions(cursor, id_devis, id_compagnie, date_effet, gardees)
    resultat = {l.get("id_devis_detail"): parts[l.get("id_devis_detail")][3] for l in lignes if l.get("id_devis_detail") in parts}
    if len(resultat) != len(lignes):
        return None
    return resultat if abs(sum(resultat.values()) - _decimal(ttc)) <= 2 else None


def montants_du_contrat(cursor, objets):
    """Montants de chaque assuré du contrat renouvelé : ceux gardés à l'import s'il y en a, sinon sa part du contrat d'où vient sa ligne
    (accessoire et TTC au prorata des primes nettes du contrat, plus forts restes). objets : [{Matricule, IdContrat, IdContratDetail}]."""
    par_contrat = {}
    for o in objets:
        par_contrat.setdefault(o["IdContrat"], []).append(o)
    resultat = {}
    for id_contrat, siens in par_contrat.items():
        cursor.execute("SELECT iddevis, COALESCE(primenette, 0), COALESCE(accessoire, 0), COALESCE(primettc, 0) FROM stdcontrat WHERE idcontrat = %s",
                       [id_contrat])
        id_devis, pn_contrat, acc_contrat, ttc_contrat = cursor.fetchone()
        connus = gardes(cursor, id_devis)
        cursor.execute("""SELECT idcontratdetail, TRIM(matricule), COALESCE(primenette, 0), COALESCE(primeannuelle, 0) FROM stdcontratdetail
                          WHERE idcontrat = %s AND NOT (COALESCE(idoffre, 0) = ANY(%s))""", [id_contrat, list(OFFRES_HORS_MONTANTS_GARDES)])
        lignes = cursor.fetchall()
        if not lignes:
            continue
        # Frais de gestion hors de la part des assurés : la TTC répartie est celle du contrat sans eux
        cursor.execute("SELECT COALESCE(accessoiregestionnaire, 0) FROM stdcontrat WHERE idcontrat = %s", [id_contrat])
        ttc_contrat = ttc_contrat - (cursor.fetchone() or [0])[0]
        pns = [l[2] for l in lignes]
        accessoires = repartir(acc_contrat, pns)
        ttcs = repartir(ttc_contrat, pns)
        part = {l[1]: (l[2], acc, ttc) for l, acc, ttc in zip(lignes, accessoires, ttcs)}
        for o in siens:
            m = str(o["Matricule"]).strip()
            if m in connus:
                k = connus[m]
                resultat[m] = (_decimal(k["PrimeNette"]), _decimal(k["Accessoire"]), _decimal(k["PrimeTtc"]))
            elif m in part and part[m][0] > 0:
                resultat[m] = (_decimal(part[m][0]), _decimal(part[m][1]), _decimal(part[m][2]))
    return resultat
