# Cahier des charges fonctionnel
## Application de gestion du cabinet de courtage LE PHARE

**Document de présentation et de cadrage — à valider avec le client**  
**Date : 1er novembre 2026**

> Ce document décrit les fonctions repérées dans l’application. Il est rédigé pour les utilisateurs métier, sans vocabulaire technique. La présence d’un écran ne suffit pas à confirmer qu’un service externe est activé ou que toutes les règles sont déjà validées : les points concernés sont signalés dans la dernière partie.

## 1. Présentation de l’application

LE PHARE est une application destinée à rassembler les principales activités d’un cabinet de courtage en assurance. Elle accompagne les équipes depuis le suivi d’un prospect et la préparation d’un devis jusqu’à la gestion du contrat, de son règlement et, le cas échéant, d’un sinistre.

Elle permet également à la direction de suivre l’activité du cabinet, de gérer les accès des collaborateurs et de préparer différents états de gestion et de conformité.

L’application s’adresse principalement aux agents commerciaux, aux gestionnaires, aux équipes de caisse et de suivi des contrats, ainsi qu’aux responsables et administrateurs. Les écrans accessibles dépendent du rôle attribué à chaque personne.

## 2. Objectifs

- Regrouper les informations utiles sur les prospects, clients, devis et contrats.
- Mieux suivre les démarches commerciales, les relances et les renouvellements.
- Faciliter la préparation et le suivi des opérations d’assurance.
- Suivre les règlements des clients, les chèques et les sommes à reverser aux compagnies.
- Conserver les pièces liées aux dossiers et retrouver les dossiers archivés.
- Donner à la direction des indicateurs de suivi et des outils de contrôle.
- Limiter l’accès aux informations et opérations selon les responsabilités de chacun.

## 3. Utilisateurs et responsabilités

| Profil d’utilisation | Besoins principaux |
|---|---|
| Agent commercial | Enregistrer un prospect, suivre les échanges, préparer des devis et effectuer les relances. |
| Gestionnaire | Suivre les clients, les contrats, les pièces, les modifications et les dossiers de sinistre. |
| Personnel de caisse | Enregistrer les règlements, éditer les reçus et suivre les chèques. |
| Direction | Consulter les tableaux de bord, traiter les validations et suivre les résultats et la conformité. |
| Administrateur | Gérer les comptes, les rôles, les droits et les paramètres de l’application. |

Un même collaborateur peut recevoir plusieurs responsabilités. Les droits précis sont attribués par l’administration du cabinet.

## 4. Fonctions de l’application

### 4.1 Accueil et suivi de l’activité

Des tableaux de bord présentent des indicateurs de l’activité, notamment les devis en cours, les contrats, les encaissements et certains dossiers à suivre. Des alertes peuvent attirer l’attention sur des échéances ou des opérations nécessitant un suivi.

Les informations affichées dépendent des droits de l’utilisateur et des données disponibles dans le cabinet.

### 4.2 Prospects et suivi commercial

Le suivi commercial permet de :

- créer et mettre à jour un dossier de prospect ;
- visualiser les affaires par étape commerciale ;
- suivre les relances prévues et repérer celles qui sont en retard ;
- consulter l’activité commerciale et l’avancement des affaires ;
- associer des questionnaires à un prospect, les télécharger ou classer les questionnaires reçus ;
- accéder à la préparation d’un devis depuis le dossier concerné.

Cette fonction aide les équipes à ne pas perdre de vue les demandes en attente et les suites à donner.

### 4.3 Clients

Le fichier clients permet de rechercher et consulter les clients, de créer ou compléter leurs informations et d’accéder à une vue regroupant les éléments de leur dossier. Cette vue peut notamment réunir les devis, contrats, sinistres et paiements liés au client.

### 4.4 Devis et produits d’assurance

Les écrans de saisie recensés couvrent plusieurs familles de produits, selon le catalogue et les réglages du cabinet :

