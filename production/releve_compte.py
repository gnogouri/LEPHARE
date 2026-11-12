"""
Relevé de compte d'un client, au format du relevé OREOLE remis au client quand un devis Dommages est
confirmé (document reçu le 2026-10-08 : relevé STEP BY STEP du 13/01/2026, 13 cautions NSIA) : une ligne
par quittance — période, branche, opération (« Assurance CAUTION - Police N°… »), prime TTC,
encaissement, solde — et la compagnie à l'ordre de laquelle le chèque est établi.

Lignes proposées : la quittance du contrat demandé, puis les quittances non soldées du même client
(contrats non annulés, toutes branches), les plus anciennes d'abord ; l'écran laisse choisir celles à
imprimer. Encaissement = montant encaissé de la quittance (mt_encaisse), comme le dossier client 360°.
"""

from datetime import datetime

from .reste_encaissement import reste_a_encaisser, sql_reste

ID_PRODUIT_DOMMAGES = 9
ID_AVENANT_AFFAIRE_NOUVELLE = 1


def _iso(valeur):
    if valeur is None:
        return None
    if isinstance(valeur, datetime):
        valeur = valeur.date()
    return valeur.isoformat()


def _montant(valeur):
    return int(round(float(valeur or 0)))


def _sans_prefixe(libelle):
    """« ASSURANCE CAUTION » → « CAUTION » (le relevé écrit « Assurance CAUTION »)."""
    libelle = " ".join(str(libelle or "").split()).upper()
    return libelle[len("ASSURANCE "):] if libelle.startswith("ASSURANCE ") else libelle


def releve_compte(cursor, idcontrat):
    """Client du contrat et lignes proposées pour son relevé (None si le contrat n'existe pas)."""
    cursor.execute(
        """
        SELECT c.idclient, TRIM(COALESCE(cl.nom, '') || ' ' || COALESCE(cl.prenoms, ''))
        FROM stdcontrat c LEFT JOIN stdclient cl ON cl.idclient = c.idclient
        WHERE c.idcontrat = %s
        """,
        [idcontrat],
    )
    client = cursor.fetchone()
    if not client:
        return None
    # Quittances non soldées : un reliquat de moins de 5 F compte comme soldé
    cursor.execute(
        f"""
        SELECT c.idcontrat, c.numeropolice, c.numeropolicecompagnie, c.idproduit, p.libelleproduit, cat.libelle,
               c.idavenant, a.textemouvement, q.idquittance, q.numeroquittance,
               COALESCE(q.dateeffet, c.dateeffet), COALESCE(q.dateexpiration, c.dateexpiration),
               COALESCE(q.primettc, c.primettc), COALESCE(q.mt_encaisse, 0),
               c.idcompagnie, co.raisonsociale, doc.ordrecheque
        FROM stdcontrat c
        LEFT JOIN stdquittance q ON q.idquittance = c.idquittance
        LEFT JOIN stdproduit p ON p.idproduit = c.idproduit
        LEFT JOIN stdavenant a ON a.idavenant = c.idavenant
        LEFT JOIN stdcompagnie co ON co.idcompagnie = c.idcompagnie
        LEFT JOIN lephare_compagnie_document doc ON doc.idcompagnie = c.idcompagnie
        LEFT JOIN LATERAL (
            SELECT t.libelle FROM stdcontratdetail cd JOIN stdtarif t ON t.idtarif = cd.idtarif
            WHERE cd.idcontrat = c.idcontrat ORDER BY cd.idcontratdetail LIMIT 1
        ) cat ON c.idproduit = %s
        WHERE c.idclient = %s AND COALESCE(c.idcontratannulation, 0) = 0
          AND (c.idcontrat = %s
               OR (q.idquittance IS NOT NULL AND q.primettc > 0 AND {sql_reste()} > 0))
        ORDER BY COALESCE(q.dateeffet, c.dateeffet), c.idcontrat
        """,
        [ID_PRODUIT_DOMMAGES, client[0], idcontrat],
    )
    lignes = []
    for (id_contrat, police, police_cie, id_produit, produit, categorie, id_avenant, mouvement, id_quittance,
         numero_quittance, effet, expiration, ttc, encaisse, id_compagnie, compagnie, ordre) in cursor.fetchall():
        branche = _sans_prefixe(categorie if id_produit == ID_PRODUIT_DOMMAGES and categorie else produit)
        numero = (police_cie or "").strip() or police or ""
        operation = f"Assurance {branche} - Police N°{numero}"
        if id_avenant and id_avenant != ID_AVENANT_AFFAIRE_NOUVELLE and mouvement:
            operation += f" ({str(mouvement).strip().capitalize()})"
        solde = _montant(reste_a_encaisser(ttc, encaisse))
        ttc, encaisse = _montant(ttc), _montant(encaisse)
        lignes.append({
            "IdContrat": id_contrat,
            "IdQuittance": id_quittance,
            "NumeroQuittance": numero_quittance or "",
            "NumeroPolice": numero,
            "NumeroPoliceCabinet": police or "",
            "Produit": produit or "",
            "Branche": branche.capitalize(),
            "Operation": operation,
            "DateEffet": _iso(effet),
            "DateExpiration": _iso(expiration),
            "PrimeTtc": ttc,
            "Encaissement": encaisse,
            "Solde": solde,
            "IdCompagnie": id_compagnie,
            "Compagnie": compagnie or "",
            # « Chèque à l'ordre de » : réglé par compagnie (Compagnies partenaires > Documents imprimés)
            "OrdreCheque": (ordre or "").strip() or compagnie or "",
            "ContratCourant": id_contrat == idcontrat,
        })
    return {"IdContrat": idcontrat, "Client": {"IdClient": client[0], "Nom": client[1]}, "Lignes": lignes}
