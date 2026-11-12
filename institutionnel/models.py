from django.db import models


class CrmLead(models.Model):
    """Prospect et opportunité commerciale dans le pipeline de vente"""
    # Étapes du suivi commercial, dans l'ordre du pipeline
    STATUTS = ("Nouveau", "Qualifié", "Proposition", "Négociation", "Gagné", "Perdu")

    id_lead = models.CharField(max_length=50, unique=True, verbose_name="ID Prospect")
    nom_prospect = models.CharField(max_length=150, verbose_name="Nom du Prospect / Entreprise")
    contact = models.CharField(max_length=150, verbose_name="Contact / Interlocuteur", blank=True, default="")
    telephone = models.CharField(max_length=50, verbose_name="Téléphone", blank=True, default="")
    email = models.EmailField(verbose_name="Email", blank=True, default="")
    branche = models.CharField(max_length=60, default="Automobile", verbose_name="Branche d'assurance")
    prime_estimee = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name="Prime estimée (FCFA)")
    statut = models.CharField(
        max_length=40,
        default="Nouveau",
        verbose_name="Étape Kanban",
        help_text="Nouveau, Qualifié, Proposition, Négociation, Gagné, Perdu"
    )
    commercial_attribue = models.CharField(max_length=100, default="Koffi Serge", verbose_name="Commercial affecté")
    prochaine_action = models.TextField(blank=True, default="", verbose_name="Prochaine action requise")
    date_action = models.DateField(null=True, blank=True, verbose_name="Date d'échéance action")
    historique_echanges = models.JSONField(default=list, blank=True, verbose_name="Historique des échanges")
    date_creation = models.DateTimeField(auto_now_add=True)
    date_maj = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Prospect CRM"
        verbose_name_plural = "Prospects CRM"
        ordering = ["-date_creation"]

    def __str__(self):
        return f"{self.id_lead} - {self.nom_prospect} ({self.statut})"


class CrmInteraction(models.Model):
    """Interaction client ou prospect (compte-rendu, note, appel, email)"""
    lead = models.ForeignKey(CrmLead, null=True, blank=True, on_delete=models.CASCADE, related_name="interactions")
    client_id = models.IntegerField(null=True, blank=True, verbose_name="ID Client")
    client_nom = models.CharField(max_length=150, null=True, blank=True, verbose_name="Nom Client")
    type_interaction = models.CharField(max_length=50, default="Appel", verbose_name="Type (Appel, Email, RDV, Relance)")
    auteur = models.CharField(max_length=100, default="Conseiller Commercial", verbose_name="Auteur")
    resume = models.TextField(verbose_name="Compte rendu / Résumé")
    date_interaction = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Interaction CRM"
        verbose_name_plural = "Interactions CRM"
        ordering = ["-date_interaction"]

    def __str__(self):
        return f"{self.type_interaction} - {self.client_nom or (self.lead.nom_prospect if self.lead else 'Inconnu')}"


class QuestionnaireProspect(models.Model):
    """Questionnaire rempli par le client et déposé dans le suivi commercial (modèles : institutionnel/questionnaires.py).
    Le dépôt fait avancer le prospect ; l'étude du questionnaire mène au devis."""

    modele = models.CharField(max_length=60, verbose_name="Modèle de questionnaire")
    titre = models.CharField(max_length=200, verbose_name="Titre du questionnaire")
    branche = models.CharField(max_length=60, verbose_name="Branche")
    # Prospect gardé par son nom si la fiche du suivi commercial est supprimée : le document reste consultable
    lead = models.ForeignKey(CrmLead, null=True, blank=True, on_delete=models.SET_NULL, related_name="questionnaires",
                             verbose_name="Prospect")
    prospect_nom = models.CharField(max_length=150, verbose_name="Prospect ou client")
    fichier = models.FileField(upload_to="questionnaires/%Y/%m/", verbose_name="Questionnaire rempli")
    nom_original = models.CharField(max_length=255, verbose_name="Nom du fichier reçu")
    taille = models.PositiveIntegerField(default=0, verbose_name="Taille (octets)")
    version = models.PositiveSmallIntegerField(default=1, verbose_name="Version déposée")
    statut = models.CharField(max_length=20, default="Reçu", verbose_name="Étape (Reçu, En étude, À compléter, Devis établi)")
    note = models.TextField(blank=True, default="", verbose_name="Note")
    depose_par = models.ForeignKey("account.UranusUser", null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="+", verbose_name="Déposé par")
    depose_par_nom = models.CharField(max_length=150, blank=True, default="", verbose_name="Déposé par (nom)")
    historique = models.JSONField(default=list, blank=True, verbose_name="Historique")
    date_depot = models.DateTimeField(auto_now_add=True, verbose_name="Date de dépôt")
    date_maj = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "lephare_questionnaire_prospect"
        verbose_name = "Questionnaire prospect"
        verbose_name_plural = "Questionnaires prospects"
        ordering = ["-date_depot"]
        indexes = [models.Index(fields=["statut", "date_depot"], name="questionnaire_statut_idx")]

    def __str__(self):
        return f"{self.titre} - {self.prospect_nom} ({self.statut})"


