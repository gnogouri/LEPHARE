-- PROCEDURE: public.sp_enregistrement_encaissement(integer, integer, date, integer, numeric, character varying, character varying, character varying, character varying, character varying, character varying, integer, character varying)

-- DROP PROCEDURE IF EXISTS public.sp_enregistrement_encaissement(integer, integer, date, integer, numeric, character varying, character varying, character varying, character varying, character varying, character varying, integer, character varying);

CREATE OR REPLACE PROCEDURE public.sp_enregistrement_encaissement(
	IN id_utilisateur integer,
	IN id_mode_encaissement integer,
	IN date_encaissement date,
	IN id_banque integer,
	IN montant_total numeric,
	IN numero_cheque character varying,
	IN reference_encaissement character varying,
	IN reference_compensation character varying,
	IN nom_emetteur character varying,
	IN liste_quittance character varying,
	IN liste_montant character varying,
	INOUT id_encaissement integer,
	INOUT out_message character varying)
LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
    montant_total_calcule numeric;
    numero_piece character varying;
    code_intermediaire character varying (4);
    date_emission date;
    reference_transaction uuid;
    v_msg TEXT;

	encaissement_banque boolean;
	encaissement_compensation boolean;
	libelle_banque character varying (50);
	abrege_reglement character varying(3);
	quittance_rec RECORD;
	
BEGIN
    -- 1. INITIALISATION & VALIDATION
    out_message := '';
    id_encaissement := 0;
    id_banque := COALESCE(id_banque, 1);
    montant_total := COALESCE(montant_total, 0);
	numero_cheque := TRIM(COALESCE(numero_cheque, '')); 
	reference_encaissement := TRIM(COALESCE(reference_encaissement, '')); 
	reference_compensation := TRIM(COALESCE(reference_compensation, '')); 
	nom_emetteur := TRIM(COALESCE(nom_emetteur, '')); 
	
	SELECT banque, compensation, UPPER(abregereglement)
	INTO encaissement_banque, encaissement_compensation, abrege_reglement
	FROM StdModeEncaissement
	WHERE idmodeencaissement = id_mode_encaissement;
	encaissement_banque := COALESCE(encaissement_banque, False);
	encaissement_compensation := COALESCE(encaissement_compensation, False);
	abrege_reglement := COALESCE(abrege_reglement, '');

	IF abrege_reglement = 'PYM' AND reference_encaissement = '' THEN
		out_message := 'Le numéro du reçu de l''opérateur ou la référence de la transaction mobile doit être renseigné.';
		RAISE EXCEPTION '%', out_message;	
	END IF;

    IF is_valid_uuid(reference_encaissement) THEN
        reference_transaction := CAST (reference_encaissement AS UUID);
    ELSE
        reference_transaction := NULL;
    END IF;

	-- v4 : référence UUID = transaction DistriPay, vérifiée comme avant ; sinon numéro du reçu
	-- remis par l'opérateur (paiement mobile saisi à la caisse), contrôlé et conservé par
	-- l'application (stdencaissement.numerorecuoperateur)
	IF abrege_reglement = 'PYM' AND reference_transaction IS NOT NULL THEN
		IF NOT EXISTS (SELECT * FROM StdDistripayTransaction WHERE IdTransaction = reference_transaction AND CodeErreurTransaction = '00' AND MontantTransaction = montant_total) THEN
			out_message := 'La référence de la transaction mobile est invalide.';
			RAISE EXCEPTION '%', out_message;
		END IF;
		IF EXISTS (SELECT 1 FROM StdDistripayTransaction WHERE IdTransaction = reference_transaction AND CodeErreurTransaction = '00') AND
	       EXISTS (SELECT 1 FROM StdEncaissement AS SE INNER JOIN StdModeEncaissement AS SM ON (SE.IdModePaiement = SM.IdModeEncaissement) WHERE SE.ReferenceTransaction = reference_transaction AND UPPER(SM.AbregeReglement) = 'PYM') THEN
			out_message := 'Cette transaction mobile a déjà été utilisée pour un autre encaissement.';
			RAISE EXCEPTION '%', out_message;
		END IF;
	END IF;
	IF NOT encaissement_banque THEN
		numero_cheque := '';
		id_banque := 1;
	ELSE
		SELECT UPPER(Libelle)
		INTO libelle_banque
		FROM StdBanque
		WHERE IdBanque = id_banque;
		libelle_banque := TRIM(COALESCE(libelle_banque,''));
		IF libelle_banque IN ('', 'AUCUNE', 'AUCUN', 'NEANT') THEN
			out_message := 'Une banque doit être précisée pour ce mode d''encaissement.';
			RAISE EXCEPTION '%', out_message;
		END IF;
