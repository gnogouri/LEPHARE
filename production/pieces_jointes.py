"""
Pièce jointe d'un devis ou d'un contrat : fichier téléversé à l'enregistrement du devis (écrans MRH, RC et MRP, comme
l'étape « Upload de fichier » d'URANUS), recopié sur le contrat à la confirmation (production/database.py).

- fiche : nom, type, taille, date et présence du fichier sur le serveur (les pièces reprises d'URANUS n'ont que leur
  ligne en base, sans le fichier) ;
- reponse_fichier : le fichier lui-même, affiché dans l'application (PDF ou image), après contrôle des droits par la
  garde centrale (devis.view ou contrats.view).
Le contrat sans pièce propre montre celle de son devis d'origine.
"""
import mimetypes
import posixpath

from django.http import FileResponse, Http404

from .models import Devis

FICHIER_ABSENT = "Le fichier n'est pas sur ce serveur : pièce enregistrée dans URANUS, sans son fichier."
# Seuls ces formats s'affichent dans l'application (type déduit de l'extension du fichier stocké, contrôlée à l'envoi) ;
# tout autre fichier, par exemple une pièce reprise d'URANUS sans ce contrôle, n'est proposé qu'au téléchargement
TYPES_AFFICHABLES = {"application/pdf", "image/png", "image/jpeg"}


def _nom(piece):
    return (piece.nom_original or "").strip() or posixpath.basename(str(piece.fichier.name or ""))


def _type_affichable(piece):
    type_mime = mimetypes.guess_type(str(piece.fichier.name or ""))[0]
    return type_mime if type_mime in TYPES_AFFICHABLES else None


def _disponible(piece):
    try:
        return bool(piece.fichier) and piece.fichier.storage.exists(piece.fichier.name)
    except Exception:  # chemin invalide
        return False


def piece_du_contrat(contrat):
    """(pièce, origine) : celle du contrat, sinon celle de son devis d'origine."""
    if contrat.piece_jointe_id:
        return contrat.piece_jointe, "contrat"
    id_devis = getattr(contrat, "iddevis_id", None) or getattr(contrat, "iddevis", None)
    id_devis = getattr(id_devis, "pk", id_devis)
    devis = Devis.objects.filter(pk=id_devis).select_related("piece_jointe").first() if id_devis else None
    if devis and devis.piece_jointe_id:
        return devis.piece_jointe, "devis"
    return None, None


def fiche(piece, origine="devis"):
    if not piece:
        return {"Presente": False}
    return {
        "Presente": True,
        "Id": piece.pk,
        "Nom": _nom(piece),
        "Type": piece.type_fichier or mimetypes.guess_type(_nom(piece))[0] or "",
        "Taille": piece.taille or 0,
        "Date": piece.date_upload.isoformat() if piece.date_upload else None,
        "Disponible": _disponible(piece),
        "Affichable": bool(piece.fichier) and _type_affichable(piece) is not None,
        "Origine": origine,
        "Message": None if _disponible(piece) else FICHIER_ABSENT,
    }


def reponse_fichier(piece):
    """Le fichier sous son nom d'origine : affiché dans le navigateur s'il est d'un format sûr (PDF, PNG, JPEG),
    sinon proposé au téléchargement sous un type neutre. Jamais exécuté comme une page (CSP sandbox)."""
    if not piece or not piece.fichier:
        raise Http404("Aucune pièce jointe.")
    if not _disponible(piece):
        raise Http404(FICHIER_ABSENT)
    nom = _nom(piece)
    type_mime = _type_affichable(piece)
    reponse = FileResponse(piece.fichier.open("rb"), content_type=type_mime or "application/octet-stream",
                           as_attachment=type_mime is None, filename=nom)
    reponse["X-Content-Type-Options"] = "nosniff"
    reponse["Content-Security-Policy"] = "sandbox; default-src 'none'"
    reponse["Cache-Control"] = "private, no-store"
    return reponse
