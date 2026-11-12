"""
FICHIER: production/anti_doublons/importateur.py
VERSION AMÉLIORÉE avec gestion robuste des doublons

CORRECTIONS APPLIQUÉES:
1. Cache local pour doublons dans le même fichier
2. Passage de cle_unique à insert_new_assure()
3. Gestion IntegrityError (race condition)
4. Validation NumeroAssure unique
5. Messages d'erreur explicites
"""

import os
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from django.db import connection, transaction, IntegrityError
from .detection_collision import detecter_collision
from .utils import normaliser_texte
from .rapport import (
    ConfigurationImport,
    RapportImport,
    StatutImport,
    ModeImport,
    AssureResultat,
)
from django.core.exceptions import ValidationError

from .cle_unique import (
    obtenir_cle_unique_assure,
    generer_numero_assure_auto,
    assure_existe_deja,
    verifier_fichier_deja_importe
)


logger = logging.getLogger(__name__)


class ErreurPrimesImport(Exception):
    """Import refusé en entier : prime calculée nulle alors que le fichier en indique une."""


def _montant(valeur) -> Decimal:
    try:
        return Decimal(str(valeur or 0))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _assure_du_souscripteur(id_assure, id_souscripteur) -> bool:
    """L'assuré figure déjà dans un devis ou un contrat de ce souscripteur (ou est le souscripteur)."""
    if not id_souscripteur:
        return False
    if int(id_assure) == int(id_souscripteur):
        return True
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM stddevisdetail dd JOIN stddevis d ON d.iddevis = dd.iddevis
            WHERE d.idclient = %s AND dd.matricule = LPAD(%s::text, 20, '0')
            UNION ALL
            SELECT 1 FROM stdcontratdetail cd JOIN stdcontrat ct ON ct.idcontrat = cd.idcontrat
            WHERE ct.idclient = %s AND cd.idassure = %s
            LIMIT 1
            """,
            [id_souscripteur, id_assure, id_souscripteur, id_assure],
        )
        return cursor.fetchone() is not None


def _reprendre_assure_existant(assure_existant, assure_data, numero_ligne, rapport, id_souscripteur):
    """Assuré déjà en base (même personne) repris dans le devis au lieu d'être recréé :
    fonction mise à jour, ayants droit remplacés par ceux du fichier s'ils diffèrent (l'ancienne
    désignation est gardée dans le rapport d'import). La fiche n'est modifiée que si l'assuré
    appartient déjà au souscripteur du devis : reconnu sur son seul nom et sa date de naissance,
    il pourrait être l'assuré d'un autre souscripteur."""
    from customer.models import Client
    from ..import_assures import enregistrer_beneficiaire

    if not _assure_du_souscripteur(assure_existant.IdClient, id_souscripteur):
        if assure_data.get("Beneficiaires") or assure_data.get("Fonction"):
            rapport.avertissements.append(
                f"Ligne {numero_ligne} - {assure_data['Nom']} {assure_data.get('Prenoms', '')} : assuré déjà connu "
                "hors de ce souscripteur, sa fiche (fonction, ayants droit) n'a pas été modifiée : à vérifier."
            )
        return

    fonction = (assure_data.get("Fonction") or "").strip()
    if fonction and fonction != (assure_existant.Fonction or "").strip():
        Client.objects.filter(pk=assure_existant.IdClient).update(Fonction=fonction)

    beneficiaires = assure_data.get("Beneficiaires") or []
    if not beneficiaires:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT nomayantdroit, prenomsayantdroit, part FROM stdayantdroitia WHERE idassure = %s ORDER BY idayantdroit",
            [assure_existant.IdClient],
        )
        existants = cursor.fetchall()

    def designation(nom, prenoms, part):
        return (normaliser_texte(f"{nom or ''} {prenoms or ''}"), _montant(part).quantize(Decimal("0.01")))

    avant = sorted(designation(n, p, part) for n, p, part in existants)
    apres = sorted(designation(b["Nom"], b["Prenoms"], b["Part"]) for b in beneficiaires)
    if avant == apres:
        return
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM stdayantdroitia WHERE idassure = %s", [assure_existant.IdClient])
    for beneficiaire in beneficiaires:
        enregistrer_beneficiaire(assure_existant.IdClient, beneficiaire)
    if existants:
        ancienne = " / ".join(" ".join(filter(None, [n, p, f"{part} %"])) for n, p, part in existants)
        rapport.avertissements.append(
            f"Ligne {numero_ligne} - {assure_data['Nom']} {assure_data.get('Prenoms', '')} : ayants droit remplacés par "
            f"ceux du fichier (avant : {ancienne})"
        )


def donnees_avec_avenant(request_post_data, id_avenant_devis, police_connexe_devis=""):
    """Données de l'écran avec l'avenant du devis existant à la place de celui envoyé. L'écran IA envoyait l'avenant 1
    (affaire nouvelle) en important dans un devis de renouvellement : sp_creation_devis_ia le réécrivait sur le devis,
    qui sortait de la page Renouvellement (devis REN seuls) et aurait pris une nouvelle police à la confirmation.
    La police Santé connexe du devis (IA MINENE) complète aussi une saisie vide, que la base refuse pour l'offre MINENE."""
    changer_avenant = bool(id_avenant_devis) and str(request_post_data.get("IdAvenant") or "") != str(id_avenant_devis)
    police = str(police_connexe_devis or "").strip()
    changer_police = bool(police) and not str(request_post_data.get("NumeroPoliceConnexe") or "").strip()
    if not (changer_avenant or changer_police):
        return request_post_data
    donnees = request_post_data.copy()
    if changer_avenant:
        donnees["IdAvenant"] = str(id_avenant_devis)
    if changer_police:
        donnees["NumeroPoliceConnexe"] = police
    return donnees


