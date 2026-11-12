CREATE OR REPLACE PROCEDURE public.sp_creation_devis_ia(IN id_intermediaire integer, IN id_compagnie integer, IN id_produit integer, IN id_offre integer, IN id_avenant integer, IN id_client integer, IN id_assure integer, IN id_profession integer, IN flotte_ia boolean, IN en_coassurance boolean, IN date_effet date, IN date_expiration date, IN date_emission date, IN id_tarif integer, IN capital_deces numeric, IN capital_ipp numeric, IN frais_traitement numeric, IN taux_reduction numeric, IN code_activite character varying, IN date_naissance date, IN adresse_geographique character varying, IN numero_police_connexe character varying, IN numero_police_compagnie character varying, IN id_duree integer, IN prime_nette numeric, IN montant_accessoire numeric, IN prime_ttc numeric, INOUT id_devis integer, INOUT id_devis_detail integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE

	--etat_traitement character varying(1);
	numero_avenant character varying(8); clef_avenant integer; numero_devis character varying(16);
	code_categorie character varying(3); local_message character varying(500);
	duree_contrat integer; periode_contrat character varying(1);
	id_devis_initial integer;
	v_accessoire_compagnie numeric;
	v_accessoire_intermediaire numeric;

    code_avenant char(3);
	flotte_ia_ancien boolean;
	id_old_hist int;
	v_prime_imposee bool;
	date_expiration_ancienne date;
	
	----Gestion des erreurs
	v_state TEXT; v_msg TEXT; v_detail TEXT; v_hint TEXT; v_context TEXT;

BEGIN

	
	id_devis := COALESCE(id_devis,0);
	id_devis_detail := COALESCE(id_devis_detail,0);
	out_message := '';
	id_devis_initial := id_devis;
	
	id_intermediaire := COALESCE(id_intermediaire,0);
	id_compagnie := COALESCE(id_compagnie,1);
	id_produit := COALESCE(id_produit,0);
	id_offre := COALESCE(id_offre,0);
	id_client := COALESCE(id_client,0);
	id_assure := COALESCE(id_assure,0);
	id_profession := COALESCE(id_profession,0);
	id_avenant := COALESCE(id_avenant,0);
	flotte_ia := COALESCE(flotte_ia,False);
	en_coassurance := COALESCE(en_coassurance,False);
	code_activite := COALESCE(code_activite,'00');
	id_duree := COALESCE(id_duree, 0);
	adresse_geographique := TRIM(COALESCE(adresse_geographique, ''));
	numero_police_connexe := TRIM(COALESCE(numero_police_connexe, ''));
	prime_nette := COALESCE(prime_nette, 0);
	montant_accessoire := COALESCE(prime_ttc, 0);
	prime_ttc := COALESCE(montant_accessoire, 0);
	v_prime_imposee := (prime_nette <> 0);
	v_accessoire_compagnie := 0;
	v_accessoire_intermediaire := 0;
	IF v_prime_imposee AND montant_accessoire <> 0 THEN
		IF id_compagnie IN (1, 14, 21) THEN
			v_accessoire_compagnie := ROUND (montant_accessoire / 2.0, 0);
			v_accessoire_intermediaire := montant_accessoire - v_accessoire_compagnie;
		ELSE
			out_message := 'La répartition de l''accessoire entre la compagnie et le courtier n''est pas définie pour cette compagnie!';
			RAISE EXCEPTION '%', out_message;	
		END IF;
	END IF;
	IF numero_police_compagnie IS NOT NULL THEN
		numero_police_compagnie := NULLIF(TRIM(numero_police_compagnie),'');
	END IF;

	IF id_offre = 66 AND numero_police_connexe = '' THEN
		out_message := 'Le numéro de police MINENE n''a pas été renseigné!';
		RAISE EXCEPTION '%', out_message;
	END IF;

	IF id_offre = 66 AND NOT EXISTS (SELECT 1 FROM StdContrat WHERE IdProduit = 5 AND NumeroPolice = numero_police_connexe) THEN
		out_message := 'Le numéro de police MINENE n''existe pas!';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
    SELECT codeavenant
	INTO code_avenant  
	FROM public.stdavenant
	WHERE idavenant = id_avenant;
	IF code_avenant IS NULL THEN
		out_message := 'Erreur logicielle: avenant mal ou non paramétré!';
		RAISE EXCEPTION '%', out_message;
	END IF;

	-- IF id_duree = 1 THEN
	-- 	id_duree := fn_calcul_id_duree_contrat(date_expiration - date_effet);
	-- END IF;
	IF id_duree = 0 THEN
		id_duree := fn_calcul_id_duree_contrat(date_effet, date_expiration);
	ELSIF NOT public.fn_valide_id_duree_contrat(id_duree, date_effet, date_expiration) THEN
		out_message := 'Incohérence entre période de couverture et durée du contrat!';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	duree_contrat := date_expiration - date_effet;
	periode_contrat := fn_calcul_periode_contrat(duree_contrat);

	IF (id_devis = 0) THEN
        IF (code_avenant NOT IN ('AFN', 'RPP', 'TRP')) THEN
				out_message := 'Erreur logicielle: création de nouveau devis impossible pour cet avenant!';
				RAISE EXCEPTION '%', out_message;
		END IF;
		CALL public.sp_numeroter_avenant(id_avenant, id_intermediaire, clef_avenant, numero_avenant);
    END IF;
	
    IF (id_devis = 0) THEN
        SELECT codecategorie INTO code_categorie
	    FROM public.stdtarif
	    WHERE idtarif = id_tarif;
	
		CALL public.sp_generer_numero_devis(id_intermediaire, id_compagnie, code_categorie, numero_devis, local_message);
	
		INSERT INTO public.stddevis (IdIntermediaire, IdCompagnie, IdProduit, IdClient, IdAssure, IdAvenant, NumeroAvenant, NumeroDevis, Flotte,
							IdAperiteur, Coassurance, Periode, DateEmission, DateEffet, DateExpiration, Confirme, AccessoireCompagnie, AccessoireIntermediaire, IdDuree, NumeroPoliceConnexe, numeropolicecompagnie, PrimeImposee)
		VALUES (id_intermediaire, id_compagnie, id_produit, id_client, id_assure, id_avenant, numero_avenant, numero_devis, flotte_ia, id_compagnie, 
				en_coassurance, periode_contrat, date_emission, date_effet, date_expiration, False, v_accessoire_compagnie, v_accessoire_intermediaire, id_duree, numero_police_connexe, numero_police_compagnie, v_prime_imposee) RETURNING IdDevis INTO id_devis;
	ELSE
		IF EXISTS (SELECT * FROM public.stddevis WHERE iddevis = id_devis AND confirme) THEN
			out_message := 'Devis déjà confirmé. Opération impossible';
			RAISE EXCEPTION '%', out_message;
		END IF;

        IF (code_avenant = 'INC') THEN

			IF NOT flotte_ia THEN
				out_message := 'Erreur logicielle: ce devis doit être une flotte!';
				RAISE EXCEPTION '%', out_message;	
			END IF;

			SELECT idoldhist
			INTO id_old_hist
			FROM public.stddevis
			WHERE iddevis = id_devis;

			IF id_old_hist IS NULL THEN
				out_message := 'Erreur logicielle: devis mal initialisé!';
				RAISE EXCEPTION '%', out_message;
			END IF;

			SELECT flotte, dateexpiration
			INTO flotte_ia_ancien, date_expiration_ancienne
			FROM public.stddevis
			WHERE iddevis = id_old_hist;

			-- v3 : contrat à plusieurs personnes hors catégorie groupe (IA MINENE, anciens contrats) admis ; v4 : IA MINENE (offre 66) admise même à une personne
			IF NOT flotte_ia_ancien AND id_offre <> 66 AND (SELECT COUNT(*) FROM public.stddevisdetail WHERE iddevis = id_old_hist) <= 1 THEN
				out_message := 'Impossible de faire une incorporation dans une police mono!';
				RAISE EXCEPTION '%', out_message;
			END IF;

			IF date_expiration != date_expiration_ancienne THEN --L'incorporation et l'avenant de base doivent expirer à la même date
				out_message := 'Date d''expiration incorrecte!';
				RAISE EXCEPTION '%', out_message;
			END IF;  

		END IF;

        IF (code_avenant IN ('AFN', 'RPP')) THEN
		    UPDATE public.stddevis
		    SET idintermediaire = id_intermediaire, idcompagnie = id_compagnie, idproduit = id_produit, idclient = id_client, idassure = id_assure, idavenant = id_avenant,
			    flotte = flotte_ia, idaperiteur = id_compagnie, coassurance = en_coassurance, periode = periode_contrat, dateemission = date_emission, dateeffet = date_effet,
			    dateexpiration = date_expiration, confirme = False, accessoirecompagnie = v_accessoire_compagnie, accessoireintermediaire = v_accessoire_intermediaire, idduree = id_duree, numeropoliceconnexe = numero_police_connexe,
                numeropolicecompagnie = numero_police_compagnie, primeimposee = v_prime_imposee
		    WHERE iddevis = id_devis AND NOT confirme;
        ELSE
            UPDATE public.stddevis
		    SET idcompagnie = CASE WHEN code_avenant = 'TRP' THEN id_compagnie ELSE idcompagnie END, idassure = id_assure, idavenant = id_avenant,
			    flotte = flotte_ia, idaperiteur = CASE WHEN code_avenant = 'TRP' THEN id_compagnie ELSE idaperiteur END, coassurance = en_coassurance, periode = periode_contrat, dateemission = date_emission, dateeffet = date_effet,
			    dateexpiration = date_expiration, confirme = False, accessoirecompagnie = v_accessoire_compagnie, accessoireintermediaire = v_accessoire_intermediaire, idduree = id_duree,
				numeropolicecompagnie = CASE WHEN TRIM(COALESCE(numeropolicecompagnie,'')) = '' THEN numero_police_compagnie ELSE numeropolicecompagnie END, primeimposee = v_prime_imposee
		    WHERE iddevis = id_devis AND NOT confirme;
        END IF;
	END IF;
	
	CALL public.sp_enregistrement_assure_ia(id_compagnie, id_produit, id_offre, id_assure, id_profession, date_effet, date_expiration, id_tarif, capital_deces,
									 capital_ipp, frais_traitement, taux_reduction, code_activite, date_naissance, adresse_geographique, id_devis, prime_nette, montant_accessoire, prime_ttc, id_devis_detail, out_message);

	IF NOT flotte_ia THEN
		CALL public.sp_finalisation_devis(id_devis, id_client, id_assure, flotte_ia, out_message);
	END IF;
	
	EXCEPTION WHEN others THEN
			get stacked diagnostics
        		v_state   = returned_sqlstate,
        		v_msg     = message_text,
        		v_detail  = pg_exception_detail,
        		v_hint    = pg_exception_hint,
        		v_context = pg_exception_context;
				
			IF (id_devis_initial = 0) THEN
				id_devis := 0;
			END IF;
			out_message := v_msg; -- || ' : ' || v_context; -- 'Problème rencontré lors de la création du devis';
			RAISE EXCEPTION '%', out_message;
END;
$procedure$;
