-- Migration production 0176 : montants et taux du moteur écrits jusqu'ici dans la fonction lus dans les réglages
-- « Montants du moteur » (Administration > Réglages par branche > Automobile > Barème automobile),
-- fn_lephare_auto_constante(compagnie, groupe, code, valeur d'origine). Valeurs d'origine identiques : mêmes calculs.
CREATE OR REPLACE FUNCTION public.fn_get_accessoire_moto(prime_nette numeric, id_produit integer, id_offre integer, id_compagnie integer, date_effet date, quantite integer DEFAULT 1)
 RETURNS TABLE(accessoire_compagnie numeric, accessoire_intermediaire numeric, taxe_sur_accessoire numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
	tx_taxe_acc numeric;
	acc_compagnie numeric; 
	acc_intermediaire numeric;
	taxe_sur_acc numeric;
	
BEGIN
		
		acc_compagnie := fn_lephare_auto_constante(id_compagnie, 'cat5', 'accessoire_par_engin', 1000) * quantite;
		IF id_compagnie IN (1, 14) THEN
			acc_compagnie := ROUND(acc_compagnie / 2, 0);
			acc_intermediaire := acc_compagnie;
		ELSE
			acc_intermediaire := fn_get_accessoire_intermediaire(prime_nette, id_compagnie);
		END IF;
		
		tx_taxe_acc := fn_get_taux_taxe(id_compagnie, id_produit, id_offre, date_effet);
		taxe_sur_acc := ROUND(((acc_compagnie + acc_intermediaire) * tx_taxe_acc)/100, 0);
		
		RETURN QUERY
			SELECT acc_compagnie AS accessoire_compagnie, acc_intermediaire AS accessoire_intermediaire,
				   taxe_sur_acc AS taxe_sur_accessoire;
	
END;
$function$;
