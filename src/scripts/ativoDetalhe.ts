// Script da ficha do ativo (/admin/ativos/[id]). Extraído para módulo próprio porque
// o Rollup descartava o <script> hoisted grande direto na página (renderScript sumia do
// SSR). Aqui ele é um módulo normal, sempre bundlado; a página só faz import (corpo mínimo).

    // marcador de carregamento do script desta página (diagnóstico) — vira true ao final
    (window as any).__ativosReady = false;
    // termos lidos do island JSON (substitui o antigo define:vars)
    (window as any).__termos = JSON.parse((document.getElementById("termosData") as HTMLElement)?.textContent || "[]");
    // mantém a posição de rolagem após inserir/recarregar (não pula pro topo)
    function reloadKeepScroll() { try { sessionStorage.setItem("ativoScroll", String(window.scrollY)); } catch {} window.location.reload(); }
    (function () { try { const s = sessionStorage.getItem("ativoScroll"); if (s != null) { sessionStorage.removeItem("ativoScroll"); requestAnimationFrame(() => window.scrollTo(0, parseInt(s, 10) || 0)); } } catch {} })();
    const ativoId = location.pathname.split("/").filter(Boolean).pop();
    function fecharModais() { document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("open")); }
    function abrirModal(id: string) {
      // limpa mensagens de erro anteriores ao abrir qualquer modal
      const ma = document.getElementById("msgAcao"); if (ma) ma.innerHTML = "";
      const me = document.getElementById("msgEditar"); if (me) me.innerHTML = "";
      if (id === "modalEditar") sincronizarCamposEdicao();
      document.getElementById(id)?.classList.add("open");
    }
    // exposição ANTECIPADA dos handlers de modal (funções declaradas = hoisted) — garante
    // que os botões de ação abram mesmo que algo mais abaixo no script venha a falhar.
    (window as any).abrirModal = abrirModal;
    (window as any).fecharModais = fecharModais;

    // mostra os campos específicos conforme a categoria escolhida na edição
    function sincronizarCamposEdicao() {
      const sel = document.querySelector("#formEditar select[name='categoria']") as HTMLSelectElement;
      const cat = sel?.value;
      document.querySelectorAll(".ecampos-cat").forEach(el => (el as HTMLElement).style.display = "none");
      const alvo = document.getElementById("ecampos-" + cat);
      if (alvo) alvo.style.display = "";
    }
    document.querySelector("#formEditar select[name='categoria']")?.addEventListener("change", sincronizarCamposEdicao);

    // selects com opção "Outro"
    document.querySelectorAll("select[name='colaborador_sel'], select[name='obra_sel']").forEach(sel => {
      sel.addEventListener("change", () => {
        const outro = sel.closest("form")?.querySelector("[data-outro]") as HTMLElement;
        if (outro) outro.style.display = (sel as HTMLSelectElement).value.startsWith("__") ? "" : "none";
      });
    });

    // ações de movimentação
    document.querySelectorAll("form[data-acao]").forEach(form => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = form as HTMLFormElement;
        const fd = new FormData(f);
        const body = Object.fromEntries(fd.entries()) as any;
        let acao = f.dataset.acao!;

        if (acao === "entregar") {
          const sel = f.querySelector("select[name='colaborador_sel']") as HTMLSelectElement;
          const opt = sel.selectedOptions[0];
          if (sel.value === "__outro__") {
            body.colaborador_nome = body.colaborador_nome_manual;
            body.colaborador_id = null;
          } else {
            body.colaborador_id = sel.value;
            body.colaborador_nome = opt?.dataset.nome;
            body.colaborador_email = opt?.dataset.email;
          }
          if (!body.colaborador_nome) { alert("Informe o colaborador"); return; }
        }
        if (acao === "transferir_obra") {
          const sel = f.querySelector("select[name='obra_sel']") as HTMLSelectElement;
          const opt = sel.selectedOptions[0];
          if (sel.value === "__outra__") { body.obra_nome = body.obra_nome_manual; body.obra_id = null; }
          else { body.obra_id = opt?.dataset.obraid || null; body.obra_nome = opt?.dataset.nome; }
          if (!body.obra_nome) { alert("Informe a obra"); return; }
        }
        if (acao === "transferir_deposito") {
          const sel = f.querySelector("select[name='deposito_sel']") as HTMLSelectElement | null;
          if (!sel || !sel.value) { alert("Selecione o depósito"); return; }
          body.deposito_id = sel.value;
          body.deposito_nome = sel.selectedOptions[0]?.dataset.nome;
        }
        if (f.id === "formBaixa") {
          acao = body.tipo_baixa;
          const rotulo = acao === "baixar" ? "baixa" : "descarte";
          if (!confirm(`Confirmar ${rotulo} deste ativo? Ele sai de circulação (o histórico é mantido para sempre).`)) return;
        }
        if (body.valor) body.valor = Number(body.valor);
        body.acao = acao;

        const btn = f.querySelector("button[type=submit]") as HTMLButtonElement | null;
        const txtOrig = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = "Processando..."; }

        try {
          const res = await fetch(`/api/admin/ativos/${ativoId}/movimentar`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          });
          const d = await res.json();
          if (res.ok) { reloadKeepScroll(); }
          else {
            fecharModais();
            document.getElementById("msgAcao")!.innerHTML = `<div class="alert alert-error">${d.error || "Erro na ação"}</div>`;
          }
        } catch {
          fecharModais();
          document.getElementById("msgAcao")!.innerHTML = `<div class="alert alert-error">Erro de conexão. Tente novamente.</div>`;
        } finally {
          if (btn) { btn.disabled = false; if (txtOrig) btn.textContent = txtOrig; }
        }
      });
    });

    // editar
    document.getElementById("formEditar")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const fd = new FormData(f);
      const body = Object.fromEntries(fd.entries()) as any;
      body.garantia = body.garantia === "true";
      if (body.valor_aquisicao) body.valor_aquisicao = Number(body.valor_aquisicao);

      // campos específicos do grupo de categoria visível
      const campos = {} as any;
      document.querySelectorAll(".ecampos-cat:not([style*='none']) [data-ecampo]").forEach((el) => {
        const input = el as HTMLInputElement;
        if (input.value.trim()) campos[(input.dataset.ecampo as string)] = input.value.trim();
      });
      body.campos = campos;

      const btn = f.querySelector("button[type=submit]") as HTMLButtonElement;
      const txt = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
      try {
        const res = await fetch(`/api/admin/ativos/${ativoId}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const d = await res.json();
        if (res.ok) reloadKeepScroll();
        else document.getElementById("msgEditar")!.innerHTML = `<div class="alert alert-error">${d.error || "Erro ao salvar"}</div>`;
      } catch {
        document.getElementById("msgEditar")!.innerHTML = `<div class="alert alert-error">Erro de conexão.</div>`;
      } finally {
        if (btn) { btn.disabled = false; if (txt) btn.textContent = txt; }
      }
    });

    // termo
    function verTermo(id: string) {
      const t = (window as any).__termos.find((x: any) => x.id === id);
      if (!t) return;
      (document.getElementById("termoConteudo") as HTMLElement).textContent = t.conteudo
        + (t.status === "aceito" ? `\n\n--------------------------------------------\nACEITO ELETRONICAMENTE em ${new Date(t.aceito_em).toLocaleString("pt-BR")}${t.aceito_ip ? ` — IP ${t.aceito_ip}` : ""}\npor ${t.colaborador_nome}` : "\n\n[ Aguardando aceite eletrônico no Portal do Colaborador ]");
      abrirModal("modalTermo");
    }
    function imprimirTermo() {
      const conteudo = (document.getElementById("termoConteudo") as HTMLElement).textContent || "";
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`<html><head><title>Termo de Responsabilidade</title><style>body{font-family:Arial,sans-serif;font-size:13px;padding:40px;white-space:pre-wrap;line-height:1.5}</style></head><body>${conteudo.replace(/</g, "&lt;")}</body></html>`);
      w.document.close();
      w.print();
    }

    let termoD4SignId: string | null = null;
    async function enviarD4Sign(termoId: string) {
      termoD4SignId = termoId;
      const sel = document.getElementById("d4CofreSel") as HTMLSelectElement;
      const msg = document.getElementById("d4Msg")!;
      msg.innerHTML = ""; sel.innerHTML = '<option>Carregando cofres...</option>'; sel.disabled = true;
      abrirModal("modalD4Sign");
      try {
        const res = await fetch("/api/admin/d4sign/cofres");
        const d = await res.json();
        if (!res.ok) { msg.innerHTML = `<div class="alert alert-error">${d.error || "Erro ao listar cofres. Verifique se o token da D4Sign foi configurado em produção."}</div>`; sel.innerHTML = ""; return; }
        sel.innerHTML = (d || []).map((c: any) => `<option value="${c.uuid}">${c.nome}</option>`).join("");
        sel.disabled = false;
        // lembra o último cofre escolhido
        const ultimo = localStorage.getItem("d4_cofre_ultimo");
        if (ultimo && (d || []).some((c: any) => c.uuid === ultimo)) sel.value = ultimo;
      } catch {
        msg.innerHTML = '<div class="alert alert-error">Erro de conexão com a D4Sign.</div>'; sel.innerHTML = "";
      }
    }
    async function confirmarD4Sign() {
      if (!termoD4SignId) return;
      const sel = document.getElementById("d4CofreSel") as HTMLSelectElement;
      const cofre = sel.value;
      if (!cofre) { alert("Selecione um cofre."); return; }
      localStorage.setItem("d4_cofre_ultimo", cofre);
      const btn = document.getElementById("btnD4Confirmar") as HTMLButtonElement;
      btn.disabled = true; btn.textContent = "Enviando...";
      try {
        const res = await fetch(`/api/admin/termos/${termoD4SignId}/enviar-d4sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cofre_uuid: cofre }) });
        const d = await res.json();
        if (res.ok) { alert("Termo enviado para assinatura! O colaborador vai receber por e-mail."); reloadKeepScroll(); }
        else document.getElementById("d4Msg")!.innerHTML = `<div class="alert alert-error">${d.error || "Erro ao enviar para a D4Sign"}</div>`;
      } finally { btn.disabled = false; btn.textContent = "Enviar para assinatura"; }
    }
    (window as any).confirmarD4Sign = confirmarD4Sign;

    // planos de preventiva
    document.getElementById("formPlano")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const body = Object.fromEntries(new FormData(f).entries());
      const btn = f.querySelector("button[type=submit]") as HTMLButtonElement;
      const txt = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Criando..."; }
      try {
        const res = await fetch(`/api/admin/ativos/${ativoId}/planos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (res.ok) reloadKeepScroll();
        else alert((await res.json()).error || "Erro ao criar plano");
      } finally {
        if (btn) { btn.disabled = false; if (txt) btn.textContent = txt; }
      }
    });
    async function executarPlano(id: string) {
      if (!confirm("Registrar que esta manutenção preventiva foi executada hoje? A próxima será reprogramada automaticamente.")) return;
      const res = await fetch(`/api/admin/ativos/${ativoId}/planos`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, acao: "executar" }) });
      if (res.ok) reloadKeepScroll(); else alert((await res.json()).error || "Erro");
    }
    async function desativarPlano(id: string) {
      if (!confirm("Desativar este plano de manutenção?")) return;
      const res = await fetch(`/api/admin/ativos/${ativoId}/planos`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, acao: "desativar" }) });
      if (res.ok) reloadKeepScroll(); else alert((await res.json()).error || "Erro");
    }

    // fotos do ativo
    function enviarFoto() {
      const picker = document.createElement("input");
      picker.type = "file"; picker.accept = "image/*";
      picker.onchange = async () => {
        const file = picker.files && picker.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { alert("Imagem muito grande (máx. 10MB)."); return; }
        const btn = document.getElementById("btnAddFoto") as HTMLButtonElement | null;
        const txt = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
        try {
          const imagem_base64 = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.readAsDataURL(file);
          });
          const res = await fetch(`/api/admin/ativos/${ativoId}/fotos`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ imagem_base64, content_type: file.type }),
          });
          if (res.ok) reloadKeepScroll();
          else alert((await res.json().catch(() => ({}))).error || "Erro ao enviar foto");
        } finally {
          if (btn) { btn.disabled = false; if (txt) btn.textContent = txt; }
        }
      };
      picker.click();
    }
    async function removerFoto(url: string) {
      if (!confirm("Remover esta foto?")) return;
      const res = await fetch(`/api/admin/ativos/${ativoId}/fotos?url=${encodeURIComponent(url)}`, { method: "DELETE", headers: { "content-type": "application/json" } });
      if (res.ok) reloadKeepScroll(); else alert("Erro ao remover foto");
    }

    // nota fiscal (cofre privado)
    function anexarNf() {
      const picker = document.createElement("input");
      picker.type = "file"; picker.accept = "application/pdf,image/*";
      picker.onchange = async () => {
        const file = picker.files && picker.files[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { alert("Arquivo muito grande (máx. 15MB)."); return; }
        const btn = document.getElementById("btnNf") as HTMLButtonElement | null;
        const txt = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
        try {
          const arquivo_base64 = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.readAsDataURL(file);
          });
          const res = await fetch(`/api/admin/ativos/${ativoId}/nota-fiscal`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ arquivo_base64, content_type: file.type }),
          });
          if (res.ok) reloadKeepScroll();
          else alert((await res.json().catch(() => ({}))).error || "Erro ao anexar a NF");
        } finally { if (btn) { btn.disabled = false; if (txt) btn.textContent = txt; } }
      };
      picker.click();
    }
    async function removerNf() {
      if (!confirm("Remover a nota fiscal do cofre? Esta ação não pode ser desfeita.")) return;
      const res = await fetch(`/api/admin/ativos/${ativoId}/nota-fiscal`, { method: "DELETE", headers: { "content-type": "application/json" } });
      if (res.ok) reloadKeepScroll(); else alert("Erro ao remover a NF");
    }
    (window as any).anexarNf = anexarNf;
    (window as any).removerNf = removerNf;

    // busca na lista de obras (lista extensa)
    function filtrarObras() {
      const termo = (document.getElementById("obraSearch") as HTMLInputElement).value.toLowerCase().trim();
      const sel = document.getElementById("obraSelect") as HTMLSelectElement;
      Array.from(sel.options).forEach((o) => {
        if (!o.value || o.value.startsWith("__")) { o.hidden = false; return; }
        o.hidden = !!termo && !o.text.toLowerCase().includes(termo);
      });
    }
    // popula o dropdown SÓ com obras EM ANDAMENTO (ao vivo da Vobi; o histórico do
    // equipamento guarda todas as obras por onde passou — ver ativos_movimentos).
    async function carregarObrasAndamento() {
      const sel = document.getElementById("obraSelect") as HTMLSelectElement;
      if (!sel) return;
      const outra = '<option value="__outra__">Outra (digitar nome)…</option>';
      const esc = (s: any) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      try {
        const r = await fetch("/api/admin/ativos/obras-andamento");
        const d = await r.json();
        const obras = (d && d.obras) || [];
        if (!obras.length) { sel.innerHTML = '<option value="">Nenhuma obra em andamento no momento</option>' + outra; return; }
        const opts = ['<option value="">Selecione a obra…</option>'];
        for (const o of obras) {
          const rotulo = o.nome + (o.cliente ? " — " + o.cliente : "") + (o.cidade ? " (" + o.cidade + ")" : "");
          opts.push(`<option value="${o.obra_id || ("v-" + (o.vobi_id || ""))}" data-obraid="${o.obra_id || ""}" data-nome="${esc(o.nome)}">${esc(rotulo)}</option>`);
        }
        opts.push(outra);
        sel.innerHTML = opts.join("");
      } catch {
        sel.innerHTML = '<option value="">Não foi possível carregar — use "Outra (digitar nome)"</option>' + outra;
      }
    }
    // mostra o campo "valor da venda" só quando o status escolhido for Vendido
    function toggleValorVenda() {
      const sel = document.querySelector("#modalStatus select[name='novo_status']") as HTMLSelectElement;
      const grp = document.getElementById("grpValorVenda") as HTMLElement;
      if (grp) grp.style.display = sel && sel.value === "vendido" ? "" : "none";
    }
    (window as any).filtrarObras = filtrarObras;
    (window as any).toggleValorVenda = toggleValorVenda;
    carregarObrasAndamento();

    (window as any).fecharModais = fecharModais;
    (window as any).abrirModal = abrirModal;
    (window as any).verTermo = verTermo;
    (window as any).imprimirTermo = imprimirTermo;
    (window as any).enviarD4Sign = enviarD4Sign;
    (window as any).executarPlano = executarPlano;
    (window as any).desativarPlano = desativarPlano;
    (window as any).enviarFoto = enviarFoto;
    (window as any).removerFoto = removerFoto;
    (window as any).__ativosReady = true;
