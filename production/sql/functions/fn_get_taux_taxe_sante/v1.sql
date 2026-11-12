CREATE OR REPLACE FUNCTION public.fn_get_taux_taxe_sante(id_produit integer, date_effet date, police_sante_groupe boolean)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
	taux_taxe numeric;
BEGIN
	
	SELECT CASE WHEN police_sante_groupe THEN TauxTaxeGroupe ELSE TauxTaxe END
	INTO taux_taxe
	FROM StdTauxTaxeGarantieProduit
	WHERE (IdProduit = id_produit) AND (date_effet BETWEEN DebutValidite AND FinValidite)
	ORDER BY IdProduit ASC, DebutValidite DESC
	LIMIT 1;
	taux_taxe := COALESCE(taux_taxe, 0);
	
	RETURN taux_taxe;
END;
$function$;
