-- Tarif Individuelle Accidents NSIA ASSURANCES (document « TARIF IA_NSIA CI.xlsx » reçu
-- d'OREOLE, feuilles « Mode de calcul » et « classe d'activités ») :
--   prime décès        = taux décès (‰) de la classe × capital décès
--   prime invalidité   = taux de la classe × capital invalidité permanente
--   prime frais médic. = taux frais médicaux (%) de la classe × capital frais de traitement
-- Classes (code_classe_assure de la profession IA) :
--   01 : 0,85 ‰ / 1,5 %   02 : 1,15 ‰ / 2,5 %   03 : 1,3 ‰ / 3 %   04 : 1,8 ‰ / 4 %   05 : 3 ‰ / 5 %
-- Le document ne donne pas de taux d'invalidité distinct (colonne « … ») : le taux décès de la
-- classe s'applique aussi à l'invalidité, comme dans le barème d'URANUS (même taux pour les deux).
-- Aucune majoration d'âge : le tarif NSIA n'en prévoit pas (clause d'âge = non-garantie au-delà
-- de 60 ans à la souscription sauf dérogation, contrôlée à l'écran).
-- L'ITT / indemnité journalière du document n'est pas tarifée : aucune offre IA NSIA ne porte
-- la garantie, et l'unité du taux « IND JOURN » n'est pas précisée.
-- Mêmes colonnes de retour que fn_calcul_prime_ia_by_age (appelée pour les autres compagnies).
CREATE OR REPLACE FUNCTION public.fn_calcul_prime_ia_nsia(code_activite character varying, capital_deces numeric, capital_infirmite_permanente numeric, capital_frais_traitement numeric)
 RETURNS TABLE(primedeces numeric, primeinfirmite numeric, primefraistraitement numeric, outmessage character varying)
 LANGUAGE plpgsql
AS $function$
DECLARE
	taux_deces numeric;      -- pour mille
	taux_frais_medicaux numeric; -- pour cent
BEGIN
	IF code_activite = '01' THEN
		taux_deces := 0.85; taux_frais_medicaux := 1.5;
	ELSIF code_activite = '02' THEN
		taux_deces := 1.15; taux_frais_medicaux := 2.5;
	ELSIF code_activite = '03' THEN
		taux_deces := 1.3; taux_frais_medicaux := 3;
	ELSIF code_activite = '04' THEN
		taux_deces := 1.8; taux_frais_medicaux := 4;
	ELSIF code_activite = '05' THEN
		taux_deces := 3; taux_frais_medicaux := 5;
	ELSE
		RAISE EXCEPTION 'Classe d''activité IA inconnue (%) : tarif NSIA non applicable.', code_activite;
	END IF;

	RETURN QUERY
		SELECT ROUND(COALESCE(capital_deces, 0) * taux_deces / 1000, 0),
		       ROUND(COALESCE(capital_infirmite_permanente, 0) * taux_deces / 1000, 0),
		       ROUND(COALESCE(capital_frais_traitement, 0) * taux_frais_medicaux / 100, 0),
		       ''::character varying;
END;
$function$;