class SinistreDelegue(models.Model):
    """Dossier de sinistre géré sous mandat de gestion déléguée CIMA"""
    numero_sinistre = models.CharField(max_length=50, unique=True, verbose_name="N° Dossier Sinistre")
    police_num = models.CharField(max_length=60, verbose_name="N° Police d'assurance")
    assure_nom = models.CharField(max_length=150, verbose_name="Nom de l'assuré")
    compagnie = models.CharField(max_length=100, verbose_name="Compagnie porteuse")
    nature = models.CharField(max_length=150, verbose_name="Nature de l'événement")
    date_survenance = models.DateField(verbose_name="Date de survenance")
    date_declaration = models.DateField(verbose_name="Date de déclaration")
    lieu = models.CharField(max_length=150, verbose_name="Lieu du sinistre", blank=True, default="")
    montant_reclame = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name="Montant réclamé (FCFA)")
    montant_indemnise = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name="Montant indemnisé (FCFA)")
    statut = models.CharField(
        max_length=50,
        default="Déclaré",
        verbose_name="Statut du sinistre",
        help_text="Déclaré, Expertise en cours, En attente validation, Prêt pour règlement, Réglé, Clôturé, Rejeté"
    )
    delegation_respectee = models.BooleanField(
        default=True,
        verbose_name="Gestion sous plafond de délégation autorisée"
    )
    accord_prealable_requis = models.BooleanField(
        default=False,
        verbose_name="Accord préalable de la compagnie requis (dépassement plafond)"
    )
    quittance_subrogative_emise = models.BooleanField(
        default=False,
        verbose_name="Quittance d'indemnité subrogative émise (Art. 54 CIMA)"
    )
    date_limite_instruction_cima = models.DateField(
        null=True,
        blank=True,
        verbose_name="Date limite légale d'offre CIMA (90 jours)"
    )
    expert_assigne = models.CharField(max_length=150, null=True, blank=True, verbose_name="Cabinet d'expertise désigné")
    pieces_justificatives = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Checklist des pièces probantes CIMA"
    )
    recours_info = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Recours subrogatoire adverse"
    )
    historique_evenements = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Journal chronologique du sinistre"
    )
    date_creation = models.DateTimeField(auto_now_add=True)
    date_maj = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Sinistre Délégué"
        verbose_name_plural = "Sinistres Délégués"
        ordering = ["-date_declaration"]

    def __str__(self):
        return f"{self.numero_sinistre} - {self.assure_nom} ({self.statut})"


class ConventionAssureur(models.Model):
    """Convention de partenariat et mandat de gestion déléguée assureur-courtier"""
    code_convention = models.CharField(max_length=50, unique=True, verbose_name="Code Convention")
    compagnie = models.CharField(max_length=100, verbose_name="Compagnie Partenaire")
    code_partenaire = models.CharField(max_length=60, verbose_name="Code Partenaire / Intermédiaire")
    delai_reversement_jours = models.IntegerField(default=30, verbose_name="Délai reversement (jours CIMA)")
    plafond_delegation_sinistre = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=5000000,
        verbose_name="Plafond délégation sinistres (FCFA)"
    )
    encaissement_delegue = models.BooleanField(default=True, verbose_name="Encaissement direct autorisé")
    statut = models.CharField(max_length=30, default="Actif", verbose_name="Statut de la convention")
    date_effet = models.DateField(null=True, blank=True, verbose_name="Date d'effet")
    date_renouvellement = models.DateField(null=True, blank=True, verbose_name="Date de renouvellement")
    commissions_branches = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Barème commissions par branche"
    )
    participation_beneficiaire = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Conditions de participation bénéficiaire"
    )
    date_creation = models.DateTimeField(auto_now_add=True)
    # Compagnie du référentiel (stdcompagnie) : conditions saisies dans Administration > Conventions avec les
    # compagnies (production/views_conventions.py) ; vide pour les anciennes lignes de démonstration, non affichées
    idcompagnie = models.IntegerField(null=True, blank=True, unique=True, db_column="idcompagnie",
                                      verbose_name="Compagnie (référentiel)")
    date_maj = models.DateTimeField(null=True, blank=True, verbose_name="Dernière mise à jour")
    maj_par = models.CharField(max_length=150, blank=True, default="", verbose_name="Mis à jour par")

    class Meta:
        verbose_name = "Convention Assureur"
        verbose_name_plural = "Conventions Assureurs"
        ordering = ["compagnie"]

    def __str__(self):
        return f"Convention {self.compagnie} ({self.code_convention})"


