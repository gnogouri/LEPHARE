-- PROCEDURE: public.sp_calcul_devis_prime_imposee(integer, numeric, numeric, numeric, integer)
-- v1 : définition d'URANUS relevée en base le 2026-11-02 (RC et Multirisque Professionnelle, appelée par
-- sp_creation_devis_rc et sp_creation_devis_risques_divers).

CREATE OR REPLACE PROCEDURE public.sp_calcul_devis_prime_imposee(IN p_id_devis integer, IN p_pn_imposee numeric, IN p_acc_impose numeric, IN p_taxe_totale_imposee numeric, IN p_id_offre integer)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
	v_pn_theo_totale NUMERIC;
	v_taxe_theo_garanties NUMERIC;
	v_acc_final NUMERIC;
	v_ratio_pn NUMERIC;
	v_id_gar_majeure INT;
	v_somme_pn_ventilee NUMERIC;
	v_reliquat_pn NUMERIC;
	v_min_taxe_legale NUMERIC;
	v_taxe_acc_finale NUMERIC;
	v_ttc_theorique NUMERIC;
	v_ttc_arrondi NUMERIC;
	v_diff_arrondi_ttc NUMERIC;
	v_taux_taxe_acc NUMERIC;
	v_id_compagnie INTEGER;
	v_id_produit INTEGER;
	v_date_effet DATE;
	v_nombre_garanties INTEGER;

