CREATE OR REPLACE FUNCTION public.fn_get_accessoire(prime_nette numeric, id_produit integer, id_offre integer, id_compagnie integer, date_effet date)
  RETURNS TABLE(accessoire_compagnie numeric, accessoire_intermediaire numeric, taxe_sur_accessoire numeric)
  LANGUAGE plpgsql
 AS $function$
 DECLARE
         tx_taxe_acc numeric;
         acc_compagnie numeric;
         acc_intermediaire numeric;
         taxe_sur_acc numeric;

 BEGIN

                 IF id_compagnie IN (1, 14, 21) AND id_produit = 2 AND id_offre IN (154, 155, 156) THEN
                         acc_compagnie := 500;
                         acc_intermediaire := 500;
                 ELSIF id_compagnie IN (1, 14, 21) AND id_produit = 2 AND id_offre IN (162, 163, 165, 166, 167, 168, 169, 170) THEN
                         acc_compagnie := 39.5;
                         acc_intermediaire := 39.5;
                 ELSIF id_compagnie = 1 AND id_produit = 2 AND id_offre <> 66 THEN
                         -- IA NSIA : grille du tarif IA NSIA, moitié compagnie / moitié courtier.
                         -- MINENE (66) garde l'accessoire de son tarif (6 000, document MINENE d'OREOLE).
                         acc_compagnie := ROUND(fn_get_accessoire_ia_nsia(prime_nette) / 2, 0);
                         acc_intermediaire := fn_get_accessoire_ia_nsia(prime_nette) - acc_compagnie;
                 ELSE
                         acc_compagnie := fn_get_accessoire_compagnie(prime_nette, id_produit, id_compagnie);
                         acc_intermediaire := 0;
                         IF id_compagnie IN (1, 14, 21) THEN
                                 acc_compagnie := ROUND(acc_compagnie / 2, 0);
                                 acc_intermediaire := acc_compagnie;
                         ELSE
                                 IF id_produit <> 3 THEN
                                         acc_intermediaire := fn_get_accessoire_intermediaire(prime_nette, id_compagnie);
                                 END IF;
                         END IF;
                 END IF;

                 tx_taxe_acc := fn_get_taux_taxe(id_compagnie, id_produit, id_offre, date_effet);
                 taxe_sur_acc := ROUND(((acc_compagnie + acc_intermediaire) * tx_taxe_acc)/100, 0);

                 RETURN QUERY
                         SELECT acc_compagnie AS accessoire_compagnie, acc_intermediaire AS accessoire_intermediaire,
                                    taxe_sur_acc AS taxe_sur_accessoire;

 END;
 $function$
