CREATE OR REPLACE FUNCTION public.fn_web_calcul_taux_classe(code_classe character varying)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
   
   resultat numeric;
   
BEGIN
  
	  IF (code_classe = '01' ) THEN
		  resultat := 1.0;
	  ELSIF (code_classe = '02' ) THEN
		  resultat := 1.3;
	  ELSIF (code_classe = '03' ) THEN
		  resultat := 1.7;
	  ELSIF (code_classe = '04' ) THEN
		  resultat := 2.5;
	  ELSIF (code_classe = '05' ) THEN
		  resultat := 4.1;
	  ELSE  resultat := 0.0;
	  END IF;

	  RETURN resultat;

END;
$function$;
