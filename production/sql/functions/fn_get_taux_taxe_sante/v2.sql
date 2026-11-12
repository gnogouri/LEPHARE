-- Taux de taxe des accessoires Santé : celui de la garantie principale Santé (98 ; 8 %, contrats groupe 3 % à
-- l'origine, Administration > Taxes). La v1 prenait la première ligne du produit sans ordre déterminé : les lignes
-- IA de la Santé (14,5 %) ont les mêmes dates de validité et pouvaient passer devant après une modification.
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
	ORDER BY (IdGarantie = 98) DESC, DebutValidite DESC, Id ASC
	LIMIT 1;
	taux_taxe := COALESCE(taux_taxe, 0);

	RETURN taux_taxe;
END;
$function$;
