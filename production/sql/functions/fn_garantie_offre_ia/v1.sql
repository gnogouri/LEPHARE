CREATE OR REPLACE FUNCTION public.fn_garantie_offre_ia(id_compagnie integer, id_offre integer, capital_deces numeric, capital_infirmite numeric, capital_frais_traitement numeric, taux_reduction numeric, date_effet date, date_expiration date, code_activite character varying, date_naissance date, p_prime_nette numeric DEFAULT 0, p_accessoire numeric DEFAULT 0)
 RETURNS TABLE(idgarantie integer, libellegarantie character varying, idsousgarantie integer, libellesousgarantie character varying, acquise boolean, capital numeric, nombreplace integer, primeannuelle numeric, primenette numeric, taxe numeric, montantaccessoire numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
	garantie_rec RECORD;
	prime_rec RECORD;
	duree_totale integer;
	duree_contrat integer;
	debut_annee date;
	fin_annee date;
	age integer;
	--local_taux_reduction numeric;
	prime_deces numeric;
	prime_ip numeric;
	prime_frais_traitement numeric;
	v_prime_nette numeric;
	--local_message character varying(500);
	
	----Pour le calcul des totaux des composantes de prime
	taux_taxe numeric;
	prime_annuelle_totale numeric;
	prime_nette_totale numeric;
	v_prime_base_minene numeric;
	v_accessoire numeric;
	v_accessoire_intermediaire numeric;
	v_cumul_capitaux numeric;
	--taux_taxe_accessoire numeric;
	taxe_accessoire numeric;
	taxe_totale numeric;

BEGIN
	
	debut_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS VARCHAR(4)),'-01-01') AS DATE);
	fin_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS VARCHAR(4)),'-12-31') AS DATE);
	duree_totale := fin_annee - debut_annee + 1;
	duree_contrat := date_expiration - date_effet + 1;
	age := date_part('year', AGE(CURRENT_DATE, date_naissance))::int;
	p_prime_nette := COALESCE(p_prime_nette, 0);
	p_accessoire := COALESCE(p_accessoire, 0);
	capital_deces := COALESCE(capital_deces, 0);
	capital_infirmite := COALESCE(capital_infirmite, 0);
	capital_frais_traitement := COALESCE(capital_frais_traitement, 0);

	
	IF  id_offre = 66 THEN -- Pour l'offre IA MINENE
		v_prime_base_minene := public.fn_get_prime_base_minene_ia();
		IF (capital_deces + capital_infirmite + capital_frais_traitement) = 0 THEN --Si capitaux non précisés, récupérer les valeurs du paramétrage
			SELECT *
			INTO capital_deces, capital_infirmite, capital_frais_traitement
			FROM public.fn_get_capitaux_minene_ia();
		END IF;
		v_cumul_capitaux := capital_deces + capital_infirmite + capital_frais_traitement; 
		IF v_cumul_capitaux <> 0 THEN
			prime_ip := ROUND(v_prime_base_minene * capital_infirmite / v_cumul_capitaux, 0);
			prime_frais_traitement := ROUND(v_prime_base_minene * capital_frais_traitement / v_cumul_capitaux, 0);
			prime_deces := v_prime_base_minene - (prime_ip + prime_frais_traitement);
		ELSE -- Sinon capitaux non disponibles (ce qui serait vraiment aberrant!), faire une répartition équitables sur les 3 garanties
			prime_ip := ROUND(v_prime_base_minene / 3.0, 0);
			prime_frais_traitement := prime_ip;
			prime_deces := v_prime_base_minene - (prime_ip + prime_frais_traitement);
		END IF;
	ELSIF id_offre = 154 THEN -- INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 2K
		prime_deces := 2120;
		prime_ip := 2120;
		prime_frais_traitement := 0;
		capital_deces := 2000000;
		capital_infirmite := 2000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 155 THEN -- INDIVIDUELLE ACCIDENTS CGA P/C - SPECIFIQUE
		prime_deces := 0;
		prime_ip := 0;
		prime_frais_traitement := 0;
		capital_deces := 0;
		capital_infirmite := 0;
		capital_frais_traitement := 0;
	ELSIF id_offre = 156 THEN -- INDIVIDUELLE ACCIDENTS CGA P/C - CAPITAL: 4K
		prime_deces := 6924;
		prime_ip := 6923;
		prime_frais_traitement := 0;
		capital_deces := 4000000;
		capital_infirmite := 4000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 166 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 100K
		prime_deces := 48000;
		prime_ip := 48000;
		prime_frais_traitement := 0;
		capital_deces := 100000000;
		capital_infirmite := 100000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 165 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 75K
		prime_deces := 36000;
		prime_ip := 36000;
		prime_frais_traitement := 0;
		capital_deces := 75000000;
		capital_infirmite := 75000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 170 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 50K
		prime_deces := 24000;
		prime_ip := 24000;
		prime_frais_traitement := 0;
		capital_deces := 50000000;
		capital_infirmite := 50000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 162 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 30K
		prime_deces := 14400;
		prime_ip := 14400;
		prime_frais_traitement := 0;
		capital_deces := 30000000;
		capital_infirmite := 30000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 168 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 25K
		prime_deces := 12000;
		prime_ip := 12000;
		prime_frais_traitement := 0;
		capital_deces := 25000000;
		capital_infirmite := 25000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 169 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 15K
		prime_deces := 7200;
		prime_ip := 7200;
		prime_frais_traitement := 0;
		capital_deces := 15000000;
		capital_infirmite := 15000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 167 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 10K
		prime_deces := 4800;
		prime_ip := 4800;
		prime_frais_traitement := 0;
		capital_deces := 10000000;
		capital_infirmite := 10000000;
		capital_frais_traitement := 0;
	ELSIF id_offre = 163 THEN -- INDIVIDUELLE ACCIDENTS CI-ENERGIES P/C - CAPITAL: 5K
		prime_deces := 2400;
		prime_ip := 2400;
		prime_frais_traitement := 0;
		capital_deces := 5000000;
		capital_infirmite := 5000000;
		capital_frais_traitement := 0;
	ELSE --Calculer les primes pour les autres offres autres
		SELECT * INTO prime_rec 
		FROM fn_calcul_prime_ia_by_age (code_activite, age, capital_deces, capital_infirmite, capital_frais_traitement);
	    prime_deces := prime_rec.primedeces;
		prime_ip := prime_rec.primeinfirmite;
		prime_frais_traitement := prime_rec.primefraistraitement;
		IF p_prime_nette <> 0 AND id_offre IN (173, 174) THEN -- Repartir la prime imposée proportionnellement à la prime calculée
			v_prime_nette := prime_deces + prime_ip + prime_frais_traitement;
			IF v_prime_nette <> 0 THEN
				prime_deces := ROUND(p_prime_nette * prime_deces / v_prime_nette, 0);
				prime_ip := ROUND(p_prime_nette * prime_ip / v_prime_nette, 0);
				prime_frais_traitement := ROUND(p_prime_nette * prime_frais_traitement / v_prime_nette, 0);
			ELSE -- Si la prime calculée est égale à zéro, repartir la prime imposée équitablement sur les trois garanties
				prime_deces := ROUND(p_prime_nette / 3.0, 0);
				prime_ip := prime_deces;
				prime_frais_traitement := prime_deces;
			END IF;
			-- Reporter la perte due aux arrondis sur la prime décès
			prime_deces := p_prime_nette - (prime_ip + prime_frais_traitement);
		END IF;
		
	END IF;
	---Initialisation des cumuls
	prime_annuelle_totale := 0;
	prime_nette_totale := 0;
	v_accessoire := 0;
	v_accessoire_intermediaire := 0;
	taxe_totale := 0;
	FOR garantie_rec IN (
                    SELECT ssg.IdGarantie AS id_garantie, sg.LibelleGarantie AS libelle_garantie,
                             sog.IdSousGarantie AS id_sous_garantie, ssg.LibelleSousGarantie AS libelle_sous_garantie,
                            True AS garantie_acquise, 0 AS capital_garanti, 0 AS nombre_place, 0 AS prime_annuelle, 0 AS prime_nette, 0 AS taxe_enregistrement, 0 AS montant_accessoire 
	                FROM StdOffreGarantie AS sog
	                INNER JOIN StdSousGarantie AS ssg ON(ssg.IdSousGarantie=sog.IdSousGarantie)
	                INNER JOIN StdGarantie AS sg ON(sg.IdGarantie=ssg.IdGarantie)
	                WHERE IdOffre = id_offre AND IdCompagnie = id_compagnie
                	ORDER BY 1
                   )
        LOOP
		idgarantie := garantie_rec.id_garantie;
		libellegarantie := garantie_rec.libelle_garantie;
		idsousgarantie := garantie_rec.id_sous_garantie;
		libellesousgarantie := garantie_rec.libelle_sous_garantie;
		acquise := garantie_rec.garantie_acquise;
		capital := garantie_rec.capital_garanti;
		nombreplace := garantie_rec.nombre_place;
		primeannuelle := COALESCE(garantie_rec.prime_annuelle, 0.0);
		primenette := COALESCE(garantie_rec.prime_nette, 0.0);
		taxe := COALESCE(garantie_rec.taxe_enregistrement, 0.0);
		montantaccessoire := COALESCE(garantie_rec.montant_accessoire, 0.0);

		IF (garantie_rec.id_sous_garantie = 19) THEN
				capital := capital_deces;
		END IF; 
		IF (garantie_rec.id_sous_garantie = 17) THEN
				capital := capital_infirmite;
		END IF;
		IF (garantie_rec.id_sous_garantie = 20) THEN
				capital := capital_frais_traitement;
		END IF;
		
		IF id_offre IN (66, 154, 155, 156, 162, 163, 165, 166, 167, 168, 169, 170, 173, 174) THEN --Prime forfaitaire pour IA MINENE, CGA P/C, CI-ENERGIES P/C et TARIF PERSONNALISE
			taux_reduction := 0;
		END IF;
			
		IF (garantie_rec.id_sous_garantie = 19) THEN
			primeannuelle := prime_deces;
			primenette := (prime_deces - (prime_deces * taux_reduction)/100);
		END IF;
			
		IF (garantie_rec.id_sous_garantie = 17) THEN
			primeannuelle := prime_ip;
			primenette := (prime_ip - (prime_ip * taux_reduction)/100);
		END IF;
			
		IF (garantie_rec.id_sous_garantie = 20) THEN
			primeannuelle := prime_frais_traitement;
			primenette := (prime_frais_traitement - (prime_frais_traitement*taux_reduction)/100);
		END IF;
			
		------------------------------Détermination de la Prime de la période de couverture---------------------
		IF (garantie_rec.id_sous_garantie IN (19,17,20)) AND id_offre NOT IN (66, 154, 155, 156, 162, 163, 165, 166, 167, 168, 169, 170, 173, 174) THEN
			primenette := CASE WHEN (duree_contrat*1.0/duree_totale) <= 1 THEN (round((primenette * duree_contrat)/duree_totale,0)) ELSE primenette END;
		END IF;

		---Calcul de la taxe
		SELECT tauxtaxe
		INTO taux_taxe
		FROM stdtauxtaxegarantieproduit AS tt
		WHERE (idproduit = 2) AND (tt.idgarantie = garantie_rec.id_sous_garantie)
			      AND date_effet BETWEEN DebutValidite AND FinValidite;
		taux_taxe := COALESCE(taux_taxe, 0);
		taxe := ROUND((primenette * taux_taxe)/100,0);
		
		---Faire le cumul des 2 composantes de prime (prime nette et taxe)
		prime_annuelle_totale := prime_annuelle_totale + primeannuelle;
		prime_nette_totale := prime_nette_totale + primenette;
		taxe_totale := taxe_totale + taxe;
		
		RETURN NEXT;
	
	END LOOP;

	v_accessoire := 0;
	v_accessoire_intermediaire := 0;
	taxe_accessoire := 0;
	
	IF id_offre IN (173, 174) AND p_accessoire <> 0 THEN --Prime imposée en IA PERSONNALISEE
		v_accessoire_intermediaire := ROUND(p_accessoire / 2, 0);
		v_accessoire := p_accessoire - v_accessoire_intermediaire;
		taxe_accessoire := ROUND(p_accessoire * public.fn_get_taux_taxe(id_compagnie, 2, id_offre, date_effet) / 100, 0);
	ELSE
		SELECT * 
		INTO v_accessoire, v_accessoire_intermediaire, taxe_accessoire
		FROM fn_get_accessoire(prime_nette_totale, 2, id_offre, id_compagnie, date_effet);
	END IF;
	
	--- Retourner la ligne des cumuls
	idgarantie := 0;
	libellegarantie := 'CUMUL DES MONTANTS DES GARANTIES';
	idsousgarantie := 0;
	libellesousgarantie := 'CUMUL DES MONTANTS DES S/GARANTIES';
	acquise := True;
	capital := 0.0;
	nombreplace := 0.0;
	primeannuelle := prime_annuelle_totale;
	primenette := prime_nette_totale;
	taxe := taxe_totale + taxe_accessoire;
	montantaccessoire := v_accessoire + v_accessoire_intermediaire;

	RETURN NEXT;
	
END;
$function$
;