def _avec_avenant_du_devis(request_post_data):
    """Import dans un devis existant (renouvellement, incorporation, modification) : son avenant est gardé."""
    id_devis = int(request_post_data.get("IdDevis") or 0)
    if not id_devis:
        return request_post_data
    with connection.cursor() as cursor:
        cursor.execute("SELECT idavenant, numeropoliceconnexe FROM stddevis WHERE iddevis = %s", [id_devis])
        ligne = cursor.fetchone()
    if not ligne:
        return request_post_data
    return donnees_avec_avenant(request_post_data, ligne[0], ligne[1])


def _controler_entete(entete_fichier, request_post_data, rapport):
    """Acte, période et souscripteur du fichier comparés à la saisie de l'écran (avertissements)."""
    from ..iautils import convert_to_date

    def date_fichier(valeur):
        if isinstance(valeur, datetime):
            return valeur.date()
        try:
            return convert_to_date(str(valeur).strip()[:10])
        except Exception:
            return None

    def date_ecran(champ):
        try:
            return convert_to_date(str(request_post_data.get(champ) or "").strip())
        except Exception:
            return None

    for cle, champ, libelle in (("Periode", "DateEffet", "date d'effet"), ("Echeance", "DateExpiration", "date d'expiration")):
        fichier, ecran = date_fichier(entete_fichier.get(cle)), date_ecran(champ)
        if fichier and ecran and fichier != ecran:
            rapport.avertissements.append(
                f"Le fichier indique une {libelle} au {fichier:%d/%m/%Y}, le devis est au {ecran:%d/%m/%Y}."
            )
    souscripteur = normaliser_texte(str(entete_fichier.get("Souscripteur") or ""))
    if souscripteur:
        from customer.models import Client

        client = Client.objects.filter(pk=int(request_post_data.get("IdClient") or 0)).first()
        nom_client = normaliser_texte(f"{client.Nom or ''} {client.Prenoms or ''}") if client else ""
        if nom_client and nom_client != souscripteur:
            nom_devis = " ".join(filter(None, [client.Nom, client.Prenoms]))
            rapport.avertissements.append(
                f"Le fichier est au nom du souscripteur « {entete_fichier['Souscripteur'].strip()} », "
                f"le devis au nom de « {nom_devis} »."
            )
    acte = str(entete_fichier.get("Acte") or "").strip()
    if acte and acte.upper() != "AFFAIRE NOUVELLE" and int(request_post_data.get("IdAvenant") or 1) == 1:
        rapport.avertissements.append(f"Le fichier indique « {acte} » : le devis est créé en affaire nouvelle.")


