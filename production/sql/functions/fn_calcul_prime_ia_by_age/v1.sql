CREATE OR REPLACE FUNCTION public.fn_calcul_prime_ia_by_age(code_activite character varying, age integer, capital_deces numeric, capital_infirmite_permanente numeric, capital_frais_traitement numeric)
 RETURNS TABLE(primedeces numeric, primeinfirmite numeric, primefraistraitement numeric, outmessage character varying)
 LANGUAGE plpgsql
AS $function$
DECLARE

    taux numeric;
	taux_age numeric;
	
	prime_deces numeric;
	prime_infirmite numeric;
	prime_frais_traitement numeric;
	out_message character varying;
    ----Gestion des erreurs
    v_state   TEXT;
    v_msg     TEXT;
    v_detail  TEXT;
    v_hint    TEXT;
    v_context TEXT;
BEGIN

  	out_message := '';
	prime_deces := 0;
	prime_infirmite := 0;
	prime_frais_traitement := 0;
	
	IF (age>=12) AND (age<=49) THEN
		taux_age := 0;
	ELSIF (age>49) AND (age<=65) THEN
		taux_age := 1.3;
	ELSIF (age>65) AND (age<=70) THEN
		taux_age := 1.40;
	END IF;
	
	------ Recharhe taux classe------------------------
	taux := fn_web_calcul_taux_classe(code_activite);
	
	------- CALCUL DE LA PRIME DECCES ET CALCUL DE LA PRIME INFIRMITE PERMANENTE----------------------
    IF (age>=12) AND (age<=49) THEN
    	prime_deces := (capital_deces*(taux/1000));
		prime_infirmite := (capital_infirmite_permanente*(taux/1000));
    ELSIF (age>49) and (age<=65) THEN
    	prime_deces := ((capital_deces*taux)/1000)*taux_age;
		prime_infirmite := ((capital_infirmite_permanente*taux*taux_age)/1000);
    ELSIF (age>65) and (age<=70) THEN 
			IF (taux<2) THEN 
				taux := 2 ;
           		prime_deces := ((capital_deces*taux)/1000)*taux_age;
			END IF;
			IF (taux<2.5) THEN
		   		prime_infirmite := ((capital_infirmite_permanente*taux*taux_age)/1000);
			END IF;
    END IF;
	
 ------- CALCUL DE LA PRIME FRAIS DE TRAITEMENT----------------------

 	IF (code_activite='01') THEN
		IF ((age>49) AND (age<=65)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 4000*taux_age;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 6000*taux_age;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 9500*taux_age;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 12500*taux_age;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 15750*taux_age;
			END IF;
		ELSIF ((age>12) AND (age<=49)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 4000;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 6000;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 9500;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 12500;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 15750;
			END IF;
		END IF;
	ELSIF (code_activite='02') THEN
		IF ((age>49) AND (age<=65)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 6000*taux_age;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 10000*taux_age;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 15000*taux_age;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 18000*taux_age;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 21500*taux_age;
			END IF;
		ELSIF ((age>12) and (age<=49)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 6000;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement :=10000;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 15000;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 18000;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 21500;
			END IF;
		END IF;		 
	ELSIF (code_activite='03') THEN
		IF ((age>49) AND (age<=65)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 8500*taux_age;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 12500*taux_age;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 18000*taux_age;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 23500*taux_age;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 32000*taux_age;
			END IF;
		ELSIF ((age>12) and (age<=49)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 8500;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 12500;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 18000;
			ELSIF (capital_frais_traitement>500000 AND capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 23500;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 32000;
			END IF;
		END IF;	
	ELSIF (code_activite='04') THEN
		IF ((age>49) AND (age<=65)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 11000*taux_age;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN 
				prime_frais_traitement := 16000*taux_age;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 23500*taux_age;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 30500*taux_age;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 40500*taux_age;
			END IF;
		ELSIF ((age>12) and (age<=49)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 11000;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 16000;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 23500;
			ELSIF (capital_frais_traitement>500000) AND (capital_frais_traitement<=750000) THEN
				prime_frais_traitement := 30500;
			ELSIF (capital_frais_traitement>750000) AND (capital_frais_traitement<=1000000) THEN
				prime_frais_traitement := 40500;
			END IF;
		END IF;		 
    ELSIF (code_activite='04') THEN
		IF ((age>49) AND (age<=65)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement := 14500*taux_age;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 19500*taux_age;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 27000*taux_age;
			END IF; 
		ELSIF ((age>12) and (age<=49)) THEN
			IF (capital_frais_traitement>0) AND (capital_frais_traitement<=125000) THEN
				prime_frais_traitement :=14500;
			ELSIF (capital_frais_traitement>125000) AND (capital_frais_traitement<=250000) THEN
				prime_frais_traitement := 19500;
			ELSIF (capital_frais_traitement>250000) AND (capital_frais_traitement<=500000) THEN
				prime_frais_traitement := 27000;
			END IF; 
		END IF;	
	END IF;
	
	RETURN QUERY
			SELECT prime_deces, prime_infirmite, prime_frais_traitement, out_message;
  
  	EXCEPTION WHEN others THEN
		get stacked diagnostics
        	v_state   = returned_sqlstate,
        	v_msg     = message_text,
        	v_detail  = pg_exception_detail,
        	v_hint    = pg_exception_hint,
        	v_context = pg_exception_context;
			
		out_message := v_msg || ' : ' || v_context; -- 'Problème rencontré lors de la génération du calcul de la prime IA
		
    	RAISE EXCEPTION E'Got exception:
        	state  : %
        	message: %
        	detail : %
        	hint   : %
        	context: %
        	SQLSTATE: % 
        	SQLERRM: %', v_state, v_msg, v_detail, v_hint, v_context, SQLSTATE, SQLERRM;

END;
$function$;