class DocumentGED(models.Model):
    """Document numérique à valeur probante stocké dans la GED LE PHARE"""
    reference = models.CharField(max_length=60, unique=True, verbose_name="N° Référence Document")
    titre = models.CharField(max_length=150, verbose_name="Titre du document")
    categorie = models.CharField(
        max_length=50,
        verbose_name="Catégorie CIMA (Contrat, Quittance, Sinistre, KYC, Avenant, Attestation, Convention)"
    )
    type_mime = models.CharField(max_length=60, default="application/pdf", verbose_name="Type MIME")
    taille = models.CharField(max_length=30, default="1.2 MB", verbose_name="Taille")
    entite_type = models.CharField(max_length=50, blank=True, default="contrat", verbose_name="Type entité rattachée")
    entite_id = models.CharField(max_length=60, blank=True, default="", verbose_name="ID ou N° de l'entité")
    statut_validation = models.CharField(max_length=40, default="Validé", verbose_name="Statut de conformité")
    auteur = models.CharField(max_length=100, default="Direction Technique LE PHARE", verbose_name="Auteur / Opérateur")
    date_upload = models.DateTimeField(auto_now_add=True)
    fichier = models.FileField(upload_to="ged/", null=True, blank=True, verbose_name="Fichier numérique")

    class Meta:
        verbose_name = "Document GED"
        verbose_name_plural = "Documents GED"
        ordering = ["-date_upload"]

    def __str__(self):
        return f"{self.reference} - {self.titre} ({self.categorie})"


class AuditLogCima(models.Model):
    """Journal d'audit réglementaire et traçabilité des opérations de courtage"""
    type_operation = models.CharField(
        max_length=60,
        verbose_name="Type d'opération (ENCAISSEMENT, EMISSION, REVERSEMENT, SINISTRE, DEROGATION)"
    )
    description = models.TextField(verbose_name="Description détaillée de l'opération")
    auteur = models.CharField(max_length=100, verbose_name="Auteur / Opérateur")
    statut_conformite = models.CharField(max_length=30, default="CONFORME", verbose_name="Statut de conformité")
    reference_reglementaire = models.CharField(max_length=100, default="CIMA Art. 13", verbose_name="Règle CIMA")
    details_json = models.JSONField(default=dict, blank=True, verbose_name="Métadonnées d'audit")
    date_creation = models.DateTimeField(auto_now_add=True)
    # Journal d'audit centralisé de LE PHARE (autorisations/journal.py) : qui, quoi, sur quel objet,
    # avec quel résultat, d'où, et les valeurs avant / après. La table est en ajout seul
    # (déclencheur en base : ni modification ni suppression, administrateur compris).
    utilisateur = models.ForeignKey(
        "account.UranusUser", null=True, blank=True, on_delete=models.PROTECT,
        related_name="journal_audit", verbose_name="Utilisateur",
    )
    module = models.CharField(max_length=40, blank=True, default="", verbose_name="Module")
    action = models.CharField(max_length=80, blank=True, default="", verbose_name="Action (droit ou évènement)")
    objet_type = models.CharField(max_length=60, blank=True, default="", verbose_name="Type d'objet")
    objet_id = models.CharField(max_length=80, blank=True, default="", verbose_name="Identifiant de l'objet")
    resultat = models.CharField(max_length=10, blank=True, default="", verbose_name="Résultat (SUCCES, ECHEC, REFUS)")
    adresse_ip = models.GenericIPAddressField(null=True, blank=True, verbose_name="Adresse IP")
    methode = models.CharField(max_length=8, blank=True, default="", verbose_name="Méthode HTTP")
    chemin = models.CharField(max_length=255, blank=True, default="", verbose_name="Route appelée")
    statut_http = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name="Code de réponse")
    valeur_avant = models.JSONField(null=True, blank=True, verbose_name="Valeur avant")
    valeur_apres = models.JSONField(null=True, blank=True, verbose_name="Valeur après")
    motif = models.TextField(blank=True, default="", verbose_name="Motif saisi")

    class Meta:
        indexes = [
            models.Index(fields=["date_creation"], name="audit_date_idx"),
            models.Index(fields=["utilisateur", "date_creation"], name="audit_utilisateur_idx"),
            models.Index(fields=["module", "action"], name="audit_module_action_idx"),
            models.Index(fields=["objet_type", "objet_id"], name="audit_objet_idx"),
        ]
        verbose_name = "Entrée Journal Audit CIMA"
        verbose_name_plural = "Journal Audit CIMA"
        ordering = ["-date_creation"]

    def __str__(self):
        return f"[{self.date_creation.strftime('%d/%m/%Y %H:%M')}] {self.type_operation} - {self.auteur}"


