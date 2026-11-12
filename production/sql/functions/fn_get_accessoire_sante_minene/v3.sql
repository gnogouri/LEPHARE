-- v3 (production 0182) : accessoire d'une famille MINENE selon la prime de base de sa formule (montants du fichier
-- de tarification OREOLE), et non selon sa prime surprimée ou réduite.
CREATE OR REPLACE FUNCTION public.fn_get_accessoire_sante_minene(id_offre integer, prime_nette_sante numeric, montant_accessoire_manuel numeric, nombre_adherent integer)
 RETURNS TABLE(accessoire_compagnie numeric, accessoire_intermediaire numeric, taxe_sur_accessoire numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
	tx_taxe_acc numeric;
	acc_compagnie numeric;
	acc_intermediaire numeric;
	acc_sante numeric;
	taxe_sur_acc numeric;

BEGIN

		acc_intermediaire := 0;
		acc_compagnie := 0;
		acc_sante := 0;

		IF(COALESCE(montant_accessoire_manuel,0) = 0) THEN
			-- Accessoire de la formule (TARIFICATION MINENE SANTE.xlsx : SOLO 9 000 F, FAMILLE 12 000 F, FAMILLE PLUS
			-- 12 000 F en 70-80 ; 12 000 / 12 000 / 24 000 F en 80-80) : grille de la compagnie appliquée à la prime de
			-- base de la formule (Administration > Réglages Santé MINENE), pas à la prime surprimée ou réduite de la
			-- famille, qui la faisait changer de tranche (SOLO de 65 ans : 12 000 F au lieu de 9 000 F)
			acc_sante := fn_get_accessoire_compagnie(
				COALESCE((SELECT F.primebase FROM public.lephare_sante_formule AS F WHERE F.idoffre = id_offre), prime_nette_sante), 5, 1);
		ELSE
			acc_sante := montant_accessoire_manuel;
		END IF;

		-- Taux de taxe Santé de NSIA (Administration > Taxes, 8 % à l'origine), auparavant écrit ici
		tx_taxe_acc := COALESCE(fn_get_taux_taxe(1, 5, id_offre, CURRENT_DATE), 8.0);

		IF id_offre IN (17, 18, 19, 175, 176, 181) THEN
			acc_compagnie := acc_sante;
			taxe_sur_acc := ROUND((acc_sante * tx_taxe_acc)/100,0);
		ELSIF id_offre IN (20, 21, 22) THEN
			acc_compagnie := acc_sante;
			taxe_sur_acc := ROUND((acc_sante * tx_taxe_acc)/100,0);
		END IF;

		acc_compagnie := acc_compagnie * nombre_adherent;
		taxe_sur_acc := taxe_sur_acc * nombre_adherent;

		RETURN QUERY
			SELECT acc_compagnie AS accessoire_compagnie, acc_intermediaire AS accessoire_intermediaire,
				   taxe_sur_acc AS taxe_sur_accessoire;

END;
$function$;