def _garder_montants_fichier(id_devis, assures_inscrits, rapport):
    """PRIME HT et PRIME TTC du fichier gardées pour chaque assuré (production/ia_montants_imposes.py) : réappliquées exactement après chaque
    calcul du devis, quelle que soit l'offre. Renvoie les assurés concernés."""
    from ..ia_montants_imposes import MESSAGE_MIGRATION, OFFRES_HORS_MONTANTS_GARDES, appliquer, decomposer, enregistrer, table_presente, taux_taxe

    imposes, incomplets, a_garder = set(), 0, []
    with connection.cursor() as cursor:
        if not table_presente(cursor):
            if any(_montant(a.get("PrimeHT")) > 0 for _n, _i, a in assures_inscrits):
                rapport.avertissements.append(MESSAGE_MIGRATION)
            return imposes
        cursor.execute("SELECT idcompagnie, dateeffet::date FROM stddevis WHERE iddevis = %s", [id_devis])
        id_compagnie, date_effet = cursor.fetchone()
        cursor.execute("SELECT CAST(matricule AS bigint), TRIM(matricule), idoffre FROM stddevisdetail WHERE iddevis = %s AND matricule ~ '^[0-9]+$'", [id_devis])
        lignes = {id_client: (matricule, offre) for id_client, matricule, offre in cursor.fetchall()}
        taux = {}
        for _numero, id_client, assure_data in assures_inscrits:
            if id_client not in lignes:
                continue
            matricule, offre = lignes[id_client]
            if offre in OFFRES_HORS_MONTANTS_GARDES:
                continue  # IA MINENE : tarif fixe de la formule
            if offre not in taux:
                taux[offre] = taux_taxe(cursor, id_compagnie, offre, date_effet)
            montants = decomposer(assure_data.get("PrimeHT"), assure_data.get("PrimeTTC"), taux[offre])
            if not montants:
                incomplets += int(_montant(assure_data.get("PrimeHT")) > 0 or _montant(assure_data.get("PrimeTTC")) > 0)
                continue
            prime_nette, accessoire, prime_ttc = montants
            a_garder.append({"Matricule": matricule, "PrimeNette": prime_nette, "Accessoire": accessoire, "PrimeTtc": prime_ttc,
                             "CapitalDeces": assure_data.get("CapitalDeces"), "CapitalInfirmite": assure_data.get("CapitalInfirmite"), "IdOffre": offre})
            imposes.add(id_client)
        if a_garder:
            enregistrer(cursor, id_devis, a_garder, "FICHIER")
            appliquer(cursor, id_devis)
    if incomplets:
        rapport.avertissements.append(f"{incomplets} assuré(s) avec une seule des deux primes (HT ou TTC) dans le fichier : tarif de l'offre appliqué pour eux.")
    return imposes


