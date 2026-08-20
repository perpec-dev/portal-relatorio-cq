# -*- coding: utf-8 -*-
"""
gerar-fontes.py — produz js/pdf/fontes.js a partir das OTF instaladas.

O jsPDF só embarca fonte TrueType (tabelas glyf/loca). As licenciadas da Perpec
são OTF, com contorno CFF (cúbico). Este script converte o contorno para
quadrático, salva o TTF, confere a acentuação portuguesa glifo a glifo e
escreve o .js em base64 que o gerador de PDF carrega sob demanda.

    pip install fonttools
    python ferramentas/gerar-fontes.py

Para trocar de família, mexa em FACES. O primeiro item é o estilo 'normal'
(corpo do relatório) e o segundo é o 'bold' (rótulos, faixas e laudo).
"""
import base64
import os
import sys

try:
    from fontTools.ttLib import TTFont, newTable
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
except ImportError:
    sys.exit("fontTools não instalado. Rode:  pip install fonttools")

# (arquivo .otf de origem, nome do .ttf embarcado, estilo no jsPDF)
FACES = [
    ("Proxima Nova Alt Condensed Light.otf", "ProximaNovaAlt-CondLight.ttf", "normal"),
    ("Proxima Nova Alt Extra Condensed Bold.otf", "ProximaNovaAlt-XCondBold.ttf", "bold"),
]

FAMILIA = "pnalt"          # nome usado em pdf.setFont(...) no gerar-pdf.js
MAX_ERR = 1.0              # erro máximo, em unidades de em, da aproximação
DESCRICAO = {
    "normal": "Proxima Nova Alt Condensed Light      — corpo do relatório",
    "bold":   "Proxima Nova Alt Extra Condensed Bold — títulos, rótulos, laudo",
}

# Se algum destes faltar, o PDF sai com buraco no lugar do acento.
PORTUGUES = "ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç°º–—•·"

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "js", "pdf", "fontes.js")
PASTA_FONTES = os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts")


def para_quadratico(glyphset):
    quad = {}
    for nome in glyphset.keys():
        caneta = TTGlyphPen(glyphset)
        glyphset[nome].draw(Cu2QuPen(caneta, MAX_ERR, reverse_direction=True))
        quad[nome] = caneta.glyph()
    return quad


def otf_para_ttf(fonte):
    if fonte.sfntVersion != "OTTO" or "CFF " not in fonte:
        return fonte                      # já é TrueType

    ordem = fonte.getGlyphOrder()

    fonte["loca"] = newTable("loca")
    fonte["glyf"] = glyf = newTable("glyf")
    glyf.glyphOrder = ordem
    glyf.glyphs = para_quadratico(fonte.getGlyphSet())
    del fonte["CFF "]
    glyf.compile(fonte)

    fonte["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    maxp.maxZones = 1
    maxp.maxTwilightPoints = 0
    maxp.maxStorage = 0
    maxp.maxFunctionDefs = 0
    maxp.maxInstructionDefs = 0
    maxp.maxStackElements = 0
    maxp.maxSizeOfInstructions = 0
    maxp.maxComponentElements = max(
        (len(g.components) for g in glyf.glyphs.values() if hasattr(g, "components")),
        default=0)
    maxp.compile(fonte)

    post = fonte["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = ordem
    try:
        post.compile(fonte)
    except OverflowError:
        post.formatType = 3.0

    fonte.sfntVersion = "\000\001\000\000"
    return fonte


def converter(arquivo_otf, arquivo_ttf, destino_dir):
    origem = os.path.join(PASTA_FONTES, arquivo_otf)
    if not os.path.exists(origem):
        sys.exit("Fonte não encontrada: %s\nInstale-a ou ajuste FACES." % origem)

    destino = os.path.join(destino_dir, arquivo_ttf)
    fonte = otf_para_ttf(TTFont(origem))
    fonte.save(destino)
    cmap = fonte.getBestCmap()
    fonte.close()

    faltando = "".join(c for c in PORTUGUES if ord(c) not in cmap)
    if faltando:
        sys.exit("%s não tem os caracteres: %s" % (arquivo_otf, faltando))

    with open(destino, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    os.remove(destino)                     # o .ttf é intermediário; só o .js fica

    print("  %-42s -> %s (%.0f KB em base64)" % (arquivo_otf, arquivo_ttf, len(b64) / 1024.0))
    return b64


def main():
    import tempfile
    print("Convertendo OTF -> TTF:")
    with tempfile.TemporaryDirectory() as tmp:
        faces = [(ttf, estilo, converter(otf, ttf, tmp)) for otf, ttf, estilo in FACES]

    # A vírgula ENTRE os objetos é do separador do join, não do formato de
    # cada face — sem ela o .js sai com erro de sintaxe, o navegador não
    # define FONTES_PDF e o PDF cai calado para Helvetica.
    linhas = ",\n\n".join(
        "    { arquivo: '%s', estilo: '%s',\n      b64: '%s' }" % (ttf, estilo, b64)
        for ttf, estilo, b64 in faces)

    inventario = "\n".join(
        "     %-7s %s" % (estilo, DESCRICAO.get(estilo, ttf))
        for ttf, estilo, _ in faces)

    cabecalho = """/* ==========================================================================
   fontes.js — Proxima Nova Alt embarcada para o jsPDF
   --------------------------------------------------------------------------
   ARQUIVO GERADO por ferramentas/gerar-fontes.py. Não edite à mão.

   O jsPDF só embarca fonte TrueType; as faces abaixo saíram das OTF
   licenciadas da Perpec convertidas para TTF (contorno quadrático), com a
   acentuação portuguesa inteira conferida glifo a glifo.

%s

   Carregado SOB DEMANDA por gerar-pdf.js: quem só navega pelo portal não paga
   o download da fonte. Se o arquivo faltar, o PDF sai em Helvetica — feio,
   mas sai. Nunca deixe a fonte impedir a emissão do laudo.

   Para regerar, ver README.md > "Fonte do PDF".
   ========================================================================== */

window.FONTES_PDF = {
  familia: '%s',
  faces: [
""" % (inventario, FAMILIA)

    with open(SAIDA, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(cabecalho)
        fh.write(linhas)
        fh.write("\n  ]\n};\n")

    print("\nGerado %s — %.0f KB" % (
        os.path.relpath(SAIDA, RAIZ), os.path.getsize(SAIDA) / 1024.0))


if __name__ == "__main__":
    main()
