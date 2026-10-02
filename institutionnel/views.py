import datetime
from django.db.models import Sum, Count, Q
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from core.views import ResultsOnlyPagination

from .models import (
    CrmLead,
    CrmInteraction,
    SinistreDelegue,
    ConventionAssureur,
    DocumentGED,
    AuditLogCima,
    QuittanceCima,
    BordereauReversement
)
from .serializers import (
    CrmLeadSerializer,
    CrmInteractionSerializer,
    SinistreDelegueSerializer,
    ConventionAssureurSerializer,
    DocumentGEDSerializer,
    AuditLogCimaSerializer,
    QuittanceCimaSerializer,
    BordereauReversementSerializer
)

# Optional import of core Uranus models for 360 view
try:
    from customer.models import Client
except Exception:
    Client = None

try:
    from production.models import Contrat, Devis, Encaissement
except Exception:
    Contrat = None
    Devis = None
    Encaissement = None


# Seed initial demonstration data if tables are empty
def check_and_seed_data():
    try:
        # Les prospects CRM ne sont plus créés d'office : supprimer ses prospects les faisait
        # réapparaître au premier appel de n'importe quelle vue (table vide = démonstration).

        if ConventionAssureur.objects.count() == 0:
            ConventionAssureur.objects.bulk_create([
                ConventionAssureur(
                    code_convention="CNV-2026-001",
                    compagnie="NSIA Assurances Côte d'Ivoire",
                    code_partenaire="NSIA-CRT-048",
                    delai_reversement_jours=30,
                    plafond_delegation_sinistre=5000000,
                    encaissement_delegue=True,
                    statut="Actif",
                    date_effet=datetime.date(2026, 1, 1),
                    date_renouvellement=datetime.date(2026, 12, 31),
                    commissions_branches={"automobile": 12.5, "mrh": 15.0, "sante": 10.0, "rc": 14.0},
                    participation_beneficiaire={"active": True, "taux": "15%", "seuil_sp": "60%"}
                ),
                ConventionAssureur(
                    code_convention="CNV-2026-002",
                    compagnie="SUNU Assurances CI",
                    code_partenaire="SUNU-PART-112",
                    delai_reversement_jours=30,
                    plafond_delegation_sinistre=3500000,
                    encaissement_delegue=True,
                    statut="Actif",
                    date_effet=datetime.date(2026, 1, 1),
                    date_renouvellement=datetime.date(2026, 12, 31),
                    commissions_branches={"automobile": 11.0, "mrh": 14.0, "sante": 12.0, "rc": 12.5},
                    participation_beneficiaire={"active": True, "taux": "12%", "seuil_sp": "65%"}
                ),
                ConventionAssureur(
                    code_convention="CNV-2026-003",
                    compagnie="SANLAM Assurance",
                    code_partenaire="SANLAM-AGY-009",
                    delai_reversement_jours=30,
                    plafond_delegation_sinistre=7000000,
                    encaissement_delegue=True,
                    statut="Actif",
                    date_effet=datetime.date(2026, 1, 1),
                    date_renouvellement=datetime.date(2026, 12, 31),
                    commissions_branches={"automobile": 13.0, "mrh": 16.0, "sante": 11.5, "rc": 15.0},
                    participation_beneficiaire={"active": True, "taux": "18%", "seuil_sp": "55%"}
                ),
                ConventionAssureur(
                    code_convention="CNV-2026-004",
                    compagnie="ALLIANZ Côte d'Ivoire",
                    code_partenaire="ALLIANZ-LEPHARE-01",
                    delai_reversement_jours=30,
                    plafond_delegation_sinistre=5000000,
                    encaissement_delegue=True,
                    statut="Actif",
                    date_effet=datetime.date(2026, 1, 1),
                    date_renouvellement=datetime.date(2026, 12, 31),
                    commissions_branches={"automobile": 12.0, "mrh": 15.0, "sante": 10.0, "rc": 13.5},
                    participation_beneficiaire={"active": False, "taux": "0%", "seuil_sp": "70%"}
                )
            ])

        if SinistreDelegue.objects.count() == 0:
            SinistreDelegue.objects.bulk_create([
                SinistreDelegue(
                    numero_sinistre="SIN-2026-00125",
                    police_num="POL-2026-001",
                    assure_nom="KOUAME Jean-Baptiste",
                    compagnie="NSIA Assurances Côte d'Ivoire",
                    nature="Accident de la circulation - Choc arrière",
                    date_survenance=datetime.date(2026, 8, 28),
                    date_declaration=datetime.date(2026, 8, 30),
                    lieu="Abidjan Boulevard VGE",
                    montant_reclame=1850000,
                    montant_indemnise=1650000,
                    statut="Réglé",
                    delegation_respectee=True,
                    expert_assigne="Cabinet d'Expertise Automobile CI",
                    pieces_justificatives=[
                        {"nom": "Déclaration signée", "recu": True},
                        {"nom": "Constat amiable", "recu": True},
                        {"nom": "Permis de conduire", "recu": True},
                        {"nom": "Devis de réparation", "recu": True},
                        {"nom": "Rapport expertise", "recu": True},
                        {"nom": "Quittance d'indemnité", "recu": True}
                    ],
                    recours_info={"compagnie_adverse": "SUNU Assurances CI", "montant_recours": 1650000, "statut": "Recours encaissé"},
                    historique_evenements=[
                        {"date": "2026-08-30", "action": "Déclaration enregistrée"},
                        {"date": "2026-09-02", "action": "Rapport expertise chiffré à 1 650 000 FCFA"},
                        {"date": "2026-09-04", "action": "Règlement sous mandat de délégation approuvé et viré"}
                    ]
                ),
                SinistreDelegue(
                    numero_sinistre="SIN-2026-00126",
                    police_num="POL-2026-002",
                    assure_nom="SOCIETE IVOIRIENNE DE DISTRIBUTION",
                    compagnie="SANLAM Assurance",
                    nature="Incendie local technique et entrepôt",
                    date_survenance=datetime.date(2026, 9, 1),
                    date_declaration=datetime.date(2026, 9, 2),
                    lieu="Zone Industrielle de Yopougon",
                    montant_reclame=8500000,
                    montant_indemnise=0,
                    statut="En attente validation",
                    delegation_respectee=False,
                    expert_assigne="Bureau Veritas Sinistres CI",
                    pieces_justificatives=[
                        {"nom": "Déclaration signée", "recu": True},
                        {"nom": "Rapport sapeurs-pompiers", "recu": True},
                        {"nom": "Factures matériels endommagés", "recu": True},
                        {"nom": "Rapport contradictoire", "recu": False},
                        {"nom": "Mandat compagnie requis (> 7M)", "recu": False}
                    ],
                    recours_info={"statut": "Sans tiers identifié"},
                    historique_evenements=[
                        {"date": "2026-09-02", "action": "Déclaration reçue"},
                        {"date": "2026-09-03", "action": "Montant supérieur au plafond de délégation (7 000 000 FCFA) : saisine de SANLAM pour mandat spécial"}
                    ]
                ),
                SinistreDelegue(
                    numero_sinistre="SIN-2026-00127",
                    police_num="POL-2026-003",
                    assure_nom="BAMBA Mariam",
                    compagnie="SUNU Assurances CI",
                    nature="Dégât des eaux appartement Cocody",
                    date_survenance=datetime.date(2026, 9, 3),
                    date_declaration=datetime.date(2026, 9, 4),
                    lieu="Cocody Riviera Golf",
                    montant_reclame=850000,
                    montant_indemnise=0,
                    statut="Expertise en cours",
                    delegation_respectee=True,
                    expert_assigne="Cabinet CIMA Expertises",
                    pieces_justificatives=[
                        {"nom": "Déclaration signée", "recu": True},
                        {"nom": "Photos des dommages", "recu": True},
                        {"nom": "Devis plomberie", "recu": True},
                        {"nom": "Rapport expertise", "recu": False}
                    ],
                    recours_info={"compagnie_adverse": "NSIA Assurances CI", "montant_recours": 850000, "statut": "En attente rapport"},
                    historique_evenements=[
                        {"date": "2026-09-04", "action": "Dossier ouvert et expert mandaté sous 24h"}
                    ]
                )
            ])

        if DocumentGED.objects.count() == 0:
            DocumentGED.objects.bulk_create([
                DocumentGED(
                    reference="DOC-2026-001",
                    titre="Police Signée - Flotte Automobile SIFCA",
                    categorie="Contrat",
                    type_mime="application/pdf",
                    taille="2.4 MB",
                    entite_type="contrat",
                    entite_id="POL-2026-001",
                    statut_validation="Validé",
                    auteur="Direction Technique LE PHARE"
                ),
                DocumentGED(
                    reference="DOC-2026-002",
                    titre="Convention Cadre Gestion Déléguée NSIA 2026",
                    categorie="Convention",
                    type_mime="application/pdf",
                    taille="4.1 MB",
                    entite_type="convention",
                    entite_id="CNV-2026-001",
                    statut_validation="Validé",
                    auteur="Direction Générale LE PHARE"
                ),
                DocumentGED(
                    reference="DOC-2026-003",
                    titre="Rapport d'expertise contradictoire SIN-00125",
                    categorie="Sinistre",
                    type_mime="application/pdf",
                    taille="1.8 MB",
                    entite_type="sinistre",
                    entite_id="SIN-2026-00125",
                    statut_validation="Validé",
                    auteur="Cabinet d'Expertise Automobile CI"
                ),
                DocumentGED(
                    reference="DOC-2026-004",
                    titre="Attestation Caution Financière 50M FCFA SGCI",
                    categorie="KYC",
                    type_mime="application/pdf",
                    taille="1.1 MB",
                    entite_type="audit",
                    entite_id="CAUTION-SGCI-2026",
                    statut_validation="Validé",
                    auteur="SGCI Direction Grandes Entreprises"
                )
            ])

        if AuditLogCima.objects.count() == 0:
            AuditLogCima.objects.bulk_create([
                AuditLogCima(
                    type_operation="ENCAISSEMENT",
                    description="Encaissement prime annuelle 450 000 FCFA chèque certifié ECOBANK (Reçu N° REC-2026-001)",
                    auteur="Koffi Serge",
                    statut_conformite="CONFORME",
                    reference_reglementaire="CIMA Art. 13 - Paiement préalable à la délivrance de l'attestation",
                    details_json={"police": "POL-2026-001", "montant": 450000}
                ),
                AuditLogCima(
                    type_operation="REVERSEMENT",
                    description="Ordre de reversement net de commissions vers NSIA sous délai de 22 jours (conforme max 30 jours)",
                    auteur="Direction Financière LE PHARE",
                    statut_conformite="CONFORME",
                    reference_reglementaire="Convention Assureur Art. 7 & CIMA",
                    details_json={"compagnie": "NSIA Assurances", "montant": 12850000}
                ),
                AuditLogCima(
                    type_operation="SINISTRE_REGLEMENT",
                    description="Ordonnancement règlement sinistre SIN-00125 (1 650 000 FCFA) conforme au plafond de délégation (5 000 000 FCFA)",
                    auteur="Amina Diallo",
                    statut_conformite="CONFORME",
                    reference_reglementaire="Mandat de Gestion Déléguée Sinistres",
                    details_json={"sinistre": "SIN-2026-00125", "indemnite": 1650000}
                )
            ])

        if QuittanceCima.objects.count() == 0:
            QuittanceCima.objects.bulk_create([
                QuittanceCima(
                    numero_quittance="QUIT-CIMA-2026-001",
                    police_num="POL-2026-001",
                    souscripteur="KOUAME Jean-Baptiste",
                    compagnie="NSIA Assurances",
                    branche="Automobile",
                    montant_encaisse=450000,
                    mode_paiement="CHEQUE",
                    reference_paiement="CHQ-ECOBANK-998812",
                    emetteur="Caisse Principale LE PHARE"
                ),
                QuittanceCima(
                    numero_quittance="QUIT-CIMA-2026-002",
                    police_num="POL-2026-002",
                    souscripteur="SOCIETE IVOIRIENNE DE DISTRIBUTION",
                    compagnie="SANLAM Assurance",
                    branche="IARD",
                    montant_encaisse=1250000,
                    mode_paiement="VIREMENT",
                    reference_paiement="VIR-SGCI-20260901",
                    emetteur="Caisse Principale LE PHARE"
                )
            ])

        if BordereauReversement.objects.count() == 0:
            BordereauReversement.objects.bulk_create([
                BordereauReversement(
                    reference="REV-NSIA-2026-09",
                    compagnie="NSIA Assurances",
                    nombre_polices=38,
                    montant_primes=14500000,
                    commissions_deduites=1740000,
                    net_a_reverser=12760000,
                    date_echeance_30j=datetime.date.today() + datetime.timedelta(days=12),
                    statut="Validé",
                    ordre_virement_ref="OV-SGCI-2026-0012"
                ),
                BordereauReversement(
                    reference="REV-SUNU-2026-09",
                    compagnie="SUNU Assurances",
                    nombre_polices=24,
                    montant_primes=9800000,
                    commissions_deduites=1176000,
                    net_a_reverser=8624000,
                    date_echeance_30j=datetime.date.today() + datetime.timedelta(days=4),
                    statut="En attente validation",
                    ordre_virement_ref=""
                ),
                BordereauReversement(
                    reference="REV-SANLAM-2026-09",
                    compagnie="SANLAM Assurances",
                    nombre_polices=15,
                    montant_primes=4200000,
                    commissions_deduites=504000,
                    net_a_reverser=3696000,
                    date_echeance_30j=datetime.date.today() + datetime.timedelta(days=18),
                    statut="En attente validation",
                    ordre_virement_ref=""
                )
            ])
    except Exception as e:
        print(f"[Seed Data Error] {e}")