BEGIN
	-- 0. RECUPERATION DES INFORMATIONS DU DEVIS
	SELECT idcompagnie, idproduit, dateeffet
	INTO v_id_compagnie, v_id_produit, v_date_effet
	FROM public.stddevis
	WHERE iddevis = p_id_devis;
	
	-- 1. RECUPERATION DES BASES DE CALCUL
	SELECT SUM(primenette), SUM(taxe), COUNT(iddevisdetgarantie) INTO v_pn_theo_totale, v_taxe_theo_garanties, v_nombre_garanties
	FROM stddevisdetgarantie 
	WHERE iddevisdet IN (SELECT iddevisdetail FROM public.stddevisdetail WHERE iddevis = p_id_devis);
	
	IF v_pn_theo_totale IS NULL OR v_pn_theo_totale = 0 THEN
		IF v_nombre_garanties > 0 THEN
			UPDATE stddevisdetgarantie AS DD
			SET primenette = ROUND(p_pn_imposee / v_nombre_garanties, 2),
			taxe = ROUND((ROUND(p_pn_imposee / v_nombre_garanties, 2)) * TT.TauxTaxe / 100, 2)
			FROM StdTauxTaxeGarantieProduit AS TT
			WHERE (DD.iddevisdet IN (SELECT iddevisdetail FROM public.stddevisdetail WHERE iddevis = p_id_devis)) AND (DD.IdGarantie = TT.IdGarantie)
				AND (TT.IdProduit = v_id_produit) AND (v_date_effet BETWEEN TT.DebutValidite AND TT.FinValidite);
	
			v_pn_theo_totale := p_pn_imposee;
			v_ratio_pn := 1; -- Le ratio devient neutre car le travail est deja fait
		ELSE
			--      Ici, on ne peut vraiment rien faire (0 garanties dans la table)
			RETURN;
		END IF;
	ELSE
		v_ratio_pn := p_pn_imposee / v_pn_theo_totale;
	END IF;
	
	-- Recuperation du taux de taxe accessoire
	v_taux_taxe_acc := fn_get_taux_taxe(v_id_compagnie, v_id_produit, p_id_offre, v_date_effet);
	
	-- Determination de l'accessoire (Impose ou existant)
	v_acc_final := COALESCE(p_acc_impose, (SELECT accessoire FROM stddevis WHERE iddevis = p_id_devis));
	
	-- 2. VENTILATION DE LA PRIME NETTE
	
	-- On cible la plus grosse garantie pour les ecarts dus aux arrondis
	SELECT iddevisdetgarantie INTO v_id_gar_majeure 
	FROM stddevisdetgarantie 
	WHERE iddevisdet IN (SELECT iddevisdetail FROM public.stddevisdetail WHERE iddevis = p_id_devis)
	ORDER BY primenette DESC
	LIMIT 1;

	-- Mise a jour proportionnelle
	IF v_ratio_pn <> 1 THEN
		UPDATE stddevisdetgarantie AS DD
		SET primenette = ROUND(primenette * v_ratio_pn, 2),
		taxe = ROUND(((ROUND(primenette * v_ratio_pn, 2)) * TT.TauxTaxe) / 100, 2)
		FROM StdTauxTaxeGarantieProduit AS TT
		WHERE (DD.iddevisdet IN (SELECT iddevisdetail FROM public.stddevisdetail WHERE iddevis = p_id_devis)) AND (DD.IdGarantie = TT.IdGarantie)
			AND (TT.IdProduit = v_id_produit) AND (v_date_effet BETWEEN TT.DebutValidite AND TT.FinValidite);
	END IF;
	
	-- Calcul et application du reliquat (ecart de centimes sur la somme)
	SELECT (p_pn_imposee - SUM(primenette)) INTO v_reliquat_pn
	FROM public.stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM public.stddevisdetail WHERE iddevis = p_id_devis);
	
	UPDATE public.stddevisdetgarantie AS DD
	SET primenette = primenette + v_reliquat_pn,
	taxe = ROUND((primenette + v_reliquat_pn) * TT.TauxTaxe / 100, 2)
	FROM StdTauxTaxeGarantieProduit AS TT
	WHERE iddevisdetgarantie = v_id_gar_majeure AND (DD.IdGarantie = TT.IdGarantie)
		AND (TT.IdProduit = v_id_produit) AND (v_date_effet BETWEEN TT.DebutValidite AND TT.FinValidite);
	
	
	-- 3. GESTION DE LA TAXE ET DE L'ACCESSOIRE
	-- Somme des taxes garanties apres ventilation
	SELECT ROUND(SUM(taxe), 0) INTO v_min_taxe_legale FROM stddevisdetgarantie WHERE iddevisdet IN (SELECT iddevisdetail FROM public.stddevisdetail WHERE iddevis = p_id_devis);
	
	IF p_taxe_totale_imposee IS NOT NULL THEN
		IF p_taxe_totale_imposee < v_min_taxe_legale THEN
			RAISE EXCEPTION 'Taxe imposee insuffisante par rapport au minimum legal des garanties: %', v_min_taxe_legale;
		END IF;
		v_taxe_acc_finale := p_taxe_totale_imposee - v_min_taxe_legale;
	ELSE
		v_taxe_acc_finale := ROUND(v_acc_final * COALESCE(v_taux_taxe_acc, 0) / 100, 2);
	END IF;
	
	-- 4. CALCUL DU TTC ET ARRONDI FINAL A L'ENTIER
	v_ttc_theorique := COALESCE(p_pn_imposee, v_pn_theo_totale) + v_acc_final + COALESCE(p_taxe_totale_imposee, v_min_taxe_legale + v_taxe_acc_finale);
	
	-- Application de votre regle d'arrondi a l'unite
	v_ttc_arrondi := ROUND(v_ttc_theorique, 0);
	v_diff_arrondi_ttc := v_ttc_arrondi - v_ttc_theorique;
	
	-- L'accessoire absorbe la difference pour garder l'equilibre comptable
	v_acc_final := v_acc_final + v_diff_arrondi_ttc;
	
	-- 5. SYNCHRONISATION DES NIVEAUX PARENTS
	-- Mise a jour DetailDevis
	UPDATE public.stddevisdetail AS D
	SET (primenette, taxeenregistrement) = (SELECT SUM(g.primenette), SUM(g.taxe)
	FROM public.stddevisdetgarantie AS G WHERE (G.iddevisdet = D.iddevisdetail))
	WHERE D.iddevis = p_id_devis;
	
	-- Mise a jour Devis
	UPDATE public.stddevis
	SET primenette = COALESCE(p_pn_imposee, v_pn_theo_totale), accessoire = v_acc_final,
	taxe = COALESCE(p_taxe_totale_imposee, v_min_taxe_legale + v_taxe_acc_finale), primettc = v_ttc_arrondi
	WHERE iddevis = p_id_devis;

END;
$procedure$;
