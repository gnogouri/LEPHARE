-- Montant ou taux du moteur Auto d'une compagnie (Administration > Réglages par branche > Automobile > Barème
-- automobile, onglet « Montants du moteur ») : réglage auto.moteur.<compagnie>.<groupe>.<code> de lephare_parametre,
-- la valeur d'origine (celle écrite jusqu'ici dans la fonction) à défaut.
-- groupe : cat1 (201, 212), cat2 (202), cat3 (203, 209), cat5 (205).
CREATE OR REPLACE FUNCTION public.fn_lephare_auto_constante(p_idcompagnie integer, p_groupe character varying, p_code character varying, p_defaut numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
	SELECT public.fn_lephare_parametre_nombre('auto.moteur.' || p_idcompagnie || '.' || p_groupe || '.' || p_code, p_defaut)
$function$;