# =========================================================================
# 1. CRM PIPELINE & LEADS
# =========================================================================
class CrmLeadViewSet(viewsets.ModelViewSet):
    """Prospects du suivi commercial : réservés aux utilisateurs connectés (écriture comprise)."""

    queryset = CrmLead.objects.all().order_by("-date_creation")
    serializer_class = CrmLeadSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        # Référence PROSP-<année>-<n° à 3 chiffres> suivant la plus haute de l'année (jamais
        # calculée par l'écran, qui la dupliquait après une suppression)
        prefixe = f"PROSP-{datetime.date.today().year}-"
        numeros = [
            int(ref[len(prefixe):])
            for ref in CrmLead.objects.filter(id_lead__startswith=prefixe).values_list("id_lead", flat=True)
            if ref[len(prefixe):].isdigit()
        ]
        serializer.save(id_lead=f"{prefixe}{(max(numeros) if numeros else 0) + 1:03d}")

    @action(detail=True, methods=["post", "patch"])
    def changer_statut(self, request, pk=None):
        lead = self.get_object()
        nouveau_statut = request.data.get("statut")
        if not nouveau_statut:
            return Response({"error": "Paramètre 'statut' obligatoire"}, status=status.HTTP_400_BAD_REQUEST)
        if nouveau_statut not in CrmLead.STATUTS:
            return Response(
                {"error": f"Étape inconnue : {nouveau_statut} (attendu : {', '.join(CrmLead.STATUTS)})"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ancien_statut = lead.statut
        lead.statut = nouveau_statut
        
        # Ajout automatique à l'historique
        if not isinstance(lead.historique_echanges, list):
            lead.historique_echanges = []
        
        lead.historique_echanges.append({
            "date": datetime.date.today().isoformat(),
            "auteur": request.user.username if request.user and request.user.is_authenticated else "Conseiller Commercial",
            "action": f"Transition d'étape : de '{ancien_statut}' vers '{nouveau_statut}'"
        })
        lead.save()
        return Response(CrmLeadSerializer(lead).data)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        total_leads = CrmLead.objects.count()
        total_valeur = CrmLead.objects.aggregate(total=Sum("prime_estimee"))["total"] or 0
        gagnes = CrmLead.objects.filter(statut="Gagné")
        valeur_gagnee = gagnes.aggregate(total=Sum("prime_estimee"))["total"] or 0
        tx_conversion = round((gagnes.count() / total_leads * 100), 1) if total_leads > 0 else 0

        par_etape = dict(CrmLead.objects.values("statut").annotate(count=Count("id")).values_list("statut", "count"))

        return Response({
            "total_leads": total_leads,
            "total_valeur_pipeline": total_valeur,
            "valeur_gagnee": valeur_gagnee,
            "taux_conversion": tx_conversion,
            "par_etape": par_etape
        })


class CrmInteractionViewSet(viewsets.ModelViewSet):
    queryset = CrmInteraction.objects.all().order_by("-date_interaction")
    serializer_class = CrmInteractionSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]


# =========================================================================
# 2. VUE CONSOLIDÉE CLIENT 360°
# =========================================================================
class Customer360View(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, client_id=None):
        check_and_seed_data()
        client_data = {
            "id": client_id or 1,
            "codeclient": f"CLI-2024-{str(client_id or 1).zfill(3)}",
            "nom": "KOUAME Jean-Baptiste",
            "typeclient": "Particulier",
            "telephone": "+225 07 07 12 34 56",
            "email": "jb.kouame@gmail.com",
            "adresse": "Cocody Deux-Plateaux Vallons",
            "ville": "Abidjan",
            "profession": "Chef d'Entreprise",
            "vip": True,
            "solde": 0,
            "statut": "Actif"
        }

        # Si le modèle Client existe en base
        if Client and client_id:
            try:
                db_client = Client.objects.filter(IdClient=client_id).first()
                if db_client:
                    client_data.update({
                        "id": db_client.IdClient,
                        "nom": f"{db_client.Nom} {db_client.Prenoms or ''}".strip(),
                        "telephone": db_client.Telephone or db_client.Mobile or client_data["telephone"],
                        "email": db_client.Email or client_data["email"],
                        "ville": "Abidjan",
                        "solde": float(db_client.Solde or 0)
                    })
            except Exception:
                pass

        # Récupération des polices et sinistres associés
        sinistres = list(SinistreDelegue.objects.filter(assure_nom__icontains=client_data["nom"][:8]).values())
        if not sinistres:
            sinistres = list(SinistreDelegue.objects.all()[:2].values())

        contrats = [
            {
                "id": 101,
                "numeropolice": "POL-2026-001",
                "produit": "Automobile Tous Risques",
                "compagnie": "NSIA Assurances",
                "date_effet": "2026-01-01",
                "date_echeance": "2026-12-31",
                "prime_totale": 450000,
                "statut": "Actif"
            },
            {
                "id": 102,
                "numeropolice": "POL-2026-003",
                "produit": "Multi-Risques Habitation (MRH)",
                "compagnie": "SUNU Assurances",
                "date_effet": "2026-02-15",
                "date_echeance": "2027-02-14",
                "prime_totale": 280000,
                "statut": "Actif"
            }
        ]

        interactions = list(CrmInteraction.objects.filter(client_id=client_id).values())
        if not interactions:
            interactions = [
                {
                    "date_interaction": "2026-09-02T10:30:00Z",
                    "type_interaction": "Appel",
                    "auteur": "Koffi Serge",
                    "resume": "Point d'étape annuel de renouvellement de la police automobile. Client très satisfait de la réactivité sur le sinistre d'août."
                },
                {
                    "date_interaction": "2026-08-30T14:15:00Z",
                    "type_interaction": "Rendez-vous",
                    "auteur": "Amina Diallo",
                    "resume": "Réception des pièces justificatives originales pour le dossier de sinistre collision."
                }
            ]

        return Response({
            "client": client_data,
            "contrats": contrats,
            "sinistres": sinistres,
            "interactions": interactions,
            "devis_recents": [
                {
                    "id": 201,
                    "numerodevis": "DEV-2026-089",
                    "produit": "Individuelle Accident Famille",
                    "prime_totale": 125000,
                    "statut": "Proposition émise"
                }
            ],
            "statistiques": {
                "total_primes_cumulees": 855000,
                "nombre_contrats_actifs": len(contrats),
                "nombre_sinistres": len(sinistres),
                "ratio_sinistre_prime": "25.4%"
            }
        })


# =========================================================================
# 3. SINISTRES DÉLÉGUÉS CIMA
# =========================================================================
class SinistreDelegueViewSet(viewsets.ModelViewSet):
    queryset = SinistreDelegue.objects.all().order_by("-date_declaration")
    serializer_class = SinistreDelegueSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]

    def list(self, request, *args, **kwargs):
        check_and_seed_data()
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def reglement(self, request, pk=None):
        """Exécution du règlement d'un sinistre sous mandat de gestion déléguée"""
        sinistre = self.get_object()
        montant = request.data.get("montant_indemnise") or sinistre.montant_reclame
        montant = float(montant)

        # Vérification du plafond de délégation de la convention
        convention = ConventionAssureur.objects.filter(compagnie__icontains=sinistre.compagnie[:6]).first()
        plafond = float(convention.plafond_delegation_sinistre) if convention else 5000000.0

        if montant > plafond:
            return Response({
                "error": f"Le montant ({montant:,.0f} FCFA) dépasse le plafond de délégation conventionnelle ({plafond:,.0f} FCFA). Un mandat exprès de la compagnie est requis."
            }, status=status.HTTP_400_BAD_REQUEST)

        sinistre.montant_indemnise = montant
        sinistre.statut = "Réglé"
        if not isinstance(sinistre.historique_evenements, list):
            sinistre.historique_evenements = []
        
        sinistre.historique_evenements.append({
            "date": datetime.date.today().isoformat(),
            "action": f"Règlement ordonnancé pour un montant de {montant:,.0f} FCFA sous mandat de délégation approuvé."
        })
        sinistre.save()

        # Enregistrement dans le journal d'audit CIMA
        AuditLogCima.objects.create(
            type_operation="SINISTRE_REGLEMENT",
            description=f"Règlement ordonnancé sur le sinistre {sinistre.numero_sinistre} pour {montant:,.0f} FCFA (Assuré : {sinistre.assure_nom})",
            auteur=request.user.username if request.user and request.user.is_authenticated else "Gestionnaire Sinistres",
            statut_conformite="CONFORME",
            reference_reglementaire="Mandat Conventionnel Gestion Déléguée CIMA",
            details_json={"numero_sinistre": sinistre.numero_sinistre, "montant": montant, "compagnie": sinistre.compagnie}
        )

        return Response(SinistreDelegueSerializer(sinistre).data)

    @action(detail=True, methods=["post"])
    def demande_accord(self, request, pk=None):
        """Transmission du dossier pour accord préalable / mandat spécial compagnie (hors plafond)"""
        sinistre = self.get_object()
        motif = request.data.get("motif") or "Montant réclamé supérieur au plafond de délégation conventionnelle."
        sinistre.accord_prealable_requis = True
        sinistre.statut = "En attente accord compagnie"
        if not isinstance(sinistre.historique_evenements, list):
            sinistre.historique_evenements = []
        sinistre.historique_evenements.append({
            "date": datetime.date.today().isoformat(),
            "action": f"Dossier transmis au siège de {sinistre.compagnie} pour accord préalable / dérogation CIMA : {motif}"
        })
        sinistre.save()
        AuditLogCima.objects.create(
            type_operation="SINISTRE_DEMANDE_ACCORD",
            description=f"Transmission pour accord préalable compagnie sur {sinistre.numero_sinistre} ({sinistre.montant_reclame:,.0f} FCFA vs plafond)",
            auteur=request.user.username if request.user and request.user.is_authenticated else "Gestionnaire Sinistres",
            statut_conformite="CONFORME",
            reference_reglementaire="Règles de délégation CIMA Livre V",
            details_json={"numero_sinistre": sinistre.numero_sinistre, "compagnie": sinistre.compagnie}
        )
        return Response(SinistreDelegueSerializer(sinistre).data)

    @action(detail=True, methods=["get", "post"])
    def quittance_subrogative(self, request, pk=None):
        """Génération de la quittance d'indemnité subrogative conforme à l'Art. 54 du Code CIMA"""
        sinistre = self.get_object()
        montant = sinistre.montant_indemnise or sinistre.montant_reclame
        sinistre.quittance_subrogative_emise = True
        sinistre.save()
        data = {
            "numero_quittance": f"QT-SUB-{sinistre.numero_sinistre}",
            "numero_sinistre": sinistre.numero_sinistre,
            "assure_nom": sinistre.assure_nom,
            "police_num": sinistre.police_num,
            "compagnie": sinistre.compagnie,
            "montant_indemnise": float(montant),
            "date_reglement": datetime.date.today().isoformat(),
            "clause_subrogative": f"Le soussigné {sinistre.assure_nom} reconnaît avoir reçu de LE PHARE, agissant au nom et pour le compte de {sinistre.compagnie}, la somme de {float(montant):,.0f} FCFA en règlement intégral et définitif du sinistre N° {sinistre.numero_sinistre}. Conformément à l'Article 54 du Code CIMA, l'assureur est subrogé jusqu'à concurrence de cette indemnité dans les droits et actions de l'assuré contre les tiers responsables.",
            "emetteur": "Direction Sinistres LE PHARE"
        }
        return Response(data)

    @action(detail=True, methods=["post"])
    def maj_pieces(self, request, pk=None):
        sinistre = self.get_object()
        pieces = request.data.get("pieces_justificatives")
        if pieces is not None:
            sinistre.pieces_justificatives = pieces
            sinistre.save()
        return Response(SinistreDelegueSerializer(sinistre).data)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        check_and_seed_data()
        total = SinistreDelegue.objects.count()
        total_reclame = SinistreDelegue.objects.aggregate(total=Sum("montant_reclame"))["total"] or 0
        total_indemnise = SinistreDelegue.objects.aggregate(total=Sum("montant_indemnise"))["total"] or 0
        regles = SinistreDelegue.objects.filter(statut="Réglé").count()
        en_cours = SinistreDelegue.objects.exclude(statut__in=["Réglé", "Clôturé", "Rejeté"]).count()
        respect_delegation_pct = round(SinistreDelegue.objects.filter(delegation_respectee=True).count() / total * 100, 1) if total > 0 else 100

        return Response({
            "total_sinistres": total,
            "total_montant_reclame": total_reclame,
            "total_montant_indemnise": total_indemnise,
            "sinistres_regles": regles,
            "sinistres_en_cours": en_cours,
            "conformite_delegation_pourcentage": respect_delegation_pct
        })


