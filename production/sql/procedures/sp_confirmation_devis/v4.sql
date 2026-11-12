-- v4 (migration production 0200) : un devis IA MINENE à plusieurs adhérents se confirme. La v3 le refusait
-- (« trop d'objets assurés ») parce qu'il n'est pas une flotte : toute police Santé de plus d'un adhérent était bloquée.
CREATE OR REPLACE PROCEDURE public.sp_confirmation_devis(IN id_devis integer, INOUT id_contrat integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
	local_message varchar(500);
	commit_var int;
	police_locale varchar(50);
	vehicule_ int;
	id_avenant int;
	date_effet date;
	date_emission date;
	code_avenant character varying(5);
	id_intermediaire int; 
	old_date_effet date;
	flotte_ boolean;
	numero_police_local varchar(16);
	v_taux_commission numeric(5,2);
	id_old_contrat int;
	matricule_ varchar(10);
	id_devis_detail int;
	id_contrat_detail int;
	id_contrat_det_garantie int;
	id_tarif int;
	id_produit int;
	id_compagnie int;
	id_assure int;
	id_offre int;
	code_categorie char(3);
	var_devis RECORD;
	var_devis_detail RECORD;
	prime_nette numeric;
	var_accessoire numeric;
	var_accessoire_intermediaire numeric;
	taxe_accessoire numeric;
	id_quittance int;
	liste_matricules character varying;
	motif_annulation character varying;
	devis_archive boolean;
	taxe_devis numeric :=0;
	nombre_objets_assures integer;
	v_prime_imposee bool;
	----Gestion des erreurs
	v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
	
BEGIN
	id_contrat := 0;
	out_message := '';
	local_message := '';
	id_quittance := 0;
  	SELECT numerodevis,
         dateeffet,
         idavenant,		 
         idintermediaire,
         flotte,
         idoldhist,
		 idproduit,
		 idassure,
		 idcompagnie,
		 dateemission,
		 motifannulation,
		 COALESCE(archive, False) AS archive,
		 COALESCE(primeimposee, False) as primeimposee
	INTO var_devis
    FROM StdDevis      
    WHERE iddevis = id_devis;    
   
   	police_locale := var_devis.numerodevis;
    date_effet := var_devis.dateeffet;
	date_emission := var_devis.dateemission;
    id_avenant  := var_devis.idavenant;		 
    id_intermediaire := var_devis.idintermediaire;
	id_compagnie := var_devis.idcompagnie;
    flotte_    := var_devis.flotte;
    --id_old_contrat  := var_devis.idoldhist;
	id_produit  := COALESCE(var_devis.idproduit,0);
	id_assure := var_devis.idassure;
	motif_annulation := var_devis.motifannulation;
	devis_archive := var_devis.archive;
	v_prime_imposee := COALESCE(var_devis.primeimposee,False);
	   
	IF devis_archive THEN
		out_message := 'Devis archivé. Confirmation impossible!';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
  	SELECT CodeAvenant
	INTO code_avenant
    FROM StdAvenant
    WHERE IdAvenant = id_avenant;

	SELECT idcontrat 
	INTO id_old_contrat
	FROM public.stdcontrat
	WHERE iddevis = var_devis.idoldhist;
	id_old_contrat := COALESCE(id_old_contrat, 0);
	
	-- IF id_produit = 1 AND code_avenant NOT IN ('ANL', 'RET', 'RES') THEN
	-- 	liste_matricules := array_to_string(ARRAY(SELECT CBV.matricule_ FROM fn_num_carte_brune_vide(id_devis) AS CBV),';');
	-- 	IF liste_matricules <> '' THEN
	-- 		out_message := 'Carte brune non renseignée pour les véhicules suivants: ' || liste_matricules;
	-- 		RAISE EXCEPTION '%', out_message;
	-- 	END IF;
	-- END IF;
	
	IF EXISTS (SELECT * FROM StdDevis
                   WHERE iddevis = id_devis  AND
                        confirme = True AND
				        iddevis IN (SELECT IdDevis FROM StdContrat
								   WHERE COALESCE(IdContratAnnulation,0) = 0)
			     ) THEN
    	  local_message := 'Désolé, Affaire existe déjà pour la police ' || police_locale || '_Vehicule_' || CAST(vehicule_ AS varchar(10));
     	  RAISE EXCEPTION '%', local_message;
  	END IF;

	-- IA MINENE (offre 66) : une ligne par adhérent de la police Santé sans être une flotte, la prime étant celle de
	-- l'assuré principal multipliée par le nombre d'adhérents (sp_finalisation_devis)
	IF NOT flotte_ AND id_produit IN (1, 2)
	   AND NOT EXISTS (SELECT 1 FROM public.stddevisdetail WHERE iddevis = id_devis AND idoffre = 66) THEN
		SELECT COUNT(matricule)
		INTO nombre_objets_assures
		FROM public.stddevisdetail  
		WHERE iddevis = id_devis;
		IF COALESCE(nombre_objets_assures, 0) > 1 THEN
			local_message := 'Erreur logicielle: trop d''objets assurés.';
     	  	RAISE EXCEPTION '%', local_message;
		END IF;
	END IF;

	IF id_produit IN (1, 2) AND EXISTS (SELECT COUNT(matricule) FROM public.stddevisdetail WHERE iddevis = id_devis GROUP BY matricule HAVING COUNT(matricule) > 1) THEN
		local_message := 'Doublons sur les objets assurés.';
     	RAISE EXCEPTION '%', local_message;
	END IF;

	v_taux_commission := 0;
	IF code_avenant NOT IN ('ANL', 'ANP', 'RET', 'RES', 'MPE', 'CHI') THEN
		-- MINENE Santé : taux de commission du cabinet du barème OREOLE (6,5 %), autres offres : produit et compagnie
		v_taux_commission := fn_get_taux_commission_offre(id_produit, id_compagnie,
			(SELECT MAX(IdOffre) FROM StdDevisDetail WHERE IdDevis = id_devis), date_emission);
	END IF;	

	
	UPDATE StdDevis 
	SET confirme=True
	WHERE iddevis=id_devis;
	
	IF id_produit = 5 THEN
		UPDATE StdNumeroSaisieSante
		SET SaisieEnCours = False, DateMaj = CURRENT_TIMESTAMP
		WHERE IdDevis = id_devis AND SaisieEnCours;
	END IF;
	
	IF code_avenant IN ('AFN', 'RPP', 'TRP') THEN
		SELECT idtarif
		INTO id_tarif
		FROM StdDevisDetail
		WHERE iddevis=id_devis
		LIMIT 1;

		SELECT CodeCategorie
		INTO code_categorie
		FROM StdTarif
		where IdTarif=id_tarif;

		CALL sp_generer_numero_police(id_intermediaire, id_compagnie, code_categorie, numero_police_local, local_message);
	ELSE
		SELECT NumeroPolice
		INTO numero_police_local
		FROM StdContrat
		WHERE IdContrat = id_old_contrat;
	END IF;
	
	INSERT INTO StdContrat (IdDevis, IdOldHist, IdIntermediaire, IdProduit, IdCompagnie, IdClient, IdAssure, IdAvenant,
							 Flotte, Coassurance, IdAperiteur, NumeroPolice, ReferenceAgent, Renouvelable, Echeance,
							 Periode, NumeroAvenant, DateEffet, HeureDebut, DateExpiration,
							 DateEmission, Transfere, NbrEche, Anticipation, Observation, OldNumeroDevis, Auteur,
							 IdOperateur, Bonus_Malus, Assure, IdDuree, IdTerme, MotifAnnulation, NumeroPoliceConnexe,
							 idpolicepegas,numeropolicecompagnie, primeimposee, primeannuelle, primenette, taxe, fga, cedeao, accessoire, primettc,
							 accessoiregestionnaire)

    SELECT iddevis, id_old_contrat, idintermediaire, idproduit, idcompagnie, idclient, idassure, idavenant,
           flotte, coassurance, idaperiteur, numero_police_local, referenceagent, renouvelable, echeance,
           periode, numeroavenant, dateeffet, heuredebut, dateexpiration, dateemission, transfere,
		   nbreche, anticipation, observation, oldnumerodevis, auteur, idoperateur, bonus_malus, nomassure, idduree, idterme, motifannulation,
		   numeropoliceconnexe, idpolicepegas, numeropolicecompagnie, primeimposee, primeannuelle, primenette, taxe, fga, cedeao, accessoire, primettc,
		   COALESCE(accessoiregestionnaire, 0) -- frais de gestion MINENE (IA, RC chef de famille), compris dans la prime TTC
    FROM StdDevis
    WHERE iddevis = id_devis
	RETURNING IdContrat INTO id_contrat;
	
	IF code_avenant IN ('ANL', 'ANP', 'RES') THEN
		UPDATE StdContrat
		SET IdContratAnnulation = id_contrat, motifannulation = motif_annulation
		WHERE IdContrat = id_old_contrat;
	END IF;
	
	FOR var_devis_detail IN (SELECT iddevisdetail FROM StdDevisDetail WHERE iddevis=id_devis)
	LOOP
		id_devis_detail := var_devis_detail.iddevisdetail;
		INSERT INTO StdContratDetail (IdContrat, modelevehicule, CarteVerte, NumCarteVerte, IdAssure, IdTarif, IdProduit, IdOffre, Mt_Delegation, idusage, CodeUsage, Reference, IdCarrosserie, Matricule,
									PuissanceFiscale, NombrePlace, ChargeUtile, ValeurNeuve, ValeurVenale, ValeurAccessoire, Remorque, CodeCarburant,
									Matrem1, Matrem2, Extincteur, Conducteur, Assure, AdresseCnd, Sexe, DateMec, NumMoteur, NumChassis, NbreExtinteur, IdMarque,
									idtypevehicule, idgenrevehicule, Attestation, TypePermis, Permis, PrimeAnnuelle, PrimeNette, IdOldContratDet, OldNumeroPolice, OldTypeVehicule, taxeenregistrement, fga, idprofession, tauxreduction, codealarme)
		SELECT id_contrat, modelevehicule, carteverte, numcarteverte, id_assure, idtarif, id_produit, idoffre, 0 AS mt_delegation, idusage, codeusage, reference, idcarrosserie, matricule, puissancefiscale, nombreplace, chargeutile,
           valeurneuve, valeurvenale, valeuraccessoire, remorque, COALESCE(SEner.CodeEnergie,'0000'), matrem1, matrem2, False as extincteur, conducteur,'' AS assure, adressecnd,
		   sexe, datemec, nummoteur, numchassis, 0 AS nombreextincteur, idmarque, idtypevehicule, idgenrevehicule, attestation,pctype,permis,primeannuelle, primenette, 0, '000', '', taxeenregistrement, fga, idprofession, tauxreduction, codealarme
    	FROM StdDevisDetail AS SDevDet
		LEFT JOIN StdEnergie AS SEner ON (SDevDet.essence = SEner.IdEnergie)
    	WHERE (iddevis = id_devis) AND (iddevisdetail = id_devis_detail)
		RETURNING IdContratDetail INTO id_contrat_detail;
		
		IF id_produit = 1 THEN --Production Automobile
			INSERT INTO StdComplementContratDetailAuto(bns, carburantautrematiere, transporteleves, transportemployes, transportpassagersupplementaire, idcontratdetail, idformulesecuriteroutiere, idoptionassistance)
			SELECT bns, carburantautrematiere, transporteleves, transportemployes, transportpassagersupplementaire, id_contrat_detail, idformulesecuriteroutiere,idoptionassistance
			FROM StdComplementDevisDetailAuto
			WHERE iddevisdetail = id_devis_detail;
		END IF;
		
		IF id_produit = 3 THEN --Production Voyage
			INSERT INTO StdComplementContratDetailVoyage(IdContratDetail, NumeroAttestation, NumeroPasseport, IdPaysDestination, IdPaysVoyageur, ReferenceContrat, VisaSchengen)
			SELECT id_contrat_detail, NumeroAttestation, NumeroPasseport, IdPaysDestination, IdPaysVoyageur, ReferenceContrat, VisaSchengen
			FROM StdComplementDevisDetailVoyage
			WHERE IdDevisDetail = id_devis_detail;	
		END IF;
		
		IF id_produit = 5 THEN --Production Santé
			INSERT INTO StdComplementContratDetailSante(PrimeFamille, PrimeAffilie, PrimeGlobale, MontantSurprime, MontantAccessoireManuel, TauxReductionCommerciale, IdTypeContrat, GestionnaireSante, IdContratDetail)
			SELECT PrimeFamille, PrimeAffilie, PrimeGlobale, MontantSurprime, MontantAccessoireManuel, TauxReductionCommerciale, IdTypeContrat, GestionnaireSante, id_contrat_detail
			FROM StdComplementDevisDetailSante
			WHERE IdDevisDetail = id_devis_detail;
		END IF;

		IF id_produit = 8 THEN --Production RC
			INSERT INTO StdComplementContratDetailRC(TauxPrime, AssiettePrime, NombreParticipants, IdDomaineActivite, IdActivite, Localisation, DateDebut, IdContratDetail)
			SELECT TauxPrime, AssiettePrime, NombreParticipants, IdDomaineActivite, IdActivite, Localisation, DateDebut, id_contrat_detail
			FROM StdComplementDevisDetailRC
			WHERE IdDevisDetail = id_devis_detail;
		END IF;
		
		IF id_produit = 9 THEN --Production Dommages (TRI, Globale de banque)
			INSERT INTO StdComplementContratDetailDommage(TauxPrime, MontantPrime, IdContratDetail)
			SELECT TauxPrime, MontantPrime, id_contrat_detail
			FROM StdComplementDevisDetailDommage
			WHERE IdDevisDetail = id_devis_detail;
		END IF;

		INSERT INTO stdcontratdetgarantie (idcontratdetail, idgarantie, acquise, capital, franchise,
                                    textefranchise, primeannuelle, primenette, taxe, minfranchise, maxfranchise, formule, deces, ipp, fraismed, tauxfranchise)
    	SELECT id_contrat_detail, IdGarantie, Acquise, Capital, Franchise, TexteFranchise, primeannuelle, PrimeNette, taxe,
    	        minfranchise, maxfranchise, formule, deces, ipp, fraismed, tauxfranchise
      	FROM StdDevisDetGarantie
      	WHERE (IdDevisDet = id_devis_detail) and (Acquise = True) AND IdGarantie <> 2; ---Ne pas inclure le FGA comme garantie
	END LOOP;
	
	UPDATE StdContrat
	SET CommissionIntermediaire = ROUND((primenette*COALESCE(v_taux_commission,0))/100,0), taux_commission = v_taux_commission
	WHERE (IdContrat=id_contrat) AND (NumeroPolice=numero_police_local);
	
	
	IF code_avenant NOT IN ('ANL', 'ANP', 'MPE', 'CHI', 'RET', 'RES') THEN
		SELECT PrimeNette 
		INTO prime_nette
		FROM StdContrat 
		WHERE IdContrat=id_contrat;
		prime_nette := COALESCE(prime_nette, 0);

		SELECT MAX(IdOffre)
		INTO id_offre
		FROM StdDevisDetail
		WHERE IdDevis = id_devis;
		
		UPDATE StdContrat AS SC
		SET AccessoireCompagnie = SD.AccessoireCompagnie, AccessoireIntermediaire = SD.AccessoireIntermediaire,
			Accessoire = SD.Accessoire, Taxe = SD.Taxe, Fga = SD.Fga, Cedeao = SD.Cedeao, PrimeNette = SD.PrimeNette, PrimeAnnuelle = SD.PrimeAnnuelle,
			PrimeTTC = SD.PrimeTTC
		FROM StdDevis AS SD
		WHERE SC.IdContrat = id_contrat AND SC.IdDevis = SD.IdDevis AND SD.IdDevis = id_devis;
		
	ELSE
		UPDATE StdContrat AS SC
		SET AccessoireCompagnie = SD.AccessoireCompagnie, AccessoireIntermediaire = SD.AccessoireIntermediaire,
			Accessoire = SD.Accessoire, Taxe = SD.Taxe
		FROM StdDevis AS SD
		WHERE SC.IdContrat = id_contrat AND SC.IdDevis = SD.IdDevis AND SD.IdDevis = id_devis;
	END IF;

	--IF id_offre NOT IN (66, 67) THEN --Ne pas générer de quittance pour l'offre MINENE qui est encaissé en Santé MINENE
	CALL sp_generation_quittance (id_contrat, id_quittance, out_message);
	--ELSE
	--	id_quittance := -1; --Ceci est un id fictif juste pour satisfaire le test ci-dessous
	--END IF;

	IF (id_contrat <> 0) AND (id_quittance <> 0) THEN
		out_message := 'Contrat enregistré avec succès.';
	END IF;
	
	EXCEPTION WHEN others THEN
	
		get stacked diagnostics
        	v_state   = returned_sqlstate,
        	v_msg     = message_text,
        	v_detail  = pg_exception_detail,
        	v_hint    = pg_exception_hint,
        	v_context = pg_exception_context;
			
		id_contrat := 0;
		
		out_message := v_msg || ' : ' || v_context; -- 'Problème rencontré lors de la confirmation du devis';
		RAISE EXCEPTION '%', out_message;

END; 
$procedure$
