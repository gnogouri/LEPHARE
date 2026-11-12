CREATE OR REPLACE PROCEDURE public.sp_saisie_affilie_sante(IN nom_affilie character varying, IN prenom_affilie character varying, IN date_naissance date, IN sexe_affilie character, IN mobile1_affilie character varying, IN mobile2_affilie character varying, IN cni_affilie character varying, IN lien_affilie character, IN date_effet date, IN certificat_joint boolean, IN matricule_affilie character varying, IN observations_ character varying, IN affilie_handicape boolean, IN debut_consommation date, IN surprime_appliquee boolean, IN montant_surprime numeric, IN nombre_pathologie integer, IN numero_cmu character varying, IN groupe_sanguin character varying, IN user_id integer, INOUT id_affilie integer, INOUT adherent integer, INOUT devis integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
	initial_id_affilie integer;
	age_affilie integer;
	date_controle date;
	nombre_affilie integer; --Pour contrôler le nombre de personnes dans chaque famille dans le cas des polices MINENE
	id_offre integer;
	-- Âge apprécié à la date d'effet de la couverture ; dérogation accordée par LE PHARE (utilisateur habilité)
	date_reference date;
	age_limite integer;
	derogation_age boolean;
	message_derogation text := '';
	-- Famille complète passée dans la formule de sa nouvelle taille (v6)
	v_offre_adaptee integer;
	v_option_adaptee text;
	v_option_actuelle text;
	v_filiale_adaptee integer;
	v_college integer;
	v_zone integer;
	v_effet_filiale date;
	v_expiration_filiale date;
	v_message_filiale character varying;
	message_formule text := '';
	----Gestion des erreurs
	v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
	
BEGIN
	
	id_affilie := COALESCE(id_affilie,0);
	devis := COALESCE(devis,0);
	nombre_pathologie := COALESCE(nombre_pathologie, 0);
	numero_cmu := TRIM(COALESCE(numero_cmu,''));
	mobile1_affilie := COALESCE(mobile1_affilie, '');
	mobile2_affilie := COALESCE(mobile2_affilie, '');
	initial_id_affilie := id_affilie;
	age_affilie := EXTRACT('year' FROM AGE(CURRENT_DATE, date_naissance));
	matricule_affilie := TRIM(COALESCE(matricule_affilie,''));
	nom_affilie := TRIM(COALESCE(nom_affilie,''));
	prenom_affilie := TRIM(COALESCE(prenom_affilie,''));
	out_message := '';
	id_offre := 0;
	
	IF UPPER(numero_cmu) IN ('NA', 'N/A', 'N-A') THEN
		numero_cmu := '';
	END IF;
	
	IF devis = 0 THEN
		out_message := 'Le numéro n''a pas été initialisé.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF devis <> 0 AND NOT EXISTS (SELECT * FROM StdNumeroSaisieSante
								  WHERE IdOperateur=user_id AND SaisieEnCours AND IdDevis=devis) THEN
		out_message := 'Saisie non initialisée pour cet utilisateur.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	
	IF (adherent = 0) OR NOT EXISTS(SELECT * FROM StdAdherent WHERE idadherent = adherent and iddevis=devis) THEN
		out_message := 'Adhérent inexistant.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF nom_affilie = '' THEN
		out_message := 'Nom de l''affilie non renseigné.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	-- Âge à la date d'effet du devis (comme la tarification, sp_creation_devis_sante), et non au jour de la saisie :
	-- un devis antidaté admet l'assuré qui avait l'âge requis à cette date. LE PHARE pose la date d'effet saisie à
	-- l'écran (lephare.date_effet_age) ; sinon celle de la couverture de la famille
	date_reference := NULLIF(COALESCE(current_setting('lephare.date_effet_age', true), ''), '')::date;
	IF date_reference IS NULL THEN
		SELECT SF.date_effet::date INTO date_reference
		FROM StdAdherent AS SA INNER JOIN StdFiliale AS SF ON (SA.IdFiliale = SF.IdFiliale)
		WHERE SA.IdAdherent = adherent;
	END IF;
	date_reference := COALESCE(date_reference, CURRENT_DATE);
	age_affilie := EXTRACT('year' FROM AGE(date_reference, date_naissance));
	-- Limites d'âge dépassables par un utilisateur habilité (droit LE PHARE devis.derogation_age) : LE PHARE pose
	-- lephare.derogation_age = 'on' sur sa connexion avant l'appel
	derogation_age := COALESCE(current_setting('lephare.derogation_age', true), '') = 'on';
	-- Âges des enfants : Administration > Réglages Santé MINENE (21 ans, 25 ans avec certificat à l'origine)
   	IF lien_affilie = 'E' AND age_affilie > fn_lephare_parametre_nombre('sante.minene.age_max_enfant_certificat', 25) THEN
		age_limite := fn_lephare_parametre_nombre('sante.minene.age_max_enfant_certificat', 25)::integer;
		IF NOT derogation_age THEN
			out_message := 'Enfant de plus de ' || age_limite || ' ans rejeté (' || age_affilie || ' ans au '
				|| to_char(date_reference, 'DD/MM/YYYY') || ').';
			RAISE EXCEPTION '%', out_message;
		END IF;
		message_derogation := ' Dérogation à la limite d''âge : ' || age_affilie || ' ans au ' || to_char(date_reference, 'DD/MM/YYYY') || ' (' || age_limite || ' ans au plus).';
	-- Enfants : 21 ans au plus, 25 ans au plus avec un certificat de scolarité de l'année ou un rapport
	-- médical (handicap réduisant totalement la mobilité) — conditions particulières MINENE
	ELSIF lien_affilie ='E' AND age_affilie > fn_lephare_parametre_nombre('sante.minene.age_max_enfant', 21) AND NOT certificat_joint THEN
		age_limite := fn_lephare_parametre_nombre('sante.minene.age_max_enfant', 21)::integer;
		IF NOT derogation_age THEN
			out_message := 'Enfant de plus de ' || age_limite || ' ans (' || age_affilie || ' ans au '
				|| to_char(date_reference, 'DD/MM/YYYY') || ') : certificat de scolarité ou rapport médical non fourni. Enfant rejeté.';
			RAISE EXCEPTION '%', out_message;
		END IF;
		message_derogation := ' Dérogation à la limite d''âge : ' || age_affilie || ' ans au ' || to_char(date_reference, 'DD/MM/YYYY') || ' (' || age_limite || ' ans au plus).';
	END IF;
	
	IF groupe_sanguin NOT IN ('O-','O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+', 'NA', 'N/A', 'N-A', 'NS', '') THEN
		out_message := 'Groupe sanguin incorrect!';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	-- Affections acceptées : Administration > Réglages Santé MINENE (3 au plus à l'origine)
	IF nombre_pathologie < 0 OR nombre_pathologie > fn_lephare_parametre_nombre('sante.minene.affections_max', 3) THEN
		out_message = 'Le nombre de pathologies doit être compris entre 0 et ' || fn_lephare_parametre_nombre('sante.minene.affections_max', 3)::integer || ' compris.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	--IF matricule_affilie = '' THEN
	--	out_message := 'Matricule obligatoire pour l''affilié!';
	--	RAISE EXCEPTION '%', out_message;
	--END IF;
	
	IF numero_cmu <> '' AND EXISTS (SELECT * FROM StdAffilie WHERE NumeroCmu = numero_cmu AND IdAffilie <> id_affilie) THEN
		out_message := 'Numéro CMU déjà enregistré pour un autre affilié!';
		RAISE EXCEPTION '%', out_message;	
	END IF;
	
-- 	IF nombre_pathologie < 0 THEN
-- 		out_message := 'Nombre de pathologies erroné!';
-- 		RAISE EXCEPTION '%', out_message;
-- 	END IF;
	
	SELECT COUNT(IdAffilie)
	INTO nombre_affilie
	FROM StdAffilie
	WHERE IdDevis = devis AND IdAdherent = adherent AND IdOperateur = user_id;
	nombre_affilie := COALESCE(nombre_affilie, 0) + CASE WHEN id_affilie = 0 THEN 1 ELSE 0 END; --Augmenter le nombre d'affiliés d'une unité si l'enregistrement en cours concerne un nouvel affilié
	--Vérifier le nombre maximal d'affiliés n'est pas dépassé
	SELECT SF.IdOffreSante
	INTO id_offre
	FROM StdAdherent AS SA 
	INNER JOIN StdFiliale AS SF ON (SA.IdFiliale = SF.IdFiliale AND SA.IdDevis=SF.IdDevis)
	WHERE SA.IdDevis = devis AND IdAdherent = adherent AND SA.IdOperateur = user_id;
	id_offre := COALESCE(id_offre, 0);
	
	IF id_offre = 0 THEN
		out_message := 'Aucune offre choisie pour cette famille!';
		RAISE EXCEPTION '%', out_message;	
	END IF;
	
	-- Barème OREOLE (70 %-80 %, VTC et 80 %-80 %) : SOLO 1 personne, FAMILLE 3 au plus, FAMILLE PLUS 6 au plus,
	-- réglés par formule dans Administration > Réglages Santé MINENE.
	-- v6 (demande du 2026-11-02) : une personne de plus dans une famille complète fait passer la famille dans la formule
	-- de sa nouvelle taille, de la même offre commerciale (FAMILLE de 3 personnes + 1 : FAMILLE PLUS ; SOLO + 1 : FAMILLE).
	-- Couverture de cette formule reprise dans le devis (même collège et zone) ou créée avec les dates de celle de la
	-- famille ; refus seulement si aucune formule de l'offre n'accueille cette taille. Tout est annulé si l'affilié est
	-- refusé plus loin (bloc unique). Avenant de modification : la prime est l'écart entre les deux formules
	-- (sp_creation_devis_sante).
	IF id_offre IN (17, 18, 19, 20, 21, 22, 175, 176, 181) AND nombre_affilie > fn_minene_personnes_max(id_offre) THEN
		SELECT O.IdOffre, F.option
		INTO v_offre_adaptee, v_option_adaptee
		FROM StdOffre AS O INNER JOIN lephare_sante_formule AS F ON F.idoffre = O.IdOffre
		WHERE O.IdTarif = (SELECT IdTarif FROM StdOffre WHERE IdOffre = id_offre) AND COALESCE(O.Actif, TRUE)
		  AND nombre_affilie BETWEEN F.personnesmin AND F.personnesmax
		ORDER BY F.personnesmax, O.IdOffre
		LIMIT 1;
		IF v_offre_adaptee IS NULL THEN
			out_message := 'Nombre maximum de personnes dépassé pour cette formule (' || fn_minene_personnes_max(id_offre)
				|| ' au plus) : aucune formule de l''offre n''accueille une famille de ' || nombre_affilie || ' personnes !';
			RAISE EXCEPTION '%', out_message;
		END IF;
		SELECT SF.IdCollege, SF.IdZoneCouverture, SF.date_effet::date, SF.date_expiration::date, COALESCE(F.option, O.LibelleOffre)
		INTO v_college, v_zone, v_effet_filiale, v_expiration_filiale, v_option_actuelle
		FROM StdAdherent AS SA
		INNER JOIN StdFiliale AS SF ON (SA.IdFiliale = SF.IdFiliale AND SA.IdDevis = SF.IdDevis)
		INNER JOIN StdOffre AS O ON O.IdOffre = SF.IdOffreSante
		LEFT JOIN lephare_sante_formule AS F ON F.idoffre = SF.IdOffreSante
		WHERE SA.IdDevis = devis AND SA.IdAdherent = adherent;
		SELECT IdFiliale
		INTO v_filiale_adaptee
		FROM StdFiliale
		WHERE IdDevis = devis AND IdOffreSante = v_offre_adaptee
		  AND IdCollege IS NOT DISTINCT FROM v_college AND IdZoneCouverture IS NOT DISTINCT FROM v_zone
		ORDER BY (IdOperateur = user_id) DESC, IdFiliale
		LIMIT 1;
		IF v_filiale_adaptee IS NULL THEN
			v_filiale_adaptee := 0;
			CALL sp_saisie_filiale_sante(v_college, v_offre_adaptee, v_zone, v_effet_filiale, v_expiration_filiale, CURRENT_DATE, 'S',
										 user_id, v_filiale_adaptee, devis, v_message_filiale);
		END IF;
		UPDATE StdAdherent SET IdFiliale = v_filiale_adaptee WHERE IdAdherent = adherent AND IdDevis = devis;
		message_formule := ' Famille de ' || nombre_affilie || ' personnes : elle passe de ' || v_option_actuelle || ' à '
			|| v_option_adaptee || '.';
		id_offre := v_offre_adaptee;
	END IF;
	
	IF groupe_sanguin IN ('NA', 'N/A', 'N-A', '') THEN
		groupe_sanguin := 'NS';
	END IF;
	
	-- MINENE : 69 ans au plus pour l'adhérent et le conjoint (conditions particulières), toutes formules ;
	-- âge réglé dans Administration > Réglages Santé MINENE
	IF id_offre IN (17, 18, 19, 20, 21, 22, 175, 176, 181) THEN
		age_limite := fn_lephare_parametre_nombre('sante.minene.age_max_adulte', 69)::integer;
		IF lien_affilie IN ('A', 'C') AND age_affilie > age_limite THEN
			IF NOT derogation_age THEN
				out_message := 'Âge limite dépassé : ' || age_affilie || ' ans au ' || to_char(date_reference, 'DD/MM/YYYY')
					|| ' (' || age_limite || ' ans au plus). Assuré rejeté.';
				RAISE EXCEPTION '%', out_message;
			END IF;
			message_derogation := ' Dérogation à la limite d''âge : ' || age_affilie || ' ans au ' || to_char(date_reference, 'DD/MM/YYYY') || ' (' || age_limite || ' ans au plus).';
		END IF;
	END IF;
	
   	IF id_affilie = 0 THEN
		IF lien_affilie = 'A' THEN
			IF EXISTS (SELECT * FROM StdAffilie WHERE idadherent = adherent AND iddevis = devis AND idoperateur = user_id AND lien = 'A') THEN
				out_message := 'Adhérent déjà saisi en tant qu''affilié.';
				RAISE EXCEPTION '%',out_message;
			END IF;
		END IF;
		IF lien_affilie = 'E' AND age_affilie > 21 AND certificat_joint THEN
			date_controle := CURRENT_DATE;
		END IF;
		INSERT INTO stdaffilie(groupesanguin, lien, nom, prenom, nombrepathologie, numerocmu, cni, datenaissance, mobile1, mobile2, dateadhesion, datesortie, certificat, datectrl, matricule, carte_vigueur, ancien_matricule, date_dernier_demande, observations, handicape, sexe, actif, primeannuelle, datemaj, iddevis, datedebutconsommation, surprimeappliquee, montantsurprime, idadherent, idoperateur)
		VALUES (groupe_sanguin, lien_affilie, nom_affilie, prenom_affilie, nombre_pathologie, numero_cmu, cni_affilie, date_naissance, mobile1_affilie, mobile2_affilie, date_effet, NULL, certificat_joint, date_controle, matricule_affilie, False, '', NULL, observations_, affilie_handicape, sexe_affilie, True, 0, CURRENT_TIMESTAMP, devis, debut_consommation, surprime_appliquee, montant_surprime, adherent, user_id)
		RETURNING idaffilie INTO id_affilie;
		
	ELSE
		IF lien_affilie = 'A' AND EXISTS (SELECT * FROM StdAffilie WHERE idadherent = adherent AND iddevis = devis AND idoperateur = user_id AND lien ='A' AND idaffilie <> id_affilie) THEN
			out_message := 'Un autre affilié est déjà adhérent dans cette famille.';
			RAISE EXCEPTION '%', out_message;
		END IF;
		UPDATE stdaffilie
		SET groupesanguin = groupe_sanguin, lien = lien_affilie, nom = nom_affilie, prenom = prenom_affilie, cni = cni_affilie, datenaissance = date_naissance, dateadhesion = date_effet, certificat = certificat_joint,
		    datectrl = date_controle, matricule = matricule_affilie, observations = observations_, handicape = affilie_handicape, sexe = sexe_affilie, datemaj = CURRENT_TIMESTAMP,
			iddevis = devis, datedebutconsommation = debut_consommation, idadherent = adherent, surprimeappliquee = surprime_appliquee, montantsurprime = montant_surprime,
			mobile1 = mobile1_affilie, mobile2 = mobile2_affilie, nombrepathologie = nombre_pathologie, numerocmu = numero_cmu
		WHERE idaffilie = id_affilie;
	END IF;
   	
	IF (initial_id_affilie = 0) AND (id_affilie <>0) THEN
		out_message := 'Affilié enregistré avec succès.' || message_derogation || message_formule;
	ELSE
		out_message := 'Mise à jour d''affilié réussie.' || message_derogation || message_formule;
	END IF;
	
	EXCEPTION WHEN others THEN
	
		get stacked diagnostics
        	v_state   = returned_sqlstate,
        	v_msg     = message_text,
        	v_detail  = pg_exception_detail,
        	v_hint    = pg_exception_hint,
        	v_context = pg_exception_context;
			
		out_message := v_msg; -- || ' : ' || v_context; -- 'Problème rencontré lors de l''enregistrement de l'affilié;
		
    	RAISE EXCEPTION E'%
        	state  : %
        	detail : %
        	hint   : %
        	context: %
        	SQLSTATE: % 
        	SQLERRM: %', v_msg, v_state, v_detail, v_hint, v_context, SQLSTATE, SQLERRM;

END; 
$procedure$
