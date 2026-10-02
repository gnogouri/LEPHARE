# Audit URANUS → LE PHARE : Individuelle Accidents (IA) et Santé

Date de l'audit : 01/10/2026 — branche `sangare` (commit `6ebcda2`).

Sources examinées :

| Source | Emplacement | Ce qui a été lu |
|---|---|---|
| URANUS frontend | `Desktop\OREOLE\APPLICATIONS\uranus-frontend\build\static\js\main.092db3ec.js.map` | 441 fichiers sources extraits ; IA : `scenes/Production/IndividuelleAccident/**`, `partials/Contrats/IAPartials/*` ; Santé : `scenes/Production/Sante/**`, `partials/Contrats/SantePartials/**`, fiches `DevisSanteDetails`, `ContratSanteDetails`, documents `Products/Documents/IA|Sante/*`, `partials/Utils/FormUtils` |
| URANUS backend | `Desktop\OREOLE\APPLICATIONS\uranus-backend` | `sante/*`, `production/{views,database,iautils,import_assures,serializers,urls}.py`, `core/serializers.py`, `configuration_api/urls.py` |
| Base de données | PostgreSQL `oreole` (commune aux deux applications) | tables `std*` IA/Santé, référentiels, 40 procédures et fonctions (définitions extraites par `pg_get_functiondef`) |
| LE PHARE | `c:\laragon\www\LEPHARE` | `frontend/src/pages/user/quotes/{NewIaQuotePage,NewSanteQuotePage,ViewQuoteModal,QuoteListPage}.jsx`, `pages/user/contracts/*`, `api/endpoints.js`, `utils/{exportUtils,termesContrat}.js`, `production/views_devis_ia.py`, `sante/*` |
| Documents OREOLE | `Desktop\_OREOLE ASSURANCE` (+ doublons `Desktop\OREOLE ASSURANCE`) | Compte rendu de séance du 09/09/2026, `DOCUMENTS LE PHARE.docx` et `DOCUMENT PROJET LE PHARE.docx` (captures URANUS), spécifications fonctionnelles V3, `TARIF IA_NSIA CI.xlsx`, `IA ATM INFORMATIQUE 2026.xlsx`, `TARIFICATION MINENE SANTE.xlsx`, PDF IA (CP, annexe, facture, quittance groupe, fichier IA ressorti par URANUS), codes catégorie |

Conventions : « NON TROUVÉ » = information absente de toutes les sources ; « RÈGLE NON DÉTERMINÉE » = règle qu'aucune source ne permet d'établir avec certitude. Les noms techniques sont ceux du code (`camelCase` du frontend URANUS, clés JSON des API, colonnes SQL).

---

## 1. Résumé exécutif

1. **Le backend de LE PHARE est un fork du backend URANUS** : l'application `sante` est identique (modèles, sérialiseurs, routes, procédures appelées) à 2 lignes près ; les vues IA d'URANUS (`enregistrementdevisia`, `finalisationdevisia`, `importationassureia`, `ayantdroitia`, `assureiainfo`, MINENE…) existent toutes dans LE PHARE. Les deux applications utilisent la **même base** et les **mêmes procédures stockées**. Les écarts sont donc presque tous dans le **frontend**.
2. **IA dans LE PHARE : fonctionnel mais incomplet.** Création et « Modifier » enregistrent réellement (route LE PHARE `POST /api/devisia/enregistrement/`, une transaction, procédures URANUS). La création MINENE depuis le contrat Santé connexe est reprise. En revanche, quatre fonctions ont leur logique codée mais **aucun champ à l'écran** (ajoutées au commit `fb95664` sans leur interface) : primes imposées des catégories à tarif personnalisé, import Excel des assurés, détail des garanties par assuré, téléphone de l'assuré. L'aperçu du devis IA affiche des champs qui n'existent pas sur un devis réel (« Classe professionnelle », « Capital décès »… vides). La transformation en contrat depuis la page IA affiche « succès » même si l'API échoue et crée un contrat fictif dans le navigateur. Les **mouvements de police IA** (8 types dans URANUS) ne sont pas disponibles.
3. **Santé dans LE PHARE : maquette.** La page `NewSanteQuotePage` n'enregistre rien en base (l'appel API part avec un corps incompatible, l'erreur est avalée, « créé avec succès » s'affiche) et repose sur des **valeurs inventées** : offres « SANTE CONFORT PLUS / ELITE MONDE / ESSENTIEL », gestionnaires « ASCOMA / GRAS SAVOYE… », collèges avec taux de couverture, plafond, effectif et prime par tête, zones et formules libres, taxe fixe de 5 %, accessoire par défaut de 5 000. Aucune de ces valeurs n'existe dans URANUS, la base ou les documents OREOLE. Le parcours réel d'URANUS (couvertures souscrites = filiales/collèges, adhérents, affiliés, prime par famille / par affilié / globale, surprime, accessoire manuel, calcul MINENE automatique) est **absent**.
4. **Documents OREOLE** : le compte rendu du 09/09/2026 décrit le parcours IA (catégorie, capitaux, durée, ayants droit avec qualité et pourcentage, groupe avec import Excel) et classe la **Santé parmi les « modules en attente »** de tarifs mis à jour. Seul le tarif **MINENE Santé** a été fourni (xlsx) : ses montants **concordent** avec les fonctions de la base (primes de base, accessoire, taxe 8 %).
5. **Incohérences notables** (détail §17) : le tarif IA NSIA fourni par OREOLE (taux décès 0,85 ‰ à 3 ‰ selon la classe, clause d'âge 60/65 ans) diffère de la tarification URANUS (1 ‰ à 4,1 ‰, majoration jusqu'à 70 ans) ; plusieurs défauts d'URANUS se retrouvent dans la base partagée (surprime d'adhérent jamais enregistrée, réduction Santé sans effet hors MINENE, offres MINENE 80 %-80 % sans contrôle d'âge ni de taille de famille, branche « classe 05 » morte dans le calcul des frais de traitement).
6. **Décision proposée** : intégrer d'abord la Santé réelle (priorité 1, perte fonctionnelle totale), puis rendre accessibles les fonctions IA déjà codées (priorité 1-2), corriger les affichages et la transformation en contrat (priorité 4), sans toucher aux règles tarifaires (les écarts de tarif sont soumis à validation métier). Les mouvements de police dépendent de procédures absentes de la base et restent hors périmètre de cette intervention.

---

## 2. Fonctionnalités IA d'URANUS

| # | Fonctionnalité | Écran / fichier URANUS | API / procédure |
|---|---|---|---|
| IA-F1 | Liste des devis et contrats IA, compteurs devis/contrats, filtre « Confirmé », recherche client, pagination | `scenes/Production/IndividuelleAccident/index.jsx` | `infodevis/2` |
| IA-F2 | Affaire nouvelle en 3 étapes : Contrat → Offre (individuel) ou Assurés/Ayants droit (groupe) → Souscripteur/Assuré/Ayants droit | `ContratIA/IAForm/IAForm.jsx` | — |
| IA-F3 | Nature de la catégorie : groupe / individuelle / tarif personnalisé / MINENE | `IAPartials/ContratSection.jsx` | `esttarifiagroupe/<id>/` (`fn_tarif_ia_groupe`), `esttarifiapersonnalise/<id>/` (`fn_tarif_ia_personnalise`) |
| IA-F4 | Calcul des garanties et primes d'un assuré (tableau des garanties) | `IAPartials/OffreSection.jsx` | `POST offregarantieia` → `fn_garantie_offre_ia` |
| IA-F5 | Primes imposées (catégories « SPECIFIQUE » 74/75) : prime nette, accessoire, taxe, prime TTC saisies | `ContratSection.jsx`, `IAGroupeSection.jsx` | `enregistrementdevisia` (PrimeNette, Accessoire, PrimeTTC) |
| IA-F6 | Enregistrement d'un devis individuel | `IAPartials/SouscripteurSection.jsx` | `POST enregistrementdevisia` → `sp_creation_devis_ia` |
| IA-F7 | Devis groupe : ajout assuré par assuré, édition d'un assuré, liste des assurés, finalisation | `IAPartials/IAGroupeSection.jsx` | `enregistrementdevisia` (IdDevisDetail 0 = ajout), `assureiainfo/<iddevis>`, `POST finalisationdevisia` → `sp_finalisation_devis` |
| IA-F8 | Import Excel d'une liste d'assurés (3 modèles de fichier reconnus) | `IAGroupeSection.jsx` (bascule « Saisie Manuelle »), `SouscripteurSection.jsx` | `POST importationassureia/`, `assureiapardevis/<iddevis>` |
| IA-F9 | Ayants droit de l'assuré : nom, prénoms, qualité, part (%), total ≤ 100 % | `SouscripteurSection.jsx`, `IAGroupeSection.jsx`, `features/AyantDroit/*` | `POST saisieayantdroitia` → `sp_saisie_ayant_droit_ia`, `ayantdroitia/<idassure>`, `qualiteayantdroit` |
| IA-F10 | IA MINENE : création automatique depuis la police Santé connexe (souscripteur = client Santé, assurés = adhérents, ayants droit = affiliés) | `SouscripteurSection.jsx` (`handleCreerDevisIAMinene`) | `POST creer-devis-ia-minene/` |
| IA-F11 | IA MINENE groupe : import des adhérents Santé avec choix manuel de la qualité de chaque affilié | `IAGroupeSection.jsx` | `adherents-sante-pour-devis-ia/<id>/`, `POST transformer-sante-en-ia/` |
| IA-F12 | Création d'un client depuis le formulaire (panneau « Nouveau client ») | `ContratSection.jsx`, `SouscripteurSection.jsx`, `IAGroupeSection.jsx` | `NewClientContrat` |
| IA-F13 | Édition d'un devis | `ContratIA/Edition/EditionDevisIA.jsx` | `devis/<id>/`, `devisdetail/<id>` |
| IA-F14 | Correction des primes d'un devis rouvert (« comme Automobile ») | `OffreSection.jsx` | `POST correctiondevis/` (source `IA_PREMIUM_IMPOSITION`) |
| IA-F15 | Mouvements de police : renouvellement, incorporation, modification de prise d'effet, reprise de portefeuille, annulation, retrait, résiliation, transfert de portefeuille ; motif obligatoire pour 6, 8, 9 | `ContratIA/Mouvement/MouvementPoliceIA.jsx`, `ContratSection.jsx` | `avenant?idproduit=2&flotte=…`, `POST avenant/initiationmouvement` |
| IA-F16 | Retrait d'assurés d'une police groupe (cocher les assurés à retirer, le devis de retrait garde les autres) | `IAGroupeSection.jsx` (mode RETRAIT) | `assureiainfo/<iddevis>`, `enregistrementdevisia` |
| IA-F17 | Fiche devis / contrat, confirmation, archivage | `scenes/Products/Devis/*`, `Contrat/*` | `POST confirmationdevis` → `sp_confirmation_devis` |
| IA-F18 | Impressions : proposition / CP individuelle, proposition groupe, facture proforma, quittance, quittance proposition, annexe « liste des assurés », CP IA MINENE (police et devis) | `scenes/Products/Documents/IA/**` | `quittanceproposition`, `quittancecontrat`, `garantiesouscritedevis`, `assureiapardevis`, `ayantdroitia`, `ayantdroitminene/<police>` |

Champ affiché mais **jamais enregistré** dans URANUS : « Gaucher(e)/Droitier(e) » (`mainPrincipale`) et, en groupe, « Téléphone Assuré » (absents des corps envoyés).

## 3. Fonctionnalités Santé d'URANUS