def _controler_primes(id_devis, assures_inscrits, rapport, imposes=()):
    """Prime nette de chaque assuré inscrit au devis comparée à la « PRIME HT » du fichier : une
    prime nulle alors que le fichier en indique une refuse tout l'import (offre sans tarif pour
    ces capitaux) ; un autre écart est signalé. Renvoie les totaux du fichier."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT CAST(matricule AS bigint), primenette, idoffre FROM stddevisdetail WHERE iddevis = %s AND matricule ~ '^[0-9]+$'",
            [id_devis],
        )
        lignes = {id_client: (_montant(pn), offre) for id_client, pn, offre in cursor.fetchall()}
    totaux = {"prime_ht": Decimal("0"), "prime_ttc": Decimal("0"), "assures": 0}
    primes_nulles = []
    for numero_ligne, id_client, assure_data in assures_inscrits:
        prime_fichier = _montant(assure_data.get("PrimeHT"))
        totaux["prime_ht"] += prime_fichier
        totaux["prime_ttc"] += _montant(assure_data.get("PrimeTTC"))
        totaux["assures"] += 1
        # Montants du fichier imposés à cet assuré : ni refus ni écart possibles
        if prime_fichier <= 0 or id_client not in lignes or id_client in imposes:
            continue
        prime_devis, offre = lignes[id_client]
        nom = f"{assure_data['Nom']} {assure_data.get('Prenoms', '')}".strip()
        if prime_devis == 0:
            primes_nulles.append(f"ligne {numero_ligne} ({nom}, offre {offre})")
        elif prime_devis != prime_fichier:
            rapport.avertissements.append(
                f"Ligne {numero_ligne} - {nom} : prime nette du devis {prime_devis:,.0f} F, fichier {prime_fichier:,.0f} F (offre {offre})."
                .replace(",", " ")
            )
    if primes_nulles:
        raise ErreurPrimesImport(
            "Prime nette nulle au tarif de l'offre alors que le fichier indique une prime pour "
            + ", ".join(primes_nulles[:5]) + (" …" if len(primes_nulles) > 5 else "")
            + ". Aucun assuré n'a été importé : choisissez l'offre qui correspond aux capitaux et aux primes du fichier."
        )
    return {cle: float(v) if isinstance(v, Decimal) else v for cle, v in totaux.items()}


def calculer_hash_fichier(filepath: str) -> str:
    """Calcule le hash SHA256 d'un fichier"""
    import hashlib
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def traiter_assures(assures, request_post_data, config, rapport):
    """
    Traite les assurés avec détection anti-doublons ROBUSTE.
    
    ✅ AMÉLIORATIONS :
    - Cache local pour détecter doublons dans le même fichier
    - Passage de cle_unique à insert_new_assure()
    - Gestion IntegrityError avec retry (race condition)
    - Validation NumeroAssure auto unique
    - Messages d'erreur détaillés par ligne
    
    Returns:
        int: ID du devis créé
    """
    # Import de vos fonctions existantes
    from ..import_assures import (
        insert_new_assure,
        enregistrer_devis_ia,
        get_entete_devis,
        enregistrer_beneficiaire,
    )
    
    id_devis_initial = int(request_post_data.get("IdDevis", 0) or 0)
    entete_devis = get_entete_devis(
        request_post_data=request_post_data,
        flotte=(len(assures) > 1) or (id_devis_initial > 0)
    )
    
    id_devis = 0

    # Lignes déjà au devis avant l'import (renouvellement : assurés du contrat), par matricule : un assuré connu du fichier y est mis à jour
    lignes_existantes = {}
    if id_devis_initial:
        with connection.cursor() as cursor:
            cursor.execute("SELECT TRIM(matricule), iddevisdetail FROM stddevisdetail WHERE iddevis = %s", [id_devis_initial])
            lignes_existantes = dict(cursor.fetchall())

    # ✅ AMÉLIORATION 1 : Cache local des clés uniques traitées dans ce fichier
    cles_traitees_fichier = set()
    # Assurés inscrits au devis (ligne, client, données du fichier) : contrôle des primes
    assures_inscrits = []

    with transaction.atomic():
        for idx, assure_data in enumerate(assures, 1):
            # Une ligne en erreur est annulée entièrement (assuré, ayants droit, ligne du devis)
            # sans bloquer les suivantes
            point_de_reprise = transaction.savepoint()
            try:
                # Générer la clé unique
                cle_unique = obtenir_cle_unique_assure(assure_data)
                logger.debug(f"[{idx}/{len(assures)}] Clé: {cle_unique[:50]}...")
                
                # ✅ AMÉLIORATION 2 : Vérifier d'abord dans le cache local
                if cle_unique in cles_traitees_fichier:
                    logger.warning(f"  → Doublon dans le fichier (clé: {cle_unique[:30]}...)")
                    rapport.assures_ignores.append(AssureResultat(
                        nom=assure_data['Nom'],
                        prenoms=assure_data.get('Prenoms', ''),
                        cle_unique=cle_unique,
                        numero_ligne=idx,
                        action='IGNORE',
                        id_client=None,
                        message="Doublon dans le fichier (même CNI ou identité)"
                    ))
                    continue
                
                # Vérifier si existe déjà en base
                assure_existant = assure_existe_deja(cle_unique)
                
                if assure_existant:
                    # ─── ASSURÉ EXISTANT EN BASE ───
                    logger.info(f"  → Existant en base (ID: {assure_existant.IdClient})")
                    
                    # Analyser la similarité
                    est_meme, score, diffs = detecter_collision(
                        assure_data,
                        assure_existant
                    )
                    
                    if est_meme:
                        # ✅ CORRECTION : Même personne détectée
                        # Gérer TOUS les modes d'import
                        
                        if config.mode_import in (ModeImport.CREER_SEULEMENT, ModeImport.METTRE_A_JOUR):
                            # L'assuré déjà connu est inscrit au devis avec sa fiche existante (un
                            # assuré écarté manquait au devis, un assuré recréé faisait un doublon).
                            # « Mettre à jour » (mode de l'écran) reprend aussi sa fonction et ses
                            # ayants droit depuis le fichier ; « créer seulement » ne touche pas la fiche.
                            logger.info(f"  → Assuré existant repris (ID: {assure_existant.IdClient})")
                            if config.mode_import == ModeImport.METTRE_A_JOUR:
                                _reprendre_assure_existant(
                                    assure_existant, assure_data, idx, rapport,
                                    int(request_post_data.get("IdClient") or 0),
                                )
                            cles_traitees_fichier.add(cle_unique)
                            id_devis = enregistrer_devis_ia(entete_devis, assure_data, assure_existant.IdClient, lignes_existantes)
                            entete_devis["IdDevis"] = id_devis
                            assures_inscrits.append((idx, assure_existant.IdClient, assure_data))
                            rapport.assures_mis_a_jour.append(AssureResultat(
                                nom=assure_data['Nom'],
                                prenoms=assure_data.get('Prenoms', ''),
                                cle_unique=cle_unique,
                                numero_ligne=idx,
                                action='MIS_A_JOUR',
                                id_client=assure_existant.IdClient,
                                message=f"Assuré déjà connu repris dans le devis {id_devis} (similarité: {score:.1f}%)"
                            ))
                            transaction.savepoint_commit(point_de_reprise)
                            continue  # ✅ Passer au suivant
                        
                        elif config.mode_import == ModeImport.ERREUR_SI_DOUBLON:
                            # Mode : Erreur si doublon → Lever une exception
                            raise ValidationError(
                                f"Doublon détecté (mode strict) - Assuré déjà en base "
                                f"(ID: {assure_existant.IdClient}, similarité: {score:.1f}%)"
                            )
                        
                        elif config.mode_import == ModeImport.IGNORER_SILENCIEUX:
                            # Mode : Ignorer silencieusement
                            logger.debug(f"  → Doublon ignoré silencieusement (ID: {assure_existant.IdClient})")
                            rapport.assures_ignores.append(AssureResultat(
                                nom=assure_data['Nom'],
                                prenoms=assure_data.get('Prenoms', ''),
                                cle_unique=cle_unique,
                                numero_ligne=idx,
                                action='IGNORE',
                                id_client=assure_existant.IdClient,
                                message=f"Ignoré (similarité: {score:.1f}%)"
                            ))
                            continue  # ✅ Passer au suivant
                        
                        else:
                            # Mode inconnu → Par sécurité, ignorer
                            logger.warning(f"  → Mode d'import inconnu: {config.mode_import} - Ignorer par sécurité")
                            rapport.assures_ignores.append(AssureResultat(
                                nom=assure_data['Nom'],
                                prenoms=assure_data.get('Prenoms', ''),
                                cle_unique=cle_unique,
                                numero_ligne=idx,
                                action='IGNORE',
                                id_client=assure_existant.IdClient,
                                message=f"Mode inconnu - Ignoré par sécurité"
                            ))
                            continue  # ✅ Passer au suivant
                    
                    else:
                        # Homonymie - personnes différentes avec même nom/date
                        if config.generer_numero_assure_auto:
                            # ✅ Générer NumeroAssure unique avec vérification
                            max_tentatives = 10
                            numero_auto = None
                            
                            for tentative in range(max_tentatives):
                                numero_auto = generer_numero_assure_auto()
                                cle_unique_na = f"NA-{numero_auto}"
                                
                                # Vérifier que ce NA n'existe ni en base ni dans le fichier
                                if (cle_unique_na not in cles_traitees_fichier and 
                                    not assure_existe_deja(cle_unique_na)):
                                    cle_unique = cle_unique_na
                                    assure_data["NumeroAssure"] = numero_auto
                                    logger.info(f"  → Homonymie - NumeroAssure généré: {numero_auto}")
                                    break
                            else:
                                # Échec après 10 tentatives
                                raise ValidationError(
                                    f"Impossible de générer un NumeroAssure unique après "
                                    f"{max_tentatives} tentatives"
                                )
                            
                            rapport.avertissements.append(
                                f"Ligne {idx} - Homonymie détectée: {assure_data['Nom']} - "
                                f"NumeroAssure généré: {numero_auto}"
                            )
                        else:
                            raise ValidationError(
                                f"Homonymie détectée (génération NumeroAssure auto désactivée)"
                            )
                
                # ─── NOUVEL ASSURÉ ───
                logger.info(f"  → Nouveau - création...")
                
                # ✅ AMÉLIORATION 4 : Passer cle_unique et numero_assure
                assure_data['cle_unique'] = cle_unique
                if 'NumeroAssure' in assure_data:
                    assure_data['numero_assure'] = assure_data['NumeroAssure']
                
                # ✅ AMÉLIORATION 5 : Gérer IntegrityError (race condition ou trigger)
                try:
                    # Créer l'assuré
                    assure = insert_new_assure(assure_data)
                    
                    # ✅ Ajouter au cache local
                    cles_traitees_fichier.add(cle_unique)
                    
                except IntegrityError as e:
                    # Violation de contrainte UNIQUE
                    error_msg = str(e).lower()
                    
                    if 'cle_unique' in error_msg or 'unique' in error_msg:
                        logger.warning(
                            f"  → IntegrityError sur cle_unique : {cle_unique[:30]}... "
                            f"(race condition ou doublon)"
                        )
                        
                        # Réessayer de vérifier si l'assuré existe maintenant
                        assure_existant = assure_existe_deja(cle_unique)
                        if assure_existant:
                            rapport.assures_ignores.append(AssureResultat(
                                nom=assure_data['Nom'],
                                prenoms=assure_data.get('Prenoms', ''),
                                cle_unique=cle_unique,
                                numero_ligne=idx,
                                action='IGNORE',
                                id_client=assure_existant.IdClient,
                                message="Créé par un autre processus (race condition)"
                            ))
                            # Ajouter au cache quand même
                            cles_traitees_fichier.add(cle_unique)
                            continue
                    
                    # Autre erreur IntegrityError (CNI, etc.)
                    raise ValidationError(
                        f"Erreur d'intégrité lors de la création: {str(e)}"
                    )
                
                # Créer les bénéficiaires (rang distinct du numéro de ligne de l'assuré)
                for rang, ben in enumerate(assure_data.get("Beneficiaires", []), 1):
                    logger.debug(f"Traitement du bénéficiaire {rang}/{len(assure_data['Beneficiaires'])}")
                    enregistrer_beneficiaire(assure.IdClient, ben)

                # Créer le devis
                id_devis = enregistrer_devis_ia(
                    entete_devis,
                    assure_data,
                    assure.IdClient
                )
                entete_devis["IdDevis"] = id_devis
                assures_inscrits.append((idx, assure.IdClient, assure_data))

                rapport.assures_nouveaux.append(AssureResultat(
                    nom=assure_data['Nom'],
                    prenoms=assure_data.get('Prenoms', ''),
                    cle_unique=cle_unique,
                    numero_ligne=idx,
                    action='CREE',
                    id_client=assure.IdClient,
                    message=f"Créé avec succès (Devis: {id_devis})"
                ))
                transaction.savepoint_commit(point_de_reprise)

            except ValidationError as e:
                transaction.savepoint_rollback(point_de_reprise)
                logger.error(f"  ✗ Erreur validation ligne {idx}: {e}")
                rapport.erreurs.append(
                    f"Ligne {idx} ({assure_data.get('Nom', 'Inconnu')} "
                    f"{assure_data.get('Prenoms', '')}): {str(e)}"
                )
            
            except Exception as e:
                transaction.savepoint_rollback(point_de_reprise)
                logger.error(f"  ✗ Erreur ligne {idx}: {e}", exc_info=True)
                rapport.erreurs.append(
                    f"Ligne {idx} ({assure_data.get('Nom', 'Inconnu')} "
                    f"{assure_data.get('Prenoms', '')}): "
                    f"Erreur lors de l'enregistrement de l'assuré: {str(e)}"
                )

                # Propager l'erreur si mode strict
                if config.mode_import == ModeImport.ERREUR_SI_DOUBLON:
                    raise

        # Contrôles du fichier contre le devis obtenu : primes de chaque assuré (une prime nulle
        # refuse tout l'import), puis acte, période et souscripteur (avertissements)
        if id_devis and assures_inscrits:
            imposes = _garder_montants_fichier(id_devis, assures_inscrits, rapport)
            rapport.totaux_fichier = _controler_primes(id_devis, assures_inscrits, rapport, imposes)
            _controler_entete(assures_inscrits[0][2].get("EnteteFichier") or {}, request_post_data, rapport)

    return id_devis


