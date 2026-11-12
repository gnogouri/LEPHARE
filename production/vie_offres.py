"""
Offres commerciales de la branche Vie (demande du 2026-11-10) : AFA, Retraite complémentaire, Temporaire décès…, réglées
dans l'administration (Réglages Vie, configuration_api/parametrage_vie.py) et proposées en liste déroulante à la saisie
d'un devis Vie (production/afa.py). Tables de la migration production 0219 : lephare_vie_offre, lephare_vie_devis (offre de
chaque devis), lephare_vie_cotisant (salariés d'un état de cotisations, production/vie_retraite.py).

Base où la migration 0219 n'est pas encore appliquée : seule l'offre AFA est proposée et les devis AFA s'enregistrent comme
avant (aucune requête sur les tables absentes, qui mettrait l'écran en erreur).
"""

SAISIE_CAPITAL = "CAPITAL"  # un assuré par ligne : capital, prime, bénéficiaires
SAISIE_COTISATION = "COTISATION"  # un salarié par ligne : part salariale, part employeur
SAISIES = {SAISIE_CAPITAL: "Assurés avec capital et prime", SAISIE_COTISATION: "Cotisations salarié et employeur"}
PERIODICITES = {"ANNUELLE": "Annuelle", "SEMESTRIELLE": "Semestrielle", "TRIMESTRIELLE": "Trimestrielle", "MENSUELLE": "Mensuelle"}
CODE_AFA = "AFA"
ID_GARANTIE_DECES = 231  # DÉCÈS TOUTES CAUSES
MIGRATION = "production 0219_vie_offres_commerciales"

# Offre des devis Vie d'avant les offres commerciales et des bases sans la migration 0219
OFFRE_AFA = {"IdOffre": 0, "Code": CODE_AFA, "Libelle": "AFA", "Saisie": SAISIE_CAPITAL, "Periodicite": "ANNUELLE",
             "IdGarantie": ID_GARANTIE_DECES, "Garantie": "DÉCÈS TOUTES CAUSES", "Description": "", "Actif": True, "Ordre": 1}

COLONNES = """o.idoffre, o.code, o.libelle, o.saisie, o.periodicite, o.idgarantie, TRIM(COALESCE(sg.libellesousgarantie, '')),
              o.description, o.actif, o.ordre"""


def tables_presentes(cursor):
    """Migration 0219 appliquée (tables des offres et des cotisants présentes)."""
    cursor.execute("SELECT to_regclass('public.lephare_vie_offre') IS NOT NULL AND to_regclass('public.lephare_vie_cotisant') IS NOT NULL")
    return bool(cursor.fetchone()[0])


def _offre(ligne):
    idoffre, code, libelle, saisie, periodicite, idgarantie, garantie, description, actif, ordre = ligne
    return {"IdOffre": idoffre, "Code": code, "Libelle": libelle, "Saisie": saisie, "Periodicite": periodicite,
            "IdGarantie": idgarantie, "Garantie": garantie, "Description": description, "Actif": bool(actif), "Ordre": ordre}


def offres(cursor, actives_seulement=True):
    """Offres dans l'ordre de la liste déroulante ; sans la migration 0219 : AFA seule."""
    if not tables_presentes(cursor):
        return [dict(OFFRE_AFA)]
    cursor.execute(
        f"""SELECT {COLONNES} FROM lephare_vie_offre o LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = o.idgarantie
            {'WHERE o.actif' if actives_seulement else ''} ORDER BY o.ordre, o.libelle"""
    )
    return [_offre(l) for l in cursor.fetchall()]


def offre_par_id(cursor, id_offre):
    """Offre n° id_offre (0 ou vide : AFA), None si inconnue."""
    if not tables_presentes(cursor):
        return dict(OFFRE_AFA) if not id_offre else None
    if id_offre:
        cursor.execute(f"""SELECT {COLONNES} FROM lephare_vie_offre o LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = o.idgarantie
                           WHERE o.idoffre = %s""", [id_offre])
    else:
        cursor.execute(f"""SELECT {COLONNES} FROM lephare_vie_offre o LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = o.idgarantie
                           WHERE o.code = %s""", [CODE_AFA])
    ligne = cursor.fetchone()
    return _offre(ligne) if ligne else (dict(OFFRE_AFA) if not id_offre else None)


# Devis d'où découle un devis (renouvellements, incorporations), de proche en proche : un devis de renouvellement créé hors de
# l'écran Vie (page Renouvellement, sp_avenant_initiation) n'a pas sa ligne lephare_vie_devis, ni ceux qui le suivent ; l'offre
# est celle du devis le plus proche qui en porte une (2026-11-11 : un mois de Retraite complémentaire passait pour un devis AFA).
CHAINE = """
    WITH RECURSIVE chaine(origine, iddevis, idoldhist, rang) AS (
        SELECT d.iddevis, d.iddevis, d.idoldhist, 0 FROM stddevis d WHERE d.iddevis = ANY(%s)
        UNION ALL
        SELECT c.origine, d.iddevis, d.idoldhist, c.rang + 1 FROM stddevis d JOIN chaine c ON d.iddevis = c.idoldhist
        WHERE c.rang < 1000 AND COALESCE(c.idoldhist, 0) <> 0 AND c.idoldhist <> c.iddevis
    )"""


def offre_du_devis(cursor, id_devis):
    """Offre d'un devis Vie : la sienne, sinon celle du devis le plus proche dont il découle (renouvellement, incorporation),
    sinon AFA."""
    if not id_devis or not tables_presentes(cursor):
        return dict(OFFRE_AFA)
    cursor.execute(
        f"""{CHAINE}
            SELECT {COLONNES} FROM chaine c
            JOIN lephare_vie_devis v ON v.iddevis = c.iddevis
            JOIN lephare_vie_offre o ON o.idoffre = v.idoffre
            LEFT JOIN stdsousgarantie sg ON sg.idsousgarantie = o.idgarantie
            ORDER BY c.rang LIMIT 1""",
        [[id_devis]],
    )
    ligne = cursor.fetchone()
    return _offre(ligne) if ligne else offre_par_id(cursor, 0)


def offres_des_devis(cursor, ids_devis):
    """{iddevis: libellé de l'offre} des devis qui en ont une, la leur ou celle du devis le plus proche dont ils découlent
    (polices proposées au renouvellement)."""
    ids = [i for i in ids_devis if i]
    if not ids or not tables_presentes(cursor):
        return {}
    cursor.execute(
        f"""{CHAINE}
            SELECT DISTINCT ON (c.origine) c.origine, o.code, o.libelle FROM chaine c
            JOIN lephare_vie_devis v ON v.iddevis = c.iddevis
            JOIN lephare_vie_offre o ON o.idoffre = v.idoffre
            ORDER BY c.origine, c.rang""",
        [ids],
    )
    return {iddevis: {"Code": code, "Libelle": libelle} for iddevis, code, libelle in cursor.fetchall()}


def lier_devis(cursor, id_devis, offre, fichier=""):
    """Offre retenue pour le devis (rien à écrire sans la migration 0219 : le devis est un devis AFA)."""
    if not offre.get("IdOffre") or not tables_presentes(cursor):
        return
    cursor.execute(
        """INSERT INTO lephare_vie_devis (iddevis, idoffre, fichier) VALUES (%s, %s, %s)
           ON CONFLICT (iddevis) DO UPDATE SET idoffre = EXCLUDED.idoffre,
               fichier = CASE WHEN EXCLUDED.fichier <> '' THEN EXCLUDED.fichier ELSE lephare_vie_devis.fichier END""",
        [id_devis, offre["IdOffre"], (fichier or "")[:200]],
    )