- automobile et flotte de véhicules ;
- multirisque habitation ;
- assurance santé ;
- individuelle accidents ;
- responsabilité civile et autres risques divers ;
- multirisque professionnelle et dommages ;
- voyage ;
- transport, y compris des parcours associés au GUCE, hors GUCE et aux abonnements de transport.

La préparation d’un devis consiste à renseigner le client et les éléments du risque à assurer, choisir les garanties ou la formule proposées, puis enregistrer les informations utiles à l’étude et au suivi. Les règles de calcul, les tarifs, les taxes et les garanties dépendent des paramètres disponibles pour chaque produit et compagnie.

Les devis peuvent être consultés et suivis dans un registre. Des écrans prévoient également l’enregistrement de saisies en cours, la reprise de dossiers et la transformation d’un devis confirmé en contrat.

### 4.5 Contrats et vie du contrat

Le portefeuille permet de rechercher et consulter les contrats, leur situation et les informations associées. Les opérations prévues dans les écrans comprennent notamment :

- le suivi des contrats et de leurs échéances ;
- la préparation d’un renouvellement ;
- les modifications de contrat (avenants et autres mouvements) ;
- la gestion de certains mouvements de véhicules ou de personnes couverts ;
- la consultation de documents et d’informations de règlement liés au contrat.

Certaines modifications exceptionnelles sont réservées à des personnes habilitées et peuvent nécessiter un motif.

### 4.6 Encaissements, chèques et reversements

Les fonctions de caisse permettent de suivre les règlements de primes, d’enregistrer les encaissements et d’éditer un reçu. Des états peuvent être consultés ou exportés, notamment au format PDF ou Excel selon l’écran.

La gestion des chèques comprend le suivi des chèques reçus, de leurs échéances et des situations d’impayé. L’espace de direction comporte également un suivi des reversements aux compagnies et des commissions.

Les écrans rappellent une règle importante de gestion : le paiement effectif de la prime conditionne la prise d’effet des garanties et certaines délivrances d’attestations. Les modalités applicables doivent être confirmées avec le cabinet et les compagnies.

### 4.7 Sinistres

Le module de suivi des sinistres permet de consulter des dossiers, de suivre leur instruction et de conserver des informations et pièces justificatives. Les écrans prévoient aussi des indicateurs de suivi et des actions de gestion selon le dossier.

Le détail du circuit de traitement, les personnes responsables à chaque étape et les échanges avec les compagnies doivent être précisés avec le client.

### 4.8 Documents et archives

La gestion documentaire permet de classer et retrouver des pièces rattachées aux clients ou aux contrats. Un espace d’archives regroupe différents éléments archivés, notamment des devis, contrats, clients ou sinistres.

Les règles de conservation, la durée d’archivage, les personnes autorisées à consulter les documents et les modalités de récupération en cas de perte doivent être validées par le cabinet.

### 4.9 Espace de direction et administration

Les responsables disposent de fonctions de pilotage et de contrôle, notamment :

- des tableaux de bord et états de gestion sur les émissions, encaissements et commissions ;
- des états réglementaires CIMA et des bordereaux prévus dans l’application ;
- le suivi des approbations ou demandes de dérogation ;
- la gestion des conventions et des plafonds de délégation ;
- le suivi de la conformité et la consultation du journal des opérations ;
- la gestion des utilisateurs, des profils et des autorisations ;
- le paramétrage du cabinet, des compagnies, produits, tarifs, garanties, taxes et commissions.

Ces réglages influencent les informations proposées aux équipes et certains calculs. Ils doivent être confiés à des personnes autorisées.

### 4.10 Attestations et échanges avec l’ASACI

Un espace est consacré aux attestations digitales et au suivi des demandes associées à l’ASACI. Il prévoit notamment la consultation de statuts et de retours, ainsi que l’utilisation d’attestations avec code de vérification ou QR code.

La disponibilité réelle de ces échanges dépend de la connexion au service externe, des accès fournis et de la configuration en place. Elle doit être vérifiée avant de considérer cette fonction comme opérationnelle.

## 5. Parcours type d’un dossier

