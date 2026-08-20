/* ==========================================================================
   storage.js — buckets privados (assinaturas e fotos)
   --------------------------------------------------------------------------
   Os dois buckets são PRIVADOS. Nada é lido por URL pública: toda imagem sai
   por signed URL de vida curta, e quem autoriza a emissão dessa URL é a
   policy em storage.objects — não este arquivo.

   Convenção de caminho, e ela não é decorativa: a PRIMEIRA pasta é sempre o
   uuid do dono, porque é ela que as policies comparam com auth.uid().
     assinaturas/<user_id>/<uuid>.png
     relatorios/<inspetor_id>/<relatorio_id>/<campo_id>/<uuid>.jpg
   ========================================================================== */

window.Storage = (function () {
  'use strict';

  const B_ASSIN = 'assinaturas';
  const B_FOTOS = 'relatorios';

  function sb() { return SB.exigirCliente(); }

  /* ------------------------------------------------------------------
     Redimensionamento antes do upload.
     Uma foto de celular atual tem 4-6 MB. Vinte num relatório seriam 100 MB
     no bucket e um PDF que trava o leitor. 1600px no lado maior continua
     mostrando trinca, rosca e oxidação com folga.
     ------------------------------------------------------------------ */
  function reduzirImagem(arquivo) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        const lado = CONFIG.FOTO_LADO_MAX;
        let w = img.naturalWidth, h = img.naturalHeight;

        if (!w || !h) { reject(new Error('Imagem inválida.')); return; }

        if (w > lado || h > lado) {
          const f = Math.min(lado / w, lado / h);
          w = Math.round(w * f);
          h = Math.round(h * f);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        // Fundo branco: JPEG não tem transparência, e sem isto um PNG com
        // fundo transparente vira um retângulo preto no relatório.
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);

        cv.toBlob(function (blob) {
          if (!blob) { reject(new Error('Não foi possível processar a imagem.')); return; }
          resolve({ blob: blob, largura: w, altura: h });
        }, 'image/jpeg', CONFIG.FOTO_QUALIDADE);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        // HEIC do iPhone cai aqui em navegadores que não decodificam o formato.
        reject(new Error('Não foi possível ler esta imagem. Tente tirar a foto de novo.'));
      };
      img.src = url;
    });
  }

  async function enviarFoto(arquivo, idRelatorio, campoId) {
    const p = await Auth.garantirPerfil();
    if (!p) throw new Error('Sessão necessária.');

    const reduzida = await reduzirImagem(arquivo);
    const caminho = [p.id, idRelatorio, campoId, Util.uid() + '.jpg'].join('/');

    const { error } = await sb().storage.from(B_FOTOS).upload(caminho, reduzida.blob, {
      contentType: 'image/jpeg',
      upsert: false
    });
    if (error) throw error;
    return caminho;
  }

  async function apagarFotoArquivo(caminho) {
    const { error } = await sb().storage.from(B_FOTOS).remove([caminho]);
    if (error) throw error;
  }

  async function enviarAssinatura(blob) {
    const p = await Auth.garantirPerfil();
    if (!p) throw new Error('Sessão necessária.');

    // O bucket só aceita png/jpeg/webp; qualquer outra coisa é recusada lá.
    const mime = blob.type && /^image\/(png|jpeg|webp)$/.test(blob.type)
      ? blob.type : 'image/png';
    const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/webp' ? 'webp' : 'png');

    /* Nome novo a cada troca, NUNCA sobrescrever.
       Se sobrescrevesse, todo PDF já emitido passaria a exibir a assinatura
       nova — o laudo mudaria sozinho depois de assinado. */
    const caminho = p.id + '/' + Util.uid() + '.' + ext;

    const { error } = await sb().storage.from(B_ASSIN).upload(caminho, blob, {
      contentType: mime,
      upsert: false
    });
    if (error) throw error;

    await DB.atualizarPerfil(p.id, {
      assinatura_path: caminho,
      assinatura_atualizada_em: new Date().toISOString()
    });
    await Auth.carregarPerfil();
    return caminho;
  }

  /* ------------------------------------------------------------------
     URLs assinadas. Em lote quando dá, porque um relatório com 20 fotos
     faria 20 viagens ao servidor uma a uma.
     ------------------------------------------------------------------ */
  async function urlFoto(caminho) {
    const { data, error } = await sb().storage.from(B_FOTOS)
      .createSignedUrl(caminho, CONFIG.URL_ASSINADA_SEG);
    if (error) throw error;
    return data.signedUrl;
  }

  async function urlsFotos(caminhos) {
    if (!caminhos || !caminhos.length) return {};
    const { data, error } = await sb().storage.from(B_FOTOS)
      .createSignedUrls(caminhos, CONFIG.URL_ASSINADA_SEG);
    if (error) throw error;
    const mapa = {};
    (data || []).forEach(function (d) {
      if (d && d.signedUrl && !d.error) mapa[d.path] = d.signedUrl;
    });
    return mapa;
  }

  async function urlAssinatura(caminho) {
    if (!caminho) return null;
    const { data, error } = await sb().storage.from(B_ASSIN)
      .createSignedUrl(caminho, CONFIG.URL_ASSINADA_SEG);
    if (error) throw error;
    return data.signedUrl;
  }

  /* ------------------------------------------------------------------
     Conversões para os geradores de documento.
     jsPDF quer dataURL; a lib docx quer ArrayBuffer. Os dois precisam das
     dimensões para não distorcer a imagem.
     ------------------------------------------------------------------ */
  async function comoDataURL(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Não foi possível baixar a imagem.');
    const blob = await resp.blob();
    return await new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('Falha ao ler a imagem.')); };
      fr.readAsDataURL(blob);
    });
  }

  async function comoArrayBuffer(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Não foi possível baixar a imagem.');
    return await resp.arrayBuffer();
  }

  function dimensoes(dataUrl) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve({ largura: img.naturalWidth, altura: img.naturalHeight }); };
      img.onerror = function () { resolve({ largura: 0, altura: 0 }); };
      img.src = dataUrl;
    });
  }

  /* Só o admin consegue: a policy assin_apagar exige sou_admin(). É usada na
     execução do direito de exclusão, porque o SQL não alcança o Storage. */
  async function apagarAssinaturaArquivo(caminho) {
    const { error } = await sb().storage.from(B_ASSIN).remove([caminho]);
    if (error) throw error;
  }

  return {
    reduzirImagem: reduzirImagem,
    enviarFoto: enviarFoto, apagarFotoArquivo: apagarFotoArquivo,
    enviarAssinatura: enviarAssinatura, apagarAssinaturaArquivo: apagarAssinaturaArquivo,
    urlFoto: urlFoto, urlsFotos: urlsFotos, urlAssinatura: urlAssinatura,
    comoDataURL: comoDataURL, comoArrayBuffer: comoArrayBuffer, dimensoes: dimensoes
  };
})();