--		IF abrege_reglement = 'CHQ' AND numero_cheque = '' THEN
--			out_message := 'Le numéro de chèque doit être précisé.';
--			RAISE EXCEPTION '%', out_message;
--		END IF;
		reference_compensation := '';
	END IF;
	IF encaissement_compensation THEN
		IF reference_compensation = '' THEN
			out_message := 'La référence de la compensation doit être précisée.';
			RAISE EXCEPTION '%', out_message;
		END IF;
		numero_cheque := '';
		id_banque := 1;
	END IF;
	IF nom_emetteur = '' THEN
		out_message := 'Le nom de l''émetteur ou du déposant doit être indiqué.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
 	CREATE TEMPORARY TABLE IF NOT EXISTS temp_data_encaissement(numeroquittance character varying(16), montantencaissement numeric);
	
	TRUNCATE TABLE temp_data_encaissement;
	
	INSERT INTO temp_data_encaissement(numeroquittance, montantencaissement)
	VALUES (CAST(UNNEST(STRING_TO_ARRAY(liste_quittance, ';')) AS character varying), CAST(UNNEST(STRING_TO_ARRAY(liste_montant,';')) AS numeric)); 
	
	SELECT SUM(montantencaissement)
	INTO montant_total_calcule
	FROM temp_data_encaissement;
	
	montant_total_calcule := COALESCE(montant_total_calcule,0);
	
	IF montant_total_calcule <> montant_total THEN
		out_message := 'Incohérence des données. La somme des montants d''encaissement est différente du montant total à encaisser.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	PERFORM *
	FROM temp_data_encaissement
	WHERE MontantEncaissement = 0;
	IF FOUND THEN
		out_message := 'Certains montants d''encaissement sont égaux à zéro!';
		RAISE EXCEPTION '%', out_message;
	END IF;


    -- 3. GÉNÉRATION DU NUMÉRO DE PIÈCE (via votre procédure interne)
    SELECT SQ.DateEmission, TRIM(COALESCE(SI.CodeIntermediaire,'0')) 
    INTO date_emission, code_intermediaire
    FROM temp_data_encaissement AS TDE
    INNER JOIN StdQuittance AS SQ ON TDE.NumeroQuittance = SQ.NumeroQuittance
    INNER JOIN StdContrat AS SC ON SQ.idquittance = SC.idquittance
    INNER JOIN StdIntermediaireCompagnie AS SI ON (SC.IdIntermediaire = SI.IdIntermediaire AND SC.IdCompagnie = SI.IdCompagnie)
    LIMIT 1;
	numero_piece := '';
    CALL sp_generation_numero_piece (code_intermediaire, date_emission, numero_piece);

    -- 4. INSERTION ENTÊTE ENCAISSEMENT
	INSERT INTO StdEncaissement(numeropiece, dateencaissement, montantencaissement, montantenattente, montantdeduit, numerocheque, compte_compensation, idutilisateur, datesaisie, piece_annulee,
							   dateannulation, nomannulation, motifannulation, datesaisieannulation, nomtireurcheque, idbanque, idmodepaiement, referencetransaction, created_at, updated_at)
	VALUES (numero_piece, date_encaissement, montant_total, 0, 0, numero_cheque, reference_compensation, id_utilisateur, CURRENT_DATE, False,
			NULL, '', '', NULL, nom_emetteur, id_banque, id_mode_encaissement, reference_transaction, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	RETURNING idencaissement INTO id_encaissement;
	

    -- 5. UPDATE STDCLIENT (AVANT StdQuittance pour utiliser les anciennes valeurs de Mt_Encaisse)
    -- On utilise LEAST et GREATEST pour une logique mathématique infaillible
    UPDATE StdClient AS SCli
    SET 
        Solde = COALESCE(SCli.Solde, 0) - sub.montant_imputable,
        Avoir = COALESCE(SCli.Avoir, 0) + sub.montant_surplus
    FROM (
        SELECT 
            SQ.IdClient,
            -- Reste à payer avant cet encaissement
            SUM(LEAST(TDE.MontantEncaissement, (SQ.PrimeTTC - COALESCE(SQ.Mt_Encaisse, 0)))) as montant_imputable,
            -- Excédent (si versement > reste à payer)
            SUM(GREATEST(0, TDE.MontantEncaissement - (SQ.PrimeTTC - COALESCE(SQ.Mt_Encaisse, 0)))) as montant_surplus
        FROM temp_data_encaissement TDE
        INNER JOIN StdQuittance SQ ON TDE.NumeroQuittance = SQ.NumeroQuittance
        GROUP BY SQ.IdClient
    ) AS sub
    WHERE SCli.IdClient = sub.IdClient;

    -- 6. UPDATE STDQUITTANCE (Après avoir calculé les avoirs client)
    UPDATE StdQuittance AS SQ
    SET 
        Mt_Encaisse = CASE 
            WHEN (COALESCE(SQ.Mt_Encaisse, 0) + TDE.MontantEncaissement) > SQ.PrimeTTC THEN SQ.PrimeTTC 
            ELSE (COALESCE(SQ.Mt_Encaisse, 0) + TDE.MontantEncaissement) 
        END,
        Encaissee = CASE 
            WHEN (COALESCE(SQ.Mt_Encaisse, 0) + TDE.MontantEncaissement) >= SQ.PrimeTTC THEN True 
            ELSE False 
        END
    FROM temp_data_encaissement AS TDE
    WHERE SQ.NumeroQuittance = TDE.NumeroQuittance;

    -- 7. INSERTION DÉTAILS
	INSERT INTO StdDetailEncaissement(indiceacompte, soldeinitial, montantreglement, montantecart, ecart, code_ecart,
											 montant_encaissement, dedcommission_intermediaire, dedcommission_gestionnaire,
											 dedcommission_coassurance, dedaccessoireintermediaire, dedaccessoiregestionnaire,
											 dedtaxecommission, idencaissement, numeroquittance, comintermediaire, comgestionnaire,
									  comconseiller, comcoassurance, accintermediaire, accgestionnaire)
	SELECT (COALESCE(SDE.AncIndiceAcompte, 0) + 1) AS Indice, (SQ.PrimeTTC - COALESCE(SQ.Mt_Encaisse,0)) AS Solde, 0 AS MontantRegle,
		   (SQ.PrimeTTC - COALESCE(SQ.Mt_Encaisse,0) - TDE.MontantEncaissement) AS MontantEcart,
		   CASE WHEN (SQ.PrimeTTC - COALESCE(SQ.Mt_Encaisse,0) - TDE.MontantEncaissement) >= 5.0 THEN True ELSE False END, 'E' AS CodeEcart,
		   TDE.MontantEncaissement, False, False, False, False, False, False, id_encaissement, TDE.NumeroQuittance,
		   COALESCE(SC.commissionintermediaire,0) AS comintermediaire, COALESCE(SC.commissiongestionnaire, 0) AS comgestionnaire, 0 AS comconseiller,
		   COALESCE(SC.commissionaperiteur, 0) AS comcoassurance, SC.accessoireintermediaire AS accintermediaire, SC.accessoiregestionnaire AS accgestionnaire
	FROM temp_data_encaissement AS TDE
	INNER JOIN StdQuittance AS SQ ON (TDE.NumeroQuittance = SQ.NumeroQuittance)
	LEFT JOIN (SELECT MAX(IndiceAcompte) AS AncIndiceAcompte, NumeroQuittance
			   FROM StdDetailEncaissement
			   GROUP BY NumeroQuittance) AS SDE ON (TDE.NumeroQuittance = SDE.NumeroQuittance)
	INNER JOIN StdContrat AS SC ON (SQ.IdQuittance = SC.IdQuittance);

    out_message := 'Encaissement enregistré avec succès.';

EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    id_encaissement := 0;
    out_message := 'Erreur : ' || v_msg;
END;
$BODY$;
ALTER PROCEDURE public.sp_enregistrement_encaissement(integer, integer, date, integer, numeric, character varying, character varying, character varying, character varying, character varying, character varying, integer, character varying)
    OWNER TO uranususer;

