-- v2 (production 0179) : pas d'arrondi pendant la reprise d'une affaire antérieure (production/reprise.py pose
-- lephare.reprise = 'on' dans sa transaction) : la TTC est celle du document émis à l'époque.
CREATE OR REPLACE FUNCTION public.trg_fn_lephare_arrondi_primettc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
-- Prime TTC d'un devis, d'un contrat ou d'une quittance arrondie à son enregistrement (fn_lephare_arrondi_montant) :
-- toutes les branches et tous les documents, qui lisent la TTC enregistrée. Les composantes (prime nette,
-- accessoire, taxe) restent celles du calcul ; l'écart (2 F au plus) est celui de l'arrondi.
BEGIN
	IF NEW.primettc IS NOT NULL AND COALESCE(current_setting('lephare.reprise', true), '') <> 'on' THEN
		NEW.primettc := public.fn_lephare_arrondi_montant(NEW.primettc, NEW.idproduit);
	END IF;
	RETURN NEW;
END;
$function$;