| # | Fonctionnalité | Écran / fichier URANUS | API / procédure |
|---|---|---|---|
| S-F1 | Liste des devis et contrats Santé, compteurs, filtre, « Affaire Nouvelle » | `scenes/Production/Sante/index.jsx` | `infodevis/5` |
| S-F2 | Numéro de saisie : un devis vide est créé à l'ouverture du formulaire et porte toute la saisie | `SanteForm.jsx` (`handleNumeroSaisie`) | `numerosaisiesante` → `sp_initialisation_devis_sante` (crée `stddevis` + `stdnumerosaisiesante`) |
| S-F3 | Étape « Contrat » : police compagnie, type de contrat, compagnie, offre commerciale (= catégorie), ajustement réduction/majoration, gestionnaire, dates, durée | `SantePartials/ContratSection.jsx` | `typecontratsante`, `tarifparproduit/5` |
| S-F4 | Étape « Couvertures souscrites » : formule de couverture, collège, zone ; « Enregistrer le collège » crée une filiale ; liste « Vos Couvertures » | `SantePartials/FormuleSection.jsx` | `offresantepartarif/<tarif>`, `collegesanteparoffre/<offre>`, `zonecouverturesante`, `POST saisiefilialesante` → `sp_saisie_filiale_sante`, `filialelisteensaisie/<iddevis>` |
| S-F5 | Adhérents (chefs de famille) : création, modification, suppression (avec ses affiliés) | `SantePartials/AffiliationSection.jsx`, `Utils/NewAdherent.js` | `POST saisieadherentsante` (multipart, pièce) → `sp_saisie_adherent_sante` (crée aussi l'affilié lien « A »), `adherentlisteensaisie/<iddevis>`, `POST annulationsaisieadherent` |
| S-F6 | Affiliés (conjoint, enfants) : création, modification, suppression ; pièce CNI ou extrait de naissance | `Utils/NewAffilie.jsx` | `POST saisieaffiliesante` → `sp_saisie_affilie_sante`, `affilielisteensaisie/<iddevis>`, `lienjuridiquesante`, `POST annulationsaisieaffilie` |
| S-F7 | Import Excel des adhérents et affiliés dans une filiale | `NewAdherent.js` (bascule « Saisie Manuelle ») | `POST importationaffilie/` → `import_insured` |
| S-F8 | Primes : prime par famille, prime par affilié **ou** prime globale (une seule), surprime affection, accessoire manuel ; calcul automatique pour MINENE | `AffiliationSection.jsx` | `POST enregistrementdevissante` → `sp_creation_devis_sante` |
| S-F9 | Édition d'un devis | `ContratSante/Edition/EditionDevisSante.jsx` | `devis/<id>/`, `devisdetail/<id>` |
| S-F10 | Mouvements de police (renouvellement, annulation…) | `ContratSante/Mouvement/MouvementPoliceSante.jsx` | `avenant`, `POST avenant/annulation` |
| S-F11 | Fiche devis : Éditer, **Confirmer le devis**, **Archiver le devis**, détails, barème MINENE, liste des affiliés | `Products/Devis/DevisSanteDetails.jsx` | `devis`, `devisdetail`, `garantiesouscritedevis`, `quittanceproposition`, `listeaffiliesante/<iddevis>`, `POST confirmationdevis` |
| S-F12 | Fiche contrat : détails, barème, conditions particulières MINENE, liste des affiliés, liste des ayants droit (IA MINENE) | `Products/Contrat/ContratSanteDetails.jsx` | `contrat`, `contratdetail`, `quittancecontrat`, `listeaffiliesante`, `ayantdroitminene/<police>` |
| S-F13 | Impressions : facture proforma (devis/contrat), quittance, quittance proposition, CP MINENE, barème MINENE, liste des affiliés, liste des ayants droit | `Products/Documents/Sante/**` | idem |

---

## 4. Parcours IA complet (reconstitué depuis le code URANUS)

```text
Liste IA (IndividuelleAccident/index) ──« Affaire Nouvelle »──▶ /production/individuelle-accident/nouveau-contrat/2
ÉTAPE 1 « CONTRAT » (ContratSection)
   Catégorie ─▶ esttarifiagroupe / esttarifiapersonnalise ─▶ isGroupe / isPersonnalise ; tarif 103 ─▶ isMinene
   Catégorie ─▶ offreparproduit (offres de la catégorie)
   Individuel : Profession, Capitaux, Date de naissance (+ PN/Acc/Taxe/TTC si personnalisé)
   Groupe : Souscripteur
   Durée ─▶ Date d'expiration (calculée ; saisie si « Divers » ; MINENE « Divers » = 31/12)
   ─ « Suivant »
ÉTAPE 2
   ├─ Individuel : « OFFRE » (OffreSection) : offre (défaut : libellé contenant PARTICULIER ; MINENE : 66)
   │     ─▶ POST offregarantieia ─▶ tableau des garanties + Total prime nette + Prime TTC
   └─ Groupe : « Assuré(e)s/Ayants Droit » (IAGroupeSection) : offre (défaut : libellé contenant GROUPE)
         pour chaque assuré : Assuré, Date de naissance, Ayants droit, Téléphone, Gaucher/Droitier,
         Adresse, Profession, Capitaux (+ PN/Acc/Taxe/TTC si personnalisé)
         « Ajouter l'assuré » ─▶ POST enregistrementdevisia (IdDevis 0 au 1er, puis IdDevis du devis ;
         IdDevisDetail 0) ; refus si l'assuré est déjà dans la liste (« Assuré existant »)
         « Editer » ─▶ assureiainfo ─▶ « Enregistrer » (IdDevisDetail de la ligne)
         Import Excel (bascule « Saisie Manuelle ») ─▶ POST importationassureia/ ─▶ assureiapardevis
ÉTAPE 3 « SOUSCRIPTEUR/ASSURÉ(E)/AYANTS DROIT » (SouscripteurSection)
   MINENE : « Numéro de police Santé connexe » ─▶ POST creer-devis-ia-minene/ (tout automatique)
   Sinon : Souscripteur (l'assuré suit par défaut), Assuré, Gaucher/Droitier, Ayants droit, Adresse
   Individuel ─▶ POST enregistrementdevisia (+ correctiondevis en édition)
   Groupe     ─▶ POST finalisationdevisia (+ correctiondevis en édition)
   ─▶ fiche devis /production/individuelle-accident/details-devis/<id>
FICHE DEVIS ─▶ « Confirmer » ─▶ POST confirmationdevis ─▶ sp_confirmation_devis ─▶ contrat + police + quittance
FICHE CONTRAT ─▶ « Mouvement » ─▶ MouvementPoliceIA (choix du mouvement, motif si 6/8/9) ─▶ avenant/initiationmouvement
```

Comportements après validation : toast du message de la procédure (`OutputMessage`), navigation vers la fiche devis. Validation côté écran : réduction bornée 0–35, part d'ayant droit ≤ part restante. Validations côté base : voir §10.

## 5. Parcours Santé complet (reconstitué depuis le code URANUS)

```text
Liste Santé ──« Affaire Nouvelle »──▶ SanteForm
   à l'ouverture : GET numerosaisiesante ─▶ sp_initialisation_devis_sante ─▶ nouveau devis vide (numeroSaisie)
ÉTAPE 1 « CONTRAT » : police compagnie, Type de contrat, Compagnie, Offre commerciale (tarif produit 5),
   Ajustement (Réduction/Majoration), Taux (%), Gestionnaire (VITALIS SANTE, non modifiable),
   Date d'emission, Date d'effet, Durée (Annuelle / Divers), Date d'expiration
   Offre commerciale 87 ou 102 ─▶ isMinene (zone forcée CÔTE D'IVOIRE, durée forcée Annuelle)
ÉTAPE 2 « COUVERTURES SOUSCRITES » : Formule de couverture (offresantepartarif), Collège (collegesanteparoffre),
   Zone de couverture ─▶ « Enregistrer le collège » ─▶ POST saisiefilialesante (source « S »)
   ─▶ « Vos Couvertures » (filialelisteensaisie) ; libellé de filiale « Collège:Offre(CODE ZONE) »
ÉTAPE 3 « AFFILIATION » : Nom du client (= souscripteur = assuré)
   Adhérents : « + » ─▶ Nouvel Adhérent (filiale, identité, pièce, CMU, adresse, matricule, groupe sanguin,
               pathologies, surprime, téléphone, e-mail, dates) ─▶ POST saisieadherentsante
               ou import Excel ─▶ POST importationaffilie/
               « − » ─▶ liste : modifier / supprimer (annulationsaisieadherent, supprime aussi ses affiliés)
   Affiliés (de l'adhérent choisi) : « + » ─▶ Nouvel Affilié (lien, identité, pièce, CMU, groupe sanguin,
               matricule, observations, surprime, pathologies, pathologie antérieure, certificat, sexe, dates)
               ─▶ POST saisieaffiliesante ; « − » ─▶ modifier / supprimer (annulationsaisieaffilie ;
               refus de supprimer le chef de famille « A »)
   Primes : Prime par famille | Prime par Affilié | Prime globale (une seule) ; Surprime affection ; Accessoire manuel
   « Enregistrer le devis » ─▶ POST enregistrementdevissante ─▶ sp_creation_devis_sante (calcul, numéro de devis)
   ─▶ fiche devis /production/sante/details-devis/<id>
FICHE DEVIS ─▶ Éditer | Confirmer le devis (confirmationdevis) | Archiver le devis ; onglets Barème (MINENE), Liste des affiliés
FICHE CONTRAT ─▶ CP MINENE, Barème, Liste des affiliés, Liste des ayants droits ; Mouvement
```

Contrôles de la base qui conditionnent l'enregistrement : au moins un adhérent et un affilié saisis par l'opérateur, dates de naissance des affiliés renseignées, une seule prime renseignée (sauf MINENE automatique), un seul chef de famille par famille, catégorie paramétrée.

---

## 6. Champs IA

### 6.1 Étape Contrat (`ContratSection.jsx`)

| Champ URANUS | Libellé affiché | Type | Obligatoire | Liste | Valeurs / défaut | Règle métier | Présent dans PHARE | Action |
|---|---|---|---|---|---|---|---|---|
| `numeroPoliceCompagnie` → `NumeroPoliceCompagnie` | Numéro de police compagnie | texte | non | — | vide ; « RAS » envoyé si vide (individuel) | `stddevis.numeropolicecompagnie` (vide → NULL) | Oui (envoie `''`) | conserver ; « RAS » d'URANUS non repris (À VÉRIFIER, la base remet `''` à NULL) |
| `compagnie` → `IdCompagnie` | Compagnie d'Assurance | liste | oui | `stdcompagnie` | défaut **21 (AMSA)** en création ; MINENE : 1 (NSIA) verrouillé | répartition de l'accessoire imposé définie pour 1, 14, 21 seulement | Oui ; défaut **1 (NSIA)** | DIFFÉRENT (défaut) — signalé, non modifié |
| `categorie` → `IdTarif` | Catégorie (* requis) | liste | oui | `tarifparproduit/2` | 1er tarif | groupe = 75, 76, 78, 145 ; personnalisé = 74, 75 ; MINENE = 103 | Oui (défaut 77, liste triée) | OK |
| `reduction` → `TauxReduction` | Reduction (* requis) | nombre | oui | — | 0, borné 0–35 | ramené à 0 pour les offres forfaitaires (§10) | Oui (« Réduction (%) ») | OK |
| `souscripteur` (groupe) → `IdClient` | Souscripteur | recherche client + « Nouveau client » | oui | `stdclient` | 1er client | — | Oui (étape 2) | OK |
| `profession` → `IdProfession` | Profession | liste | oui | `professionia` (225 actives, dont id 0 « AUTRE ») | 1er élément | `code_classe_assure` → `CodeActivite` (01–05) | Oui, par assuré ; option « AUTRE » codée en dur **en plus** de l'« AUTRE » de la base | INCOHÉRENT (doublon) → corriger |
| `capitalDeces` → `CapitalDeces` | Capital décès | montant | non (0) | — | MINENE : 2 000 000 verrouillé | `stddevisdetail.valeurvenale` | Oui | OK |
| `capitalInfirmitePermanente` → `CapitalIpp` | Capital Infirmite permanente | montant | non | — | MINENE : 2 000 000 | `stddevisdetail.valeurneuve` | Oui | OK |
| `capitalFraisTraitement` → `FraisTraitement` | Capital frais de traitement | montant | non | — | MINENE : 100 000 | `stddevisdetail.valeuraccessoire` | Oui | OK |
| `primenette` → `PrimeNette` | Prime Nette | montant | si personnalisé | — | — | prime ≠ 0 ⇒ `primeimposee` ; répartie sur les 3 garanties au prorata (offres 173/174) | **Non** (logique présente, champ absent) | INCOMPLET → intégrer |
| `accessoire` → `Accessoire` | Accessoire | montant | non | — | — | moitié compagnie / moitié courtier (compagnies 1, 14, 21) | **Non** | INCOMPLET → intégrer |
| `taxe` | Taxe | montant | non | — | — | **non lu par le backend** | Non (calculée par LE PHARE) | conserver calculée (lecture seule) |
| `primettc` → `PrimeTTC` | Prime TTC | montant | non | — | — | la procédure redéduit l'accessoire de la TTC | Non (calculée) | conserver calculée |
| `dateNaissance` → `DateNaissance` | Date de naissance | date | oui | — | aujourd'hui − 18 ans ; ≤ aujourd'hui ; masquée en MINENE | `stddevisdetail.datemec` ; âge 0 refusé | Oui, sans défaut | OK |
| `dateEmission` → `DateEmission` | Date d'emission | date | oui | — | aujourd'hui, modifiable | — | Oui, **non modifiable** (date du jour, imposée aussi par le serveur) | DIFFÉRENT (évolution LE PHARE) — conserver |
| `dateEffet` → `DateEffet` | Date d'effet | date | oui | — | aujourd'hui | — | Oui | OK |
| `duree` → `IdDuree` | Durée du contrat | liste | oui | voir §8 | 1 | — | Oui | DIFFÉRENT (libellé/ordre, §8) |
| `dateExpiration` → `DateExpiration` | Date d'expiration (* requis) | date calculée ou saisie | oui | — | effet + durée − 1 jour | « Incohérence entre période de couverture et durée » (base) | Oui | OK |
| — | Terme du contrat | liste | — | — | — | `stddevis.idterme` | Oui | NOUVEAU (LE PHARE) — conserver |

### 6.2 Étapes Assurés / Souscripteur (`SouscripteurSection.jsx`, `IAGroupeSection.jsx`)

| Champ URANUS | Libellé affiché | Type | Obligatoire | Liste | Valeurs / défaut | Règle métier | Présent dans PHARE | Action |
|---|---|---|---|---|---|---|---|---|
| `offre` → `IdOffre` | Offre | liste | oui | `offreparproduit` | individuel : libellé contenant « PARTICULIER » ; groupe : « GROUPE » ; MINENE : 66 | détermine le calcul (§10) | Oui (étape 1) | OK |
| `numPoliceConnexe` → `NumeroPoliceConnexe` | Numéro de police Santé connexe | texte | oui si MINENE | — | — | police Santé existante (`sp_creation_devis_ia`) | Oui | OK |
| `assure` → `IdAssure` | Nom de l'assuré / Assuré | recherche client ; « + » = nouveau client ou import | oui | `stdclient` | = souscripteur en individuel | `stddevisdetail.matricule` (id client sur 20 car.) ; doublon refusé | Oui (client existant **ou** nouvel assuré saisi par nom) | OK (+ NOUVEAU : saisie par nom) |
| `telephoneAssure` | Téléphone Assuré (+225) | téléphone | non | — | téléphone du client | **non envoyé** | **Non** (état présent, champ absent) | intégrer pour la fiche du nouvel assuré |
| `mainPrincipale` | Gaucher(e)/Droitier(e) | liste | non | 1 Gaucher(e), 2 Droitier(e) | — | **non envoyé, aucune colonne** | Non | NON PERSISTÉ — non intégré, à valider (§17) |
| `adresseGeo` → `AdresseGeographique` | Adresse Géographique | texte | non | — | adresse du client | conservée dans `stdclient.adresse2` uniquement pour l'offre 66 | Oui | OK |
| `nom_ayant_droit` → `NomAyantDroit` | Nom Ayant Droit | texte | **oui** | — | — | `stdayantdroitia.nomayantdroit` | Oui (requis) | OK |
| `prenoms_ayant_droit` → `PrenomsAyantDroit` | Prenoms Ayant Droit | texte | **oui** (« Prenoms obligatoire ») | — | — | — | Oui, **facultatif** | INCOHÉRENT → rendre obligatoire |
| `id_qualite_ayantD` → `IdQualiteAyantDroit` | Qualité Ayant Droit | liste | oui | `qualiteayantdroit` | défaut **3** (ENFANTS ORPHELINS) | — | Oui ; défaut 1 (CONJOINT), liste triée | DIFFÉRENT (défaut) — signalé |
| `part` → `Part` | Part (%). Part restante : n % | nombre | oui | — | ≤ part restante ; ajout bloqué à 100 % | total ≤ 100 % | Oui (> 0 exigé) | OK |
| Excel `FichierExcel` | Importez une liste d'assurés | fichier | — | — | — | 3 modèles (§10.4) | **Non** (logique `handleImportAssures` présente, champ absent) | INCOMPLET → intégrer |

### 6.3 Récapitulatif des primes (`OffreSection.jsx`)

| Colonne URANUS | Source | Présent dans PHARE | Action |
|---|---|---|---|
| Garantie, Acquise (cochée, lecture seule), Capital, Franchise, Formule, Place (vides en IA), P.Annuelle, P.Nette | `fn_garantie_offre_ia` | **Non** : seul le total par assuré s'affiche (garanties chargées mais non montrées) | INCOMPLET → afficher le détail par assuré |
| Total Prime Nette, Prime TTC (ou PN/Acc/Taxe/TTC saisies) | ligne CUMUL | Oui (prime nette, taxes, accessoires, TTC) | OK |

## 7. Champs Santé

### 7.1 Étape Contrat (`SantePartials/ContratSection.jsx`)

| Champ URANUS | Libellé affiché | Type | Obligatoire | Liste | Valeurs / défaut | Règle métier | Présent dans PHARE | Action |
|---|---|---|---|---|---|---|---|---|
| `numeroPoliceCompagnie` | Numéro de police compagnie | texte | non | — | — | `stddevis.numeropolicecompagnie` | Oui | OK |
| `typeContrat` → `TypeContrat` | Type de contrat | liste | oui | `typecontratsante` | 1 CONTRAT PARTICULIER, 2 CONTRAT SOCIETE | `stdcomplementdevisdetailsante.idtypecontrat` | **Inventé** : INDIVIDUEL / GROUPE / FAMILLE (texte) | INCOHÉRENT → remplacer |
| `compagnie` → `IdCompagnie` | Compagnie d'Assurance | liste | oui | compagnies | 1er | — | Oui | OK |
| `offreCommerciale` → `IdTarif` | Offre Commerciale | liste | oui | `tarifparproduit/5` (5 valeurs) | 1er | 87, 102 ⇒ MINENE | **Inventé** : SANTE CONFORT PLUS / ELITE MONDE / ESSENTIEL | INCOHÉRENT → remplacer |
| `ajustement` | Ajustement | liste | oui | `true` Réduction / `false` Majoration | Réduction | signe du taux envoyé (+ réduction, − majoration) | **Non** | MANQUANT → intégrer |
| `reduction` → `TauxReduction` | Taux Réduction (%) / Taux Majoration (%) | nombre | non | — | 0 ; second champ borné 0–35 si type 2 | appliqué aux primes MINENE seulement (§11) | Partiel (« Réduction Commerciale », 0–35, sans majoration) | INCOMPLET → compléter |
| `GestionnaireSante` | Gestionnaire | texte, non modifiable | — | — | **VITALIS SANTE** | `stdcomplementdevisdetailsante.gestionnairesante` | **Inventé** : ASCOMA / GRAS SAVOYE / NSIA HEALTH / SUNU SANTE | INCOHÉRENT → remplacer |
| `dateEmission`, `dateEffet` | Date d'emission, Date d'effet (* requis) | date | oui | — | aujourd'hui | — | Oui (émission non modifiable) | DIFFÉRENT (évolution LE PHARE) |
| `duree` → `IdDuree` | Durée du contrat | liste | oui | `dureeContratMinene` : 4 Annuelle, 5 Divers | 4 | MINENE : Annuelle forcée | Oui (Mensuelle…Annuelle + terme « Autre ») | DIFFÉRENT (§9) |
| `dateExpiration` | Date d'expiration (* requis) | calculée / saisie (Divers) | oui | — | effet + 1 an − 1 jour | — | Oui | OK |

### 7.2 Étape Couvertures souscrites (`FormuleSection.jsx`)

| Champ URANUS | Libellé affiché | Type | Liste / valeurs | Règle | Présent dans PHARE | Action |
|---|---|---|---|---|---|---|
| `formuleCouverture` → `offresante`, puis `IdOffre` du devis | Formule de couverture | liste | `offresantepartarif/<tarif>` | 1re offre par défaut | **Inventé** (« 80 % ticket modérateur… ») | INCOHÉRENT → remplacer |
| `college` → `college` | Collège | liste | `collegesanteparoffre/<offre>` (13 collèges en base) | 1er par défaut | **Inventé** (collèges libres avec taux, plafond, effectif, prime/tête) | INCOHÉRENT → remplacer |
| `zoneCouverture` → `zonecouverture` | Zone de couverture | liste | 1 CÔTE D'IVOIRE, 2 MONDE ENTIER | forcée CÔTE D'IVOIRE si libellé de formule « COTE D'IVOIRE » ; MINENE : 1 verrouillé | **Inventé** (« CI & zone CIMA », « Monde entier (évacuation) ») | INCOHÉRENT → remplacer |
| — | Enregistrer le collège | bouton | — | `sp_saisie_filiale_sante` ; refus d'une filiale identique | Non | MANQUANT → intégrer |
| `filialeslist` | Vos Couvertures | liste | filiales du devis | — | Non | MANQUANT → intégrer |

### 7.3 Adhérent (`Utils/NewAdherent.js` → `sp_saisie_adherent_sante`)

| Champ (clé envoyée) | Libellé | Type | Obligatoire | Valeurs | Colonne | Règle | PHARE | Action |
|---|---|---|---|---|---|---|---|---|
| `filiale` | Filiale * | liste | oui | filiales du devis | `stdadherent.idfiliale` | filiale du devis et de l'opérateur | Non | intégrer |
| `nom`, `prenom` | Nom, Prenom | texte | nom oui | — | `nom`, `prenom` | « Nom de l'adhérent non renseigné » | Non | intégrer |
| `datenaissance` | Date de naissance | date | oui | défaut : date de naissance du client | `datenaissance` | MINENE 70/80 : âge ≥ 70 refusé | Non | intégrer |
| `sexe` | Sexe | liste | oui | F Féminin (défaut), M Masculin | `sexe` | — | Non | intégrer |
| `fichierpiece` | Importation CNI | fichier | non | — | `fichierpiece` | — | Non | intégrer |
| `cni` | (CNI du client par défaut, pas de champ visible) | texte | non | — | `cni` | — | Non | intégrer (champ visible) |
| `numerocmu` | Numéro CMU | texte | non | — | `numerocmu` | unique parmi les adhérents | Non | intégrer |
| `adresse` | Adresse | texte | non | adresse du client | `adresse` | — | Non | intégrer |
| `matricule` | Matricule | texte | non | — | `matricule` | — | Non | intégrer |
| `groupesanguin` | Groupe Sanguin: | liste | non | NS « INFO NON DISPONIBLE », A+, B+, AB+, O+, A−, B−, AB−, O− | `groupesanguin` | valeurs contrôlées | Non | intégrer |
| `nombrepathologies` | Nombre pathologies | nombre | non | 0 | `nombrepathologie` | 0 à 3 | Non | intégrer |
| `supprimeappliquee` / `montantsuprime` | Surprime / Montant Surprime | interrupteur + montant | non | — | `surprimeappliquee`, `montantsurprime` | **clés mal orthographiées : jamais enregistrées** (§17) | Non | intégrer avec les clés lues par le serveur |
| `mobile1` | Numéro de téléphone * | téléphone | marqué * | téléphone du client | `mobile1` | — | Non | intégrer |
| `email` | E-mail * | texte | marqué * | e-mail du client | `email` | — | Non | intégrer |
| `dateeffet` | Date d'effet | date | non | aujourd'hui | `dateadhesion` | — | Non | intégrer |
| `datedebutconsommation` | Date début consommation | date | oui (sérialiseur) | aujourd'hui | `datedebutconsommation` | fin de carence | Non | intégrer |
| `vip` (caché), `mobile2` | — | — | — | `true` | `vip`, `mobile2` | — | — | conserver la valeur URANUS |

### 7.4 Affilié (`Utils/NewAffilie.jsx` → `sp_saisie_affilie_sante`)

| Champ (clé envoyée) | Libellé | Type | Obligatoire | Valeurs | Règle | PHARE | Action |
|---|---|---|---|---|---|---|---|
| `adherent` | Adhérent | lecture seule | oui | adhérent choisi | « Adhérent inexistant » | Non | intégrer |
| `lien` | Lien * | liste | oui | `lienjuridiquesante` sans « A » : C Conjoint(e), E Enfant | enfant > 25 ans refusé ; enfant ≥ 21 ans sans certificat refusé | Non | intégrer |
| `nom`, `prenom` | Nom, Prenom | texte | nom oui | — | — | Non | intégrer |
| `fichierpiece` | CNI / Extrait de naissance (si E) | fichier | non | — | — | Non | intégrer |
| `numerocmu` | Numéro CMU | texte | non | — | unique parmi les affiliés | Non | intégrer |
| `groupesanguin` | Groupe Sanguin: | liste | non | idem adhérent | contrôlé | Non | intégrer |
| `matricule`, `observations` | Matricule, Observations | texte | non | « RAS » par défaut côté serveur | — | Non | intégrer |
| `surprimeappliquee`, `montantsurprime` | Surprime, Montant Surprime | interrupteur + montant | non | — | — | Non | intégrer |
| `nombrepathologies` | Nombre pathologies | nombre | non | 0 | 0 à 3 | Non | intégrer |
| `handicape` | **Pathologie antérieure** | interrupteur | non | — | colonne `handicape` | Non | intégrer (libellé URANUS conservé) |
| `certificat` | Certificat | interrupteur | non | — | certificat de scolarité (enfants ≥ 21 ans) | Non | intégrer |
| `sexe` | Sexe | liste | oui | F, M | — | Non | intégrer |
| `datenaissance`, `dateeffet`, `datedebutconsommation` | Date de Naissance, Date d'effet, Date début consommation | date | naissance oui | — | MINENE : conjoint/adhérent ≥ 70 ans refusé ; taille de famille (§11) | Non | intégrer |
| `mobile1`, `mobile2` | (non affichés) | — | — | — | retenus seulement pour les liens A et C | — | conserver |

### 7.5 Primes (`AffiliationSection.jsx` → `sp_creation_devis_sante`)

| Champ URANUS | Libellé | Clé API | Colonne | PHARE | Action |
|---|---|---|---|---|---|
| `nomClient` | Nom du client | `IdClient` = `IdAssure` | `stddevis.idclient`, `idassure` | Oui (« Souscripteur ») | OK |
| `primeFamille` | Prime par famille | `PrimeFamille` | `stdcomplementdevisdetailsante.primefamille` | Non (« prime par tête » inventée) | intégrer |
| `primeAffilie` | Prime par Affilié | `PrimeAffilie` | `primeaffilie` | Non | intégrer |
| `primeGlobale` | Prime globale | `PrimeGlobale` | `primeglobale` | Non | intégrer |
| `supprimeAffection` | Supprime Affection (sic) | `MontantSuprime` | `montantsurprime` | « surprime » sans champ | intégrer (libellé corrigé en « Surprime affection », clé conservée) |
| `montantaccessoiremanuel` | Accessoire Manuel | `MontantAccessoireManuel` | `montantaccessoiremanuel` | « Frais d'adhésion / accessoires » (défaut 5 000 inventé) | intégrer (défaut 0 comme URANUS) |
| `GestionnaireSante` | Gestionnaire | `GestionnaireSante` | `gestionnairesante` | inventé | « VITALIS SANTE » |
| — | — | `IdDuree`, `NumeroPoliceCompagnie`, `IdDevis` (= numéro de saisie) | — | — | intégrer |

---

## 8. Listes déroulantes IA

| Champ | Libellé | Valeurs URANUS | Valeurs PHARE | Différence | Action |
|---|---|---|---|---|---|
| `categorie` | Catégorie | ordre de l'API : 77 TARIF INDIVIDUELLE ACCIDENTS, 78 … GROUPE, 103 … MINENE, 145 … CGA P/C, 76 … CI-ENERGIES P/C, 75 … SPECIFIQUE (GROUPE), 74 … SPECIFIQUE (PARTICULIER) | mêmes valeurs, triées par libellé | ordre seulement | conserver (tri LE PHARE) |
| `offre` | Offre | 77→6 PARTICULIER ; 78→7 GROUPE ; 103→66 MINENE ; 145→155 SPECIFIQUE, 154 CAPITAL 2K, 156 CAPITAL 4K ; 76→170 DIRECTEURS, 162 CHEFS DE DÉPARTEMENTS, 165 CONSEILLER SPÉCIAL…, 166 DIRECTEURS GENERAUX, 167 CONTRÔLEURS…, 168 CHEFS DE SERVICES, 169 CADRES…, 163 CHAUFFEURS… ; 75→174 ; 74→173 | mêmes (API), triées | défaut : URANUS choisit l'offre « PARTICULIER »/« GROUPE », LE PHARE la 1re de la liste (une seule offre dans ces catégories) | OK |
| `compagnie` | Compagnie d'Assurance | compagnies, défaut 21 | compagnies, défaut 1 | défaut | À VÉRIFIER (§17) |
| `profession` | Profession | 225 professions actives (`professionia`), dont 0 AUTRE ; défaut 1re | « AUTRE » codée (valeur 0) + liste de la base (contient déjà 0 AUTRE), libellé suffixé « (classe nn) » | **doublon « AUTRE »** | corriger : liste de la base seule |
| `duree` | Durée du contrat | 1 Mensuelle, 2 Trimestrielle, 3 Semestrielle, 4 Annuelle, 5 Divers ; MINENE : 4 Annuelle, 5 Divers | 1 Mensuelle, 2 Trimestrielle, 3 Semestrielle, 4 Annuelle (triées) ; 5 « Libre » via terme « Autre » ; MINENE : 4 (5 via « Autre ») | libellé « Divers » → « Libre », ordre alphabétique | conserver (décision LE PHARE du commit `3d5c0a3`), signalé |
| `id_qualite_ayantD` | Qualité Ayant Droit | 0 NON PRECISE, 1 CONJOINT, 2 ENFANTS MINEURS, 3 ENFANTS ORPHELINS, 4 ENFANTS MAJEURS A CHARGES, 5 ASCENDANTS, 6 FRERES ET SOEURS, 7 TIERS LESE A CHARGE ; défaut 3 | mêmes valeurs, triées ; défaut 1 | défaut, ordre | signalé |
| `mainPrincipale` | Gaucher(e)/Droitier(e) | 1 Gaucher(e), 2 Droitier(e) | absent | non persisté dans URANUS | à valider |
| `idAvenant` (mouvement) | Mouvement | RENOUVELLEMENT, INCORPORATION, MODIFICATION DE PRISE D'EFFET, REPRISE DE PORTEFEUILLE, ANNULATION, RETRAIT, RESILIATION, TRANSFERT DE PORTEFEUILLE (capture OREOLE) | modale locale (navigateur) | non relié à la base | MANQUANT (hors périmètre, §15) |

## 9. Listes déroulantes Santé

| Champ | Libellé | Valeurs URANUS (base) | Valeurs PHARE | Différence | Action |
|---|---|---|---|---|---|
| `typeContrat` | Type de contrat | 1 CONTRAT PARTICULIER, 2 CONTRAT SOCIETE | INDIVIDUEL « Individuel Mono-Bénéficiaire », GROUPE « Santé Entreprise / Groupe d'Affiliés », FAMILLE « Santé Familiale / Particulier » | valeurs inventées, valeur technique texte au lieu d'entier | remplacer par la base |
| `offreCommerciale` | Offre Commerciale | 153 MINENE-SANTE (80% - 80%), 85 SANTE CLASSIQUE, 102 MINENE CHAUFFEURS VTC, 86 SANTE MICRO, 87 MINENE SANTE (70 % - 80 %) | SANTE CONFORT PLUS, SANTE ELITE MONDE, SANTE ESSENTIEL | inventées | remplacer |
| `formuleCouverture` | Formule de couverture | 153→175 SOLO, 176 FAMILLE, 181 FAMILLE PLUS (80 % - 80 %) ; 85→29/30/31 CLASSIQUE 100/90/80 % CÔTE D'IVOIRE, 61/62/63 … MONDE ENTIER ; 102→20 SOLO, 21 FAMILLE, 22 FAMILLE PLUS (VTC) ; 86→14/15/16 TIERS-PAYANTS 100/90/80 % CÔTE D'IVOIRE, 58/59/60 … MONDE ENTIER ; 87→17 SOLO, 18 FAMILLE, 19 FAMILLE PLUS (70 % - 80 %) | « 80% TICKET MODERATEUR 20% », « 100% FRAIS REELS / TIERS PAYANT », « 100% PLAFONNE BAREME CONVENTIONNE » | inventées | remplacer |
| `college` | Collège | offres classiques/tiers payant : 1 Cadre, 2 Cadre Moyen, 3 Cadre supérieur, 4 Direction générale, 5 Directeur, 6 Agent de maîtrise, 7 Employé, 8 Ouvrier, 9 Administrateur, 10 Famille ; MINENE : 11 SOLO / 12 FAMILLE / 13 FAMILLE PLUS selon l'offre | collèges libres « CADRES / EMPLOYES » avec taux 70–100 %, plafond, effectif, prime/tête | inventés | remplacer |
| `zoneCouverture` | Zone de couverture | 1 CÔTE D'IVOIRE (CIV), 2 MONDE ENTIER (MOE) | 3 libellés inventés | inventés | remplacer |
| `ajustement` | Ajustement | Réduction (true), Majoration (false) | absent | — | intégrer |
| `duree` | Durée du contrat | 4 Annuelle, 5 Divers | 1–4 + « Libre » (terme « Autre ») | URANUS ne propose que Annuelle/Divers en Santé | restreindre à Annuelle + terme « Autre » (libre) |
| `sexe` | Sexe | F Féminin (défaut), M Masculin | absent | — | intégrer |
| `groupesanguin` | Groupe Sanguin | NS INFO NON DISPONIBLE (défaut), A+, B+, AB+, O+, A−, B−, AB−, O− (libellés « Groupe X ») | absent | — | intégrer |
| `lien` | Lien * | C Conjoint(e), E Enfant (A Adhérent exclu, créé avec l'adhérent) | absent | — | intégrer |
| `filiale` | Filiale * | filiales du devis, libellé `Collège:Offre(ZONE)` | absent | — | intégrer |
| `GestionnaireSante` | Gestionnaire | VITALIS SANTE (fixe) | 4 gestionnaires inventés | inventés | remplacer |

---

## 10. Règles de calcul IA

### 10.1 Prime d'un assuré — `fn_garantie_offre_ia` (appelée par `offregarantieia` et `sp_enregistrement_assure_ia`)

```text
Entrées : compagnie, offre, capitaux (décès, IPP, frais de traitement), taux de réduction,
          dates d'effet/expiration, code activité (classe de la profession), date de naissance,
          prime nette et accessoire imposés (0 par défaut)
âge = années révolues entre la date de naissance et AUJOURD'HUI (pas la date d'effet)

Offre 66 (MINENE) : prime de base 14 524 (fn_get_prime_base_minene_ia) ; capitaux 2 000 000 / 2 000 000 / 100 000
   si non saisis ; prime IPP = 14 524 × IPP / Σcapitaux ; prime FT = 14 524 × FT / Σcapitaux ;
   prime décès = 14 524 − (IPP + FT)
Offres forfaitaires (primes et capitaux imposés par la fonction) :
   154 CGA 2K : 2 120 / 2 120 / 0 ; capitaux 2 M / 2 M / 0
   156 CGA 4K : 6 924 / 6 923 / 0 ; 4 M / 4 M / 0
   155 CGA SPECIFIQUE : 0 / 0 / 0
   CI-ENERGIES (décès = IPP) : 166 → 48 000 (100 M) ; 165 → 36 000 (75 M) ; 170 → 24 000 (50 M) ; 162 → 14 400 (30 M) ;
   168 → 12 000 (25 M) ; 169 → 7 200 (15 M) ; 167 → 4 800 (10 M) ; 163 → 2 400 (5 M)
Autres offres (6, 7, 173, 174) : fn_calcul_prime_ia_by_age (10.2)
   173/174 avec prime imposée : prime répartie au prorata de la prime calculée (ou par tiers),
   l'écart d'arrondi reporté sur le décès
Réduction : forcée à 0 pour 66, 154–156, 162–170, 173, 174 ; sinon prime nette = prime × (1 − taux/100)
Prorata temporis (sauf offres forfaitaires) : PN = round(PN × durée du contrat / nombre de jours de L'ANNÉE EN COURS)
   si durée ≤ 1 an
Taxe par garantie : round(PN × taux / 100), taux de stdtauxtaxegarantieproduit (produit 2 : 14,5 % pour 17, 18, 19, 20)
Accessoire : 173/174 avec accessoire imposé → moitié courtier / moitié compagnie, taxe = acc × taux de l'offre ;
   sinon fn_get_accessoire(PN totale, 2, offre, compagnie, date d'effet)
Ligne CUMUL (IdGarantie 0) : PA, PN, taxe garanties + taxe accessoire, accessoire total
```

### 10.2 `fn_calcul_prime_ia_by_age` (offres au barème)

```text
taux de classe (‰) : 01 → 1,0 ; 02 → 1,3 ; 03 → 1,7 ; 04 → 2,5 ; 05 → 4,1 (fn_web_calcul_taux_classe)
coefficient d'âge : 12–49 ans → 1 ; 50–65 → 1,3 ; 66–70 → 1,4 ; hors 12–70 → aucune prime (pas de refus)
décès = capital × taux/1000 × coef ; IPP = capital × taux/1000 × coef
66–70 ans : si taux < 2 → taux = 2 et décès calculé ; IPP calculée seulement si taux < 2,5
            (pour les classes 04 et 05, décès et/ou IPP restent à 0 — RÈGLE NON DÉTERMINÉE : intention inconnue)
frais de traitement : forfait selon la classe et la tranche de capital (> 0 à ≤ 1 000 000), × 1,3 de 50 à 65 ans :
   classe 01 : 4 000 / 6 000 / 9 500 / 12 500 / 15 750 (tranches ≤125 k, ≤250 k, ≤500 k, ≤750 k, ≤1 M)
   classe 02 : 6 000 / 10 000 / 15 000 / 18 000 / 21 500
   classe 03 : 8 500 / 12 500 / 18 000 / 23 500 / 32 000
   classe 04 : 11 000 / 16 000 / 23 500 / 30 500 / 40 500
   classe 05 : branche écrite « 04 » une 2e fois (14 500 / 19 500 / 27 000) → jamais atteinte : FT = 0 en classe 05
   FT = 0 au-delà de 1 000 000, à 12 ans exactement (test « > 12 ») et après 65 ans
```

### 10.3 Enregistrement — `sp_creation_devis_ia` / `sp_enregistrement_assure_ia`

```text
prime imposée ⇔ PrimeNette ≠ 0 ; accessoire imposé réparti 50/50 (compagnies 1, 14, 21 seulement, sinon refus)
MINENE (66) : police Santé connexe obligatoire et existante (produit 5)
âge 0 refusé (« Date de naissance incorrecte ») ; même assuré deux fois dans un devis refusé
stockage d'une ligne d'assuré dans stddevisdetail : matricule = id client (20 car.), datemec = date de naissance,
   valeurvenale = capital décès, valeurneuve = capital IPP, valeuraccessoire = frais de traitement,
   chargeutile = accessoire, idprofession, tauxreduction ; stdclient.datenaissance complétée si vide
groupe : sp_finalisation_devis totalise le devis
```

### 10.4 Import Excel des assurés (`production/import_assures.py`)

Trois modèles détectés automatiquement : modèle 1 (colonne `Qualite` : lignes A = assuré, B = bénéficiaire ; colonnes `Nom, Prenoms, NumeroCNI, DateNaissance, LieuNaissance, Sexe, NumeroTelephone, NumeroMobile, Qualite, Beneficiaire, AdressePostale, AdresseGeographique, Email, CapitalDeces, CapitalInfirmite, CapitalTraitement`), modèle 2 (« NOMS ET PRENOMS / BENEFICIAIRES », un bénéficiaire par ligne — format du fichier `IA ATM INFORMATIQUE 2026.xlsx`), modèle 3 (« Matricule / Nom et prénoms / Catégorie »). L'offre CGA est déduite du capital décès et de la prime TTC (2 M / 6 000 → 154 ; 4 M / 17 000 → 156).

### 10.5 Contrôle avec les documents OREOLE

`IA ATM INFORMATIQUE 2026.xlsx` : 16 assurés, capital 2 M / 2 M, prime HT 4 240 = 2 120 + 2 120, TTC 6 000 → **concorde** avec l'offre 154. Le **tarif NSIA** (`TARIF IA_NSIA CI.xlsx`) ne concorde pas avec 10.2 (voir §17, I-1).

## 11. Règles de calcul Santé (`sp_creation_devis_sante`)

```text
Pré-requis : devis initialisé, non confirmé ; au moins 1 adhérent et 1 affilié saisis PAR L'OPÉRATEUR ;
             dates de naissance des affiliés renseignées ; un seul chef de famille (lien A) par adhérent
Une seule prime parmi famille / affilié / globale (« Au moins 2 valeurs de prime renseignées ») ;
au moins une prime sauf offres automatisées MINENE (17–28, 175–183)

Offres NON automatisées (SANTE CLASSIQUE, TIERS-PAYANTS…) : prime « imposée »
   prime famille  → garantie 98 = prime famille × nombre d'adhérents ; affilié A porte la prime famille
   prime affilié  → garantie 98 = prime affilié × nombre d'affiliés
   prime globale  → garantie 98 = prime globale
   le TAUX DE RÉDUCTION N'EST PAS APPLIQUÉ (seulement stocké)
Offres MINENE (17–22, 175, 176, 181) :
   prime affilié = prime de base de l'offre (sauf prime saisie) :
       17/20 SOLO 349 148 ; 18/21 FAMILLE 543 556 ; 19/22 FAMILLE PLUS 728 741 (70 %-80 % et VTC)
       175 SOLO 523 722 ; 176 FAMILLE 760 978 ; 181 FAMILLE PLUS 1 039 122 (80 %-80 %)
   renouvellement : réduction du devis précédent réappliquée
   surprimes (si pas de surprime ni de prime globale saisies), par affilié :
       âge (A et C) : 60–64 ans 30 %, 65–69 ans 50 % de la prime de base
       affection : 30 % de la prime de base × nombre de pathologies (0 à 3)
   réduction (ou majoration si taux négatif) : × (1 − taux/100) sur prime et surprimes
   garantie 98 = nombre d'adhérents × prime affilié (ou la prime globale saisie)
Garantie 99 « surprime affection » = surprime saisie + surprime affection ; garantie 167 « surprime âge »
Taxe par garantie : taux santé 8 % (98, 99, 100, 167), 3 % si police « groupe » ;
   groupe = offre non MINENE ET (> 5 adhérents OU > 25 affiliés) ; 14,5 % pour les garanties IA/RC des offres MINENE
Accessoire : MINENE → accessoire manuel ou grille de la compagnie (fn_get_accessoire_compagnie, produit 5),
             taxe 8 %, × nombre d'adhérents ; sinon fn_get_accessoire_sante (compagnie + courtier, taux santé)
TTC = round(prime nette + accessoire + taxe) ; commission intermédiaire = PN × taux de commission
Contrôles de saisie : enfant > 25 ans refusé ; enfant ≥ 21 ans sans certificat refusé ; pathologies 0–3 ;
   CMU unique ; MINENE 70 %-80 % et VTC : adhérent ou conjoint ≥ 70 ans refusé, taille de famille ≤ 1 / 3 / 6
```

Contrôle avec `TARIFICATION MINENE SANTE.xlsx` : primes de base 80 %-80 % (523 722 / 760 978,4 / 1 039 122) et 70 %-80 % (349 148 / 543 556 / 728 741), taxe = (PN + accessoire) × 8 %, IA MINENE 14 524 + accessoire 6 000 + taxe 14,5 % = 23 499,98 → **concordent** avec la base. Les accessoires du fichier (9 000 / 12 000 / 24 000) dépendent de la grille `fn_get_accessoire_compagnie` : non vérifiés ligne à ligne (À VÉRIFIER).

---

## 12. Tables IA

| Table | Colonnes utilisées | Relation | Description |
|---|---|---|---|
| `stddevis` | iddevis, numerodevis, idproduit = 2, idclient (souscripteur), idassure, idcompagnie, idavenant, flotte, dateemission/effet/expiration, idduree, idterme, numeropoliceconnexe, numeropolicecompagnie, primeimposee, primeannuelle, primenette, taxe, accessoire, accessoirecompagnie/intermediaire, primettc, confirme, archive | → stdclient, stdcompagnie, stdavenant | en-tête du devis |
| `stddevisdetail` | iddevisdetail, iddevis, idoffre, idtarif, idprofession, matricule (= id assuré), datemec (= naissance), valeurvenale (décès), valeurneuve (IPP), valeuraccessoire (FT), chargeutile (accessoire), tauxreduction, primenette, taxeenregistrement, primeimposee | → stddevis, stdprofessionia, stdclient (via matricule) | une ligne par assuré |
| `stddevisdetgarantie` | iddevisdet, idgarantie (19 décès, 17 IPP, 20 FT), acquise, capital, primeannuelle, primenette, taxe | → stddevisdetail, stdsousgarantie | garanties de l'assuré |
| `stdayantdroitia` | idayantdroit, idassure, nomayantdroit, prenomsayantdroit, part, idqualiteayantdroit | → stdclient (**l'assuré, pas le devis**), stdqualiteayantdroit | bénéficiaires en cas de décès |
| `stdqualiteayantdroit` | idqualite, libellequaliteayantdroit, codequaliteayantdroit, rente | — | référentiel (8 valeurs) |
| `stdprofessionia` | id, codeprofession, libelleprofession, codeclasseassure, active, debutvalidite, finvalidite | — | 226 professions (classes 01–05) |
| `stdtarif`, `stdoffre`, `stdoffregarantie`, `stdsousgarantie`, `stdgarantie` | — | — | catégories, offres, garanties par offre et compagnie |
| `stdtauxtaxegarantieproduit` | idproduit = 2, idgarantie, tauxtaxe, tauxtaxegroupe, validité | — | 14,5 % |
| `stdcontrat`, `stdcontratdetail`, `stdcontratdetgarantie` | mêmes colonnes que le devis (copie par `sp_confirmation_devis`) | → stddevis (iddevis) | contrat / police |
| `stdclient` | idclient, nom, prenoms, datenaissance, telephone, adresse2 (adresse géographique), lieunaissance, cle_unique | — | souscripteur, assurés |

Procédures et fonctions : `sp_creation_devis_ia`, `sp_enregistrement_assure_ia`, `sp_finalisation_devis`, `sp_correction_devis_ia`, `sp_saisie_ayant_droit_ia`, `fn_saisie_ayant_droit_ia`, `fn_garantie_offre_ia`, `fn_calcul_prime_ia_by_age`, `sp_calcul_prime_ia_by_age`, `fn_web_calcul_taux_classe`, `fn_get_prime_base_minene_ia`, `fn_get_capitaux_minene_ia`, `fn_tarif_ia_groupe`, `fn_tarif_ia_personnalise`, `fn_get_accessoire`, `fn_get_taux_taxe`, `fn_assure_ia_info`, `fn_liste_assure_ia`, `sp_confirmation_devis`, `sp_avenant_*` (initiation, renouvellement, incorporation, retrait, annulation, anl_ren_mpe, modification_effet, creation_devis_initial). Aucun déclencheur propre à l'IA trouvé (NON TROUVÉ).

## 13. Tables Santé

| Table | Colonnes | Relation | Description |
|---|---|---|---|
| `stdnumerosaisiesante` | id, iddevis (unique), idoperateur, saisieencours, datecreation, datemaj | → stddevis, utilisateur | devis en cours de saisie par opérateur |
| `stdfiliale` | idfiliale, iddevis, idcollege, idoffresante, idzonecouverture, nom_filiale, police, actif, date_souscription/effet/expiration, source (S, M pour MINENE), idoperateur | → stddevis, stdcollege, stdoffre, stdzonecouverturesante | « couverture souscrite » (collège × formule × zone) |
| `stdadherent` | idadherent, iddevis, idfiliale, nom, prenom, sexe, cni, fichierpiece, vip, adresse, mobile1/2, email, datenaissance, dateadhesion, datesortie, datedebutconsommation, actif, surprimeappliquee, montantsurprime, nombrepathologie, numerocmu, matricule, groupesanguin, idoperateur | → stdfiliale | chef de famille |
| `stdaffilie` | idaffilie, idadherent, iddevis, lien (A/C/E), nom, prenom, cni, fichierpiece, datenaissance, dateadhesion, datesortie, certificat, datectrl, matricule, carte_vigueur, ancien_matricule, date_dernier_demande, observations, handicape, sexe, actif, primeannuelle, surprimeappliquee, montantsurprime, groupesanguin, mobile1/2, nombrepathologie, numerocmu, datedebutconsommation, idoperateur | → stdadherent | membres de la famille (dont l'adhérent lui-même, lien A) |
| `stdcomplementdevisdetailsante` / `stdcomplementcontratdetailsante` | primefamille, primeaffilie, primeglobale, montantsurprime, montantaccessoiremanuel, tauxreductioncommerciale, idtypecontrat, gestionnairesante | → stddevisdetail / stdcontratdetail | paramètres de prime du devis/contrat |
| `stdcollege`, `stdzonecouverturesante`, `stdtypecontratsante`, `stdlienjuridique` | — | — | référentiels (§9) |
| `stdrepartitionprimesante` | taux frais généraux, commission courtier, honoraires gestionnaire, frais ADEC, autres frais, commission commerciaux, forfaits ADEC IA/RC | — | **table LE PHARE** (créée le 24/09/2026) d'après `TARIFICATION MINENE SANTE.xlsx` |

Procédures et fonctions : `sp_initialisation_devis_sante`, `sp_saisie_filiale_sante`, `sp_saisie_adherent_sante`, `sp_saisie_affilie_sante`, `sp_creation_devis_sante`, `fn_offre_automatisee_minene_sante`, `fn_get_prime_base_minene_sante`, `fn_get_surprime_age_minene_sante`, `fn_get_surprime_affection_minene_sante`, `fn_get_accessoire_sante`, `fn_get_accessoire_sante_minene`, `fn_get_taux_taxe_sante`, `fn_get_taxe_sante_minene` (non appelée par la création), `fn_liste_offre_sante_tarif`, `fn_liste_affilie_sante`, `fn_saisie_sante_en_cours`, `sp_confirmation_devis` (copie du complément Santé, clôture de la saisie).

Volumétrie (base au 01/10/2026) : IA 3 939 contrats, 380 devis non confirmés (106 depuis 2025) ; Santé 4 407 contrats, 427 devis non confirmés (117 depuis 2025, 25 confirmés depuis 2025) ; 83 adhérents, 217 affiliés, 67 filiales, 836 ayants droit IA. La plupart des contrats Santé repris n'ont **pas** d'adhérents en base.

---

## 14. Comparaison URANUS / LE PHARE

### 14.1 IA

| Fonctionnalité | URANUS | LE PHARE | État | Action |
|---|---|---|---|---|
| Liste devis/contrats IA | Oui | Oui (registre commun, onglet IA) | OK | aucune |
| Catégorie / offre / nature (groupe, personnalisé, MINENE) | Oui | Oui | OK | aucune |
| Profession → classe | Oui | Oui, « AUTRE » en double | INCOHÉRENT | corriger |
| Capitaux, date de naissance, réduction 0–35 | Oui | Oui | OK | aucune |
| Durée / expiration | Oui (Divers) | Oui (terme « Autre » = libre) | DIFFÉRENT | conserver (décision LE PHARE) |
| Date d'émission modifiable | Oui | Non (date du jour) | DIFFÉRENT | conserver (décision LE PHARE) |
| Primes imposées (catégories 74/75) | Oui | Logique sans champ | INCOMPLET | intégrer les champs |
| Calcul et tableau des garanties | Oui | Total seul | INCOMPLET | afficher le détail |
| Devis individuel : enregistrement | Oui | Oui (transactionnel) | OK | aucune |
| Devis groupe : ajout / édition / retrait d'assurés | Oui | Oui | OK | aucune |
| Import Excel des assurés | Oui | Logique sans champ | INCOMPLET | intégrer le champ fichier |
| Ayants droit (nom, prénoms, qualité, part) | Oui | Oui (prénoms facultatifs) | INCOHÉRENT | rendre les prénoms obligatoires |
| Téléphone de l'assuré | Affiché (non envoyé) | Logique sans champ | INCOMPLET | intégrer (fiche du nouvel assuré) |
| Gaucher/Droitier | Affiché (non envoyé) | Absent | À VÉRIFIER | non intégré (aucun stockage) |
| Nouvel assuré saisi par son nom (fiche client créée) | Via « Nouveau client » | Oui | NOUVEAU | conserver |
| MINENE automatique depuis la police Santé | Oui | Oui | OK | aucune |
| MINENE groupe, qualité manuelle des affiliés | Code présent mais inaccessible (103 n'est pas groupe) | Non | OK | aucune |
| « Modifier » un devis (lignes inchangées non recalculées) | Oui (correctiondevis) | Oui | OK | aucune |
| Aperçu du devis IA | Fiche détaillée | Champs fictifs vides | INCOHÉRENT | afficher les assurés réels |
| Confirmation devis → contrat | Oui | Oui (registre) ; depuis la page IA : faux succès + contrat local | INCOHÉRENT | corriger |
| Mouvements de police (8 types) | Oui | Non (modale locale) | MANQUANT | hors périmètre (procédures manquantes, voir mémoire « avenants ») |
| Impressions : proposition/CP, facture, annexe | Oui | Oui | OK | aucune |
| Impression CP IA MINENE | Oui | Non | MANQUANT | plan (étape suivante) |
| Terme du contrat | Non | Oui | NOUVEAU | conserver |

### 14.2 Santé

| Fonctionnalité | URANUS | LE PHARE | État | Action |
|---|---|---|---|---|
| Enregistrement réel du devis | Oui | Non (local, erreur avalée) | MANQUANT | intégrer |
| Numéro de saisie (devis initialisé) | Oui | Non | MANQUANT | intégrer |
| Type de contrat | Oui (base) | Valeurs inventées | INCOHÉRENT | remplacer |
| Offre commerciale (catégorie) | Oui (base) | Valeurs inventées | INCOHÉRENT | remplacer |
| Ajustement réduction / majoration | Oui | Réduction seule | INCOMPLET | compléter |
| Gestionnaire | VITALIS SANTE | Valeurs inventées | INCOHÉRENT | remplacer |
| Formule, collège, zone, filiales | Oui | Collèges libres inventés | INCOHÉRENT | remplacer |
| Adhérents (CRUD, pièce, CMU, surprime…) | Oui | Non | MANQUANT | intégrer |
| Affiliés (CRUD, lien, certificat…) | Oui | Non | MANQUANT | intégrer |
| Import Excel adhérents/affiliés | Oui | Non | MANQUANT | intégrer |
| Primes famille / affilié / globale, surprime, accessoire manuel | Oui | « Prime par tête » × effectif inventée | INCOHÉRENT | remplacer |
| Calcul (MINENE automatique, taxes 8 % / 3 %, accessoire) | Oui (procédure) | Taxe fixe 5 % inventée | INCOHÉRENT | calcul par la base |
| Répartition de la prime MINENE (NSIA, OREOLE, VITALIS, ADEC) | Non | Oui (table d'après le fichier OREOLE) | NOUVEAU | conserver, limité aux offres MINENE |
| « Modifier » un devis | Oui | Non | MANQUANT | intégrer |
| Confirmation devis → contrat | Oui | Registre : oui ; page Santé : contrat local | INCOHÉRENT | corriger |
| Aperçu du devis Santé | Fiche + liste des affiliés | Collèges fictifs | INCOHÉRENT | afficher les données réelles |
| Mouvements de police | Oui | Non | MANQUANT | hors périmètre |
| Impressions (CP MINENE, barème, listes, facture, quittance) | Oui | Facture générique seulement | MANQUANT | plan (étape suivante) |

## 15. Fonctionnalités manquantes

1. **Santé — tout le parcours de production réel** (S-F2 à S-F9) : numéro de saisie, couvertures (filiales), adhérents, affiliés, import Excel, primes, enregistrement, modification.
2. **IA et Santé — mouvements de police** (renouvellement, incorporation, retrait, annulation, résiliation…) : la modale LE PHARE n'écrit que dans le navigateur ; côté base, `sp_avenant_initiation` renvoie vers des procédures absentes pour plusieurs types (constat du 25/09/2026). Hors périmètre de cette intervention.
3. **Impressions** : CP IA MINENE ; Santé : CP MINENE, barème MINENE, liste des affiliés, liste des ayants droit, quittance et facture Santé fidèles à URANUS.
4. **Archivage d'un devis depuis sa fiche** (« Archiver le devis ») : à vérifier dans le registre commun (onglet « Archivés » présent) — À VÉRIFIER.

## 16. Fonctionnalités incomplètes

1. IA — primes imposées des catégories 74/75 : envoyées et recalculées, mais aucun champ pour les saisir.
2. IA — import Excel des assurés : appel API, finalisation et rechargement codés, aucun champ fichier.
3. IA — détail des garanties par assuré : chargé (`garantiesEnregistrees`, `prime.garanties`), jamais affiché.
4. IA — téléphone de l'assuré : repris de la fiche client et envoyé pour un nouvel assuré, aucun champ.
5. IA — aperçu du devis : la section « IA Details » lit `classeProfessionnelle`, `capitalDeces`, `capitalIpt`, `fraisMedicaux`, absents d'un devis réel.
6. Santé — réduction : pas de majoration (taux négatif d'URANUS).

## 17. Incohérences

**I-1 — Tarif IA : barème URANUS ≠ tarif NSIA fourni par OREOLE**
- PROBLÈME : taux de prime décès et invalidité par classe, frais médicaux et clause d'âge différents.
- SOURCE URANUS : `fn_web_calcul_taux_classe` (1,0 / 1,3 / 1,7 / 2,5 / 4,1 ‰), `fn_calcul_prime_ia_by_age` (forfaits FT, couverture jusqu'à 70 ans avec majoration).
- SOURCE PHARE : mêmes fonctions (base partagée).
- SOURCE DOCUMENTAIRE : `TARIF IA_NSIA CI.xlsx` : décès 0,85 / 1,15 / 1,3 / 1,8 / 3 ‰, frais médicaux 1,5 / 2,5 / 3 / 4 / 5 %, ITT/IJ 0,25 ‰ × (décès + invalidité) ; personnes de plus de 60 ans non garanties sauf dérogation, fin de garantie à 65 ans ; indemnité ≤ 200 M par personne, 1 000 M par groupe ; colonnes de capitaux non renseignées (« … »).
- IMPACT : primes IA NSIA calculées différemment du tarif de la compagnie.
- CORRECTION PROPOSÉE : **aucune modification sans validation** (règle de non-régression, document incomplet) ; à arbitrer par OREOLE (le barème URANUS vaut-il pour AMSA/SUNU ? le tarif NSIA remplace-t-il le barème pour la compagnie 1 ?).

**I-2 — Surprime de l'adhérent jamais enregistrée (URANUS)**
- SOURCE URANUS : `NewAdherent.js` envoie `supprimeappliquee` / `montantsuprime` ; `sante/utils.py` lit `surprimeappliquee` / `montantsurprime`.
- IMPACT : la surprime saisie sur un adhérent est perdue (0).
- CORRECTION : LE PHARE envoie les clés lues par le serveur (`surprimeappliquee`, `montantsurprime`).

**I-3 — Réduction Santé sans effet hors MINENE**
- SOURCE : `sp_creation_devis_sante` n'applique `taux_reduction_commerciale` que dans la branche MINENE ; en modification, la procédure ne met pas à jour `tauxreductioncommerciale`, `idtypecontrat` ni `gestionnairesante` du complément (URANUS corrige le taux par un `UPDATE` ORM après coup).
- IMPACT : réduction affichée mais primes inchangées pour SANTE CLASSIQUE / TIERS-PAYANTS / MICRO.
- CORRECTION : afficher l'avertissement à l'écran ; conserver le correctif ORM d'URANUS (déjà dans `save_quotation_sante`) ; pas de modification de procédure sans validation.

**I-4 — Offres MINENE 80 %-80 % (175, 176, 181) sans contrôles**
- SOURCE : `sp_saisie_adherent_sante` / `sp_saisie_affilie_sante` ne contrôlent l'âge (≥ 70 ans) et la taille de famille (1 / 3 / 6) que pour 17–22 ; `SanteForm.jsx` ne reconnaît MINENE que pour les catégories 87 et 102 (pas 153), alors que la fiche devis utilise le code catégorie 123.
- IMPACT : une famille « SOLO » 80 %-80 % peut compter plusieurs personnes ; zone non forcée.
- CORRECTION : LE PHARE reconnaît MINENE par le code catégorie 123 (87, 102 et 153) ; les contrôles de procédure restent à valider (À VÉRIFIER).

**I-5 — Classe 05 : frais de traitement jamais calculés** — branche `code_activite='04'` écrite deux fois dans `fn_calcul_prime_ia_by_age` ; la seconde (montants 14 500 / 19 500 / 27 000) devait viser la classe 05. Signalé, non modifié (règle tarifaire).

**I-6 — Âge IA calculé à la date du jour et prorata sur l'année civile en cours** (et non à la date d'effet / sur la durée réelle de l'année d'assurance). Signalé, non modifié.

**I-7 — Ayants droit rattachés à l'assuré, pas au devis** : modifier les ayants droit dans un nouveau devis modifie ceux de tous les contrats de la personne, sans historique. Structure URANUS conservée ; à valider.

**I-8 — Santé LE PHARE : valeurs inventées** (type de contrat, offres, formules, collèges, zones, gestionnaires, taxe 5 %, accessoire 5 000, prime par tête). SOURCE URANUS/base : §9. CORRECTION : remplacer par les référentiels de la base.

**I-9 — Faux succès** : `NewSanteQuotePage` (« Devis … créé avec succès » sur échec API), `NewIaQuotePage.handleConvertToContract` et `NewSanteQuotePage.handleConvertToContract` (contrat créé dans le navigateur si l'API échoue). CORRECTION : n'afficher le succès que sur réponse positive du serveur, sans repli local.

**I-10 — Routes d'écriture Santé en authentification Knox stricte** : `create_quotation_sante`, `saisir_*_sante`, `annuler_saisie_*` exigent un vrai jeton Knox (401 depuis l'écran), contrairement aux routes de lecture. CORRECTION : routes LE PHARE dédiées avec l'authentification par défaut du projet, comme pour l'IA (`views_devis_ia.py`) — décision « authentification suspendue » du 28/09/2026.

**I-11 — Profession « AUTRE » en double** (option codée + valeur 0 de la base). CORRECTION : liste de la base seule.

**I-12 — Prénoms d'ayant droit** : obligatoires dans URANUS, facultatifs dans LE PHARE. CORRECTION : obligatoires.

**I-13 — Valeurs par défaut différentes** (compagnie IA 21 → 1 ; qualité d'ayant droit 3 → 1 ; « RAS » pour la police compagnie vide). Signalées, non modifiées (À VÉRIFIER).

**I-14 — « Gaucher(e)/Droitier(e) »** : présent à l'écran URANUS, jamais enregistré, aucune colonne. Non intégré : l'ajouter supposerait d'inventer un stockage. À valider par OREOLE.

**I-15 — Libellé « Supprime Affection »** (URANUS) pour la surprime affection : coquille ; LE PHARE affiche « Surprime affection » mais garde la clé API `MontantSuprime`.

**I-16 — Taux de répartition MINENE contradictoires dans le fichier OREOLE** (frais généraux 13,5 % ou 12,5 %, autres frais 3,5 % ou 4,5 % selon la feuille) : la table LE PHARE porte déjà la mention « variante 12,5 % / 4,5 % à confirmer ». À valider.

## 18. Corrections proposées

| Réf. | Correction | Priorité | Fichiers |
|---|---|---|---|
| C-S1 | Production Santé réelle, fidèle à URANUS : 3 étapes (Contrat, Couvertures souscrites, Affiliation), référentiels de la base, numéro de saisie initialisé au premier enregistrement, filiales, adhérents et affiliés (création, modification, suppression, pièce jointe, import Excel), primes, enregistrement par `sp_creation_devis_sante`, erreurs de la base affichées | 1 | `frontend/src/pages/user/quotes/NewSanteQuotePage.jsx`, `frontend/src/api/endpoints.js` |
| C-S2 | Routes LE PHARE d'écriture Santé (authentification par défaut du projet) appelant les fonctions URANUS existantes | 1 | `sante/views_lephare.py` (nouveau), `sante/urls.py` |
| C-S3 | « Modifier » un devis Santé (`?edit=`) et bouton « Modifier » du registre | 1 | page Santé, `QuoteListPage.jsx`, `modulesActifs`/routage existant |
| C-I1 | Champs Prime nette / Accessoire (catégories à tarif personnalisé), taxe et TTC calculées en lecture seule | 1 | `NewIaQuotePage.jsx` |
| C-I2 | Import Excel des assurés (groupe) | 1 | `NewIaQuotePage.jsx` |
| C-I3 | Téléphone de l'assuré (nouvel assuré) | 2 | `NewIaQuotePage.jsx` |
| C-I4 | Profession : liste de la base seule ; prénoms d'ayant droit obligatoires | 2 | `NewIaQuotePage.jsx` |
| C-I5 | Détail des garanties par assuré dans le récapitulatif | 2 | `NewIaQuotePage.jsx` |
| C-X1 | Transformation en contrat sans faux succès ni contrat local (IA et Santé) | 4 | `NewIaQuotePage.jsx`, `NewSanteQuotePage.jsx` |
| C-X2 | Aperçu du devis : assurés IA réels ; données Santé réelles (type, formules, liste des affiliés) | 4 | `ViewQuoteModal.jsx`, `endpoints.js` |
| C-X3 | Lisibilité clair/sombre des nouvelles listes déroulantes (fond lié au thème) | 5 | pages ci-dessus |

Non corrigés (validation métier nécessaire) : I-1, I-3 (procédure), I-4 (contrôles de procédure), I-5, I-6, I-7, I-13, I-14, I-16. Hors périmètre : mouvements de police, impressions Santé et CP IA MINENE.

## 19. Plan d'intégration

1. **Backend Santé** : `sante/views_lephare.py` — numéro de saisie, filiale (création/suppression), adhérent et affilié (création/modification/suppression, multipart), enregistrement du devis, lecture complète d'un devis pour « Modifier » ; routes ajoutées dans `sante/urls.py` sans toucher aux routes URANUS.
2. **Frontend Santé** : réécriture de `NewSanteQuotePage.jsx` sur le modèle des écrans URANUS (vocabulaire et valeurs de la base), en conservant ce qui est propre à LE PHARE et documenté : terme du contrat, date d'émission du jour, répartition MINENE (limitée aux catégories MINENE), aperçu `ViewQuoteModal` à l'enregistrement.
3. **Frontend IA** : champs manquants (C-I1 à C-I5) dans `NewIaQuotePage.jsx` ; aucune modification de `views_devis_ia.py` nécessaire.
4. **Devis → contrat** : C-X1 ; vérifier `sp_confirmation_devis` sur un devis IA et Santé (transaction annulée).
5. **Aperçu** : C-X2.
6. **Tests** (§20), puis rapport final (annexe ci-dessous).

## 20. Tests nécessaires

| # | Test | Méthode |
|---|---|---|
| T1 | Santé : initialisation, filiale, adhérent, affilié, devis SANTE CLASSIQUE (prime par famille) et MINENE (automatique) | script Django dans une transaction annulée (`set_rollback(True)`, `connection.commit/close` neutralisés), comparaison avec la procédure |
| T2 | Santé : erreurs de la base remontées (deux primes, aucune prime, enfant > 25 ans, pathologies > 3) | idem |
| T3 | Santé : confirmation devis → contrat (complément Santé copié, saisie close) | idem — **consomme des numéros de quittance** (séquences avancées même en ROLLBACK) |
| T4 | IA : prime imposée catégorie 74 (taxe et TTC affichées = enregistrées) | `offregarantieia` + enregistrement en transaction annulée |
| T5 | IA : import Excel (modèle 2, fichier ATM) dans un devis groupe | transaction annulée |
| T6 | IA : confirmation d'un devis individuel et groupe | transaction annulée |
| T7 | Écrans : parcours complet IA et Santé, listes déroulantes, champs obligatoires, valeurs invalides, « Modifier », thèmes clair et sombre, largeur mobile | navigateur sans affichage (playwright-core + Chrome, écritures interceptées) |
| T8 | Non-régression : build Vite, Auto/MRH/RC/MRP inchangés (fichiers non modifiés) | `npm run build`, `git diff --stat` |

---

# Annexe — Rapport final d'intégration (01/10/2026)

## A. Rapport d'audit

Sections 1 à 20 ci-dessus (état **avant** modification).

## B. Fichiers modifiés

| Fichier | Modification | Pourquoi | Impact |
|---|---|---|---|
| `sante/views_devis_sante.py` (nouveau) | Routes LE PHARE de saisie Santé : initialisation, filiale, adhérent, affilié, suppression, enregistrement, lecture complète d'un devis | Les routes d'écriture d'URANUS exigent un jeton Knox réel (401 depuis l'écran) ; booléens multipart mal lus ; aucune lecture complète pour « Modifier » | Santé seulement ; appelle les fonctions URANUS de `sante/utils.py` (aucune procédure modifiée) |
| `sante/urls.py` | 7 routes `devissante/…` ajoutées | idem | routes URANUS inchangées |
| `sante/utils.py` | `message_erreur_base` : message réel de la base au lieu de « Got exception: » | refus de la base illisibles (I-10) | messages d'erreur Santé (routes URANUS comprises) |
| `frontend/src/api/endpoints.js` | `santeApi` (référentiels, saisie, enregistrement, lecture) | nouvelle page Santé | aucun autre module |
| `frontend/src/pages/user/quotes/NewSanteQuotePage.jsx` | Réécriture : parcours URANUS en 3 étapes, référentiels de la base, adhérents/affiliés, import Excel, primes, « Modifier », lecture seule si la saisie appartient à un autre opérateur | maquette sans enregistrement, valeurs inventées (I-8, I-9) | page Santé uniquement |
| `frontend/src/pages/user/quotes/NewIaQuotePage.jsx` | Champs primes imposées, import Excel, téléphone, détail des garanties ; profession sans doublon ; prénoms d'ayant droit obligatoires ; confirmation sans faux succès ; couleurs du thème ; **fragment JSX refermé** | fonctions sans interface (§16) ; le fichier du commit `fb95664` **ne compilait pas** (fragment `{!creationMinene && (<>` jamais refermé, ce qui bloque toute l'application) | page IA uniquement |
| `frontend/src/pages/user/quotes/ViewQuoteModal.jsx` | Détail réel des devis IA (assurés) et Santé (offre, formule, type, gestionnaire, couvertures, affiliés) | champs fictifs vides (I-8) | les autres branches gardent leur affichage |
| `frontend/src/pages/user/quotes/QuoteListPage.jsx` | « Modifier » d'un devis Santé ouvre `/user/quotes/sante?edit=` | C-S3 | registre : branche Santé seulement |
| `AUDIT_URANUS_IA_SANTE_LE_PHARE.md` (nouveau) | ce rapport | demandé | — |

## C. Migrations

Aucune : aucune table ni procédure modifiée. Les tables Santé (`stdfiliale`, `stdadherent`, `stdaffilie`, `stdcomplementdevisdetailsante`, `stdnumerosaisiesante`) et IA existaient déjà.

## D. API / routes

| Route | Méthode | Rôle |
|---|---|---|
| `/api/devissante/initialisation/` | POST | `sp_initialisation_devis_sante` (devis de saisie) |
| `/api/devissante/filiale/` | POST | `sp_saisie_filiale_sante` (« Enregistrer le collège ») |
| `/api/devissante/adherent/` | POST multipart | `sp_saisie_adherent_sante` (+ pièce) |
| `/api/devissante/affilie/` | POST multipart | `sp_saisie_affilie_sante` (+ pièce) |
| `/api/devissante/suppression/` | POST | retrait d'une filiale, d'un adhérent ou d'un affilié (règles d'URANUS) |
| `/api/devissante/enregistrement/` | POST | `sp_creation_devis_sante` + terme du contrat |
| `/api/devissante/<iddevis>/` | GET | saisie complète d'un devis (Modifier, aperçu) |

Routes existantes réutilisées sans changement : `tarifparproduit/5`, `typecontratsante/`, `offresantepartarif/<tarif>`, `collegesanteparoffre/<offre>`, `zonecouverturesante/`, `lienjuridiquesante/`, `importationaffilie/`, `calculrepartitionprimesante/`, `confirmationdevis`, et toutes les routes IA.

## E. Composants UI modifiés

`NewSanteQuotePage` (réécrit), `NewIaQuotePage`, `ViewQuoteModal`, `QuoteListPage` (table de routage). Composants communs réutilisés sans modification : `TermeContratSelect`, `DureeContratSelect`, `AmountInput`, `QuickAddClientModal`.

## F. Fonctionnalités IA intégrées

1. Primes imposées des catégories à tarif personnalisé (74/75) : prime nette, accessoire, taxe et TTC affichées comme la base les enregistre.
2. Import Excel d'une liste d'assurés (catégories groupe), 3 formats d'URANUS.
3. Téléphone de l'assuré (fiche du nouvel assuré).
4. Détail des garanties de chaque assuré au récapitulatif (Garantie, Acquise, Capital, P. annuelle, P. nette, Taxe).
5. Aperçu du devis : liste réelle des assurés et de leurs capitaux.
6. Confirmation devis → contrat sans faux succès.

## G. Fonctionnalités Santé intégrées

1. Production réelle en 3 étapes (Contrat, Couvertures souscrites, Affiliation & primes) avec les listes de la base (type de contrat, offre commerciale, formule, collège, zone, lien, groupe sanguin, sexe) et le gestionnaire VITALIS SANTE.
2. Ajustement réduction / majoration (taux signé comme URANUS).
3. Couvertures (filiales) : création, liste, retrait.
4. Adhérents et affiliés : création, modification, retrait, pièce jointe (CNI / extrait de naissance), CMU, matricule, groupe sanguin, pathologies, surprime, pathologie antérieure, certificat, dates d'effet et de début de consommation.
5. Import Excel des adhérents et affiliés.
6. Primes par famille / par affilié / globale (une seule), surprime affection, accessoire manuel ; calcul MINENE automatique ; montants et garanties enregistrés affichés.
7. Répartition de la prime MINENE (NSIA / OREOLE / VITALIS / ADEC) conservée, limitée aux catégories MINENE.
8. « Modifier » depuis le registre ; lecture seule quand la saisie appartient à un autre opérateur.
9. Aperçu du devis et confirmation en contrat (`sp_confirmation_devis`), sans repli local.

## H. Incohérences corrigées

I-2 (surprime de l'adhérent), I-8 (valeurs inventées Santé), I-9 (faux succès IA et Santé), I-10 (routes d'écriture Santé et messages d'erreur), I-11 (« AUTRE » en double), I-12 (prénoms d'ayant droit), I-4 en partie (MINENE reconnu par le code catégorie 123, donc aussi pour la catégorie 153), et la page IA qui ne compilait plus.

## I. Éléments volontairement non modifiés

- Règles tarifaires et procédures (I-1 tarif NSIA, I-3 réduction Santé hors MINENE, I-4 contrôles MINENE 80 %-80 %, I-5 classe 05, I-6 âge et prorata) : validation métier requise.
- Valeurs par défaut divergentes (I-13), « Gaucher(e)/Droitier(e) » (I-14), rattachement des ayants droit à l'assuré (I-7).
- Évolutions LE PHARE conservées : date d'émission du jour, terme du contrat, durée « Libre » (ex-« Divers ») via le terme « Autre », tri alphabétique des listes.
- Mouvements de police IA et Santé (procédures `sp_avenant_*` manquantes en base) ; impressions Santé et CP IA MINENE.
- Débordement horizontal à 390 px : il vient de la barre de navigation commune (sélecteur d'utilisateur), sur toutes les pages ; composant global non modifié.
- Réattribution d'une saisie Santé d'un opérateur URANUS à l'utilisateur LE PHARE (modification de données, à décider).

## J. Tests effectués

| Test | Résultat |
|---|---|
| T1 Santé serveur (transaction annulée) : initialisation, filiale, doublon de filiale refusé, adhérent avec surprime, affiliés, enfant de 31 ans refusé, deux primes refusées, devis SANTE CLASSIQUE (PN 310 000, TTC 349 920), MINENE SOLO 64 ans 2 pathologies (349 148 + 209 489 + 104 744 = 663 381), taille de famille SOLO refusée, retrait d'affilié | conforme aux procédures |
| T4 IA serveur : catégorie 74, PN 20 000 + accessoire 2 000 | taxe 3 190, TTC 25 190, identiques à l'écran |
| T5 IA serveur : import de `IA ATM INFORMATIQUE 2026.xlsx` (offre 154) + finalisation | 16 assurés, 29 ayants droit, PN 67 840, TTC 96 000, identiques au fichier OREOLE |
| T7 écran Santé (Chrome sans affichage, thèmes sombre et clair) : listes, collège, client, adhérent, refus de la base affiché, conjointe, désactivation des autres primes, corps d'enregistrement | conforme ; enregistrement final intercepté ; les 2 saisies de test ont été supprimées de la base |
| T7 écran IA : « AUTRE » unique, primes imposées, prénoms obligatoires, garanties, panneau d'import, réouverture du devis groupe 25046 (39 assurés), lecture seule du devis Santé 25265 | conforme |
| Aperçu IA (25046) et Santé (25265), confirmation refusée simulée | données réelles affichées ; message d'échec, pas de contrat local |
| T8 compilation Vite | réussie |
| T3 / T6 confirmation réelle en transaction annulée | **non exécutés** : chaque essai consomme des numéros de quittance (séquences). Chemin serveur inchangé, vérifié le 28/09/2026 sur les 10 produits ; copie du complément Santé et des colonnes IA vérifiée à la lecture de `sp_confirmation_devis` |

## K. Points nécessitant une validation métier

1. Tarif IA : barème URANUS ou tarif NSIA fourni (I-1) ; clause d'âge NSIA (60/65 ans).
2. Réduction Santé hors MINENE sans effet sur les primes (I-3) : comportement voulu ?
3. Contrôles d'âge et de taille de famille pour les offres MINENE 80 %-80 % (I-4).
4. Frais de traitement de la classe 05 (I-5).
5. Saisies Santé ouvertes dans URANUS par d'autres opérateurs : LE PHARE doit-il pouvoir les reprendre (réattribution de l'opérateur) ?
6. Valeurs par défaut (compagnie IA, qualité d'ayant droit), champ « Gaucher(e)/Droitier(e) ».
7. Taux de répartition MINENE (12,5 % / 4,5 % ou 13,5 % / 3,5 %).
8. Mouvements de police IA et Santé, impressions Santé : à planifier.

## L. Tarif IA NSIA (décision du 01/10/2026 : « prendre tarif NSIA », point I-1)

**Préparé, à appliquer** : migration `production/migrations/0144_tarif_ia_nsia.py` (`python manage.py migrate production`), réversible par `python manage.py migrate production 0143`. Elle n'a pas pu être exécutée depuis la session (modification de la base partagée refusée par le mode automatique) : ni appliquée, ni testée sur la base.

| Élément | Avant (barème URANUS) | Après (tarif NSIA, compagnie 1) | Source |
|---|---|---|---|
| Taux décès par classe 01 à 05 | 1,0 / 1,3 / 1,7 / 2,5 / 4,1 ‰ | 0,85 / 1,15 / 1,3 / 1,8 / 3 ‰ | `TARIF IA_NSIA CI.xlsx`, feuille « classe d'activités » |
| Taux invalidité | taux décès de la classe | taux décès NSIA de la classe | non fourni par NSIA (colonne « … ») : règle URANUS conservée (**à valider**) |
| Frais de traitement | forfaits par tranche de capital (0 au-delà de 1 M, 0 en classe 05) | 1,5 / 2,5 / 3 / 4 / 5 % du capital | idem, colonne « FM (%) » |
| Majoration d'âge | × 1,3 de 50 à 65 ans, × 1,4 de 66 à 70 ans, prime nulle hors 12–70 ans | aucune | le tarif NSIA n'en prévoit pas |
| Clause d'âge, plafond d'indemnité | — | avertissement à l'écran : plus de 60 ans à la date d'effet (sauf dérogation), capital décès ou invalidité > 200 M | feuille « Clauses » |
| Accessoires | grille Auto (≤ 100 000 → 6 000, ≤ 500 000 → 9 000…) | ≤ 25 000 → 3 000, ≤ 100 000 → 6 000, ≤ 500 000 → 10 000, ≤ 1 M → 20 000, ≤ 2 M → 25 000, ≤ 3 M → 30 000, ≤ 5 M → 50 000, au-delà 0,5 % + 50 000 ; moitié compagnie / moitié courtier | colonne « Accessoires » |
| Taxe | 14,5 % | 14,5 % (inchangée) | colonne « Taxes » |
| ITT / indemnité journalière | non tarifée | non tarifée | aucune offre IA NSIA ne porte la garantie 18 et l'unité du taux « IND JOURN » n'est pas donnée (**à valider**) |

Périmètre : offres au barème de NSIA (particulier 6, groupe 7, base de répartition des primes imposées 173/174). Inchangés : AMSA et SUNU (barème URANUS, aucun tarif reçu), MINENE 66 (prime 14 524 et accessoire 6 000 du document MINENE), CGA 154–156 et CI-ENERGIES 162–170 (forfaits), devis déjà enregistrés (leurs primes ne changent que si une ligne est recalculée par « Modifier »).

Cas types (effet 01/10/2026, un an, sans réduction) — « avant » relevé en base, « après » calculé selon les formules de la migration :

| Cas | Avant : PN / acc. / taxe / TTC | Après : PN / acc. / taxe / TTC |
|---|---|---|
| Classe 01, 30 ans, 5 M / 5 M / 250 000 | 16 000 / 6 000 / 3 190 / 25 190 | 12 250 / 3 000 / 2 211 / 17 461 |
| Classe 01, 55 ans, mêmes capitaux | 20 800 / 6 000 / 3 887 / 30 687 | 12 250 / 3 000 / 2 211 / 17 461 |
| Classe 03, 40 ans, 2 M / 2 M / 100 000 | 15 300 / 6 000 / 3 089 / 24 389 | 8 200 / 3 000 / 1 624 / 12 824 |
| Classe 05, 40 ans, 10 M / 10 M / 1,5 M | 82 000 / 6 000 / 12 760 / 100 760 | 135 000 / 10 000 / 21 025 / 166 025 |
| Groupe, classe 02, 35 ans, 2 M / 2 M | 5 200 par assuré | 4 600 par assuré (accessoire calculé sur la prime totale du groupe) |
| AMSA, MINENE, CGA | 18 320 / 23 499 / 5 999 | inchangés |

Fichiers : `production/sql/functions/fn_calcul_prime_ia_nsia/v1.sql`, `fn_get_accessoire_ia_nsia/v1.sql`, `fn_get_accessoire/v3.sql`, `fn_garantie_offre_ia/v1.sql` (état actuel, pour le retour arrière) et `v2.sql` ; avertissements dans `NewIaQuotePage.jsx`.

Après application, à vérifier : le calcul à l'écran (étape 3 d'un devis IA NSIA) doit redonner les montants « après » ci-dessus.
