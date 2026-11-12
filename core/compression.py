from django.middleware.gzip import GZipMiddleware


class CompressionReponses(GZipMiddleware):
    """
    Compresse les réponses de l'API (JSON, texte) quand le navigateur l'accepte.

    Les listes de clients, de devis ou de contrats pèsent de 1 à 3 Mo en JSON : compressées, elles
    sont 8 à 10 fois plus légères sur le réseau. Les fichiers (PDF, images, classeurs Excel), déjà
    compressés, sont transmis tels quels.
    """

    TYPES_COMPRESSES = ("application/json", "text/", "application/javascript", "application/xml", "image/svg+xml")

    def process_response(self, request, response):
        type_contenu = (response.get("Content-Type") or "").lower()
        if not type_contenu.startswith(self.TYPES_COMPRESSES):
            return response
        return super().process_response(request, response)
