-- Migration production 0176 : montants et taux du moteur écrits jusqu'ici dans la fonction lus dans les réglages
-- « Montants du moteur » (Administration > Réglages par branche > Automobile > Barème automobile),
-- fn_lephare_auto_constante(compagnie, groupe, code, valeur d'origine). Valeurs d'origine identiques : mêmes calculs.
CREATE OR REPLACE FUNCTION public.fn_garantie_offre_cat5_sunu(idcompagnie_ integer, idoffre_ integer, idtarif_ integer, valneuve_ numeric, valvenale_ numeric, valaccessoire_ numeric, puissance_ integer, codecarburant_ integer, tonnage_ integer, tauxreduc_ numeric, codealarme_ integer, dateeffet_ date, dateexpiration_ date, bns_ numeric, datemec_ date, remorqueattelee_ boolean, formulesecuriteroutiere_ character varying, nombreplace_ integer, codeusage_ integer DEFAULT NULL::integer, carburantautrematiere_ boolean DEFAULT NULL::boolean, transporteleves_ boolean DEFAULT NULL::boolean, transportemployes_ boolean DEFAULT NULL::boolean, transportpassagersupplementaire_ boolean DEFAULT NULL::boolean)
 RETURNS TABLE(idgarantie integer, libellegarantie character varying, idsousgarantie integer, libellesousgarantie character varying, acquise boolean, capital numeric, nombreplace smallint, primeannuelle numeric, primenette numeric, taxe numeric, montantaccessoire numeric, tauxfranchise numeric, franchiseminimum numeric, franchisemaximum numeric, franchisetexte character varying, idformule integer, capitaldeces numeric, capitalipp numeric, capitalft numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
	var_rec RECORD;
	prime_rc numeric;
	prime_fga numeric;
	prime_cedeao numeric;
   	capital_rc_corporelle numeric;
	capital_rc_materielle numeric;
	taux_reduction numeric;
	duree_contrat integer;
	duree_totale integer;
	debut_annee date;
	fin_annee date;
	dommage bool;
	age_vehicule integer;
	id_formule integer;
	prime_assist_car numeric;
	prime_minimum numeric;

	----Pour le calcul des totaux des composantes de prime
	taux_taxe numeric;
	prime_annuelle_totale numeric;
	prime_nette_totale numeric;
	v_accessoire numeric;
	v_accessoire_intermediaire numeric;
	taxe_accessoire numeric;
	taxe_totale numeric;
BEGIN

	--debut_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS VARCHAR(4)),'-01-01') AS DATE);
	--fin_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS VARCHAR(4)),'-12-31') AS DATE);
	--duree_totale := fin_annee - debut_annee + 1;
	duree_totale := fn_get_duree_annuelle_contrat(dateeffet_);
	duree_contrat := dateexpiration_ - dateeffet_ + 1;
	capital_rc_corporelle := fn_lephare_auto_constante(idcompagnie_, 'cat5', 'capital_rc_corporel', 3500000000);
	capital_rc_materielle := fn_lephare_auto_constante(idcompagnie_, 'cat5', 'capital_rc_materiel', 500000000);
	dommage := False;
	age_vehicule := EXTRACT ('year' FROM AGE(CURRENT_DATE, datemec_))::integer;
	
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
	
	SELECT TauxReduction
	INTO taux_reduction 
	FROM StdSystemeSecurite
	WHERE IdSystemeSecurite = codealarme_;
	taux_reduction := COALESCE(taux_reduction, 0);
	
	
	SELECT PrimeGar
	INTO prime_rc
	FROM StdTarifDetail AS STD
	WHERE IdTarif = idtarif_ AND STD.IdGarantie = 1
		  AND (puissance_ BETWEEN PuissanceMin AND PuissanceMax);
--		  AND (tonnage_ BETWEEN TonnageMin AND TonnageMax)
--		  AND CodeCarburant = codecarburant_;
	prime_rc := COALESCE(prime_rc, 0);
	
--	IF remorqueattelee_ THEN
--		prime_rc := ROUND(prime_rc * 1.1, 0);
--	END IF;
	
--     SELECT PrimeGar
-- 	INTO prime_cedeao
-- 	FROM StdTarifDetail AS STD
-- 	WHERE IdTarif = idtarif_ 
-- 	      AND STD.IdGarantie = 3
-- 		  AND (puissance_ between PuissanceMin and PuissanceMax)
-- 		  AND (tonnage_ between TonnageMin and TonnageMax);
	prime_cedeao := 0;
       
	prime_fga := ROUND((prime_rc*fn_lephare_auto_constante(idcompagnie_, 'cat5', 'fga_taux', 2))/100,0);

