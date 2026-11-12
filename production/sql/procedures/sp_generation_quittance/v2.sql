-- v2 (production 0180) : rien à générer pendant la reprise d'une affaire antérieure saisie comme un devis
-- (production/reprise.py pose lephare.reprise = 'on' dans sa transaction avant sp_confirmation_devis) : la reprise
-- crée elle-même la quittance, dans la série « R » de son exercice et avec son état de paiement réel ; la séquence
-- des quittances de l'année d'effet (reprise d'URANUS) n'est pas consommée.
CREATE OR REPLACE PROCEDURE public.sp_generation_quittance(IN id_contrat integer, INOUT id_quittance integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE

local_message character varying(500); prime_nette_totale numeric; taxe_totale numeric; date_effet date;
commission_totale numeric; numero_quittance integer; id_old_hist integer; id_avenant integer;
code_avenant char(3); id_annulation_quittance integer; var_statut smallint; nature_site smallint; var_nature smallint;
numero_avenant character varying(10); id_offre integer; var_flotte boolean; remb_taxe boolean; id_client integer;
taux_commission_gestionnaire numeric; id_produit integer; var_police character varying(50); prime_ttc numeric; exonere_accessoires boolean; exonere_taxes boolean; x_numero_quittance character varying(50);id_compagnie integer; code_intermediaire character varying(4);
longueur integer; var_usage Char(3); id_detail_contrat integer; var_entreprise boolean; char_numero_quittance character varying; id_intermediaire integer;

	----Gestion des erreurs
    v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
	
BEGIN
	IF COALESCE(current_setting('lephare.reprise', true), '') = 'on' THEN
		id_quittance := 0;
		out_message := 'Quittance créée par la reprise de l''affaire antérieure';
		RETURN;
	END IF;
	char_numero_quittance := '';
	id_quittance :=0;
  	SELECT DateEffet, IdOldHist, IdAvenant, Case When Flotte Then 2 else 1 end, IdIntermediaire, Flotte, IdClient, NumeroPolice, NumeroAvenant, 
  			IdCompagnie, PrimeTTC, IdProduit
    INTO date_effet, id_old_hist, id_avenant, var_nature, id_intermediaire, var_flotte, id_client, var_police, numero_avenant, id_compagnie,
    	prime_ttc, id_produit
    FROM StdContrat
    WHERE IdContrat = id_contrat;
    
    SELECT IdOffre, IdContratDetail, CodeUsage
    INTO id_offre, id_detail_contrat, var_usage
    FROM StdContratDetail
    WHERE IdContrat=id_contrat
	LIMIT 1;
    
    SELECT ExonereDeAccess, ExonereDeTaxes
    INTO exonere_accessoires, exonere_taxes
    FROM StdClient
    WHERE IdClient = id_client;
    
    IF (NOT COALESCE(exonere_accessoires,False)) THEN
    	SELECT ExonereDeAccess
    	INTO exonere_accessoires
    	FROM StdOffre
    	WHERE IdOffre=id_offre;
    END IF;
    
    IF (NOT COALESCE(exonere_taxes,False)) THEN
    	SELECT ExonereDeTaxes
    	INTO exonere_taxes
    	FROM StdOffre
    	WHERE IdOffre=id_offre;
    END IF;
    
    exonere_accessoires := COALESCE(exonere_accessoires, False);
    exonere_taxes := COALESCE(exonere_taxes, False);
    
    SELECT CodeAvenant
    INTO code_avenant
    FROM stdAvenant
    WHERE IdAvenant = id_avenant;
    
    IF (code_avenant IN ('ANL','ANP','RET','RES')) THEN
      remb_taxe := True;
      SELECT IdQuittance
      INTO id_annulation_quittance
      FROM StdContrat
      WHERE IdContrat = id_old_hist;
      
      IF (COALESCE(id_annulation_quittance,0) = 0) THEN
      	local_message := 'Impossible de trouver le n° de quittance d''origine à annuler.';
      	RAISE EXCEPTION '%', local_message;
      END IF;
      
      -- Recuperer Statut de la quittance à annuler
      SELECT Statut
      INTO var_statut
      FROM StdQuittance
      WHERE IdQuittance = id_annulation_quittance;
      
      IF COALESCE(var_statut,-1) <> 1 THEN
      	local_message := 'Quittance d''origine non trouvée ou statut différent de En cours..';
      	RAISE EXCEPTION '%', local_message;
      END IF;
      
      var_statut := 4;
  ELSE
  	id_annulation_quittance := NULL;
  	var_statut := 1; -- En Cours
  	remb_taxe := False;
  END IF;

  IF EXISTS (SELECT Numero FROM StdNumero WHERE IdModule = 'QUITT' AND Cloture = True AND Exercice = DATE_PART('Year', date_effet)) THEN
  	local_message := 'Exercice clôturé!';
  	RAISE EXCEPTION '%', local_message;
  END IF;
 
  
  IF (prime_ttc <> 0) THEN
  	SELECT TRIM(COALESCE(CodeIntermediaire,'0'))
	INTO code_intermediaire
	FROM StdIntermediaireCompagnie
	WHERE IdIntermediaire = id_intermediaire AND IdCompagnie = id_compagnie;
	
	CALL public.sp_generation_numero_quittance(code_intermediaire, date_effet, char_numero_quittance);

	IF TRIM(char_numero_quittance) = '' THEN
		out_message := 'Erreur lors de la génération du numéro de quittance!';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF var_usage IN ('006', '008', '024') THEN
		exonere_accessoires := False;
	END IF;
	
	INSERT INTO StdQuittance(NumeroQuittance, IdIntermediaire, IdClient, Nature, DateEffet, DateExpiration, Exercice, Source, PrimeNette, Taxe, Accessoire, Commission, PrimeTTC, Encaissee, MT_Encaisse, Reglee, MT_Regle, NumeroPolice, IdQuittAnnul, Statut, IdAperiteur,Coassurance, IdProduit, ExonereDeTaxes, ExonereDeAccess, taux_commission)
	SELECT char_numero_quittance, SC.IdIntermediaire, (CASE WHEN var_flotte AND NOT var_entreprise THEN SC.IdAssure ELSE SC.IdClient END),
	       (CASE WHEN code_avenant = 'REN' THEN 'T'
	                 WHEN code_avenant IN ('RET','RES') THEN 'R'
	                 WHEN code_avenant IN ('ANL','ANP') THEN 'A'
	                 ELSE 'C'
	            END), SC.DateEffet, SC.DateExpiration, DATE_PART('year', date_effet)::smallint, 1, SC.PrimeNette, SC.Taxe, SC.Accessoire, 0, SC.PrimeTTC,
	       '0', 0, '0', 0, SC.NumeroPolice, id_annulation_quittance, var_statut, SC.IdAperiteur, Coassurance, IdProduit, exonere_taxes, exonere_accessoires,SC.taux_commission
	FROM StdContrat AS SC
	WHERE SC.IdContrat = id_contrat
	RETURNING IdQuittance INTO id_quittance;
	
	
	INSERT INTO StdDetQuittance(IdQuittance, IdBrancheReassurance, TauxTaxe, TauxCommission, PrimeNette, Taxe, Commission)
	SELECT id_quittance, SG.IdGarantie, T.TauxTaxe, C.TauxCommission, SUM(D.PrimeNette), SUM(D.PrimeNette)*(T.TauxTaxe)/100,
	       SUM(D.PrimeNette) * (C.TauxCommission) / 100
	FROM StdContratDetail AS D
	INNER JOIN StdContratDetGarantie AS G ON (D.IdContratDetail = G.IdContratDetail)
	INNER JOIN StdSousGarantie AS SG ON (G.IdGarantie = SG.IdSousGarantie)
	INNER JOIN StdTauxTaxeGarantieProduit AS T ON (T.IdGarantie = G.IdGarantie AND
	                  date_effet BETWEEN T.DebutValidite AND T.FinValidite)
	INNER JOIN StdCommissionProduitCompagnie AS C ON (C.IdProduit = T.IdProduit AND
	                  date_effet BETWEEN C.DebutValidite AND C.FinValidite AND
	                  C.IdProduit = id_produit)
	WHERE (D.IdContrat = id_contrat) AND (C.IdProduit = id_produit)        
	GROUP BY SG.IdGarantie, T.TauxTaxe, C.TauxCommission;

	DELETE FROM StdDetQuittance
	WHERE IdQuittance = id_quittance AND PrimeNette = 0 and Taxe = 0 and Commission = 0;

	SELECT SUM(Taxe), SUM( Commission), SUM(PrimeNette)
	INTO taxe_totale, commission_totale, prime_nette_totale
	FROM StdDetQuittance
	WHERE  IdQuittance = id_quittance;
	
	IF (NOT remb_taxe) AND (taxe_totale < 0) AND (code_avenant NOT IN ('ANL','ANP','RET','RES', 'CHI', 'MPE')) THEN
		UPDATE StdDetQuittance
		SET Taxe = 0
	    WHERE IdQuittance = id_quittance;
	    taxe_totale := 0;
	END IF;
	
	UPDATE StdContrat
	SET IdQuittance = id_quittance
	WHERE IdContrat = id_contrat;
	
	IF (code_avenant IN ('ANL','ANP','RET','RES')) THEN
		UPDATE StdQuittance
		SET IdQuittAnnul = id_quittance, Statut = 4
		WHERE IdQuittance = id_annulation_quittance;
	 END IF;
	 
	 UPDATE StdClient AS SCli
	 SET Solde = COALESCE(Solde, 0) + SCnt.PrimeTTC
	 FROM StdContrat AS SCnt
	 WHERE SCnt.IdContrat = id_contrat AND SCnt.IdClient = SCli.IdClient; 
	 
  END IF;
  
  out_message := 'Quittance générée avec succès';
  
  EXCEPTION WHEN others THEN
		get stacked diagnostics
        		v_state   = returned_sqlstate,
        		v_msg     = message_text,
        		v_detail  = pg_exception_detail,
        		v_hint    = pg_exception_hint,
        		v_context = pg_exception_context;
		id_quittance := 0;
		out_message := v_msg || ' : ' || v_context; -- 'Problème rencontré lors de la génération de la quittance';
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