class QuittanceCima(models.Model):
    """Quittance officielle d'encaissement conforme à l'Article 13 du Code CIMA (« Pas de prime, pas d'assurance »)"""
    numero_quittance = models.CharField(max_length=60, unique=True, verbose_name="N° Quittance CIMA")
    police_num = models.CharField(max_length=60, verbose_name="N° Police")
    souscripteur = models.CharField(max_length=150, verbose_name="Souscripteur / Assuré")
    compagnie = models.CharField(max_length=100, verbose_name="Compagnie d'assurance")
    branche = models.CharField(max_length=80, default="Automobile", verbose_name="Branche")
    montant_encaisse = models.DecimalField(max_digits=14, decimal_places=2, verbose_name="Montant encaissé (FCFA)")
    mode_paiement = models.CharField(max_length=50, default="ESPECES", verbose_name="Mode de paiement")
    reference_paiement = models.CharField(max_length=100, blank=True, default="", verbose_name="Réf. Chèque/Virement/Mobile")
    date_encaissement = models.DateTimeField(auto_now_add=True, verbose_name="Date & Heure d'encaissement")
    mention_legale = models.TextField(
        default="Conformément à l'Article 13 du Code des Assurances CIMA (« Pas de prime, pas d'assurance »), la présente quittance atteste du paiement effectif de la prime et confère validité immédiate aux garanties souscrites.",
        verbose_name="Mention légale CIMA"
    )
    emetteur = models.CharField(max_length=100, default="Caisse Centrale LE PHARE", verbose_name="Agent émetteur")

    class Meta:
        verbose_name = "Quittance CIMA"
        verbose_name_plural = "Quittances CIMA"
        ordering = ["-date_encaissement"]

    def __str__(self):
        return f"{self.numero_quittance} - {self.souscripteur} ({self.montant_encaisse:,.0f} FCFA)"


class BordereauReversement(models.Model):
    """Bordereau de reversement des primes à la compagnie d'assurance (Délai légal CIMA 30 jours)"""
    reference = models.CharField(max_length=60, unique=True, verbose_name="Référence Bordereau")
    compagnie = models.CharField(max_length=100, verbose_name="Compagnie Partenaire")
    nombre_polices = models.IntegerField(default=1, verbose_name="Nombre de contrats inclus")
    montant_primes = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name="Total primes recouvrées (FCFA)")
    commissions_deduites = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name="Commissions de courtage déduites")
    net_a_reverser = models.DecimalField(max_digits=14, decimal_places=2, default=0, verbose_name="Montant net à reverser")
    date_generation = models.DateField(auto_now_add=True, verbose_name="Date de génération")
    date_echeance_30j = models.DateField(null=True, blank=True, verbose_name="Date limite légale CIMA (J+30)")
    statut = models.CharField(max_length=40, default="En attente validation", verbose_name="Statut du reversement")
    compte_bancaire_debit = models.CharField(max_length=80, default="SGCI - Compte Primes Séquestre LE PHARE", verbose_name="Compte bancaire")
    ordre_virement_ref = models.CharField(max_length=60, blank=True, default="", verbose_name="Réf. Ordre de Virement")

    class Meta:
        verbose_name = "Bordereau de Reversement CIMA"
        verbose_name_plural = "Bordereaux de Reversement CIMA"
        ordering = ["-date_generation"]

    def __str__(self):
        return f"{self.reference} - {self.compagnie} ({self.net_a_reverser:,.0f} FCFA)"

