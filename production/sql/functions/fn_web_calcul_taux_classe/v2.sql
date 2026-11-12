-- Migration production 0177 : montants et taux écrits jusqu'ici dans la fonction lus dans les réglages IA
-- (Administration > Réglages par branche > Individuelle Accidents), fn_lephare_parametre_nombre(clé, valeur d'origine).
CREATE OR REPLACE FUNCTION public.fn_web_calcul_taux_classe(code_classe character varying)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
   
   resultat numeric;
   
BEGIN
  
	  IF (code_classe = '01' ) THEN
		  resultat := fn_lephare_parametre_nombre('ia.autres.taux_classe_01', 1.0);
	  ELSIF (code_classe = '02' ) THEN
		  resultat := fn_lephare_parametre_nombre('ia.autres.taux_classe_02', 1.3);
	  ELSIF (code_classe = '03' ) THEN
		  resultat := fn_lephare_parametre_nombre('ia.autres.taux_classe_03', 1.7);
	  ELSIF (code_classe = '04' ) THEN
		  resultat := fn_lephare_parametre_nombre('ia.autres.taux_classe_04', 2.5);
	  ELSIF (code_classe = '05' ) THEN
		  resultat := fn_lephare_parametre_nombre('ia.autres.taux_classe_05', 4.1);
	  ELSE  resultat := 0.0;
	  END IF;

	  RETURN resultat;

END;
$function$;
