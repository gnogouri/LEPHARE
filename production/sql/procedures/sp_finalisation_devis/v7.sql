CREATE OR REPLACE PROCEDURE public.sp_finalisation_devis(IN id_devis integer, IN id_client integer, IN id_assure integer, IN flotte boolean, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
	numero_devis varchar(16);
	id_produit integer;
	id_offre integer;
	id_tarif integer;
	id_compagnie integer;
	date_emission date;
	date_effet date;
	prime_nette numeric;
	taux_commission numeric;
	--Pour le calcul des taxes relatives aux accessoires
	var_accessoire numeric;
	var_accessoire_compagnie numeric;
	var_accessoire_intermediaire numeric;
	taxe_accessoire numeric;
	devis_rec RECORD;
	conducteur_rec RECORD;
	effectif_assure integer;
	nombre_moto integer;
	v_accessoire_individuel numeric;
	v_accessoire_intermediaire_individuel numeric;
	v_taxe_accessoire_individuel numeric;
	v_prime_nette_individuelle numeric;
	v_devis_detail_rec RECORD;
	v_prime_imposee boolean;
	-- ✅ Nouvelles variables
	var_primenette_total numeric;
	----Gestion des erreurs
	v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
	v_nombre_adherents_minene int;
	v_id_devis_minene int;
	
BEGIN
    	out_message := '';
		effectif_assure := 1;
		nombre_moto := 1;
		
		SELECT idproduit, idcompagnie, numerodevis, dateemission, dateeffet, primeimposee, accessoire
		INTO devis_rec
		FROM StdDevis
		WHERE iddevis = id_devis;
		id_produit := COALESCE(devis_rec.idproduit, 0);
		id_compagnie := COALESCE(devis_rec.idcompagnie, 0);
		numero_devis := COALESCE(devis_rec.numerodevis, '');
		date_emission := COALESCE(devis_rec.dateemission, CURRENT_DATE);
		date_effet := COALESCE(devis_rec.dateeffet, CURRENT_DATE);
		v_prime_imposee := COALESCE(devis_rec.primeimposee, false);
		var_accessoire := COALESCE(devis_rec.accessoire, 0);
		v_nombre_adherents_minene := 0;
		v_id_devis_minene := 0;
		
		SELECT MAX(IdOffre), MAX(idtarif)
		INTO id_offre, id_tarif
		FROM StdDevisDetail
		WHERE IdDevis = id_devis;
		id_offre := COALESCE(id_offre, 0);
		id_tarif := COALESCE(id_tarif, 0);
		
		IF flotte AND id_produit = 1 THEN
			SELECT TRIM(Nom) || TRIM(COALESCE(Prenoms,'')) AS nomconducteur,
				   TRIM(COALESCE(Adresse1,'')) AS adresseconducteur
			INTO conducteur_rec
			FROM StdClient
			WHERE IdClient = id_assure;

			UPDATE StdDevisDetail
			SET conducteur = COALESCE(conducteur_rec.nomconducteur,''),
			    adressecnd = COALESCE(conducteur_rec.adresseconducteur,'')
			WHERE iddevis = id_devis;
		END IF;
		
		taux_commission := fn_get_taux_commission(id_produit, id_compagnie, date_emission);
		IF id_offre = 66 THEN -- IA MINENE
			SELECT iddevis 
			INTO v_id_devis_minene
			FROM public.stdcontrat
			WHERE idproduit = 5 AND numeropolice = (SELECT COALESCE(numeropoliceconnexe, '') FROM public.stddevis WHERE iddevis = id_devis)
			ORDER BY dateeffet DESC
			LIMIT 1;
			SELECT COUNT(*)
			INTO v_nombre_adherents_minene
			FROM public.stdadherent
			WHERE iddevis = v_id_devis_minene;
			v_nombre_adherents_minene := COALESCE(v_nombre_adherents_minene, 1);
		END IF;
 
		IF flotte THEN
			UPDATE StdDevis
			SET idclient = id_client, idassure = id_assure
			WHERE iddevis = id_devis;
			
			SELECT COUNT(iddevisdetail), SUM(CASE WHEN CodeCategorie = '205' THEN 1 ELSE 0 END)
			INTO effectif_assure, nombre_moto
			FROM StdDevisDetail AS SDD 
			INNER JOIN StdTarif AS ST ON (SDD.IdTarif = ST.IdTarif)
			WHERE iddevis = id_devis;
			effectif_assure := COALESCE(effectif_assure, 0);
			nombre_moto := COALESCE(nombre_moto, 0);
		ELSE
			effectif_assure := 1;
			nombre_moto := 0;
			IF EXISTS (SELECT 1 FROM StdDevisDetail AS SDD 
					            INNER JOIN StdTarif AS ST ON (SDD.IdTarif = ST.IdTarif)
					            WHERE IdDevis = id_devis AND CodeCategorie = '205') THEN
				nombre_moto := 1;
			END IF;
		END IF;

		UPDATE StdDevis AS DD
		SET primeannuelle = M.primeannuelle, primenette = M.primenette + M.fga, fga = M.fga, cedeao = CASE WHEN DD.idproduit = 1 THEN COALESCE(M.primecedeao, 0) ELSE 0 END,
				taxe = M.taxeenregistrement, CommissionIntermediaire = ROUND((M.primenette*COALESCE(taux_commission,0))/100,0)
		FROM (SELECT iddevis, SUM(fn_get_prime_cedeao(idtarif, puissancefiscale, chargeutile)) AS primecedeao, SUM(primeannuelle) AS primeannuelle, SUM(primenette) AS primenette, SUM(fga) AS fga, SUM(taxeenregistrement) AS taxeenregistrement
				FROM StdDevisDetail
				WHERE iddevis=id_devis
				GROUP BY iddevis) AS M
		WHERE (M.iddevis=DD.iddevis) AND (DD.iddevis=id_devis) AND (DD.numerodevis=numero_devis);
			
		-- Incorporation IA MINENE (v7) : chaque personne du devis a sa ligne au tarif ; l'en-tête repart de la prime d'une
		-- personne (accessoire et taxe sont ceux d'un adhérent), multipliée plus bas par le nombre de personnes du devis et non
		-- par les adhérents de la police Santé, déjà couverts par le contrat
		IF id_offre = 66 AND EXISTS (SELECT 1 FROM public.stddevis AS SD INNER JOIN public.stdavenant AS SA ON SA.idavenant = SD.idavenant
									 WHERE SD.iddevis = id_devis AND SA.codeavenant = 'INC') THEN
			SELECT COUNT(*) INTO v_nombre_adherents_minene FROM public.stddevisdetail WHERE iddevis = id_devis;
			v_nombre_adherents_minene := GREATEST(COALESCE(v_nombre_adherents_minene, 1), 1);
			UPDATE StdDevis
			SET primenette = primenette / v_nombre_adherents_minene, taxe = taxe / v_nombre_adherents_minene
			WHERE iddevis = id_devis;
		END IF;

		SELECT primenette 
		INTO prime_nette
		FROM StdDevis 
		WHERE iddevis = id_devis;
		prime_nette := COALESCE(prime_nette, 0);
			
		IF (effectif_assure = nombre_moto) THEN
			SELECT * 
			INTO var_accessoire_compagnie, var_accessoire_intermediaire, taxe_accessoire
			FROM fn_get_accessoire_moto(prime_nette, id_produit, id_offre, id_compagnie, date_effet, effectif_assure);
			var_accessoire := var_accessoire_compagnie + var_accessoire_intermediaire;
		ELSE
			IF id_produit = 2 AND id_tarif IN (145, 76) THEN --TARIF CGA et CI-ENERGIES
				var_accessoire_compagnie := 0;
				var_accessoire_intermediaire := 0;
				var_accessoire := 0;
				taxe_accessoire := 0;
				FOR v_devis_detail_rec IN (SELECT idoffre, primenette FROM public.stddevisdetail WHERE iddevis=id_devis)
				LOOP
					prime_nette := v_devis_detail_rec.primenette;
					id_offre := v_devis_detail_rec.idoffre;
						
					SELECT * 
					INTO v_accessoire_individuel, v_accessoire_intermediaire_individuel, v_taxe_accessoire_individuel
					FROM fn_get_accessoire(prime_nette, id_produit, id_offre, id_compagnie, date_effet);
						
					var_accessoire_compagnie := var_accessoire_compagnie + v_accessoire_individuel;
					var_accessoire_intermediaire := var_accessoire_intermediaire + v_accessoire_intermediaire_individuel;
					taxe_accessoire := taxe_accessoire + v_taxe_accessoire_individuel;
				END LOOP;
				var_accessoire := var_accessoire_compagnie + var_accessoire_intermediaire;
				
			ELSIF v_prime_imposee AND id_produit = 2 THEN
				-- ✅ FORMULE UNIQUE pour toutes les offres IA avec prime imposée
				-- Calcul en une seule fois sur (prime_nette_totale + accessoire) pour éviter
				-- les erreurs d'arrondi cumulées par garantie et par assuré
				-- (anciennement deux branches distinctes pour offres 173/174 et autres)

				-- Lire l'accessoire total directement depuis stddevis
				SELECT COALESCE(Accessoire, 0)
				INTO var_accessoire
				FROM public.stddevis
				WHERE iddevis = id_devis;

				var_accessoire := ROUND(var_accessoire, 0);

				-- Récupérer la prime nette totale depuis les détails
				SELECT COALESCE(SUM(primenette), 0)
				INTO var_primenette_total
				FROM stddevisdetail
				WHERE iddevis = id_devis;

				-- Répartition 50/50 entre compagnie et intermédiaire
				var_accessoire_compagnie := ROUND(var_accessoire / 2.0, 0);
				var_accessoire_intermediaire := var_accessoire - var_accessoire_compagnie;

				-- Flag pour déclencher le recalcul complet de la taxe
				taxe_accessoire := -1;
        
			ELSE
				SELECT * 
				INTO var_accessoire_compagnie, var_accessoire_intermediaire, taxe_accessoire
				FROM fn_get_accessoire(prime_nette, id_produit, id_offre, id_compagnie, date_effet);
				var_accessoire := var_accessoire_compagnie + var_accessoire_intermediaire;
			END IF;
				
		END IF;
		
		-- Pool TPV (catégorie 204, offre « POOL TPV ») : accessoire du tarif du Pool selon la durée et les places de
		-- chaque véhicule (Administration > Réglages Automobile > Pool TPV), au lieu du barème de la compagnie
		IF id_produit = 1 AND EXISTS (SELECT 1 FROM public.stddevisdetail AS D WHERE D.iddevis = id_devis AND public.fn_est_offre_pool_tpv(D.idoffre)) THEN
			SELECT COALESCE(SUM(P.accessoire), 0)
			INTO var_accessoire_compagnie
			FROM public.stddevisdetail AS D
			CROSS JOIN LATERAL public.fn_pool_tpv(D.nombreplace, date_effet, COALESCE((SELECT SD.dateexpiration::date FROM public.stddevis AS SD WHERE SD.iddevis = id_devis), date_effet)) AS P
			WHERE D.iddevis = id_devis AND public.fn_est_offre_pool_tpv(D.idoffre);
			var_accessoire_intermediaire := 0;
			var_accessoire := var_accessoire_compagnie;
			taxe_accessoire := ROUND(var_accessoire * COALESCE(public.fn_get_taux_taxe(id_compagnie, id_produit, id_offre, date_effet), 14.5) / 100, 0);
		END IF;

		-- ✅ UPDATE final avec gestion de la taxe
		IF taxe_accessoire = -1 THEN
			-- IA prime imposée : recalculer toute la taxe en une seule opération ROUND
			UPDATE StdDevis
			SET AccessoireCompagnie = var_accessoire_compagnie, 
			    AccessoireIntermediaire = var_accessoire_intermediaire,
			    AccessoireGestionnaire = CASE WHEN id_produit = 2 AND id_offre = 66 THEN fn_get_frais_gestion_minene(id_produit) ELSE 0 END, 
			    Accessoire = var_accessoire, 
			    taxe = ROUND((var_primenette_total + var_accessoire) * public.fn_get_taux_taxe(id_compagnie, id_produit, id_offre, date_effet) / 100, 0)
			WHERE IdDevis = id_devis;
		ELSE
			-- Autres offres : ajouter la taxe sur accessoire à la taxe existante
			UPDATE StdDevis
			SET AccessoireCompagnie = var_accessoire_compagnie, 
			    AccessoireIntermediaire = var_accessoire_intermediaire,
			    AccessoireGestionnaire = CASE WHEN id_produit = 2 AND id_offre = 66 THEN fn_get_frais_gestion_minene(id_produit) ELSE 0 END, 
			    Accessoire = var_accessoire, 
			    taxe = taxe + taxe_accessoire
			WHERE IdDevis = id_devis;
		END IF;

		IF id_offre = 66 THEN
			-- Commission (24 % de la prime HT, barème OREOLE) sur la prime de tous les adhérents ; taxe d'un
			-- adhérent sur sa prime et son accessoire en une fois (2 976 F avec la prime d'origine de 14 524 F,
			-- auparavant écrite ici), la prime étant réglée dans Administration > Réglages Santé MINENE
			UPDATE StdDevis
			SET CommissionIntermediaire = ROUND((primenette * v_nombre_adherents_minene * COALESCE(taux_commission, 0)) / 100, 0),
			    primenette = primenette * v_nombre_adherents_minene, 
			    accessoirecompagnie = accessoirecompagnie * v_nombre_adherents_minene,
			    accessoireintermediaire = accessoireintermediaire * v_nombre_adherents_minene, 
			    accessoire = accessoire * v_nombre_adherents_minene, 
			    taxe = ROUND((primenette + accessoire) * public.fn_get_taux_taxe(id_compagnie, id_produit, id_offre, date_effet) / 100, 0) * v_nombre_adherents_minene,
			    accessoiregestionnaire = accessoiregestionnaire * v_nombre_adherents_minene
			WHERE IdDevis = id_devis;
		END IF; 
		
		UPDATE StdDevis
		SET primettc = ROUND((primenette + accessoire + taxe + accessoiregestionnaire), 0)
		WHERE iddevis = id_devis;

		IF flotte THEN
			out_message := 'Devis finalisé avec succès.';
		ELSE
			out_message := 'Devis enregistré avec succès.';
		END IF;
	
		EXCEPTION WHEN others THEN
			get stacked diagnostics
        		v_state   = returned_sqlstate,
        		v_msg     = message_text,
        		v_detail  = pg_exception_detail,
        		v_hint    = pg_exception_hint,
        		v_context = pg_exception_context;
				
			out_message := v_msg;
			RAISE EXCEPTION '%', out_message;
    

END; 
$procedure$;
