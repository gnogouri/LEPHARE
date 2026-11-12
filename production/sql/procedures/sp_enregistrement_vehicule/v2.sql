CREATE OR REPLACE PROCEDURE public.sp_enregistrement_vehicule(IN id_compagnie integer, IN id_produit integer, IN id_offre integer, IN date_effet date, IN date_expiration date, IN date_emission date, IN id_tarif integer, IN code_usage integer, IN id_carroserie integer, IN code_carburant integer, IN puissance integer, IN nombre_place integer, IN charge integer, IN valeur_neuve numeric, IN valeur_venale numeric, IN valeur_accessoire numeric, IN taux_reduction numeric, IN code_alarme integer, IN reduction_bns numeric, IN nom_conducteur character varying, IN adresse_conducteur character varying, IN date_mec date, IN num_moteur character varying, IN num_chassis character varying, IN id_type_vehicule integer, IN id_marque integer, IN numero_immmatriculation character varying, IN numero_permis_conduire character varying, IN id_genre_vehicule integer, IN numero_carte_brune_physique character varying, IN modele_vehicule character varying, IN remorque_attelee boolean, IN libelle_formule_securite_routiere character varying, IN id_option_assistance integer, IN carburant_autre_matiere boolean, IN transport_eleves boolean, IN transport_employes boolean, IN transport_passager_supplementaire boolean, IN nsia_auto_plus boolean, IN id_devis integer, INOUT id_devis_detail integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE

	code_categorie char(3);
	code_usage_char char varying(3);
	id_devis_detail_initial integer;
	id_formule_sr integer; --securité routière
	code_avenant varchar(5);
	autre_num_immat character varying;
	autre_num_police character varying(50);
	id_old_hist integer;
	v_prime_imposee bool;
	caracteristiques_modifiees text;
	----Gestion des erreurs
	v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
	
BEGIN
    
  		CREATE TEMPORARY TABLE IF NOT EXISTS temp_gar (idsousgarantie int, libellesousgarantie varchar(60), garcapitalval numeric, garplaceval int, taux numeric, acquise boolean, primeannuelle numeric, primenette numeric, tauxfranchise numeric, franchiseminimum numeric, franchisemaximum numeric, franchisetexte character varying, formule integer, deces numeric, ipp numeric, ft numeric);
	    TRUNCATE TABLE temp_gar;
		
		id_devis_detail := COALESCE(id_devis_detail,0);
		id_devis_detail_initial := id_devis_detail;
		out_message := '';
		id_compagnie := COALESCE(id_compagnie,1);
		id_produit := COALESCE(id_produit,0);
		id_offre := COALESCE(id_offre,0);
		id_carroserie := COALESCE(id_carroserie,0);
		code_carburant := COALESCE(code_carburant,0);
		code_usage := COALESCE(code_usage,0);
		code_alarme := COALESCE(code_alarme,1);
		id_genre_vehicule := COALESCE(id_genre_vehicule,0);
		id_type_vehicule := COALESCE(id_type_vehicule,0);
		numero_carte_brune_physique := TRIM(COALESCE(numero_carte_brune_physique, ''));
		id_option_assistance := COALESCE(id_option_assistance, 0);
		numero_immmatriculation := TRIM(COALESCE(numero_immmatriculation, ''));
		id_old_hist := 0;

		SELECT primeimposee
		INTO v_prime_imposee
		FROM public.stddevis
		WHERE iddevis = id_devis;
		v_prime_imposee := COALESCE(v_prime_imposee, false);
		
		IF id_devis_detail <> 0 THEN
			SELECT idoldhist INTO id_old_hist
			FROM stddevisdetail
			WHERE iddevisdetail =  id_devis_detail;
			id_old_hist := COALESCE(id_old_hist, 0);
		END IF;
		
-- 		IF EXISTS (SELECT * FROM StdDevis WHERE IdDevis = id_devis AND NOT Flotte) AND numero_carte_brune_physique = '' THEN
-- 			out_message := 'La saisie du numéro de la carte brune est obligatoire.';
-- 			RAISE EXCEPTION '%', out_message;
-- 		END IF;
		
		SELECT SA.CodeAvenant
		INTO code_avenant
		FROM StdDevis AS SD
		INNER JOIN StdAvenant AS SA ON (SD.IdAvenant = SA.IdAvenant)
		WHERE SD.IdDevis = id_devis;
		code_avenant := COALESCE(code_avenant, '');
		-- IF code_avenant IN ('AFN', 'REN', 'INC', 'CHI', 'CHV', 'MPE') AND numero_carte_brune_physique <> '' THEN
		-- 	SELECT SCD.Matricule, SC.NumeroPolice
		-- 	INTO autre_num_immat, autre_num_police
		-- 	FROM StdContratDetail AS SCD
		-- 	INNER JOIN StdContrat AS SC ON (SCD.IdContrat = SC.IdContrat)
		-- 	WHERE TRIM(COALESCE(SCD.NumCarteVerte, '')) = numero_carte_brune_physique
		-- 	LIMIT 1;
		-- 	autre_num_immat := COALESCE(autre_num_immat, '');
		-- 	autre_num_police := COALESCE(autre_num_police, '');
		-- 	IF autre_num_immat <> '' THEN
		-- 		out_message := 'Cette carte brune est déja utilisée par le véhicule immatriculé ' || autre_num_immat || ' dans la police ' || autre_num_police;
		-- 		RAISE EXCEPTION '%', out_message;
		-- 	END IF;
		-- 	IF (id_devis_detail = 0) THEN
		-- 		SELECT Matricule
		-- 		INTO autre_num_immat 
		-- 		FROM StdDevisDetail
		-- 		WHERE IdDevis = id_devis AND TRIM(COALESCE(numcarteverte, '')) = numero_carte_brune_physique
		-- 		LIMIT 1;
		-- 	ELSE
		-- 		SELECT Matricule
		-- 		INTO autre_num_immat 
		-- 		FROM StdDevisDetail
		-- 		WHERE IdDevis = id_devis
		-- 		      AND IdDevisDetail <> id_devis_detail
		-- 			  AND TRIM(COALESCE(numcarteverte, '')) = numero_carte_brune_physique
		-- 		LIMIT 1;
		-- 	END IF;
		-- 	autre_num_immat := COALESCE(autre_num_immat, '');
		-- 	IF autre_num_immat <> '' THEN
		-- 		out_message := 'Cette carte brune est déjà utilisée par le véhicule immatriculé ' || autre_num_immat;
		-- 		RAISE EXCEPTION '%', out_message;
		-- 	END IF;
		-- END IF;
		
		SELECT CodeCategorie
		INTO code_categorie
		FROM StdTarif
		WHERE IdTarif = id_tarif;
		
		SELECT CodeUsage
		INTO code_usage_char
		FROM StdUsage
		WHERE IdUsage = code_usage;
		code_usage_char := COALESCE(code_usage_char,'000');
		
		id_formule_sr := fn_get_id_formule_securite_routiere(libelle_formule_securite_routiere, id_compagnie, nombre_place);
		
		IF (id_devis_detail = 0) THEN
			IF EXISTS (SELECT * FROM public.stddevisdetail WHERE iddevis = id_devis AND matricule = numero_immmatriculation) THEN
				out_message := 'Ce vehicule est déjà enregistré dans ce devis!';
				RAISE EXCEPTION '%', out_message;
			END IF;
			INSERT INTO StdDevisDetail(iddevis, idoffre, idtarif, modelevehicule, vehicule,idusage,codeusage,reference,idcarrosserie,puissancefiscale,nombreplace,chargeutile,valeurneuve,valeurvenale,valeuraccessoire,remorque,conducteur,
					adressecnd,datemec, datemutation,nummoteur,numchassis,idtypevehicule, idgenrevehicule, idmarque,matricule,carteverte,numcarteverte, essence,numpccnd, codealarme, tauxreduction, PrimeImposee)
			VALUES (id_devis, id_offre, id_tarif, modele_vehicule, 1, code_usage,code_usage_char, code_usage_char, id_carroserie, puissance, nombre_place, charge, valeur_neuve, valeur_venale, valeur_accessoire, remorque_attelee, nom_conducteur, 
					adresse_conducteur, date_mec, date_mec, num_moteur, num_chassis, id_type_vehicule, id_genre_vehicule, id_marque, numero_immmatriculation, Case when code_categorie='205' then True else False end, numero_carte_brune_physique, code_carburant, numero_permis_conduire, code_alarme, taux_reduction, v_prime_imposee)
			RETURNING iddevisdetail INTO id_devis_detail;
			
			INSERT INTO StdComplementDevisDetailAuto(bns, carburantautrematiere, transporteleves, transportemployes, transportpassagersupplementaire, iddevisdetail, idformulesecuriteroutiere, idoptionassistance)
			VALUES (reduction_bns, carburant_autre_matiere, transport_eleves, transport_employes, transport_passager_supplementaire, id_devis_detail, id_formule_sr, id_option_assistance);
			
		ELSE
			IF EXISTS (SELECT * FROM public.stddevisdetail WHERE iddevis = id_devis AND matricule = numero_immmatriculation AND iddevisdetail <> id_devis_detail) THEN
				out_message := 'Ce vehicule est déjà enregistré dans ce devis!';
				RAISE EXCEPTION '%', out_message;
			END IF;
			-- Renouvellement (REN) : nouvelle période retarifée, le véhicule repris du contrat précédent se corrige
			-- comme un véhicule saisi dans ce devis (valeur à neuf, puissance, places, énergie, charge utile)
			IF id_old_hist = 0 OR code_avenant = 'REN' THEN
				UPDATE StdDevisDetail
				SET iddevis = id_devis, idoffre = id_offre, idtarif = id_tarif, modelevehicule = modele_vehicule, vehicule = 1, idusage = code_usage, codeusage = code_usage_char, reference = code_usage_char,
					idcarrosserie = id_carroserie, puissancefiscale = puissance, nombreplace = nombre_place, chargeutile = charge, valeurneuve = valeur_neuve, valeurvenale = valeur_venale, valeuraccessoire = valeur_accessoire,
					remorque = remorque_attelee, conducteur = nom_conducteur,
					adressecnd = adresse_conducteur, datemec = date_mec, datemutation = date_mec, nummoteur = num_moteur, numchassis = num_chassis, idtypevehicule = id_type_vehicule, idgenrevehicule = id_genre_vehicule, idmarque = id_marque,
					matricule = numero_immmatriculation, carteverte = Case when code_categorie='205' then True else False end, numcarteverte = numero_carte_brune_physique, essence = code_carburant, numpccnd = numero_permis_conduire, codealarme = code_alarme, tauxreduction = taux_reduction
				WHERE iddevisdetail = id_devis_detail;
			ELSE
				-- Valeur absente en base (NULL) égale à 0 envoyé par l'écran ; message avec les caractéristiques modifiées
				SELECT CONCAT_WS(', ',
						CASE WHEN COALESCE(puissancefiscale, 0) <> COALESCE(puissance, 0) THEN 'puissance fiscale' END,
						CASE WHEN COALESCE(nombreplace, 0) <> COALESCE(nombre_place, 0) THEN 'nombre de places' END,
						CASE WHEN COALESCE(chargeutile, 0) <> COALESCE(charge, 0) THEN 'charge utile' END,
						CASE WHEN COALESCE(essence, 0) <> COALESCE(code_carburant, 0) THEN 'énergie' END,
						CASE WHEN COALESCE(valeurneuve, 0) <> COALESCE(valeur_neuve, 0) THEN 'valeur à neuf' END
						/*valeuraccessoire = valeur_accessoire*/)
				INTO caracteristiques_modifiees
				FROM public.stddevisdetail
				WHERE iddevis = id_devis AND iddevisdetail = id_devis_detail;
				IF NOT FOUND OR caracteristiques_modifiees <> '' THEN
					out_message := 'Les caractéristiques d''un véhicule déjà existant ne peuvent changer'
						|| CASE WHEN caracteristiques_modifiees <> '' THEN ' (' || caracteristiques_modifiees || ')' ELSE '' END;
					RAISE EXCEPTION '%', out_message;
				END IF;
								
				UPDATE StdDevisDetail
				SET iddevis = id_devis, idoffre = id_offre, idtarif = id_tarif, modelevehicule = modele_vehicule, vehicule = 1, idusage = code_usage, codeusage = code_usage_char, reference = code_usage_char,
					idcarrosserie = id_carroserie, nombreplace = nombre_place, chargeutile = charge, valeurvenale = valeur_venale,
					remorque = remorque_attelee, conducteur = nom_conducteur,
					adressecnd = adresse_conducteur, datemutation = date_mec, nummoteur = num_moteur, numchassis = num_chassis, idtypevehicule = id_type_vehicule, idgenrevehicule = id_genre_vehicule,
					carteverte = Case when code_categorie='205' then True else False end, numcarteverte = numero_carte_brune_physique, numpccnd = numero_permis_conduire, codealarme = code_alarme, tauxreduction = taux_reduction
				WHERE iddevisdetail = id_devis_detail;
			END IF;
			
			UPDATE StdComplementDevisDetailAuto
			SET bns = reduction_bns, carburantautrematiere = carburant_autre_matiere, transporteleves = transport_eleves, transportemployes = transport_employes, transportpassagersupplementaire = transport_passager_supplementaire, idformulesecuriteroutiere = id_formule_sr, idoptionassistance = id_option_assistance
			WHERE iddevisdetail = id_devis_detail;
			
		END IF;

		INSERT INTO temp_gar(idsousgarantie, libellesousgarantie, garcapitalval, garplaceval, acquise, primeannuelle, primenette, tauxfranchise, franchiseminimum, franchisemaximum, FranchiseTexte, Formule, Deces, IPP, FT)
		SELECT IdSousGarantie, LibelleSousGarantie, Capital, NombrePlace, Acquise, PrimeAnnuelle, PrimeNette, TauxFranchise, FranchiseMinimum, FranchiseMaximum, FranchiseTexte, IdFormule, CapitalDeces, CapitalIPP, CapitalFT
		FROM fn_garantie_offre (id_compagnie,id_offre,id_tarif,valeur_neuve,valeur_venale,valeur_accessoire,puissance,code_carburant,charge,taux_reduction,code_alarme,date_effet,date_expiration,reduction_bns,date_mec,
								remorque_attelee,libelle_formule_securite_routiere,id_option_assistance,nombre_place,code_usage,carburant_autre_matiere,transport_eleves,transport_employes,transport_passager_supplementaire, nsia_auto_plus)
		WHERE IdGarantie <> 0 AND IdSousGarantie <> 2 ---Exclure le FGA comme garantie
		ORDER BY 1;
		
		DELETE FROM StdDevisDetGarantie
		WHERE IdDevisDet = id_devis_detail;
		
		INSERT INTO StdDevisDetGarantie (IdDevisDet,IdGarantie,Acquise,taxe,Capital,franchise,minfranchise,maxfranchise,primeannuelle,PrimeNette,old_acquise,old_primenette, TexteFranchise, Formule, Deces, IPP, FraisMed)
		select id_devis_detail,idsousgarantie, acquise,0 as taxe, garcapitalval,tauxfranchise,franchiseminimum,franchisemaximum,primeannuelle,primenette,0,0, FranchiseTexte, Formule, Deces, IPP, FT
		from temp_gar; 
		
		UPDATE StdDevisDetGarantie AS DD
		SET taxe=G.taxe
		FROM (SELECT TP.idsousgarantie, ROUND((primenette * TT.tauxtaxe)/100,0) AS taxe 
			  FROM temp_gar AS TP
			  JOIN stdtauxtaxegarantieproduit AS TT ON(TT.idgarantie=TP.idsousgarantie)
			  WHERE (TT.idproduit = id_produit) AND (date_effet BETWEEN TT.DebutValidite AND TT.FinValidite)
			) AS G
		WHERE (G.idsousgarantie=DD.IdGarantie) AND DD.IdDevisDet=id_devis_detail;

		UPDATE StdDevisDetail AS DD
		SET primeannuelle = M.primeannuelle + M.fgaannuelle, primenette = M.primenette, fga = M.fganette, taxeenregistrement = taxe
		FROM (SELECT IdDevisDet, SUM(primeannuelle) AS primeannuelle, SUM(PrimeNette) AS primenette,
			  		SUM(CASE WHEN IdGarantie = 1 THEN ROUND(PrimeNette * 0.02, 0) ELSE 0 END) AS fganette,
			  		SUM(CASE WHEN IdGarantie = 1 THEN ROUND(PrimeAnnuelle * 0.02, 0) ELSE 0 END) AS fgaannuelle,
			  		SUM(taxe) AS taxe
				FROM StdDevisDetGarantie
			  	WHERE IdDevisDet = id_devis_detail AND IdGarantie <> 2 --Exclure la garantie FGA mais calculer le montant FGA qui est une composante de prime
		 		GROUP BY IdDevisDet) AS M
		WHERE (M.IdDevisDet=DD.iddevisdetail) AND (IdDevisDet = id_devis_detail);
		
		DROP TABLE IF EXISTS temp_gar;
		
		out_message := 'Véhicule enregistré avec succès';
		
		EXCEPTION WHEN others THEN
			get stacked diagnostics
        		v_state   = returned_sqlstate,
        		v_msg     = message_text,
        		v_detail  = pg_exception_detail,
        		v_hint    = pg_exception_hint,
        		v_context = pg_exception_context;
			IF (id_devis_detail_initial = 0) THEN
				id_devis_detail := 0;
			END IF;
			out_message := v_msg; -- || ' : ' || v_context; -- 'Problème rencontré lors de l''enregistrement du véhicule;
			DROP TABLE IF EXISTS temp_gar;
    		/* RAISE EXCEPTION E'Got exception:
        	state  : %
        	message: %
        	detail : %
        	hint   : %
        	context: %
        	SQLSTATE: % 
        	SQLERRM: %', v_state, v_msg, v_detail, v_hint, v_context, SQLSTATE, SQLERRM;
			*/
			RAISE EXCEPTION '%', out_message;

END; 
$procedure$;