# =========================================================================
# 4. CONVENTIONS ASSUREURS
# =========================================================================
class ConventionAssureurViewSet(viewsets.ModelViewSet):
    queryset = ConventionAssureur.objects.all().order_by("compagnie")
    serializer_class = ConventionAssureurSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]

    def list(self, request, *args, **kwargs):
        check_and_seed_data()
        return super().list(request, *args, **kwargs)


# =========================================================================
# 5. GED PROBANTE LE PHARE
# =========================================================================
class DocumentGEDViewSet(viewsets.ModelViewSet):
    queryset = DocumentGED.objects.all().order_by("-date_upload")
    serializer_class = DocumentGEDSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]

    def list(self, request, *args, **kwargs):
        check_and_seed_data()
        return super().list(request, *args, **kwargs)


# =========================================================================
# 6. CONFORMITÉ & AUDIT TRAIL CIMA
# =========================================================================
class AuditLogCimaViewSet(viewsets.ModelViewSet):
    queryset = AuditLogCima.objects.all().order_by("-date_creation")
    serializer_class = AuditLogCimaSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]

    def list(self, request, *args, **kwargs):
        check_and_seed_data()
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def kpis(self, request):
        check_and_seed_data()
        return Response({
            "agrement_courtier": "N° 021/MEF/DGTCP/DA - République de Côte d'Ivoire",
            "caution_financiere_montant": 50000000,
            "caution_banque": "Société Générale Côte d'Ivoire (SGCI)",
            "caution_statut": "Valide & Conforme CIMA",
            "delai_moyen_reversement_jours": 22.4,
            "delai_reglementaire_max_jours": 30,
            "taux_conformite_art13": "100%",
            "taux_respect_plafonds_delegation": "98.5%",
            "alertes_actives": 0
        })

    @action(detail=False, methods=["get"])
    def etats_cima(self, request):
        """Production des états statistiques normalisés C1, C2, C3 pour l'autorité de contrôle CIMA"""
        check_and_seed_data()
        return Response({
            "etat_c1": {
                "titre": "État C1 - Bordereau Annuel des Émissions et Recouvrements de Primes (Art. 13 CIMA)",
                "exercice": 2026,
                "courtier": "LE PHARE COURTAGE & GESTION DÉLÉGUÉE",
                "agrement": "021/MEF/DGTCP/DA",
                "lignes": [
                    {"branche": "Automobile", "primes_emises": 65000000, "primes_encaissees": 62500000, "taux_recouvrement": "96.2%", "commissions_dues": 6500000},
                    {"branche": "Santé Groupe", "primes_emises": 82000000, "primes_encaissees": 80000000, "taux_recouvrement": "97.5%", "commissions_dues": 8200000},
                    {"branche": "IARD & Risques Divers", "primes_emises": 45000000, "primes_encaissees": 43500000, "taux_recouvrement": "96.7%", "commissions_dues": 6750000},
                    {"branche": "Transport Facultés", "primes_emises": 28000000, "primes_encaissees": 28000000, "taux_recouvrement": "100.0%", "commissions_dues": 2800000},
                ],
                "total_primes_encaissees": 214000000,
                "total_commissions": 24250000,
                "statut_art13": "100% Conforme - Aucune attestation émise sans encaissement"
            },
            "etat_c2": {
                "titre": "État C2 - Registre des Sinistres Sous Mandat Délégué (Code CIMA Livre V)",
                "exercice": 2026,
                "sinistres_declares": SinistreDelegue.objects.count(),
                "montant_reclame_total": float(SinistreDelegue.objects.aggregate(t=Sum("montant_reclame"))["t"] or 0),
                "montant_indemnise_total": float(SinistreDelegue.objects.aggregate(t=Sum("montant_indemnise"))["t"] or 0),
                "delai_moyen_reglement_jours": 14.5,
                "delai_legal_cima_jours": 30,
                "taux_respect_plafonds": "98.5%"
            },
            "etat_c3": {
                "titre": "État C3 - Registre des Rétrocessions et Commissions d'Apporteurs (Plafonds CIMA)",
                "exercice": 2026,
                "apporteurs_actifs": 18,
                "total_commissions_versees": 11450000,
                "conformite_plafonds_cima": "Conforme (Taux maximum légal respecté sur toutes les branches)"
            }
        })


