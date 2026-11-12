# LEPHARE — guide pour Claude Code

## Projet

LEPHARE est une application de gestion de courtage et de souscription d'assurances.
Le dépôt contient principalement :

- `production/` et les autres applications Python/Django : API, modèles, règles métier et migrations.
- `frontend/` : interface React avec Vite ; les appels API sont centralisés dans `frontend/src/api/`.
- `sante/`, `autorisations/` et les autres répertoires Python : domaines métier spécialisés.
- `production/sql/` : fonctions et procédures PostgreSQL utilisées par l'application.

Les dates de contrat, primes et avenants peuvent être utilisées par plusieurs documents et
parcours. Suivre leurs sources de données et préserver la cohérence entre l'interface, l'API
et les documents imprimés.

## Règles de travail

- Répondre en français, sauf demande contraire.
- Avant toute modification, vérifier `git status` et lire le contexte des fichiers concernés.
  Ne jamais écraser ni annuler les changements déjà présents dans l'arbre de travail.
- Faire des modifications ciblées, respecter les conventions existantes et mettre à jour la
  documentation directement concernée.
- Pour une tâche indépendante en parallèle, utiliser une branche ou un worktree distinct.
  Ne pas faire travailler plusieurs agents sur les mêmes fichiers sans coordination.
- Ne jamais afficher, copier ou envoyer des secrets, données clients ou contenu de `.env`.
- Traiter les migrations et scripts SQL comme des opérations de base de données : ne pas les
  appliquer et ne pas exécuter de requête modificatrice sans confirmation explicite. Vérifier
  que tout test utilise une base de test, jamais une base partagée ou de production.
- N'ajouter/configurer un serveur MCP qu'après avoir confirmé le service nécessaire et les
  accès requis. Préférer le moindre privilège ; ne pas connecter une base de production.

## Vérifications

- Frontend : depuis `frontend/`, `npm run build`.
- Backend : utiliser `python manage.py test <module_de_test_ciblé>` pour les tests Django
  concernés, en vérifiant d'abord la configuration de la base utilisée.
- Lancer les vérifications les plus ciblées adaptées aux fichiers modifiés et signaler
  clairement celles qui n'ont pas pu être exécutées.
