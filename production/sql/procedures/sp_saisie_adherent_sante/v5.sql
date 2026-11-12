CREATE OR REPLACE PROCEDURE public.sp_saisie_adherent_sante(IN nom_adherent character varying, IN prenom_adherent character varying, IN sexe_adherent character, IN cni_adherent character varying, IN adherent_vip boolean, IN adresse_adherent character varying, IN mobile1_adherent character varying, IN mobile2_adherent character varying, IN email_adherent character varying, IN date_naissance date, IN date_effet date, IN filiale_adherent integer, IN debut_consommation date, IN matricule_adherent character varying, IN surprime_appliquee boolean, IN montant_surprime numeric, IN nombre_pathologie integer, IN numero_cmu character varying, IN groupe_sanguin character varying, IN user_id integer, INOUT id_adherent integer, INOUT devis integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
	initial_id_adherent integer;
	age_adherent integer;
	id_offre integer;
	-- Âge apprécié à la date d'effet de la couverture ; dérogation accordée par LE PHARE (utilisateur habilité)
	date_reference date;
	age_limite integer;
	derogation_age boolean;
	message_derogation text := '';
	
	----Gestion des erreurs
	v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
	
BEGIN
	
	filiale_adherent := COALESCE(filiale_adherent,0);
	id_adherent := COALESCE(id_adherent,0);
	devis := COALESCE(devis,0);
	nombre_pathologie := COALESCE(nombre_pathologie, 0);
	numero_cmu := TRIM(COALESCE(numero_cmu,''));
	nom_adherent := TRIM(COALESCE(nom_adherent,''));
	prenom_adherent := TRIM(COALESCE(prenom_adherent,''));
	--date_naissance := COALESCE(date_naissance, CURRENT_DATE);
	id_offre := 0;
	
-- 	IF (date_naissance IS NULL) OR (date_naissance = CURRENT_DATE) THEN
-- 		out_message := 'Date de naissance non renseignée.';
-- 		RAISE EXCEPTION '%', out_message;
-- 	END IF;
	
	IF UPPER(numero_cmu) IN ('NA', 'N/A', 'N-A') THEN
		numero_cmu := '';
	END IF;
	initial_id_adherent := id_adherent;
	matricule_adherent := TRIM(COALESCE(matricule_adherent,''));
	
	IF devis = 0 THEN
		out_message := 'Le numéro de devis n''a pas été initialisé.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF devis <> 0 AND NOT EXISTS (SELECT * FROM StdNumeroSaisieSante
								  WHERE IdOperateur=user_id AND SaisieEnCours AND IdDevis=devis) THEN
		out_message := 'Saisie non initialisée pour cet utilisateur.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF nom_adherent = '' THEN
		out_message := 'Nom de l''adhérent non renseigné.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF filiale_adherent = 0 THEN
		out_message := 'Filiale non renseignée pour cet adherent.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	-- Âge à la date d'effet du devis (comme la tarification, sp_creation_devis_sante), et non au jour de la saisie :
	-- un devis antidaté admet l'assuré qui avait l'âge requis à cette date. LE PHARE pose la date d'effet saisie à
	-- l'écran (lephare.date_effet_age) ; sinon celle de la couverture
	date_reference := NULLIF(COALESCE(current_setting('lephare.date_effet_age', true), ''), '')::date;
	IF date_reference IS NULL THEN
		SELECT F.date_effet::date INTO date_reference FROM StdFiliale AS F WHERE F.idfiliale = filiale_adherent AND F.iddevis = devis;
	END IF;
	date_reference := COALESCE(date_reference, CURRENT_DATE);
	age_adherent := EXTRACT('year' FROM AGE(date_reference, date_naissance));
	-- Limite d'âge dépassable par un utilisateur habilité (droit LE PHARE devis.derogation_age) : LE PHARE pose
	-- lephare.derogation_age = 'on' sur sa connexion avant l'appel
	derogation_age := COALESCE(current_setting('lephare.derogation_age', true), '') = 'on';
	-- Date de naissance après la date d'effet : erreur de saisie. Assuré principal mineur : refusé en MINENE seulement
	-- (contrôle après la lecture de l'offre de la couverture, v5)
	IF age_adherent < 0 THEN
		out_message := 'Erreur sur la date de naissance';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF groupe_sanguin NOT IN ('O-','O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+', 'NA', 'N/A', 'N-A', 'NS', '') THEN
		out_message := 'Groupe sanguin incorrect!';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	--IF matricule_adherent = '' THEN
	--	out_message := 'Matricule obligatoire pour l''adhérent!';
	--	RAISE EXCEPTION '%', out_message;
	--END IF;
	
	IF numero_cmu <> '' AND EXISTS (SELECT * FROM StdAdherent WHERE NumeroCmu = numero_cmu AND IdAdherent <> id_adherent) THEN
		out_message := 'Numéro CMU déjà enregistré pour un autre adhérent!';
		RAISE EXCEPTION '%', out_message;	
	END IF;
	
	IF NOT EXISTS (SELECT * FROM StdFiliale WHERE idfiliale = filiale_adherent AND idoperateur=user_id AND iddevis=devis) THEN
		out_message = 'Filiale non définie pour la session en cours.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	IF groupe_sanguin IN ('NA', 'N/A', 'N-A', '') THEN
		groupe_sanguin := 'NS';
	END IF;
	
	-- Affections acceptées : Administration > Réglages Santé MINENE (3 au plus à l'origine)
	IF nombre_pathologie < 0 OR nombre_pathologie > fn_lephare_parametre_nombre('sante.minene.affections_max', 3) THEN
		out_message = 'Le nombre de pathologies doit être compris entre 0 et ' || fn_lephare_parametre_nombre('sante.minene.affections_max', 3)::integer || ' compris.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	SELECT IdOffreSante
	INTO id_offre
	FROM StdFiliale
	WHERE idfiliale = filiale_adherent AND idoperateur=user_id AND iddevis=devis
	LIMIT 1;
	id_offre := COALESCE(id_offre, 0);
	
	IF id_offre = 0 THEN
		out_message = 'Aucune offre choisie pour cet adhérent.';
		RAISE EXCEPTION '%', out_message;
	END IF;
	
	-- v5 : l'adhérent (assuré principal) doit être majeur en MINENE ; hors MINENE, un contrat groupe peut couvrir des
	-- enfants dans leur propre famille quand leur parent est assuré dans une autre couverture (OIKOCREDIT : parent en
	-- 100 % Monde entier, enfants en 100 % Côte d'Ivoire). URANUS refusait tout adhérent de moins de 18 ans.
	IF id_offre IN (17, 18, 19, 20, 21, 22, 175, 176, 181) AND age_adherent < 18 THEN
		out_message := 'En MINENE, l''adhérent (assuré principal) doit être majeur : ' || age_adherent || ' ans au '
			|| to_char(date_reference, 'DD/MM/YYYY') || '. Saisissez l''enfant comme affilié de son parent.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	-- MINENE : 69 ans au plus pour l'adhérent (conditions particulières), toutes formules ; âge réglé
	-- dans Administration > Réglages Santé MINENE ; au-delà, seulement par dérogation
	IF id_offre IN (17, 18, 19, 20, 21, 22, 175, 176, 181) THEN
		age_limite := fn_lephare_parametre_nombre('sante.minene.age_max_adulte', 69)::integer;
		IF age_adherent > age_limite THEN
			IF NOT derogation_age THEN
				out_message := 'Âge limite dépassé : ' || age_adherent || ' ans au ' || to_char(date_reference, 'DD/MM/YYYY')
					|| ' (' || age_limite || ' ans au plus). Assuré rejeté.';
				RAISE EXCEPTION '%', out_message;
			END IF;
			message_derogation := ' Dérogation à la limite d''âge : ' || age_adherent || ' ans au ' || to_char(date_reference, 'DD/MM/YYYY') || ' (' || age_limite || ' ans au plus).';
		END IF;
	END IF;
   
   	IF id_adherent = 0 THEN
		INSERT INTO stdadherent(matricule, surprimeappliquee, montantsurprime, nombrepathologie, numerocmu, groupesanguin, nom, prenom, sexe, cni, vip, adresse, mobile1, mobile2, email, datenaissance, dateadhesion, datesortie, actif, datemaj, iddevis, datedebutconsommation, idfiliale, idoperateur)
		VALUES (matricule_adherent, surprime_appliquee, montant_surprime, nombre_pathologie, numero_cmu, groupe_sanguin, nom_adherent, prenom_adherent, sexe_adherent, cni_adherent, adherent_vip, adresse_adherent, mobile1_adherent, mobile2_adherent, email_adherent, date_naissance, date_effet, NULL, True, CURRENT_TIMESTAMP, devis, debut_consommation, filiale_adherent, user_id)
		RETURNING idadherent INTO id_adherent;
		---Inserer l'adhérent comme premier affilie
		INSERT INTO stdaffilie(mobile1, mobile2, matricule, surprimeappliquee, montantsurprime, nombrepathologie, numerocmu, groupesanguin, lien, nom, prenom, cni, datenaissance, dateadhesion, datesortie, certificat, datectrl, carte_vigueur, ancien_matricule, date_dernier_demande, observations, handicape, sexe, actif, primeannuelle, datemaj, iddevis, datedebutconsommation, idadherent, idoperateur)
		VALUES (mobile1_adherent, mobile2_adherent, matricule_adherent, surprime_appliquee, montant_surprime, nombre_pathologie, numero_cmu, groupe_sanguin, 'A', nom_adherent, prenom_adherent, cni_adherent, date_naissance, date_effet, NULL, False, NULL, False, '', NULL, 'RAS', False, sexe_adherent, True, 0, CURRENT_TIMESTAMP, devis, debut_consommation, id_adherent, user_id);
	ELSE
		UPDATE stdadherent
		SET nom = nom_adherent, prenom = prenom_adherent, sexe = sexe_adherent, cni = cni_adherent, vip = adherent_vip, adresse = adresse_adherent, mobile1 = mobile1_adherent, mobile2 = mobile2_adherent, idfiliale = filiale_adherent,
			email = email_adherent, datenaissance = date_naissance, dateadhesion = date_effet, datemaj = CURRENT_TIMESTAMP, iddevis = devis, datedebutconsommation = debut_consommation,
			matricule = matricule_adherent, surprimeappliquee = surprime_appliquee, montantsurprime = montant_surprime, nombrepathologie = nombre_pathologie, numerocmu = numero_cmu, groupesanguin = groupe_sanguin
		WHERE idadherent = id_adherent;
		---Mettre à jour également l'affilié correspondant à l'adhérent
		UPDATE stdaffilie
		SET nom = nom_adherent, prenom = prenom_adherent, cni = cni_adherent, datenaissance = date_naissance, dateadhesion = date_effet, sexe = sexe_adherent, datedebutconsommation = debut_consommation, datemaj = CURRENT_TIMESTAMP,
			matricule = matricule_adherent, surprimeappliquee = surprime_appliquee, montantsurprime = montant_surprime, nombrepathologie = nombre_pathologie, numerocmu = numero_cmu, groupesanguin = groupe_sanguin,
			mobile1 = mobile1_adherent, mobile2 = mobile2_adherent
		WHERE idadherent = id_adherent AND idoperateur = user_id AND lien = 'A';
	END IF;
   	
   	
	IF (initial_id_adherent = 0) AND (id_adherent <>0) THEN
		out_message := 'Adherent enregistré avec succès.' || message_derogation;
	ELSE
		out_message := 'Mise à jour réussie.' || message_derogation;
	END IF;
	
	EXCEPTION WHEN others THEN
	
		get stacked diagnostics
        	v_state   = returned_sqlstate,
        	v_msg     = message_text,
        	v_detail  = pg_exception_detail,
        	v_hint    = pg_exception_hint,
        	v_context = pg_exception_context;
			
		out_message := v_msg; -- || ' : ' || v_context; -- 'Problème rencontré lors de l''enregistrement de l'adherent;
		RAISE EXCEPTION E'%
        	state  : %
        	detail : %
        	hint   : %
        	context: %
        	SQLSTATE: % 
        	SQLERRM: %', v_msg, v_state, v_detail, v_hint, v_context, SQLSTATE, SQLERRM;

END; 
$procedure$