1. **Enregistrer le prospect** et noter la demande ainsi que la prochaine relance.
2. **Compléter ses informations** et, si nécessaire, lui transmettre ou recevoir un questionnaire.
3. **Préparer le devis** correspondant au besoin et aux informations recueillies.
4. **Suivre la réponse** du prospect et mettre à jour l’avancement commercial.
5. **Confirmer l’affaire** et établir le contrat lorsque le client accepte la proposition.
6. **Suivre le paiement**, les pièces du dossier et les échéances du contrat.
7. **Gérer la suite du contrat** : renouvellement, modification, attestation ou sinistre selon la situation.
8. **Consulter les états et archiver le dossier** selon les règles du cabinet.

Les étapes exactes peuvent varier selon le produit, la compagnie et les délégations accordées au cabinet.

## 6. Principes d’accès et de traçabilité

- L’accès à l’application se fait au moyen d’un compte utilisateur.
- Les droits sont attribués selon le rôle et peuvent limiter les écrans ou opérations accessibles.
- Certaines opérations de gestion ou d’administration sont réservées aux personnes habilitées.
- Un journal permet de retracer certaines actions réalisées dans l’application.
- Les documents et données sont associés aux dossiers auxquels ils se rapportent.

Ces principes ne remplacent pas la validation des règles internes de confidentialité, de sauvegarde et de sécurité du cabinet.

## 7. Éléments à confirmer avant validation définitive

Les points suivants ne peuvent pas être établis uniquement par l’examen des écrans. Ils sont à valider avec le client :

1. **Produits et compagnies** : liste définitive des produits commercialisés, garanties, tarifs et compagnies actives.
2. **Règles de gestion** : circuits de validation, délégations, calculs, taxes, commissions, échéances et règles de renouvellement.
3. **Règlement et comptabilité** : moyens de paiement acceptés, rapprochement bancaire et besoin éventuel de liaison avec un logiciel comptable.
4. **Services externes** : état de fonctionnement des échanges avec l’ASACI, le GUCE et les compagnies, ainsi que leur périmètre exact.
5. **Documents** : modèles officiels souhaités, personnes habilitées à les émettre et règles de conservation.
6. **Données existantes** : reprise éventuelle des fichiers clients, contrats, devis et historiques depuis les outils actuels.
7. **Organisation des équipes** : agences, profils, responsabilités, validations et droits à attribuer.
8. **Conditions d’exploitation** : modalités d’accès, assistance, sauvegardes, disponibilité attendue et procédure en cas d’incident.
9. **Périmètre utilisateur** : confirmer si les clients doivent eux-mêmes accéder à un espace en ligne ou si l’application est réservée aux collaborateurs.
10. **Recette métier** : désigner les utilisateurs qui vérifieront les parcours et les documents avant la mise en service ou la réception du projet.

## 8. Critères de validation proposés

Le client pourra valider le périmètre fonctionnel lorsque des utilisateurs représentatifs auront pu vérifier, avec des données de test :

- la création et la recherche d’un prospect ou client ;
- la préparation et le suivi d’un devis pour chaque produit retenu ;
- la transformation d’un devis accepté en contrat ;
- la consultation d’un contrat et le traitement des opérations prévues ;
- l’enregistrement d’un règlement et l’édition du reçu correspondant ;
- le suivi d’un sinistre et le rattachement de ses pièces ;
- l’accès aux tableaux de bord et états convenus ;
- les droits propres à chaque profil ;
- la disponibilité des intégrations externes déclarées comme nécessaires.

Les résultats attendus, documents de référence, règles de calcul et données de test doivent être convenus avant cette vérification.

## 9. Conclusion

LE PHARE vise à fournir aux équipes du cabinet un espace commun pour suivre la relation commerciale, les devis, les contrats, les règlements, les sinistres et les activités de direction. Ce cahier des charges constitue une base de compréhension fonctionnelle. Il doit être complété et validé par le client, en particulier pour les règles métier, les intégrations externes et les conditions d’exploitation.
