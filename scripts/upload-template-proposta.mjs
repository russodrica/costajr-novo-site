// Script de UMA VEZ (e sempre que o modelo de proposta mudar): sobe o arquivo
// .pptx que serve de MODELO para o gerador de propostas do bot de Processos
// (área Comercial) pro Supabase Storage, no bucket "comercial".
//
// Uso:
//   node --env-file=.env scripts/upload-template-proposta.mjs "caminho/do/modelo.pptx"
//
// (se seu Node for mais antigo e não tiver --env-file, rode com as variáveis
// PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já exportadas no terminal)
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "comercial";
const DESTINO = "templates/proposta-comercial-base.pptx";

async function main() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error("Uso: node --env-file=.env scripts/upload-template-proposta.mjs \"caminho/do/modelo.pptx\"");
    process.exit(1);
  }
  const url = process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltam PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente.");
    process.exit(1);
  }
  const buf = await readFile(caminho);
  const db = createClient(url, key, { auth: { persistSession: false } });

  // garante que o bucket existe (privado — só o backend acessa)
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error: errBucket } = await db.storage.createBucket(BUCKET, { public: false });
    if (errBucket) { console.error("Falha ao criar o bucket:", errBucket.message); process.exit(1); }
    console.log(`Bucket "${BUCKET}" criado.`);
  }

  const { error } = await db.storage.from(BUCKET).upload(DESTINO, buf, {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    upsert: true,
  });
  if (error) { console.error("Falha ao subir o modelo:", error.message); process.exit(1); }
  console.log(`✅ Modelo enviado: ${BUCKET}/${DESTINO} (${buf.length} bytes).`);
  console.log("Pra atualizar o modelo depois, é só rodar este script de novo com o arquivo novo.");
}

main();
