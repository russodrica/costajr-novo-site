// Upload de arquivo do admin direto para o Supabase Storage (bucket portal).
// Uso: enviarArquivoCJR("id-do-input-de-url", "id-do-botao")
window.enviarArquivoCJR = function (inputUrlId, btnId) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.xlsx,.docx,.pptx,.zip";
  picker.onchange = async () => {
    const f = picker.files && picker.files[0];
    if (!f) return;
    if (f.size > 45 * 1024 * 1024) { alert("Arquivo muito grande (máx. 45MB). Para vídeos grandes, suba no YouTube (não listado) e cole o link."); return; }
    const btn = document.getElementById(btnId);
    const original = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
    try {
      const r1 = await fetch("/api/admin/portal/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: f.name, content_type: f.type }),
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error || "Falha ao preparar o upload.");
      const r2 = await fetch(d1.signed_url, { method: "PUT", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
      if (!r2.ok) throw new Error("Falha no envio do arquivo (HTTP " + r2.status + ").");
      const campo = document.getElementById(inputUrlId);
      if (campo) campo.value = d1.public_url;
      if (btn) btn.textContent = "✓ Enviado";
      setTimeout(() => { if (btn) btn.textContent = original; }, 2500);
    } catch (e) {
      alert("Erro no upload: " + (e && e.message ? e.message : e));
      if (btn) btn.textContent = original;
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  picker.click();
};