--  prime_assist_car := 8500;
--	IF dommage THEN
--		prime_assist_car := 35000;
--	END IF;
	
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
        IF (var_rec.id_gar = 1) THEN
            IF (var_rec.id_sous_gar = 1) THEN
                PrimeAnnuelle := prime_rc;
                PrimeNette := prime_rc;
                Capital := capital_rc_corporelle;
            ELSIF (var_rec.id_sous_gar = 2) THEN
                PrimeAnnuelle := prime_fga;
                PrimeNette := prime_fga;
            ELSIF (var_rec.id_sous_gar = 3) THEN
                PrimeAnnuelle := prime_cedeao;
                PrimeNette := prime_cedeao;
			ELSIF (var_rec.id_sous_gar = 165) THEN
				PrimeAnnuelle := 0;
        		PrimeNette := 0;
				Capital := capital_rc_materielle;
            END IF;
--         ELSIF  (var_rec.id_sous_gar = 163) THEN
-- 			SELECT SR.CapitalDeces, SR.CapitalIPP, SR.CapitalFT, SR.PrimeNette
-- 			INTO CapitalDeces, CapitalIPP, CapitalFT, PrimeNette
-- 			FROM StdFormuleSecuriteRoutiere AS SR
-- 			WHERE SR.IdFormule = id_formule AND SR.IdCompagnie = idcompagnie_
-- 			LIMIT 1;
-- 			CapitalDeces := COALESCE(CapitalDeces,0);
-- 			CapitalIPP := COALESCE(CapitalIPP, 0.0);
-- 			CapitalFT := COALESCE(CapitalFT, 0.0);
-- 			PrimeNette := COALESCE(PrimeNette, 0.0);
-- 			PrimeAnnuelle := PrimeNette;
-- 			IdFormule := id_formule;
		ELSIF (var_rec.id_sous_gar IN (4,5,16)) THEN
			SELECT COALESCE(PrimeGar, 0.0)
			INTO PrimeAnnuelle
			FROM StdTarifDetail AS STD
			WHERE STD.IdTarif = idtarif_ 
					AND STD.IdGarantie = var_rec.id_sous_gar
					AND (puissance_ between STD.PuissanceMin and STD.PuissanceMax)
			LIMIT 1;
			PrimeAnnuelle := COALESCE(PrimeAnnuelle, 0);
			PrimeNette := PrimeAnnuelle;
-- 		ELSIF (var_rec.id_sous_gar IN (7, 8, 9)) THEN
-- 			SELECT valneuve_ AS cap, (valneuve_ * Taux) /1000  AS prime
-- 			INTO Capital, PrimeAnnuelle
-- 			FROM StdTarifDetail AS STD
-- 			WHERE IdTarif = idtarif_ AND STD.IdGarantie = var_rec.id_sous_gar
-- 			LIMIT 1;
-- 			Capital := COALESCE(Capital, 0);
-- 			PrimeAnnuelle := COALESCE(PrimeAnnuelle, 0);
-- 			PrimeNette := PrimeAnnuelle;
		
-- 		ELSIF (var_rec.id_sous_gar IN (10, 11, 12, 13)) THEN
-- 			SELECT  valvenale_ AS cap, CASE WHEN ((valvenale_ * Taux) /1000) > PrimeMin THEN ((valvenale_ * Taux) /1000) ELSE PrimeMin END AS prime
-- 			INTO Capital, PrimeAnnuelle
-- 			FROM StdTarifDetail AS STD
-- 			WHERE IdTarif = idtarif_ AND STD.IdGarantie = var_rec.id_sous_gar
-- 			LIMIT 1;
-- 			Capital := COALESCE(Capital, 0.0);
-- 			PrimeAnnuelle := ROUND(COALESCE(PrimeAnnuelle, 0.0),0); 
-- 			PrimeNette := PrimeAnnuelle; 
			
		ELSIF (var_rec.id_sous_gar IN (12, 13)) THEN
			SELECT  valvenale_ AS cap, ((valvenale_ * Taux) /1000) AS prime
			INTO Capital, PrimeAnnuelle
			FROM StdTarifDetail AS STD
			WHERE STD.IdTarif = idtarif_
				AND STD.IdGarantie = var_rec.id_sous_gar
				AND (puissance_ between STD.PuissanceMin and STD.PuissanceMax)
			LIMIT 1;
			Capital := COALESCE(Capital, 0.0);
			PrimeAnnuelle := ROUND(COALESCE(PrimeAnnuelle, 0.0),0); 
			PrimeNette := PrimeAnnuelle; 
