-- Coefficient de prime d'un contrat de moins d'un an, appelé par fn_calcul_prime_prorata (moteurs Automobile NSIA).
-- Les pourcentages viennent du réglage « auto.coefficients_duree » (Administration > Réglages Automobile > Tarifs à
-- lecture directe) : treize valeurs séparées par « / », 15 jours ou moins puis 1 à 12 mois. Réglage absent ou
-- illisible : valeurs d'origine (5/10/19/28/37/45/53/61/69/77/85/93/100), celles des tarifs NSIA (6 mois = 53 %,
-- 3 mois = 28 %) et du Pool TPV.
-- Durée : mois entiers et jours restants entre l'effet et l'échéance ; un mois entamé compte pour un mois entier,
-- moins d'un mois : 15 jours ou moins, sinon un mois ; un an ou plus : prime entière.
-- v3 (2026-11-02) : incorporation d'un véhicule dans une flotte en cours (production/incorporation.py, réglage de
-- session lephare.incorporation) : « prorata » = prime annuelle au prorata des jours couverts jusqu'à l'échéance du
-- contrat (jours / 365 ou 366), sans les coefficients de courte durée ; « forfait » = affaire à tarif forfaitaire,
-- prime annuelle entière, aucun prorata.
CREATE OR REPLACE FUNCTION public.fn_calcul_taux_prime_fractionnee(p_days integer, p_start_date date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
	v_ecart interval;
	v_mois integer;
	v_jours integer;
	v_rang integer;
	v_valeurs text[];
	v_taux numeric;
	v_incorporation text;
BEGIN
	v_incorporation := COALESCE(current_setting('lephare.incorporation', true), '');
	IF v_incorporation = 'forfait' THEN
		RETURN 1.00;
	ELSIF v_incorporation = 'prorata' THEN
		RETURN LEAST(1.00, ROUND(GREATEST(p_days, 0)::numeric / fn_get_duree_annuelle_contrat(p_start_date), 6));
	END IF;

	v_ecart := age(p_start_date + (p_days - 1), p_start_date);
	v_mois := EXTRACT(MONTH FROM v_ecart)::integer + EXTRACT(YEAR FROM v_ecart)::integer * 12;
	v_jours := EXTRACT(DAY FROM v_ecart)::integer;

	IF v_mois >= 12 OR (v_mois = 11 AND v_jours > 0) THEN
		RETURN 1.00;
	END IF;

	-- Rang dans la liste : 1 = 15 jours ou moins, 2 = 1 mois, …, 13 = 12 mois
	IF v_mois = 0 THEN
		v_rang := CASE WHEN v_jours <= 15 THEN 1 ELSE 2 END;
	ELSE
		v_rang := v_mois + 1 + CASE WHEN v_jours > 0 THEN 1 ELSE 0 END;
	END IF;

	v_valeurs := string_to_array(COALESCE((SELECT NULLIF(TRIM(P.valeur), '') FROM public.lephare_parametre AS P
										   WHERE P.cle = 'auto.coefficients_duree'), ''), '/');
	IF COALESCE(array_length(v_valeurs, 1), 0) <> 13 THEN
		v_valeurs := string_to_array('5/10/19/28/37/45/53/61/69/77/85/93/100', '/');
	END IF;
	BEGIN
		v_taux := NULLIF(TRIM(REPLACE(v_valeurs[v_rang], ',', '.')), '')::numeric;
	EXCEPTION WHEN others THEN
		v_taux := NULL;
	END;
	IF v_taux IS NULL OR v_taux <= 0 OR v_taux > 100 THEN
		v_taux := (string_to_array('5/10/19/28/37/45/53/61/69/77/85/93/100', '/'))[v_rang]::numeric;
	END IF;

	RETURN ROUND(v_taux / 100, 4);
END;
$function$;
