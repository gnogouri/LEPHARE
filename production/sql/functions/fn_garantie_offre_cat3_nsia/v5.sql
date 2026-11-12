-- Migration production 0176 : montants et taux du moteur écrits jusqu'ici dans la fonction lus dans les réglages
-- « Montants du moteur » (Administration > Réglages par branche > Automobile > Barème automobile),
-- fn_lephare_auto_constante(compagnie, groupe, code, valeur d'origine). Valeurs d'origine identiques : mêmes calculs.
CREATE OR REPLACE FUNCTION public.fn_garantie_offre_cat3_nsia(idcompagnie_ integer, idoffre_ integer, idtarif_ integer, valneuve_ numeric, valvenale_ numeric, valaccessoire_ numeric, puissance_ integer, codecarburant_ integer, tonnage_ integer, tauxreduc_ numeric, codealarme_ integer, dateeffet_ date, dateexpiration_ date, bns_ numeric, datemec_ date, remorqueattelee_ boolean, formulesecuriteroutiere_ character varying, nombreplace_ integer, codeusage_ integer DEFAULT NULL::integer, carburantautrematiere_ boolean DEFAULT NULL::boolean, transporteleves_ boolean DEFAULT NULL::boolean, transportemployes_ boolean DEFAULT NULL::boolean, transportpassagersupplementaire_ boolean DEFAULT NULL::boolean, nsiaautoplus_ boolean DEFAULT NULL::boolean, idoptionassistance_ integer DEFAULT NULL::integer)
 RETURNS TABLE(idgarantie integer, libellegarantie character varying, idsousgarantie integer, libellesousgarantie character varying, acquise boolean, capital numeric, nombreplace smallint, primeannuelle numeric, primenette numeric, taxe numeric, montantaccessoire numeric, tauxfranchise numeric, franchiseminimum numeric, franchisemaximum numeric, franchisetexte character varying, idformule integer, capitaldeces numeric, capitalipp numeric, capitalft numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
	var_rec RECORD;
	prime_rc numeric;
	prime_fga numeric;
	prime_cedeao numeric;
    capital_rc numeric;
	taux_reduction numeric;
	duree_contrat integer;
	duree_contrat_en_mois integer;
	duree_totale integer;
	debut_annee date;
	fin_annee date;
	dommage bool;
	age_vehicule integer;
	id_formule integer;
	prime_assist_car numeric;
	prime_minimum numeric;
	nsia_auto_plus_trouvee boolean;
	code_usage_char character varying(3);
	--Traitement relatif aux sous-garanties Assistance et aux sous-garanties "Dépannage et remorquage", "Véhicule de remplacement"
	exclure_depannage_remplacement boolean;
	assistance_materielle_parametree boolean;

	----Pour le calcul des totaux des composantes de prime
	taux_taxe numeric;
	prime_annuelle_totale numeric;
	prime_nette_totale numeric;
	v_accessoire numeric;
	v_accessoire_intermediaire numeric;
	taxe_accessoire numeric;
	taxe_totale numeric;
BEGIN
	
	age_vehicule := EXTRACT ('year' FROM AGE(CURRENT_DATE, datemec_))::integer;
	-- IF idoffre_ IN (93, 99) AND (age_vehicule < 5 OR age_vehicule > 10) THEN
	-- 	RETURN;
	-- END IF;

	IF idoffre_ IN (93, 99) AND (age_vehicule > 5) THEN
		RETURN;
	END IF;

	idoptionassistance_ := COALESCE(idoptionassistance_, 0);
	--debut_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS VARCHAR(4)),'-01-01') AS DATE);
	--fin_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS VARCHAR(4)),'-12-31') AS DATE);
	--duree_totale := fin_annee - debut_annee + 1;
	duree_totale := fn_get_duree_annuelle_contrat(dateeffet_);
	duree_contrat := dateexpiration_ - dateeffet_ + 1;
	duree_contrat_en_mois := EXTRACT ('month' FROM AGE(dateexpiration_, dateeffet_))::integer + 12 * EXTRACT ('year' FROM AGE(dateexpiration_, dateeffet_))::integer;
	capital_rc := fn_lephare_auto_constante(idcompagnie_, 'cat3', 'capital_rc', 4000000000);
	dommage := False;
	nsia_auto_plus_trouvee := False;
	assistance_materielle_parametree := False;

	SELECT CodeUsage
	INTO code_usage_char
	FROM StdUsage
	WHERE IdUsage = codeusage_;
	code_usage_char := COALESCE(code_usage_char, '000');
	
	IF idcompagnie_ = 1 THEN ---- Recherche de l'IdFormule Securité routière------
		SELECT SR.IdFormule
		INTO id_formule
		FROM StdFormuleSecuriteRoutiere AS SR
		WHERE (SR.IdCompagnie = idcompagnie_) AND (SR.LibelleFormule = formulesecuriteroutiere_)
		      AND (SR.NombrePlace = CASE WHEN nombreplace_ < 4 THEN 3 ELSE nombreplace_ END)
		LIMIT 1;
	ELSE 
		SELECT SR.IdFormule
		INTO id_formule
		FROM StdFormuleSecuriteRoutiere AS SR
		WHERE (SR.IdCompagnie = idcompagnie_) AND (SR.LibelleFormule = formulesecuriteroutiere_)
		LIMIT 1;
	END IF;
	id_formule := COALESCE(id_formule, 0);

	---La reduction bns est exprimée en valeur entière. On calcule le coefficient multiplicateur.
	bns_ := (100 - bns_)/100;
	
	IF EXISTS (SELECT * FROM StdOffreGarantie AS SOG
			   WHERE IdOffre = idoffre_ AND IdCompagnie = idcompagnie_ AND SOG.IdSousGarantie IN (7,8)) THEN
			   dommage := True;
	END IF; 

	--Exclure les sous-garanties "Dépannage et remorquage" et "Véhicule de remplacement"?
	exclure_depannage_remplacement := fn_exclure_depannage_remplacement(idcompagnie_, idoffre_, idoptionassistance_);
	
	SELECT TauxReduction
	INTO taux_reduction 
	FROM StdSystemeSecurite
	WHERE IdSystemeSecurite = codealarme_;
	taux_reduction := COALESCE(taux_reduction, 0);
	
	IF code_usage_char = '017' THEN
		prime_rc := fn_lephare_auto_constante(idcompagnie_, 'cat3', 'rc_tracteur_routier', 489000); --489000
	ELSE
		SELECT PrimeGar
		INTO prime_rc
		FROM StdTarifDetail AS STD
		WHERE IdTarif = idtarif_ AND STD.IdGarantie = 1
		  		AND (puissance_ BETWEEN PuissanceMin AND PuissanceMax)
		  		AND (tonnage_ BETWEEN TonnageMin AND TonnageMax)
		  		AND CodeCarburant = 3;
	END IF;
	prime_rc := COALESCE(prime_rc, 0);
	
	IF remorqueattelee_ THEN
		prime_rc := ROUND(prime_rc * (1 + fn_lephare_auto_constante(idcompagnie_, 'cat3', 'surprime_remorque', 10) / 100.0), 0);
	END IF;
	
	IF idcompagnie_ = 1 AND carburantautrematiere_ THEN
		prime_rc := ROUND(prime_rc * (1 + fn_lephare_auto_constante(idcompagnie_, 'cat3', 'surprime_matieres_inflammables', 10) / 100.0), 0);
	END IF;
	
    SELECT PrimeGar
	INTO prime_cedeao
	FROM StdTarifDetail AS STD
	WHERE IdTarif = idtarif_ 
	      AND STD.IdGarantie = 3
		  AND (puissance_ between PuissanceMin and PuissanceMax)
		  AND (tonnage_ between TonnageMin and TonnageMax);
	prime_cedeao := COALESCE(prime_cedeao, 0);
       
	prime_fga := ROUND((prime_rc*fn_lephare_auto_constante(idcompagnie_, 'cat3', 'fga_taux', 2))/100,0);

 --    prime_assist_car := 8500;
	-- IF dommage THEN
	-- 	prime_assist_car := 35000;
	-- END IF;
	
	---Initialisation des cumuls
	prime_annuelle_totale := 0;
	prime_nette_totale := 0;
	v_accessoire := 0;
	v_accessoire_intermediaire := 0;
	taxe_totale := 0;
    FOR var_rec IN (
                    SELECT StdSousGarantie.IdGarantie AS id_gar, StdGarantie.LibelleGarantie AS lib_gar,
                             StdOffreGarantie.IdSousGarantie AS id_sous_gar, StdSousGarantie.LibelleSousGarantie AS lib_sous_gar,
                            True AS acq, 0 AS cap, 0 AS nbr, 0 AS prime_ann, 0 AS prime_n, 0 AS taxe_enregistrement, 0 AS montant_accessoire,
		                    StdOffreGarantie.TauxFranchise AS tx_franchise, StdOffreGarantie.FranchiseMinimum AS franchise_min, StdOffreGarantie.FranchiseMaximum AS franchise_max,
		                    ' ' AS franchise_txt, 0 AS id_form, 0 AS deces, 0 AS ipp, 0 AS ft 
	                FROM StdOffreGarantie
	                INNER JOIN StdSousGarantie ON(StdSousGarantie.IdSousGarantie=StdOffreGarantie.IdSousGarantie)
	                INNER JOIN StdGarantie ON(StdGarantie.IdGarantie=StdSousGarantie.IdGarantie)
	                WHERE (IdOffre = idoffre_) AND (IdCompagnie = idcompagnie_)  AND (StdOffreGarantie.IdSousGarantie <> 2) --Ignorer la garantie FGA même si elle est confugurée. Elle est une composante de prime et traitée comme telle.
                	ORDER BY 1,3
                   )
    LOOP
		IF (idoffre_ IN (2, 46, 50)) AND (var_rec.id_sous_gar = 5) THEN --Exclure la garantie Recours anticipé des offres TOUS RISQUES
			CONTINUE;
		END IF;

		--Traitement des garanties Assistance
		IF (var_rec.id_sous_gar IN (22, 174, 176, 177, 178, 179)) AND fn_exclure_garantie_assistance(idoffre_, var_rec.id_sous_gar, duree_contrat_en_mois) THEN
			CONTINUE;
		END IF;

		--Si les sous-garanties "Dépannage et remorquage" et "Véhicule de remplacement" sont paramétrées alors qu'une sous-garantie
		--Assistance doit être choisie, dans ce cas ignorer les 2 premières sous-garanties pour les nouvelles offres Auto
		IF (var_rec.id_sous_gar IN (147, 148)) AND exclure_depannage_remplacement THEN
			CONTINUE;
		END IF;
		
		---Traitement des garanties Sécurité Routière et Personnes transportées
		IF (var_rec.id_sous_gar IN (163, 169)) THEN
			IF NOT fn_retenir_garantie_securite_routiere(idtarif_, var_rec.id_sous_gar) THEN
				CONTINUE;
			END IF;
		END IF;
		
        IdGarantie := var_rec.id_gar;
        LibelleGarantie := var_rec.lib_gar;
        IdSousGarantie := var_rec.id_sous_gar;
        LibelleSousGarantie := var_rec.lib_sous_gar;
        Acquise := var_rec.acq;
        Capital := COALESCE(var_rec.cap, 0.0);
        NombrePlace := COALESCE(var_rec.nbr, 0.0);
        PrimeAnnuelle := COALESCE(var_rec.prime_ann, 0.0);
        PrimeNette := COALESCE(var_rec.prime_n, 0.0);
		Taxe := COALESCE(var_rec.taxe_enregistrement, 0.0);
		MontantAccessoire := COALESCE(var_rec.montant_accessoire, 0.0);
		TauxFranchise := COALESCE(var_rec.tx_franchise, 0.0);
		FranchiseMinimum := COALESCE(var_rec.franchise_min, 0.0);
		FranchiseMaximum := COALESCE(var_rec.franchise_max, 0.0);
		FranchiseTexte := COALESCE(var_rec.franchise_txt, '');
		IdFormule := COALESCE(var_rec.id_form, 0);
		CapitalDeces := COALESCE(var_rec.deces, 0.0);
		CapitalIPP := COALESCE(var_rec.ipp, 0.0);
		CapitalFT := COALESCE(var_rec.ft, 0.0);

		IF (idoffre_ BETWEEN 89 AND 99) AND (var_rec.id_sous_gar = 164) THEN
			Capital := fn_lephare_auto_constante(idcompagnie_, 'cat3', 'capital_recours_incendie', 500000000);
		END IF;
		
        IF (var_rec.id_gar = 1) THEN
            IF (var_rec.id_sous_gar = 1) THEN
                PrimeAnnuelle := prime_rc;
                PrimeNette := prime_rc;
                Capital := capital_rc;
            ELSIF (var_rec.id_sous_gar = 2) THEN
                PrimeAnnuelle := prime_fga;
                PrimeNette := prime_fga;
            ELSIF (var_rec.id_sous_gar = 3) THEN
                PrimeAnnuelle := prime_cedeao;
                PrimeNette := prime_cedeao;
            END IF;
        ELSIF  (var_rec.id_sous_gar IN (163, 169)) THEN
			SELECT SR.CapitalDeces, SR.CapitalIPP, SR.CapitalFT, SR.PrimeNette
			INTO CapitalDeces, CapitalIPP, CapitalFT, PrimeNette
			FROM StdFormuleSecuriteRoutiere AS SR
			WHERE SR.IdFormule = id_formule AND SR.IdCompagnie = idcompagnie_
			LIMIT 1;
			CapitalDeces := COALESCE(CapitalDeces,0);
			CapitalIPP := COALESCE(CapitalIPP, 0.0);
			CapitalFT := COALESCE(CapitalFT, 0.0);
			PrimeNette := COALESCE(PrimeNette, 0.0);
			PrimeAnnuelle := PrimeNette;
			IdFormule := id_formule;
		ELSIF (var_rec.id_sous_gar = 4) THEN
			PrimeAnnuelle := prime_rc * fn_lephare_auto_constante(idcompagnie_, 'cat3', 'defense_recours_taux_rc', 10) / 100.0;
			PrimeNette := PrimeAnnuelle;
		ELSIF (var_rec.id_sous_gar = 5) THEN
			SELECT COALESCE(PrimeGar, 0.0)
			INTO PrimeAnnuelle
			FROM StdTarifDetail AS STD
			WHERE IdTarif = idtarif_ AND STD.IdGarantie = var_rec.id_sous_gar
			LIMIT 1;
			PrimeAnnuelle := COALESCE(PrimeAnnuelle, 0);
			PrimeNette := PrimeAnnuelle;
		ELSIF (var_rec.id_sous_gar IN (7, 8, 9, 172)) THEN
			SELECT valneuve_ AS cap, (valneuve_ * Taux) /1000  AS prime
			INTO Capital, PrimeAnnuelle
			FROM StdTarifDetail AS STD
			WHERE IdTarif = idtarif_ AND STD.IdGarantie = var_rec.id_sous_gar
			LIMIT 1;
			Capital := COALESCE(Capital, 0);
			PrimeAnnuelle := COALESCE(PrimeAnnuelle, 0);
			PrimeNette := PrimeAnnuelle;
		ELSIF (var_rec.id_sous_gar IN (10, 11, 12, 13, 14, 15)) THEN
			IF (var_rec.id_sous_gar IN (10, 11, 12, 13)) THEN
				Capital := valvenale_;
			ELSE
				Capital := valaccessoire_;
			END IF;
			IF age_vehicule <= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'age_vehicule_neuf', 2) THEN
				IF var_rec.id_sous_gar = 10 THEN
					PrimeAnnuelle := CASE WHEN Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_neuf_1', 50015)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_neuf_2', 83360)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_neuf_3', 133380)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_5', 16000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_neuf_4', 216740)
										  ELSE fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_neuf_5', 333445)
									END;
					PrimeNette := PrimeAnnuelle;
				END IF;
				IF var_rec.id_sous_gar = 12 THEN
					PrimeAnnuelle := CASE WHEN Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_neuf_1', 9205)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_neuf_2', 15345)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_neuf_3', 24550)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_5', 16000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_neuf_4', 39890)
										  ELSE fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_neuf_5', 61375)
									END;
					PrimeNette := PrimeAnnuelle;
				END IF;
				IF var_rec.id_sous_gar = 13 THEN
					PrimeAnnuelle := CASE WHEN Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_neuf_1', 18410)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_neuf_2', 30690)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_neuf_3', 49100)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_5', 16000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_neuf_4', 79780)
										  ELSE fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_neuf_5', 122750)
									END;
					PrimeNette := PrimeAnnuelle;
				END IF;
			ELSE
				IF var_rec.id_sous_gar = 10 THEN
					PrimeAnnuelle := CASE WHEN Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_ancien_1', 24815)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_ancien_2', 41875)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_ancien_3', 66690)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_5', 16000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_ancien_4', 108565)
										  ELSE fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_10_ancien_5', 166725)
									END;
					PrimeNette := PrimeAnnuelle;
				END IF;
				IF var_rec.id_sous_gar = 12 THEN
					PrimeAnnuelle := CASE WHEN Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_ancien_1', 4565)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_ancien_2', 7705)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_ancien_3', 12275)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_5', 16000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_ancien_4', 19980)
										  ELSE fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_12_ancien_5', 30685)
									END;
					PrimeNette := PrimeAnnuelle;
				END IF;
				IF var_rec.id_sous_gar = 13 THEN
					PrimeAnnuelle := CASE WHEN Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_ancien_1', 9130)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_2', 4000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_ancien_2', 15410)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_3', 6000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_ancien_3', 24550)
										  WHEN Capital >= fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_4', 10000001) AND Capital < fn_lephare_auto_constante(idcompagnie_, 'cat3', 'tranche_5', 16000001) THEN fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_ancien_4', 39960)
										  ELSE fn_lephare_auto_constante(idcompagnie_, 'cat3', 'grille_13_ancien_5', 61370)
									 END;
					PrimeNette := PrimeAnnuelle;
				END IF;
			END IF;
			IF carburantautrematiere_ AND var_rec.id_sous_gar IN (10, 11) THEN
				PrimeAnnuelle := PrimeAnnuelle * fn_lephare_auto_constante(idcompagnie_, 'cat3', 'incendie_coefficient_inflammables', 2);
				PrimeNette := PrimeNette * fn_lephare_auto_constante(idcompagnie_, 'cat3', 'incendie_coefficient_inflammables', 2);
			END IF;
			--Vol des accessoires et vandalisme : taux sur la valeur des accessoires, prime minimum du tarif
			IF var_rec.id_sous_gar IN (14, 15) THEN
				SELECT CASE WHEN ((valaccessoire_ * Taux) /1000) > PrimeMin THEN ((valaccessoire_ * Taux) /1000) ELSE PrimeMin END
				INTO PrimeAnnuelle
				FROM StdTarifDetail AS STD
				WHERE IdTarif = idtarif_ AND STD.IdGarantie = var_rec.id_sous_gar
				LIMIT 1;
				PrimeAnnuelle := ROUND(COALESCE(PrimeAnnuelle, 0.0), 0);
				PrimeNette := PrimeAnnuelle;
			END IF;
		-- ELSIF (var_rec.id_sous_gar = 22) THEN
		-- 	PrimeAnnuelle := COALESCE(prime_assist_car, 0.0);
		-- 	PrimeNette := COALESCE(prime_assist_car, 0.0);
		-- END IF;

		--Traitement de la garantie Sécurité Routière pour les nouvelles offres
		ELSIF (var_rec.id_sous_gar = 169) AND (idoffre_ BETWEEN 88 AND 99) THEN
			SELECT FSC.capitaldeces, FSC.capitalipp, FSC.capitalft, FSC.primenette
			INTO CapitalDeces, CapitalIPP, CapitalFT, PrimeAnnuelle
			FROM public.stdformulesecuriteroutiere AS FSC
			WHERE FSC.idformule = id_formule AND FSC.nombreplace = nombreplace_ AND FSC.idcompagnie = idcompagnie_;
			CapitalDeces := COALESCE(CapitalDeces, fn_lephare_auto_constante(idcompagnie_, 'cat3', 'sr_capital_deces', 2000000));
			CapitalIPP := COALESCE(CapitalIPP, fn_lephare_auto_constante(idcompagnie_, 'cat3', 'sr_capital_ipp', 2000000));
			CapitalFT := COALESCE(CapitalFT, fn_lephare_auto_constante(idcompagnie_, 'cat3', 'sr_capital_ft', 200000));
			PrimeAnnuelle := COALESCE(PrimeAnnuelle, fn_lephare_auto_constante(idcompagnie_, 'cat3', 'sr_prime', 6000));
			PrimeNette := PrimeAnnuelle;
		--Traitement de la garantie Assistance psychologique pour les offres BAOBAB et EBEN
		ELSIF (var_rec.id_sous_gar = 174) AND (idoffre_ IN (91, 92, 93, 97, 98, 99)) THEN
			PrimeAnnuelle := fn_lephare_auto_constante(idcompagnie_, 'cat3', 'assistance_psychologique', 2000);
			PrimeNette := PrimeAnnuelle;
		--Traitement de la garantie NSIA AUTO +
		ELSIF (var_rec.id_sous_gar = 175) THEN
			IF NOT fn_retenir_garantie_nsia_auto_plus(idoffre_, age_vehicule, nsiaautoplus_) THEN
				CONTINUE;
			END IF;
			nsia_auto_plus_trouvee := True;
			PrimeAnnuelle := fn_calcul_prime_nsia_auto_plus(idtarif_, idoffre_, var_rec.id_sous_gar, valvenale_);
			PrimeNette := PrimeAnnuelle;

				---Les sous-garanties Assistance matérielle sont-elles paramétrées pour cette offre ?
		ELSIF (var_rec.id_sous_gar IN (176, 177, 178, 179)) THEN
			assistance_materielle_parametree := True;
		END IF;

		--Prime minimum de la garantie (Administration > Réglages Automobile > Règles des garanties)
		prime_minimum := fn_lephare_regle_auto(idcompagnie_, idoffre_, idtarif_, var_rec.id_sous_gar, 'PRIME_MINIMUM');
		IF prime_minimum IS NOT NULL AND COALESCE(PrimeAnnuelle, 0) > 0 AND PrimeAnnuelle < prime_minimum THEN
			PrimeAnnuelle := prime_minimum;
			PrimeNette := prime_minimum;
		END IF;
		
        --Règle de gestion applicable au vol 
		IF var_rec.id_gar = 5 THEN
		    PrimeNette := COALESCE(PrimeNette, 0.0);
			PrimeNette := ROUND(PrimeNette - ((PrimeNette * COALESCE(taux_reduction,0))/100),0);
		END IF;
		--Règle dommage : bris de glace accordé avec les dommages ou la collision --
		IF dommage AND var_rec.id_sous_gar = 9 THEN
			Acquise := True;
		END IF;
		--Règles des garanties appliquées par le barème (Administration > Réglages Automobile > Règles des garanties) :
		--garantie offerte ou à prime forfaitaire quand l'offre contient une des garanties liées (NSIA : bris de glace et
		--recours anticipé sans prime, défense-recours 4 200 F, avec les dommages ou la collision)
		IF fn_lephare_regle_auto(idcompagnie_, idoffre_, idtarif_, var_rec.id_sous_gar, 'OFFERTE_SI') IS NOT NULL THEN
			PrimeNette := 0;
		END IF;
		IF fn_lephare_regle_auto(idcompagnie_, idoffre_, idtarif_, var_rec.id_sous_gar, 'PRIME_SI') IS NOT NULL THEN
			PrimeNette := fn_lephare_regle_auto(idcompagnie_, idoffre_, idtarif_, var_rec.id_sous_gar, 'PRIME_SI');
		END IF;
		
 		-----Calcul de la reduction commerciale---------------------------
		PrimeNette := fn_calcul_reduction_commerciale(var_rec.id_gar, var_rec.id_sous_gar, PrimeNette, tauxreduc_);
		
		--Détermination de la Prime de la période de couverture---------------------
		PrimeNette := fn_calcul_prime_prorata(var_rec.id_sous_gar, PrimeNette, bns_, duree_contrat, dateeffet_);
				
		PrimeAnnuelle:= COALESCE(PrimeAnnuelle, 0.0);
		PrimeNette := COALESCE(PrimeNette, 0.0);
		
		---Calcul de la taxe
		Taxe := fn_calcul_montant_taxe(1, var_rec.id_sous_gar, PrimeNette, dateeffet_);
				
		---Faire le cumul des 2 composantes de prime (prime nette et taxe)
		prime_annuelle_totale := prime_annuelle_totale + PrimeAnnuelle;
		prime_nette_totale := prime_nette_totale + PrimeNette;
		taxe_totale := taxe_totale + Taxe;
		-------------------------------Traitement du texte de la franchise-------------------------
		FranchiseTexte := fn_franchise_texte(TauxFranchise, FranchiseMinimum, FranchiseMaximum);
						  
		--Calculer le montant du FGA et l'ajouter à la prime nette totale
		IF var_rec.id_gar = 1  AND var_rec.id_sous_gar = 1 THEN
			prime_annuelle_totale := prime_annuelle_totale + ROUND((PrimeAnnuelle * fn_lephare_auto_constante(idcompagnie_, 'cat3', 'fga_taux', 2)) / 100, 0);
			prime_nette_totale := prime_nette_totale + ROUND((PrimeNette * fn_lephare_auto_constante(idcompagnie_, 'cat3', 'fga_taux', 2)) / 100, 0);
		END IF;
		
        RETURN NEXT;

    END LOOP;

	---Ajouter la sous-garantie NSIA AUTO +
	--IF (idoffre_ IN (2, 46, 50, 57, 93, 99) OR nsiaautoplus_) AND NOT nsia_auto_plus_trouvee THEN
	IF NOT nsia_auto_plus_trouvee AND fn_retenir_garantie_nsia_auto_plus(idoffre_, age_vehicule, nsiaautoplus_) THEN
		SELECT SSG.IdGarantie, SG.LibelleGarantie, SSG.IdSousGarantie, SSG.LibelleSousGarantie
		INTO IdGarantie, LibelleGarantie, IdSousGarantie, LibelleSousGarantie
		FROM StdSousGarantie AS SSG
		INNER JOIN StdGarantie AS SG ON (SSG.IdGarantie = SG.IdGarantie)
		WHERE SSG.IdSousGarantie = 175;
		Acquise := True;
		Capital := 0.0;
		NombrePlace := 0;
		PrimeAnnuelle := fn_calcul_prime_nsia_auto_plus(idtarif_, idoffre_, 175, valvenale_);
		PrimeNette := PrimeAnnuelle;

		-----Calcul de la reduction commerciale---------------------------
		PrimeNette := fn_calcul_reduction_commerciale(3, 175, PrimeNette, tauxreduc_);
		--Détermination de la Prime de la période de couverture---------------------
		PrimeNette := fn_calcul_prime_prorata(175, PrimeNette, bns_, duree_contrat, dateeffet_);
		
		Taxe := fn_calcul_montant_taxe(1, 175, PrimeNette, dateeffet_);
		MontantAccessoire := 0.0;
		TauxFranchise := 0.0;
		FranchiseMinimum := 0.0;
		FranchiseMaximum := 0.0;
		FranchiseTexte := '';
		IdFormule := 0;
		CapitalDeces := 0.0;
		CapitalIPP := 0.0;
		CapitalFT := 0.0;

		---Faire le cumul des 2 composantes de prime (prime nette et taxe)
		prime_annuelle_totale := prime_annuelle_totale + PrimeAnnuelle;
		prime_nette_totale := prime_nette_totale + PrimeNette;
		taxe_totale := taxe_totale + Taxe;
		-------------------------------Traitement du texte de la franchise-------------------------
		FranchiseTexte := fn_franchise_texte(TauxFranchise, FranchiseMinimum, FranchiseMaximum);
		
		RETURN NEXT;
		
	END IF;

	---Ajout de la sous-garantie Assistance (qui est gratuite) si elle ne l'a pas été déjà dans la boucle
	IF (idoptionassistance_ <> 0) AND (NOT assistance_materielle_parametree) AND fn_option_assistance_compatible_offre(idoffre_, idoptionassistance_) THEN
		SELECT SSG.IdGarantie, SG.LibelleGarantie, SSG.IdSousGarantie, SSG.LibelleSousGarantie
		INTO IdGarantie, LibelleGarantie, IdSousGarantie, LibelleSousGarantie
		FROM StdSousGarantie AS SSG
		INNER JOIN StdGarantie AS SG ON (SSG.IdGarantie = SG.IdGarantie)
		WHERE SSG.IdSousGarantie = fn_obtenir_garantie_assistance(idoptionassistance_);
		Acquise := True;
		Capital := 0.0;
		NombrePlace := 0;
		PrimeAnnuelle := 0;
		PrimeNette := 0;
		Taxe := 0;
		MontantAccessoire := 0.0;
		TauxFranchise := 0.0;
		FranchiseMinimum := 0.0;
		FranchiseMaximum := 0.0;
		FranchiseTexte := '';
		IdFormule := 0;
		CapitalDeces := 0.0;
		CapitalIPP := 0.0;
		CapitalFT := 0.0;
		-------------------------------Traitement du texte de la franchise-------------------------
		FranchiseTexte := fn_franchise_texte(TauxFranchise, FranchiseMinimum, FranchiseMaximum);
		
		RETURN NEXT;

	END IF;
	
	---Calcul de l'accessoire
	SELECT * 
	INTO v_accessoire, v_accessoire_intermediaire, taxe_accessoire
	FROM fn_get_accessoire(prime_nette_totale, 1, idoffre_, idcompagnie_, dateeffet_);
	
	--- Retourner la ligne des cumuls
	IdGarantie := 0;
	LibelleGarantie := 'CUMUL DES MONTANTS DES GARANTIES';
	IdSousGarantie := 0;
	LibelleSousGarantie := 'CUMUL DES MONTANTS DES S/GARANTIES';
	Acquise := True;
	Capital := 0.0;
	NombrePlace := 0.0;
    PrimeAnnuelle := prime_annuelle_totale;
	PrimeNette := prime_nette_totale;
	Taxe := taxe_totale + taxe_accessoire;
	MontantAccessoire := v_accessoire + v_accessoire_intermediaire;
	TauxFranchise := 0.0;
	FranchiseMinimum := 0.0;
	FranchiseMaximum := 0.0;
	FranchiseTexte := '';
	IdFormule :=  0.0;
	CapitalDeces :=  0.0;
	CapitalIPP :=  0.0;
	CapitalFT :=  0.0;
	
	RETURN NEXT;
	
END; 
$function$;
