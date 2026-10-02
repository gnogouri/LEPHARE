-- Accessoires Individuelle Accidents NSIA ASSURANCES (document « TARIF IA_NSIA CI.xlsx »,
-- colonne « Accessoires ») selon la prime nette :
--   0 -> 0 ; <= 25 000 -> 3 000 ; <= 100 000 -> 6 000 ; <= 500 000 -> 10 000 ;
--   <= 1 000 000 -> 20 000 ; <= 2 000 000 -> 25 000 ; <= 3 000 000 -> 30 000 ;
--   <= 5 000 000 -> 50 000 ; au-delà : 0,5 % de la prime nette + 50 000.
-- Montant total (part compagnie + part courtier), réparti par fn_get_accessoire.
CREATE OR REPLACE FUNCTION public.fn_get_accessoire_ia_nsia(prime_nette numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
BEGIN
	prime_nette := COALESCE(prime_nette, 0);
	IF prime_nette <= 0 THEN
		RETURN 0;
	ELSIF prime_nette <= 25000 THEN
		RETURN 3000;
	ELSIF prime_nette <= 100000 THEN
		RETURN 6000;
	ELSIF prime_nette <= 500000 THEN
		RETURN 10000;
	ELSIF prime_nette <= 1000000 THEN
		RETURN 20000;
	ELSIF prime_nette <= 2000000 THEN
		RETURN 25000;
	ELSIF prime_nette <= 3000000 THEN
		RETURN 30000;
	ELSIF prime_nette <= 5000000 THEN
		RETURN 50000;
	END IF;
	RETURN ROUND(prime_nette * 0.5 / 100, 0) + 50000;
END;
$function$;