-- 		ELSIF (var_rec.id_sous_gar IN (14, 15)) THEN
-- 			SELECT  valaccessoire_ AS cap, CASE WHEN ((valaccessoire_ * Taux) /1000) > PrimeMin THEN ((valaccessoire_ * Taux) /1000) ELSE PrimeMin END AS prime
-- 			INTO Capital, PrimeAnnuelle
-- 			FROM StdTarifDetail AS STD
-- 			WHERE IdTarif = idtarif_ AND STD.IdGarantie = var_rec.id_sous_gar
-- 			LIMIT 1;
-- 			Capital := COALESCE(Capital, 0.0);
-- 			PrimeAnnuelle := ROUND(COALESCE(PrimeAnnuelle, 0.0),0); 
-- 			PrimeNette := PrimeAnnuelle; 
-- 		ELSIF (var_rec.id_sous_gar = 22) THEN
-- 			PrimeAnnuelle := COALESCE(prime_assist_car, 0.0);
-- 			PrimeNette := COALESCE(prime_assist_car, 0.0);
		END IF;
        		--Règle de gestion applicable au vol 
-- 		IF var_rec.id_gar = 5 THEN
-- 		    PrimeNette := COALESCE(PrimeNette, 0.0);
-- 			PrimeNette := ROUND(PrimeNette - ((PrimeNette * COALESCE(taux_reduction,0))/100),0);
-- 		END IF;
-- 		--Règle dommage --
-- 		IF dommage THEN
-- 			IF var_rec.id_sous_gar = 9 THEN
-- 				PrimeNette := 0;
-- 				Acquise := True;
-- 			END IF;
-- 			IF var_rec.id_sous_gar = 4 THEN
-- 				PrimeNette := 4200;
-- 			END IF;
-- 		END IF;
 		-----Calcul de la reduction commerciale---------------------------
		IF var_rec.id_gar <> 1 AND var_rec.id_sous_gar NOT IN (22,4,3) THEN
		    PrimeNette := COALESCE(PrimeNette, 0.0);
			PrimeNette := ROUND((PrimeNette - (PrimeNette * tauxreduc_) / 100), 0);
		END IF;
		
		--Détermination de la Prime de la période de couverture---------------------
		IF var_rec.id_sous_gar NOT IN (22,3) THEN
			PrimeNette := COALESCE(PrimeNette, 0.0);
			--duree_contrat := dateexpiration_ - dateeffet_;
			PrimeNette := ROUND((PrimeNette * bns_ * duree_contrat)/duree_totale,0);
		END IF;
		PrimeAnnuelle:= COALESCE(PrimeAnnuelle, 0.0);
		PrimeNette := COALESCE(PrimeNette, 0.0);
		
		---Calcul de la taxe
		SELECT tauxtaxe
		INTO taux_taxe
		FROM stdtauxtaxegarantieproduit AS TT
		WHERE (idproduit = 1) AND (TT.idgarantie = var_rec.id_sous_gar)
		       AND dateeffet_ BETWEEN DebutValidite AND FinValidite;
		taux_taxe := COALESCE(taux_taxe, 0);
		Taxe := ROUND((PrimeNette * taux_taxe)/100,0);
		
		---Faire le cumul des 2 composantes de prime (prime nette et taxe)
		prime_annuelle_totale := prime_annuelle_totale + PrimeAnnuelle;
		prime_nette_totale := prime_nette_totale + PrimeNette;
		taxe_totale := taxe_totale + Taxe;
		-------------------------------Traitement du texte de la franchise-------------------------
		FranchiseTexte := fn_franchise_texte(TauxFranchise, FranchiseMinimum, FranchiseMaximum);
						  
		--Calculer le montant du FGA et l'ajouter à la prime nette totale
		IF var_rec.id_gar = 1  AND var_rec.id_sous_gar = 1 THEN
			prime_annuelle_totale := prime_annuelle_totale + ROUND((PrimeAnnuelle * fn_lephare_auto_constante(idcompagnie_, 'cat5', 'fga_taux', 2)) / 100, 0);
			prime_nette_totale := prime_nette_totale + ROUND((PrimeNette * fn_lephare_auto_constante(idcompagnie_, 'cat5', 'fga_taux', 2)) / 100, 0);
		END IF;
		
        RETURN NEXT;

    END LOOP;
	
	--Calcul de l'accessoire
-- 	SELECT accessoires
-- 	INTO v_accessoire
-- 	FROM stdaccessoire
-- 	WHERE prime_nette_totale between primemin and primemax and idproduit = 1;
-- 	v_accessoire := COALESCE(v_accessoire, 0.0);
	
-- 	taux_taxe_accessoire := fn_get_taux_taxe(1, idoffre_, dateeffet_);
-- 	taxe_accessoire := (v_accessoire * taux_taxe_accessoire)/100;
	
	SELECT * 
	INTO v_accessoire, v_accessoire_intermediaire, taxe_accessoire
	FROM fn_get_accessoire_moto(prime_nette_totale, 1, idoffre_, idcompagnie_,dateeffet_);

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