def importer_assures_anti_doublons(
    filepath: str,
    user_id: int,
    request_post_data: dict,
    config: ConfigurationImport = None
):
    """
    Fonction principale d'import avec système anti-doublons.
    
    CORRECTION : L'enregistrement de l'historique est maintenant dans la même
    transaction que l'import des assurés pour garantir la cohérence.
    
    Args:
        filepath: Chemin vers le fichier Excel
        user_id: ID de l'utilisateur
        request_post_data: Données de la requête POST
        config: Configuration (optionnel)
    
    Returns:
        Tuple (erreur: bool, id_devis: int, rapport: RapportImport)
    """
    # Import de votre fonction existante
    from ..import_assures import extraire_assures
    from .rapport import enregistrer_historique_import
    
    if config is None:
        config = ConfigurationImport()
    
    # Initialiser le rapport
    rapport = RapportImport(
        nom_fichier=os.path.basename(filepath),
        taille_fichier=os.path.getsize(filepath),
        user_id=user_id,
        mode_import=config.mode_import
    )
    
    debut = datetime.now()
    
    try:
        logger.info("=" * 80)
        logger.info(f"IMPORT: {rapport.nom_fichier}")
        logger.info("=" * 80)
        
        # ─────────────────────────────────────────────────────────────
        # ÉTAPE 1: Calculer hash du fichier
        # ─────────────────────────────────────────────────────────────
        logger.info("→ Calcul du hash...")
        rapport.hash_fichier = calculer_hash_fichier(filepath)
        
        # ─────────────────────────────────────────────────────────────
        # ÉTAPE 2: Vérifier si déjà importé (HORS TRANSACTION)
        # ─────────────────────────────────────────────────────────────
        if config.verifier_hash_fichier:
            logger.info("→ Vérification import antérieur...")
            import_precedent = verifier_fichier_deja_importe(rapport.hash_fichier)
            
            if import_precedent and not config.autoriser_reimport_meme_fichier:
                rapport.statut = StatutImport.REFUSE
                rapport.details_erreur = "Fichier déjà importé"
                rapport.avertissements.append(
                    f"Ce fichier a déjà été importé le "
                    f"{import_precedent['date_import'].strftime('%d/%m/%Y à %H:%M')}"
                )
                rapport.duree_secondes = (datetime.now() - debut).total_seconds()
                
                # CORRECTION : Enregistrer l'historique MÊME en cas de refus
                # Mais HORS transaction car rien à rollback
                enregistrer_historique_import(rapport)
                
                logger.warning("✗ Import refusé: fichier déjà importé")
                return (True, 0, rapport)
        
        # ─────────────────────────────────────────────────────────────
        # ÉTAPE 3: Extraire les assurés du fichier
        # ─────────────────────────────────────────────────────────────
        logger.info("→ Extraction des assurés...")
        request_post_data = _avec_avenant_du_devis(request_post_data)
        # Offre de l'écran transmise : imposée pour les offres standard et spécifiques (6, 7, 173,
        # 174), sinon l'offre est déduite des capitaux et de la prime du fichier (CGA, CI-ENERGIES)
        assures = extraire_assures(filepath, int(request_post_data.get("IdOffre") or 0))
        rapport.total_lignes = len(assures)
        logger.info(f"  {rapport.total_lignes} assurés extraits")
        
        if not assures:
            rapport.statut = StatutImport.REFUSE
            rapport.details_erreur = "Aucun assuré trouvé"
            rapport.duree_secondes = (datetime.now() - debut).total_seconds()
            
            # Enregistrer l'historique HORS transaction
            enregistrer_historique_import(rapport)
            
            return (True, 0, rapport)
        
        # ─────────────────────────────────────────────────────────────
        # ÉTAPE 4-6: Transaction atomique incluant import ET historique
        # ─────────────────────────────────────────────────────────────
        logger.info("→ Traitement avec anti-doublons...")
        
        # CORRECTION : Tout dans UNE SEULE transaction atomique
        with transaction.atomic():
            # Traiter les assurés
            id_devis = traiter_assures(
                assures=assures,
                request_post_data=request_post_data,
                config=config,
                rapport=rapport
            )
            
            rapport.id_devis = id_devis
            
            # Déterminer statut final
            if len(rapport.erreurs) > 0:
                if len(rapport.assures_nouveaux) > 0:
                    rapport.statut = StatutImport.PARTIEL
                else:
                    rapport.statut = StatutImport.ECHOUE
            else:
                rapport.statut = StatutImport.REUSSI
            
            rapport.duree_secondes = (datetime.now() - debut).total_seconds()
            
            # CORRECTION : Enregistrer dans l'historique DANS la transaction
            # Si erreur après, tout sera rollback (assurés + historique)
            enregistrer_historique_import(rapport)
            
            # Afficher le résumé
            logger.info(rapport.afficher_resume())
        
        # Si on arrive ici, la transaction a réussi
        erreur_survenue = rapport.statut in [StatutImport.ECHOUE, StatutImport.REFUSE]
        
        return (erreur_survenue, id_devis, rapport)
    
    except Exception as e:
        logger.error(f"Erreur lors de l'import: {str(e)}", exc_info=True)
        
        rapport.statut = StatutImport.ECHOUE
        rapport.details_erreur = str(e)
        rapport.duree_secondes = (datetime.now() - debut).total_seconds()
        # Tout a été annulé : aucun assuré créé ni repris
        rapport.assures_nouveaux.clear()
        rapport.assures_mis_a_jour.clear()
        
        # CORRECTION : En cas d'exception, enregistrer l'historique HORS transaction
        # (la transaction a déjà été rollback)
        try:
            enregistrer_historique_import(rapport)
        except Exception as e_hist:
            logger.error(f"Impossible d'enregistrer l'historique: {str(e_hist)}")
        
        return (True, 0, rapport)