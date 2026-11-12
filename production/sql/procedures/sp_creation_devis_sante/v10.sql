-- v10 (production 0187) : surprime imposée par personne. Un assuré dont la case « Surprime » est cochée avec un montant
-- remplace sa surprime calculée (âge et affection) par ce montant annuel ; sans montant, la surprime reste calculée.
CREATE OR REPLACE PROCEDURE public.sp_creation_devis_sante(IN id_intermediaire integer, IN id_compagnie integer, IN id_produit integer, IN id_offre integer, IN id_avenant integer, IN id_client integer, IN id_assure integer, IN p_flotte boolean, IN p_coassurance boolean, IN date_effet date, IN date_expiration date, IN date_emission date, IN id_tarif integer, IN prime_famille numeric, IN prime_affilie numeric, IN prime_globale numeric, IN montant_surprime numeric, IN montant_accessoire_manuel numeric, IN taux_reduction_commerciale numeric, IN type_contrat integer, IN gestionnaire_sante character varying, IN id_duree integer, IN numero_police_compagnie character varying, IN user_id integer, INOUT id_devis integer, INOUT out_message character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE

	etat_traitement character varying(1); code_avenant character varying(5); numero_avenant character varying(8); cle_avenant integer; numero_devis character varying(16);
	code_categorie character varying(3); local_message character varying(250); id_devis_detail integer; id_garantie integer;
	v_periode character(1); v_accessoire numeric; prime_nette numeric; taux_commission numeric;
	nom_conducteur character varying(80); adresse_conducteur character varying(60); code_alarme integer; v_bns numeric;
	date_mec date; num_moteur character varying(20); num_chassis character varying(20); type_vehicule character varying(50);
	id_marque integer; v_matricule character varying(20); v_essence integer; num_pc_conduire character varying(30); code_usage character(3);
	id_carrosserie integer; code_carburant integer; v_puissance integer; nombre_place integer; charge_utile integer; v_age integer;
	prime_deces numeric; prime_ip numeric; prime_frais_traitement numeric; taxe_accessoire numeric; duree_totale integer;
	nombre_adherent integer;  nombre_affilie integer; debut_annee date; fin_annee date; v_accessoire_intermediaire  numeric;
	police_sante_groupe boolean;
	age_affilie int; montant_surprime_nene numeric; taxe_minene numeric;
	nombre_pathologie int;
	nombre_primes int;
	prime_globale_manuelle boolean;
	montant_surprime_age numeric;
	montant_surprime_affection numeric;
	prime_nette_sante numeric;
	prime_affilie_manuelle numeric;
	v_prime_imposee bool;
	prev_taux_reduction numeric;
	montant_surprime_saisi numeric;
	v_part_cabinet numeric;
	-- Avenant de modification (v9)
	v_devis_base integer; v_code_base character varying(5); v_effet_base date; v_expiration_base date; v_date_tarif date;
	v_applique_prev boolean; v_devis_precedent integer; v_police character varying(50); v_prorata numeric;
	v_pn_avenant numeric; v_acc_complet numeric; v_acc_precedent numeric; v_acc_avenant numeric; v_nombre_precedent integer;
	v_annuelle_precedente numeric; v_nombre_reference integer; v_mode_reference boolean;

	----Gestion des erreurs
	--v_state   TEXT;
	v_msg     TEXT;
	--v_detail  TEXT;
	--v_hint    TEXT;
	--v_context TEXT;

BEGIN

	CREATE TEMPORARY TABLE IF NOT EXISTS temp_garantie(IdSousGarantie integer, LibelleSousGarantie character varying(100),
  							GarCapitalVal numeric, GarPlaceVal integer, GarFranchiseVal numeric, Taux numeric,
  							Acquise boolean, PrimeAnnuelle numeric, PrimeNette numeric);

	CREATE TEMPORARY TABLE IF NOT EXISTS temp_garantie_inter(IdGarantie integer, LibelleGarantie character varying(60),
  							IdSousGarantie int, LibelleSousGarantie character varying(100),
  							Acquise boolean, Capital numeric, NombrePlace integer, PrimeAnnuelle numeric,
  							PrimeNette numeric);
	CREATE TEMPORARY TABLE IF NOT EXISTS temp_adherent_surprime(idadherent int, idaffilie int, lien character, age int, nombrepathologie int, surprimeaffection numeric, surprimeage numeric);

	DELETE FROM temp_garantie;
	DELETE FROM temp_garantie_inter;
	DELETE FROM temp_adherent_surprime;

	id_devis := COALESCE(id_devis, 0);
	IF id_devis = 0 THEN
		out_message := 'Erreur logicielle, ID du devis est égal à zéro!';
		RAISE EXCEPTION '%', out_message;
	END IF;

	IF NOT EXISTS (SELECT 1 FROM StdDevis WHERE IdDevis = id_devis) THEN
		out_message := 'Devis inexistant. Opération impossible!';
		RAISE EXCEPTION '%', out_message;
	END IF;

	IF EXISTS (SELECT 1 FROM StdDevis WHERE IdDevis = id_devis AND Confirme) THEN
		out_message := 'Devis déjà confirmé. Opération impossible!';
		RAISE EXCEPTION '%', out_message;
	END IF;

	IF EXISTS (SELECT 1 FROM StdAffilie WHERE (IdDevis = id_devis) AND (DateNaissance IS NULL)) THEN
		out_message := 'Date de naissance non renseignée pour certains affiliés.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	debut_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS varchar(4)),'-01-01') AS date);
	fin_annee := CAST (CONCAT(CAST(DATE_PART('year',CURRENT_DATE) AS varchar(4)),'-12-31') AS date);
	duree_totale := fin_annee - debut_annee + 1;

	id_intermediaire := COALESCE(id_intermediaire, 0);
	id_compagnie := COALESCE(id_compagnie, 0);
	id_produit := COALESCE(id_produit, 0);
	id_offre := COALESCE(id_offre, 0);
	id_tarif := COALESCE(id_tarif, 0);
	id_client := COALESCE(id_client, 0);
	id_assure := COALESCE(id_assure, 0);
	id_avenant := COALESCE(id_avenant, 0);
	p_flotte := COALESCE(p_flotte,'0');
	p_coassurance := COALESCE(p_coassurance,'0');
	id_duree := COALESCE(id_duree, 1);
	prime_famille := COALESCE(prime_famille, 0.0);
	prime_affilie := COALESCE(prime_affilie, 0.0);
	prime_globale := COALESCE(prime_globale, 0.0);
	montant_surprime := COALESCE(montant_surprime, 0.0);
	montant_surprime_saisi := montant_surprime;
	montant_accessoire_manuel := COALESCE(montant_accessoire_manuel, 0.0);
	taux_reduction_commerciale := COALESCE(taux_reduction_commerciale, 0.0);
   	type_contrat := COALESCE(type_contrat, 1);
   	gestionnaire_sante := COALESCE(gestionnaire_sante, '');
	montant_surprime_nene := 0.0;
	nombre_pathologie := 0;
	montant_surprime_age := 0;
	montant_surprime_affection := 0;
	nombre_primes := 0;
	taxe_minene := 0;
	prime_globale_manuelle := (prime_globale > 0);
	prime_affilie_manuelle := prime_affilie;
	v_prime_imposee := false;
	IF numero_police_compagnie IS NOT NULL THEN
		numero_police_compagnie := NULLIF(TRIM(numero_police_compagnie),'');
	END IF;

	--Contrôler la durée des contrats pour les offres MINENE
	SELECT EtatTraitement, CodeAvenant
	INTO etat_traitement, code_avenant
	FROM stdAvenant
	WHERE IdAvenant = id_avenant;

	-- Avenant de modification en cours de période (v9 : changement de formule, incorporation d'un membre) : la nouvelle
	-- composition est tarifée comme le contrat de la période (âges à sa date d'effet, taux d'ajustement de l'an dernier si
	-- ce contrat est un renouvellement) ; la prime de l'avenant (écart au prorata) est calculée en fin de procédure
	v_date_tarif := date_effet;
	prev_taux_reduction := 0;
	v_applique_prev := (code_avenant = 'REN');
	-- Mode référence (sante/avenant.py, à la création de l'avenant) : composition d'avant la modification tarifée en primes
	-- annuelles, sans le calcul de l'avenant
	v_mode_reference := COALESCE(current_setting('lephare.avenant_reference', true), '') = 'on';
	IF code_avenant = 'MOD' THEN
		SELECT SD.IdOldHist INTO v_devis_base FROM StdDevis AS SD WHERE SD.IdDevis = id_devis;
		SELECT A.CodeAvenant, B.DateEffet::date, B.DateExpiration::date
		INTO v_code_base, v_effet_base, v_expiration_base
		FROM StdDevis AS B JOIN StdAvenant AS A ON A.IdAvenant = B.IdAvenant
		WHERE B.IdDevis = v_devis_base;
		IF v_code_base IS NULL THEN
			out_message := 'Avenant sans contrat de base : modification impossible.';
			RAISE EXCEPTION '%', out_message;
		END IF;
		IF date_effet < v_effet_base OR date_effet > v_expiration_base THEN
			out_message := 'La date d''effet de l''avenant doit être comprise dans la période du contrat (du ' || to_char(v_effet_base, 'DD/MM/YYYY')
				|| ' au ' || to_char(v_expiration_base, 'DD/MM/YYYY') || ').';
			RAISE EXCEPTION '%', out_message;
		END IF;
		IF date_expiration <> v_expiration_base THEN
			out_message := 'L''avenant prend fin à l''échéance du contrat : date d''expiration ' || to_char(v_expiration_base, 'DD/MM/YYYY') || '.';
			RAISE EXCEPTION '%', out_message;
		END IF;
		v_date_tarif := v_effet_base;
		v_applique_prev := (v_code_base = 'REN');
	END IF;
  -- IF id_offre IN (17, 18, 19, 20, 21, 22) THEN
	-- 	-- IF (type_contrat = 1) AND (date_expiration <> fin_annee) THEN
	-- 	-- 	out_message := 'Contrat de type PARTICULIER: date d''expiration saisie différente du 31 décembre. Echec de la création du devis.';
	-- 	-- 	RAISE EXCEPTION '%', out_message;	
	-- 	-- END IF;
	-- 	-- IF (type_contrat = 2) AND (((date_expiration - date_effet) + 1) < 365) AND (code_avenant IN ('AFN','REN')) THEN
	-- 	-- 	out_message := 'Contrat de type SOCIETE: durée inférieure à un an. Echec de la création du devis.';
	-- 	-- 	RAISE EXCEPTION '%', out_message;
	-- 	-- END IF;
	-- 	IF (((date_expiration - date_effet) + 1) < 365) AND (code_avenant IN ('AFN','REN', 'RPP')) THEN
	-- 		out_message := 'Durée de contrat inférieure à un an. Echec de la création du devis.';
	-- 		RAISE EXCEPTION '%', out_message;
	-- 	END IF;
	-- END IF;

	IF id_duree = 1 THEN
		id_duree := fn_calcul_id_duree_contrat(date_expiration - date_effet);
	END IF;

	id_carrosserie := 0; code_carburant := 0; id_marque := 0; code_usage := '000'; code_alarme := 0; num_pc_conduire := ''; v_matricule := '';
	nom_conducteur := ''; adresse_conducteur := '';v_bns := 0;date_mec := '1900-01-01'::date;num_moteur := '';num_chassis := '';type_vehicule := '';
	v_matricule := ''; v_essence := 0; num_pc_conduire := ''; v_puissance := 0; nombre_place := 0;charge_utile := 0;

	--Nombre de primes renseignées
	IF prime_affilie > 0 THEN
		nombre_primes := nombre_primes + 1;
	END IF;

	IF prime_famille > 0 THEN
		nombre_primes := nombre_primes + 1;
	END IF;

	IF prime_globale > 0 THEN
		v_prime_imposee := true;
		nombre_primes := nombre_primes + 1;
	END IF;

	IF nombre_primes > 1 THEN
		out_message := 'Au moins 2 valeurs de prime renseignées. Echec de la création du devis.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	---Quelques contrôles de cohérences
	IF (NOT public.fn_offre_automatisee_minene_sante(id_offre)) AND (prime_famille = 0) AND (prime_affilie = 0) AND (prime_globale = 0) THEN
		out_message := 'Aucune prime renseignée. Echec de la création du devis.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	PERFORM COUNT(IdAffilie) , IdDevis, IdAdherent, IdOperateur
	FROM StdAffilie
	WHERE IdDevis = id_devis AND IdOperateur = user_id AND Lien = 'A'
	GROUP BY IdDevis, IdAdherent, IdOperateur
	HAVING COUNT(IdAffilie) > 1;
	IF FOUND THEN
		out_message := 'Des familles ont au moins 2 affiliés déclarés comme adhérents. Echec de la création du devis.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	v_periode := fn_calcul_periode_contrat(date_expiration - date_effet);

	-- MINENE : taux de commission du cabinet du barème OREOLE (6,5 %), autres offres : produit et compagnie
	taux_commission := fn_get_taux_commission_offre(id_produit, id_compagnie, id_offre, date_emission);

	SELECT CodeCategorie
	INTO code_categorie
	FROM StdTarif
	WHERE IdTarif = id_tarif;
	code_categorie := COALESCE(code_categorie, '000');

	IF (code_categorie = '000') THEN
		out_message := 'Mauvais choix de tarif ou tarif mal paramétré.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	SELECT NumeroDevis
	INTO numero_devis
	FROM StdDevis
	WHERE IdDevis = id_devis;
	numero_devis := COALESCE(numero_devis,'');
	IF numero_devis = '' THEN
		CALL sp_numeroter_avenant(id_avenant, id_intermediaire, cle_avenant, numero_avenant);
		CALL sp_generer_numero_devis (id_intermediaire, id_compagnie, code_categorie, numero_devis, local_message);
		UPDATE StdDevis
		SET NumeroAvenant = numero_avenant, NumeroDevis = numero_devis
		WHERE IdDevis = id_devis;
	END IF;

	INSERT INTO temp_garantie_inter(IdGarantie, LibelleGarantie, IdSousGarantie, LibelleSousGarantie, Acquise, Capital, NombrePlace,
					PrimeAnnuelle,PrimeNette)
	SELECT SG.IdGarantie, G.LibelleGarantie, OG.IdSousGarantie AS IdSOusGarantie, SG.LibelleSousGarantie, True AS Acquis, 0 AS Capital,
		0 AS NbrePlace,0 AS PrimeAnnuelle, 0 AS PrimeNette
	FROM StdOffreGarantie AS OG
	join StdSousGarantie AS SG ON (SG.IdSousGarantie = OG.IdSousGarantie)
	join StdGarantie AS G ON (G.IdGarantie = SG.IdGarantie)
	WHERE IdOffre = id_offre
	ORDER BY 1;

	SELECT COUNT(IdAdherent)
	INTO nombre_adherent
	FROM StdAdherent
	WHERE IdDevis = id_devis AND IdOperateur = user_id;

	nombre_adherent := COALESCE(nombre_adherent, 0);
	IF (nombre_adherent = 0) THEN
		out_message := 'Aucun adhérent saisi. Echec de la création du devis.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	SELECT COUNT(IdAffilie)
	INTO nombre_affilie
	FROM StdAffilie
	WHERE IdDevis = id_devis AND IdOperateur = user_id;

	nombre_affilie := COALESCE(nombre_affilie, 0);
	IF (nombre_affilie = 0) THEN
		out_message := 'Aucun affilié saisi. Echec de la création du devis.';
		RAISE EXCEPTION '%', out_message;
	END IF;

	IF NOT public.fn_offre_automatisee_minene_sante(id_offre) THEN --Calcul de primes pour les tarifs non automatisés
		v_prime_imposee := true;
		IF (prime_famille = 0) THEN
			IF (prime_affilie <> 0) THEN
				UPDATE temp_garantie_inter
				SET PrimeAnnuelle = prime_affilie * nombre_affilie, PrimeNette = prime_affilie * nombre_affilie
				WHERE IdSousGarantie = 98; ---GARANTIE PRINCIPALE SANTE

				UPDATE StdAffilie
				SET PrimeAnnuelle = prime_affilie
				WHERE IdDevis = id_devis AND IdOperateur = user_id;

			ELSIF (prime_globale <> 0) THEN
				UPDATE temp_garantie_inter
				SET PrimeAnnuelle = prime_globale, PrimeNette = prime_globale
				WHERE IdSousGarantie = 98; ---GARANTIE PRINCIPALE SANTE

				UPDATE StdAffilie
				SET PrimeAnnuelle = 0
				WHERE IdDevis = id_devis AND IdOperateur = user_id;
			END IF;
		ELSE
			UPDATE temp_garantie_inter
			SET PrimeAnnuelle = prime_famille * nombre_adherent, PrimeNette = prime_famille * nombre_adherent
			WHERE IdSousGarantie = 98; ---GARANTIE PRINCIPALE SANTE

			UPDATE StdAffilie
			SET PrimeAnnuelle = CASE WHEN lien = 'A' THEN prime_famille ELSE 0 END
			WHERE IdDevis = id_devis AND IdOperateur = user_id;
		END IF;
	ELSIF id_offre IN (17, 18, 19, 20, 21, 22, 175, 176, 181) THEN ---Offres MINENE
		montant_surprime_nene := 0;
		-- Barème OREOLE (TARIFICATION MINENE SANTE.xlsx) : chaque famille est tarifée selon la formule de
		-- sa couverture (SOLO : 1 personne, FAMILLE : jusqu'à 3, FAMILLE PLUS : jusqu'à 6), un devis
		-- pouvant réunir des familles de formules différentes. La formule du devis ne sert qu'à défaut.
		CREATE TEMPORARY TABLE IF NOT EXISTS temp_famille_minene(idadherent int, idoffre int, personnes int, primebase numeric,
								surprimeage numeric, surprimeaffection numeric, primesante numeric);
		DELETE FROM temp_famille_minene;
		INSERT INTO temp_famille_minene(idadherent, idoffre, personnes, primebase, surprimeage, surprimeaffection, primesante)
		SELECT AD.IdAdherent,
			   CASE WHEN F.IdOffreSante IN (17, 18, 19, 20, 21, 22, 175, 176, 181) THEN F.IdOffreSante ELSE id_offre END,
			   (SELECT COUNT(*) FROM StdAffilie AS AF WHERE AF.IdAdherent = AD.IdAdherent AND AF.IdDevis = AD.IdDevis AND AF.IdOperateur = user_id),
			   0, 0, 0, 0
		FROM StdAdherent AS AD
		LEFT JOIN StdFiliale AS F ON (F.IdFiliale = AD.IdFiliale) -- couverture de la famille, même reprise d'un autre devis
		WHERE AD.IdDevis = id_devis AND AD.IdOperateur = user_id;

		-- Taille maximale de chaque formule : Administration > Réglages Santé MINENE
		IF EXISTS (SELECT 1 FROM temp_famille_minene
				   WHERE personnes > fn_minene_personnes_max(idoffre)) THEN
			out_message := 'Nombre maximum de personnes dépassé pour la formule d''une famille (' ||
				(SELECT string_agg(DISTINCT COALESCE(O.LibelleOffre, FM.idoffre::text) || ' : ' || fn_minene_personnes_max(FM.idoffre), ', ')
				 FROM temp_famille_minene AS FM LEFT JOIN StdOffre AS O ON O.IdOffre = FM.idoffre
				 WHERE FM.personnes > fn_minene_personnes_max(FM.idoffre)) || ' au plus). Echec de la création du devis.';
			RAISE EXCEPTION '%', out_message;
		END IF;

		-- 1. Prime de base (barème de la formule de chaque famille, ou prime saisie)
		IF (prime_affilie = 0) AND (prime_famille = 0) AND (prime_globale = 0) THEN
			prime_affilie := fn_get_prime_base_minene_sante(id_offre);
			UPDATE temp_famille_minene SET primebase = fn_get_prime_base_minene_sante(idoffre);
			-- Renouvellement: appliquer le taux de l'année précédente à la base tarif
			-- Taux de l'an dernier : celui du devis renouvelé (renouvellement) ou, pour un avenant de modification d'un
			-- contrat renouvelé, celui du devis que ce contrat a renouvelé
			IF v_applique_prev THEN
				SELECT COALESCE(C.TauxReductionCommerciale, 0)
				INTO prev_taux_reduction
				FROM StdDevis SD
				JOIN StdDevisDetail DD ON DD.IdDevis = SD.IdOldHist
				JOIN StdComplementDevisDetailSante C ON C.IdDevisDetail = DD.IdDevisDetail
				WHERE SD.IdDevis = CASE WHEN code_avenant = 'MOD' THEN v_devis_base ELSE id_devis END
				LIMIT 1;
				prev_taux_reduction := COALESCE(prev_taux_reduction, 0);
				prime_affilie := prime_affilie * (1 - (prev_taux_reduction / 100));
				UPDATE temp_famille_minene SET primebase = primebase * (1 - (prev_taux_reduction / 100));
			END IF;
		ELSIF prime_famille > 0 THEN
			prime_affilie := prime_famille;
			UPDATE temp_famille_minene SET primebase = prime_famille;
		ELSIF prime_globale > 0 THEN
			prime_affilie := prime_globale;
		ELSE
			-- Prime par affilié saisie : appliquée à chaque famille, comme auparavant
			UPDATE temp_famille_minene SET primebase = prime_affilie;
		END IF;
		-- 2. Calculer les surprimes (avant application du taux), sur la prime de base de la formule de la
		--    famille, à l'âge atteint à la date d'effet : âge (adhérent et conjoint) 61 à 64 ans 30 %,
		--    65 à 69 ans 50 % ; 30 % par affection chronique (3 au plus) — taux et âges réglés dans
		--    Administration > Réglages Santé MINENE. Surprime d'âge toujours calculée (sauf prime globale imposée) ;
		--    une surprime affection saisie remplace seulement la surprime d'affection calculée (v7, comme URANUS :
		--    elle supprimait aussi la surprime d'âge, perdue en particulier au « Modifier » d'un devis qui en portait une)
		IF NOT prime_globale_manuelle THEN
			INSERT INTO temp_adherent_surprime(IdAdherent, IdAffilie, Lien, Age, NombrePathologie, SurprimeAffection, SurprimeAge)
			SELECT AD.IdAdherent, IdAffilie, Lien, EXTRACT(YEAR FROM AGE(v_date_tarif, AF.DateNaissance)), COALESCE(AF.NombrePathologie,0), 0, 0
			FROM StdAdherent AS AD
			INNER JOIN StdAffilie AS AF ON (AD.IdAdherent = AF.IdAdherent AND AD.IdDevis = AF.IdDevis)
			WHERE AD.IdDevis = id_devis
					AND AD.IdOperateur = user_id
					AND ((COALESCE(AF.NombrePathologie, 0) > 0) OR ((EXTRACT(YEAR FROM AGE(v_date_tarif, AF.DateNaissance)) >= LEAST(60, fn_lephare_parametre_nombre('sante.minene.surprime_age_1_debut', 61))) AND AF.Lien IN ('A','C'))
						OR (COALESCE(AF.SurprimeAppliquee, FALSE) AND COALESCE(AF.MontantSurprime, 0) > 0));

			UPDATE temp_adherent_surprime AS S
			SET SurprimeAge = CASE WHEN S.Lien IN ('A','C') THEN fn_get_surprime_age_minene_sante(FM.idoffre, S.Age) ELSE 0 END,
				SurprimeAffection = CASE WHEN montant_surprime > 0 THEN 0 ELSE fn_get_surprime_affection_minene_sante(FM.idoffre, S.NombrePathologie) END
			FROM temp_famille_minene AS FM
			WHERE FM.idadherent = S.idadherent;

			-- Surprime imposée d'une personne (case cochée et montant) : la surprime calculée n'est pas retenue pour elle
			UPDATE temp_adherent_surprime AS S
			SET SurprimeAge = 0, SurprimeAffection = 0
			FROM StdAffilie AS AF
			WHERE AF.IdAffilie = S.IdAffilie AND COALESCE(AF.SurprimeAppliquee, FALSE) AND COALESCE(AF.MontantSurprime, 0) > 0;

			UPDATE temp_famille_minene AS FM
			SET surprimeage = S.total_age, surprimeaffection = S.total_affection
			FROM (SELECT idadherent, SUM(SurprimeAge) AS total_age, SUM(SurprimeAffection) AS total_affection
				  FROM temp_adherent_surprime GROUP BY idadherent) AS S
			WHERE S.idadherent = FM.idadherent;
		END IF;
		-- Renouvellement: appliquer aussi le taux de l'année précédente aux surprimes auto-calculées
		IF v_applique_prev AND prev_taux_reduction <> 0 AND (NOT prime_globale_manuelle) THEN
			UPDATE temp_famille_minene
			SET surprimeage = surprimeage * (1 - (prev_taux_reduction / 100)),
				surprimeaffection = surprimeaffection * (1 - (prev_taux_reduction / 100));
		END IF;
		-- Surprimes imposées par personne : montant annuel ajouté à la surprime d'affection de sa famille
		IF NOT prime_globale_manuelle THEN
			UPDATE temp_famille_minene AS FM
			SET surprimeaffection = FM.surprimeaffection + I.total
			FROM (SELECT AF.IdAdherent, SUM(AF.MontantSurprime) AS total
				  FROM StdAffilie AS AF
				  WHERE AF.IdDevis = id_devis AND AF.IdOperateur = user_id
						AND COALESCE(AF.SurprimeAppliquee, FALSE) AND COALESCE(AF.MontantSurprime, 0) > 0
				  GROUP BY AF.IdAdherent) AS I
			WHERE I.IdAdherent = FM.idadherent;
		END IF;
		-- 3. Appliquer le taux sur la base ET les surprimes sans arrondi intermédiaire.
		--    Les décimales sont conservées ici ; le seul ROUND se fait sur PrimeTTC à la fin.
		IF taux_reduction_commerciale <> 0 THEN
			prime_affilie := prime_affilie * (1 - (taux_reduction_commerciale / 100));
			UPDATE temp_famille_minene SET primebase = primebase * (1 - (taux_reduction_commerciale / 100));
			-- Surprimes calculées : le taux s'applique à chaque composante ; surprime affection saisie : à son montant
			UPDATE temp_famille_minene
			SET surprimeage = surprimeage * (1 - (taux_reduction_commerciale / 100)),
				surprimeaffection = surprimeaffection * (1 - (taux_reduction_commerciale / 100));
			montant_surprime := montant_surprime * (1 - (taux_reduction_commerciale / 100));
		END IF;

		SELECT COALESCE(SUM(surprimeage), 0), COALESCE(SUM(surprimeaffection), 0)
		INTO montant_surprime_age, montant_surprime_affection
		FROM temp_famille_minene;
		montant_surprime_nene := montant_surprime_age + montant_surprime_affection;

		-- Prime Santé de chaque famille (assiette de son accessoire) ; prime globale et surprime saisies
		-- réparties à parts égales entre les familles
		UPDATE temp_famille_minene
		SET primesante = CASE WHEN prime_globale_manuelle THEN prime_affilie / GREATEST(nombre_adherent, 1) ELSE primebase + surprimeage + surprimeaffection END
						 + montant_surprime / GREATEST(nombre_adherent, 1);

		UPDATE temp_garantie_inter
		SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN prime_affilie ELSE (SELECT COALESCE(SUM(primebase), 0) FROM temp_famille_minene) END,
			PrimeNette = CASE WHEN prime_globale_manuelle THEN prime_affilie ELSE (SELECT COALESCE(SUM(primebase), 0) FROM temp_famille_minene) END
		WHERE IdSousGarantie = 98; ---GARANTIE PRINCIPALE SANTE

		-- IF id_offre IN (17, 18, 19) THEN --MINENE CLASSIQUE
		-- 	--- Calcul de prime IA: le total de prime anuelle HT est 14524 que je repartis sur les trois garanties de façon presqu'uniforme
		-- 	UPDATE temp_garantie_inter
		-- 	SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4840 * nombre_adherent END, PrimeNette = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4840 * nombre_adherent END --Décès et infirmité permanante
		-- 	WHERE IdSousGarantie IN (17,19);

		-- 	UPDATE temp_garantie_inter 
		-- 	SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4844 * nombre_adherent END, PrimeNette = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4844 * nombre_adherent END -- Frais de traitement
		-- 	WHERE IdSousGarantie=20;
		-- ELSIF id_offre IN (20, 21, 22) THEN --MINENE VTC --
		-- 	--- Calcul de prime IA: le total de prime anuelle HT est 6424 que je repartis sur les trois garanties 
		-- 	UPDATE temp_garantie_inter
		-- 	SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN 0 ELSE 2140 * nombre_adherent END, PrimeNette = CASE WHEN prime_globale_manuelle THEN 0 ELSE 2140 * nombre_adherent END --Décès et infirmité permanante
		-- 	WHERE IdSousGarantie IN (17,19);

		-- 	UPDATE temp_garantie_inter 
		-- 	SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN 0 ELSE 2144 * nombre_adherent END, PrimeNette = CASE WHEN prime_globale_manuelle THEN 0 ELSE 2144 * nombre_adherent END -- Frais de traitement
		-- 	WHERE IdSousGarantie=20;	
		-- END IF;
		-- --- Calcul de la prime RC Chef de famille: le total de prime anuelle HT est 14524 que je repartis sur les trois garanties 
		-- UPDATE temp_garantie_inter
		-- SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4840 * nombre_adherent END, PrimeNette = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4840 * nombre_adherent END -- Dommage Matériel et Dommage Corporel
	 --   	WHERE IdSousGarantie IN (61,64);
		
		-- UPDATE temp_garantie_inter
		-- SET PrimeAnnuelle = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4844 * nombre_adherent END, PrimeNette = CASE WHEN prime_globale_manuelle THEN 0 ELSE 4844 * nombre_adherent END -- Intoxication alimentaire
	 --   	WHERE IdSousGarantie = 166;

	END IF;

	UPDATE temp_garantie_inter
	SET PrimeAnnuelle = montant_surprime + montant_surprime_affection, PrimeNette = montant_surprime + montant_surprime_affection
	WHERE IdSousGarantie = 99; --GARANTIE SURPRIME AFFECTION

	UPDATE temp_garantie_inter
	SET PrimeAnnuelle = montant_surprime_age, PrimeNette = montant_surprime_age
	WHERE IdSousGarantie = 167; --GARANTIE SURPRIME AGE

	INSERT INTO temp_garantie(IdSousGarantie, LibelleSousGarantie, GarCapitalVal, GarPlaceVal, GarFranchiseVal, Taux, Acquise,
				PrimeAnnuelle, PrimeNette)
	SELECT IdSousGarantie, LibelleSousGarantie, 0, 0, 0, 0, Acquise, PrimeAnnuelle, PrimeNette
	FROM temp_garantie_inter;

	UPDATE StdDevis
	SET IdIntermediaire = id_intermediaire, IdCompagnie = id_compagnie, IdProduit = id_produit, IdOffre = id_offre, IdClient = id_client, IdAssure = id_assure,
		 IdAvenant = id_avenant, Flotte = p_flotte, IdAperiteur = id_compagnie,
		 Coassurance = p_coassurance, Periode = v_periode, DateEmission = date_emission, DateEffet = date_effet, DateExpiration = date_expiration,
		 Confirme = False, AccessoireCompagnie = 0, AccessoireIntermediaire = 0, Accessoire = 0, Taxe = 0, IdDuree = id_duree, primeimposee = v_prime_imposee
	WHERE IdDevis = id_devis;

	UPDATE StdFiliale
	SET Source = CASE WHEN code_categorie = '123' THEN 'M' ELSE 'S' END
	WHERE (IdDevis = id_devis) AND (IdOperateur = user_id);

	IF NOT EXISTS (SELECT 1 FROM StdDevisDetail WHERE IdDevis = id_devis) THEN
		INSERT INTO StdDevisDetail(IdDevis, IdOffre, IdTarif, Vehicule, CodeUsage, Reference, IdCarrosserie, PuissanceFiscale, NombrePlace,
					ChargeUtile, ValeurNeuve, ValeurVenale, ValeurAccessoire, Remorque, Conducteur, AdresseCnd, DateMec, DateMutation,
					NumMoteur, NumChassis, TypeVehicule, IdMarque, Matricule, CarteVerte, Essence, NumPCCnd, PrimeImposee)
		VALUES (id_devis, id_offre, id_tarif, 1, code_usage, code_usage, id_carrosserie, v_puissance, nombre_place, charge_utile, 0, 0, 0, '0',
			nom_conducteur, adresse_conducteur,date_mec, date_mec, num_moteur, num_chassis, type_vehicule, id_marque, v_matricule,
			CASE WHEN code_categorie = '205' THEN True ELSE False END, code_carburant, num_pc_conduire, v_prime_imposee)
		RETURNING IdDevisDetail INTO id_devis_detail;

		INSERT INTO StdComplementDevisDetailSante(PrimeFamille, PrimeAffilie, PrimeGlobale, MontantSurprime, MontantAccessoireManuel, TauxReductionCommerciale, IdTypeContrat, GestionnaireSante, IdDevisDetail)
		VALUES (prime_famille, prime_affilie_manuelle, prime_globale, montant_surprime_saisi, montant_accessoire_manuel, taux_reduction_commerciale, type_contrat, gestionnaire_sante, id_devis_detail);

	ELSE
		SELECT IdDevisDetail
		INTO id_devis_detail
		FROM StdDevisDetail
		WHERE IdDevis = id_devis
		LIMIT 1;
		id_devis_detail := COALESCE(id_devis_detail,0);
		UPDATE StdDevisDetail
		SET IdOffre = id_offre, IdTarif = id_tarif, Vehicule = 1, CodeUsage = code_usage, Reference = code_usage, IdCarrosserie = id_carrosserie, PuissanceFiscale = v_puissance,
			NombrePlace = nombre_place, ChargeUtile = charge_utile, ValeurNeuve = 0, ValeurVenale = 0, ValeurAccessoire = 0, Remorque = '0',
			Conducteur = nom_conducteur, AdresseCnd = adresse_conducteur, DateMec = date_mec, DateMutation = date_mec, NumMoteur = num_moteur, NumChassis = num_chassis,
			TypeVehicule = type_vehicule, IdMarque = id_marque, Matricule = v_matricule, CarteVerte = CASE WHEN code_categorie = '205' THEN True ELSE False END, Essence = code_carburant,
			NumPCCnd = num_pc_conduire, PrimeImposee = v_prime_imposee
		WHERE IdDevisDetail = id_devis_detail;
		UPDATE StdComplementDevisDetailSante
		SET PrimeFamille = prime_famille, PrimeAffilie = prime_affilie_manuelle, PrimeGlobale = prime_globale, MontantSurprime = montant_surprime_saisi, MontantAccessoireManuel = montant_accessoire_manuel,
			TauxReductionCommerciale = taux_reduction_commerciale, IdTypeContrat = type_contrat, GestionnaireSante = gestionnaire_sante
		WHERE iddevisdetail = id_devis_detail;
	END IF;

	DELETE FROM StdDevisDetGarantie WHERE IdDevisDet = id_devis_detail;

	INSERT INTO StdDevisDetGarantie(IdDevisDet, IdGarantie, Acquise, Taxe, Capital, MinFranchise, MaxFranchise, PrimeAnnuelle, PrimeNette,
					Old_Acquise, Old_PrimeNette)
	SELECT id_devis_detail, IdSousGarantie, Acquise, 0 AS Taxe, 0 AS GarCapitalVal, 0, 0, PrimeAnnuelle, PrimeNette, '0', 0
	FROM temp_garantie;

	-- Contrat groupe (taxe « contrats groupe ») au-delà de 5 adhérents ou de 25 personnes assurées, seuils réglés
	-- dans Administration > Réglages par branche > Santé
	police_sante_groupe := (id_offre NOT IN (17,18,19,20,21,22, 175, 176, 181))
		AND ((nombre_adherent > fn_lephare_parametre_nombre('sante.groupe_adherents', 5))
			 OR (nombre_affilie > fn_lephare_parametre_nombre('sante.groupe_affilies', 25)));

	UPDATE StdDevisDetGarantie AS DD
	SET Taxe=G.Taxe
	FROM (SELECT TG.IdSousGarantie, ROUND((TG.PrimeNette * (CASE WHEN police_sante_groupe THEN TT.TauxTaxeGroupe ELSE TT.TauxTaxe END))/100,0) AS Taxe
	      FROM temp_garantie AS TG
	      INNER JOIN StdTauxTaxeGarantieProduit AS TT ON (TT.IdGarantie=TG.IdSousGarantie)
	      WHERE (IdProduit =id_produit) AND (date_effet BETWEEN debutvalidite AND finvalidite)) AS G
	WHERE (DD.IdDevisDet = id_devis_detail) AND (G.IdSousGarantie = DD.IdGarantie);

	UPDATE StdDevisDetail AS DD
	SET PrimeAnnuelle = M.PrimeAnnuelle, PrimeNette = M.PrimeNette, TaxeEnregistrement = M.taxe
	FROM (SELECT IdDevisDet, SUM(PrimeAnnuelle) AS PrimeAnnuelle, SUM(PrimeNette) AS PrimeNette, SUM(taxe) AS taxe
	      FROM StdDevisDetGarantie
	      WHERE IdDevisDet = id_devis_detail
	      GROUP BY IdDevisDet) AS M
	WHERE (M.IdDevisDet = id_devis_detail) AND (M.IdDevisDet = DD.IdDevisDetail);

	UPDATE StdDevis AS DD
	SET PrimeAnnuelle = M.PrimeAnnuelle, PrimeNette = M.PrimeNette, Taxe = M.TaxeEnregistrement,
	CommissionIntermediaire = ROUND((M.PrimeNette * COALESCE(taux_commission, 0))/100, 0)
	FROM (SELECT IdDevis, SUM(PrimeAnnuelle) AS PrimeAnnuelle, SUM(PrimeNette) AS PrimeNette, SUM(TaxeEnregistrement) AS TaxeEnregistrement
	      FROM StdDevisDetail
	      WHERE IdDevis = id_devis
	      GROUP BY IdDevis) AS M
	WHERE (DD.IdDevis = id_devis) AND (NumeroDevis = numero_devis) AND (M.IdDevis=DD.IdDevis);

	SELECT PrimeNette
	INTO prime_nette
	FROM StdDevis
	WHERE IdDevis = id_devis;
	prime_nette := COALESCE(prime_nette, 0);

	IF NOT public.fn_offre_automatisee_minene_sante(id_offre) THEN
		SELECT *
		INTO v_accessoire, v_accessoire_intermediaire, taxe_accessoire
		FROM fn_get_accessoire_sante(prime_nette, id_produit, id_compagnie, date_effet, police_sante_groupe);
		-- Accessoire saisi (« Accessoire Manuel ») : accessoire du devis au lieu des barèmes compagnie et cabinet,
		-- partagé selon la part du cabinet de la fiche compagnie (tout à la compagnie à défaut). La v6, comme
		-- URANUS, l'enregistrait sans l'appliquer.
		IF montant_accessoire_manuel > 0 THEN
			v_part_cabinet := COALESCE(public.fn_lephare_part_accessoires_cabinet(id_compagnie), 0);
			v_accessoire_intermediaire := ROUND(montant_accessoire_manuel * v_part_cabinet / 100, 0);
			v_accessoire := montant_accessoire_manuel - v_accessoire_intermediaire;
			taxe_accessoire := ROUND((montant_accessoire_manuel * fn_get_taux_taxe_sante(id_produit, date_effet, police_sante_groupe)) / 100, 0);
		END IF;
	ELSE
		--taxe_minene := fn_get_taxe_sante_minene(id_offre, nombre_adherent);
		IF id_offre IN (17, 18, 19, 20, 21, 22, 175, 176, 181) THEN ---Calcul d'accessoires pour les offres SANTE MINENE
			-- Barème OREOLE : accessoire de la grille de la compagnie selon la prime Santé de chaque famille
			-- (9 000 F jusqu'à 500 000 F, 12 000 F jusqu'à 1 000 000 F, 24 000 F au-delà), ou accessoire saisi,
			-- par famille. Auparavant la grille portait sur la prime de tout le devis, multipliée par le
			-- nombre de familles.
			SELECT COALESCE(SUM(A.accessoire_compagnie), 0), COALESCE(SUM(A.accessoire_intermediaire), 0), COALESCE(SUM(A.taxe_sur_accessoire), 0)
			INTO v_accessoire, v_accessoire_intermediaire, taxe_accessoire
			FROM temp_famille_minene AS FM
			CROSS JOIN LATERAL fn_get_accessoire_sante_minene(FM.idoffre, ROUND(FM.primesante, 0), montant_accessoire_manuel, 1) AS A;

		END IF;
	END IF;

	-- Avenant de modification (v9) : prime de l'avenant = écart entre la prime annuelle de la nouvelle composition et celle
	-- de la composition précédente (dernier contrat de la période : affaire nouvelle ou renouvellement, puis avenants),
	-- garantie par garantie, au prorata des jours restants jusqu'à l'échéance ; pas de ristourne (conditions MINENE : les
	-- retraits ne donnent pas lieu à ristourne) ; accessoire : supplément d'accessoire du barème pour la nouvelle composition.
	-- Les primes annuelles de la nouvelle composition restent en PrimeAnnuelle (devis, détail, garanties) pour l'avenant suivant.
	IF code_avenant = 'MOD' AND NOT v_mode_reference THEN
		SELECT NumeroPolice INTO v_police FROM StdContrat WHERE IdDevis = v_devis_base ORDER BY IdContrat DESC LIMIT 1;
		SELECT C.IdDevis INTO v_devis_precedent
		FROM StdContrat AS C JOIN StdAvenant AS A ON A.IdAvenant = C.IdAvenant
		WHERE C.NumeroPolice = v_police AND A.CodeAvenant IN ('AFN', 'REN', 'RPP', 'TRP', 'MOD')
			AND COALESCE(C.IdContratAnnulation, 0) = 0 AND C.DateEffet::date BETWEEN v_effet_base AND v_expiration_base
			AND C.IdDevis <> id_devis
		ORDER BY C.DateEffet DESC, C.IdContrat DESC
		LIMIT 1;
		v_devis_precedent := COALESCE(v_devis_precedent, v_devis_base);
		v_prorata := LEAST(GREATEST((date_expiration - date_effet + 1)::numeric / NULLIF(v_expiration_base - v_effet_base + 1, 0), 0), 1);
		v_prorata := COALESCE(v_prorata, 0);

		SELECT COUNT(*) INTO v_nombre_reference FROM lephare_avenant_sante_reference WHERE iddevis = id_devis AND idgarantie <> 0;
		SELECT COUNT(*) INTO v_nombre_precedent
		FROM StdDevisDetGarantie AS P JOIN StdDevisDetail AS PD ON PD.IdDevisDetail = P.IdDevisDet
		WHERE PD.IdDevis = v_devis_precedent;
		IF v_nombre_reference > 0 THEN
			-- Composition d'avant la modification tarifée par ce même calcul à la création de l'avenant : l'écart ne porte que
			-- sur la modification, même pour un contrat émis avec d'anciennes règles ou des primes imposées
			UPDATE StdDevisDetGarantie AS G
			SET PrimeNette = ROUND((G.PrimeAnnuelle - COALESCE((SELECT R.montant FROM lephare_avenant_sante_reference AS R
														 WHERE R.iddevis = id_devis AND R.idgarantie = G.IdGarantie), 0)) * v_prorata, 0)
			WHERE G.IdDevisDet = id_devis_detail;
		ELSIF v_nombre_precedent > 0 THEN
			UPDATE StdDevisDetGarantie AS G
			SET PrimeNette = ROUND((G.PrimeAnnuelle - COALESCE((SELECT SUM(P.PrimeAnnuelle)
														 FROM StdDevisDetGarantie AS P
														 JOIN StdDevisDetail AS PD ON PD.IdDevisDetail = P.IdDevisDet
														 WHERE PD.IdDevis = v_devis_precedent AND P.IdGarantie = G.IdGarantie), 0)) * v_prorata, 0)
			WHERE G.IdDevisDet = id_devis_detail;
		ELSE
			-- Contrat repris d'URANUS sans détail : écart avec la prime annuelle de l'en-tête, sur la garantie principale
			SELECT COALESCE(NULLIF(PrimeAnnuelle, 0), PrimeNette, 0) INTO v_annuelle_precedente FROM StdDevis WHERE IdDevis = v_devis_precedent;
			UPDATE StdDevisDetGarantie AS G
			SET PrimeNette = CASE WHEN G.IdGarantie = 98
								  THEN ROUND(((SELECT SUM(X.PrimeAnnuelle) FROM StdDevisDetGarantie AS X WHERE X.IdDevisDet = id_devis_detail)
											  - COALESCE(v_annuelle_precedente, 0)) * v_prorata, 0)
								  ELSE 0 END
			WHERE G.IdDevisDet = id_devis_detail;
		END IF;

		SELECT COALESCE(SUM(PrimeNette), 0) INTO v_pn_avenant FROM StdDevisDetGarantie WHERE IdDevisDet = id_devis_detail;
		IF v_pn_avenant <= 0 THEN
			UPDATE StdDevisDetGarantie SET PrimeNette = 0 WHERE IdDevisDet = id_devis_detail;
		END IF;

		UPDATE StdDevisDetGarantie AS DD
		SET Taxe = COALESCE((SELECT ROUND((DD.PrimeNette * (CASE WHEN police_sante_groupe THEN TT.TauxTaxeGroupe ELSE TT.TauxTaxe END)) / 100, 0)
							 FROM StdTauxTaxeGarantieProduit AS TT
							 WHERE TT.IdGarantie = DD.IdGarantie AND TT.IdProduit = id_produit
								AND date_effet BETWEEN TT.DebutValidite AND TT.FinValidite
							 ORDER BY TT.DebutValidite DESC
							 LIMIT 1), 0)
		WHERE DD.IdDevisDet = id_devis_detail;

		UPDATE StdDevisDetail AS DD
		SET PrimeNette = M.PrimeNette, TaxeEnregistrement = M.Taxe
		FROM (SELECT COALESCE(SUM(PrimeNette), 0) AS PrimeNette, COALESCE(SUM(Taxe), 0) AS Taxe
			  FROM StdDevisDetGarantie WHERE IdDevisDet = id_devis_detail) AS M
		WHERE DD.IdDevisDetail = id_devis_detail;

		UPDATE StdDevis AS SD
		SET PrimeNette = DD.PrimeNette, Taxe = DD.TaxeEnregistrement,
			CommissionIntermediaire = ROUND((DD.PrimeNette * COALESCE(taux_commission, 0)) / 100, 0)
		FROM StdDevisDetail AS DD
		WHERE SD.IdDevis = id_devis AND DD.IdDevisDetail = id_devis_detail;

		v_acc_complet := COALESCE(v_accessoire, 0) + COALESCE(v_accessoire_intermediaire, 0);
		IF EXISTS (SELECT 1 FROM lephare_avenant_sante_reference WHERE iddevis = id_devis AND idgarantie = 0) THEN
			SELECT montant INTO v_acc_precedent FROM lephare_avenant_sante_reference WHERE iddevis = id_devis AND idgarantie = 0;
		ELSE
			SELECT COALESCE(SUM(C.Accessoire), 0) INTO v_acc_precedent
			FROM StdContrat AS C JOIN StdAvenant AS A ON A.IdAvenant = C.IdAvenant
			WHERE C.NumeroPolice = v_police AND A.CodeAvenant IN ('AFN', 'REN', 'RPP', 'TRP', 'MOD')
				AND COALESCE(C.IdContratAnnulation, 0) = 0 AND C.DateEffet::date BETWEEN v_effet_base AND v_expiration_base
				AND C.IdDevis <> id_devis;
		END IF;
		v_acc_avenant := GREATEST(v_acc_complet - v_acc_precedent, 0);
		taxe_accessoire := CASE WHEN v_acc_complet > 0 THEN ROUND(v_acc_avenant * COALESCE(taxe_accessoire, 0) / v_acc_complet, 0) ELSE 0 END;
		v_accessoire_intermediaire := CASE WHEN v_acc_complet > 0 THEN ROUND(v_acc_avenant * COALESCE(v_accessoire_intermediaire, 0) / v_acc_complet, 0) ELSE 0 END;
		v_accessoire := v_acc_avenant - v_accessoire_intermediaire;
	END IF;

	UPDATE StdDevis
	SET AccessoireCompagnie = v_accessoire, AccessoireIntermediaire = v_accessoire_intermediaire,
		Accessoire = v_accessoire + v_accessoire_intermediaire, Taxe = Taxe + taxe_accessoire
	WHERE IdDevis = id_devis;

	UPDATE StdDevis
	--SET PrimeTTC = ROUND((PrimeNette + Accessoire + Taxe), 0) + 3000 * nombre_adherent
	SET PrimeTTC = ROUND((PrimeNette + Accessoire + Taxe), 0)
	WHERE IdDevis = id_devis;

	IF (id_devis <> 0) THEN
		UPDATE StdNumeroSaisieSante
		SET DateMaj = CURRENT_TIMESTAMP
		WHERE IdDevis = id_devis AND IdOperateur = user_id;
		out_message := 'Devis enregistré avec succès.';
	END IF;

	DROP TABLE IF EXISTS temp_garantie;
	DROP TABLE IF EXISTS temp_garantie_inter;
	DROP TABLE IF EXISTS temp_adherent_surprime;
	DROP TABLE IF EXISTS temp_famille_minene;


	EXCEPTION WHEN others THEN
		get stacked diagnostics
        		--v_state   = returned_sqlstate,
        		v_msg     = message_text;
        		--v_detail  = pg_exception_detail,
        		--v_hint    = pg_exception_hint,
        		--v_context = pg_exception_context;

			DROP TABLE IF EXISTS temp_garantie;
			DROP TABLE IF EXISTS temp_garantie_inter;
			DROP TABLE IF EXISTS temp_adherent_surprime;
			DROP TABLE IF EXISTS temp_famille_minene;
			--id_devis := 0;
			out_message := v_msg; -- || ' : ' || v_context; -- 'Problème rencontré lors de la création du devis';
    		RAISE EXCEPTION '%', out_message;
			/*RAISE EXCEPTION E'Got exception:
        	state  : %
        	message: %
        	detail : %
        	hint   : %
        	context: %
        	SQLSTATE: % 
        	SQLERRM: %', v_state, v_msg, v_detail, v_hint, v_context, SQLSTATE, SQLERRM;
			*/

END;
$procedure$