# =========================================================================
# 7. QUITTANCES OFFICIELLES CIMA (ARTICLE 13)
# =========================================================================
class QuittanceCimaViewSet(viewsets.ModelViewSet):
    queryset = QuittanceCima.objects.all().order_by("-date_encaissement")
    serializer_class = QuittanceCimaSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]

    def list(self, request, *args, **kwargs):
        check_and_seed_data()
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        count = QuittanceCima.objects.count() + 1
        num = f"QUIT-CIMA-2026-{str(count).zfill(3)}"
        data = request.data.copy()
        data["numero_quittance"] = num
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        
        # Log in Audit Trail
        AuditLogCima.objects.create(
            type_operation="ENCAISSEMENT",
            description=f"Émission Quittance CIMA {num} pour {serializer.data.get('souscripteur')} ({serializer.data.get('montant_encaisse')} FCFA)",
            auteur=request.user.username if request.user and request.user.is_authenticated else "Caisse Centrale LE PHARE",
            statut_conformite="CONFORME",
            reference_reglementaire="CIMA Art. 13 - Validité immédiate de garantie",
            details_json={"numero_quittance": num, "police": serializer.data.get("police_num")}
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# =========================================================================
# 8. BORDEREAUX DE REVERSEMENT ASSUREURS (DÉLAI 30 JOURS CIMA)
# =========================================================================
class BordereauReversementViewSet(viewsets.ModelViewSet):
    queryset = BordereauReversement.objects.all().order_by("-date_generation")
    serializer_class = BordereauReversementSerializer
    pagination_class = ResultsOnlyPagination
    permission_classes = [permissions.AllowAny]

    def list(self, request, *args, **kwargs):
        check_and_seed_data()
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def valider(self, request, pk=None):
        bordereau = self.get_object()
        bordereau.statut = "Validé"
        bordereau.ordre_virement_ref = f"OV-SGCI-2026-{str(bordereau.id).zfill(4)}"
        bordereau.save()

        AuditLogCima.objects.create(
            type_operation="REVERSEMENT",
            description=f"Validation bordereau {bordereau.reference} vers {bordereau.compagnie} ({bordereau.net_a_reverser:,.0f} FCFA) - Réf virement {bordereau.ordre_virement_ref}",
            auteur=request.user.username if request.user and request.user.is_authenticated else "Direction Trésorerie LE PHARE",
            statut_conformite="CONFORME",
            reference_reglementaire="Règle CIMA de reversement 30 jours",
            details_json={"reference": bordereau.reference, "compagnie": bordereau.compagnie}
        )
        return Response(BordereauReversementSerializer(bordereau).data)

