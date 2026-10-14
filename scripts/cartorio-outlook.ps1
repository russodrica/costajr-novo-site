# Ponte do Outlook para o robo de boletos de cartorio (scripts/cartorio-boletos.mjs).
#   -modo listar : e-mails da Caixa de Entrada vindos de cartorio nos ultimos N dias,
#                  salva os PDFs em -pasta e escreve o resumo em -saida (JSON).
#   -modo mover  : move os e-mails cujos EntryID estao no arquivo -ids para a pasta
#                  -pastaOutlook (subpasta da Caixa de Entrada; criada se nao existir).
param(
  [string]$modo = "listar",
  [int]$dias = 3,
  [string]$pasta = "",
  [string]$saida = "",
  [string]$ids = "",
  [string]$pastaOutlook = "Cartórios - Protestos",
  [string]$origem = "inbox",
  [string]$remetentes = "protesto|tabeli|8tpsp\.com|10tpsp\.com|jundiai\.sp\.gov\.br"
)
$ErrorActionPreference = "Stop"
$ol = New-Object -ComObject Outlook.Application
$ns = $ol.GetNamespace("MAPI")
$inbox = $ns.GetDefaultFolder(6)

function AcharPasta {
  foreach ($f in $inbox.Folders) { if ($f.Name -eq $pastaOutlook) { return $f } }
  return $null
}
function PastaDestino {
  $f = AcharPasta
  if ($f) { return $f }
  return $inbox.Folders.Add($pastaOutlook)
}

if ($modo -eq "mover") {
  $destino = PastaDestino
  $n = 0
  foreach ($id in (Get-Content -Encoding UTF8 $ids)) {
    $id = $id.Trim(); if (-not $id) { continue }
    try {
      $m = $ns.GetItemFromID($id)
      if ($m.Parent.EntryID -ne $destino.EntryID) { [void]$m.Move($destino) }
      Write-Output ("movido: " + $id)
      $n++
    } catch { Write-Output ("falhou: " + $id.Substring(0, 12) + " " + $_.Exception.Message) }
  }
  Write-Output ("movidos: " + $n)
  exit 0
}

$limite = (Get-Date).AddDays(-$dias)
$fonte = $inbox
if ($origem -eq "arquivo") {
  $fonte = AcharPasta
  if (-not $fonte) { ConvertTo-Json -InputObject @() | Out-File -Encoding utf8 $saida; Write-Output "emails: 0"; exit 0 }
}
$items = $fonte.Items
$items.Sort("[ReceivedTime]", $true)
$res = @()
$k = 0
foreach ($m in $items) {
  if ($m.Class -ne 43) { continue }
  if ($m.ReceivedTime -lt $limite) { break }
  $de = ""
  try { $de = [string]$m.SenderEmailAddress } catch {}
  if (-not ($de -match $remetentes)) { continue }
  $k++
  $anexos = @()
  foreach ($a in $m.Attachments) {
    $nome = [string]$a.FileName
    if ($nome -notmatch '\.pdf$') { continue }
    $dir = Join-Path $pasta ("m" + $k)
    if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
    $p = Join-Path $dir $nome
    $a.SaveAsFile($p)
    $anexos += $p
  }
  $spf = ""
  try {
    $h = [string]$m.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x007D001F")
    $spf = [regex]::Match($h, '(?i)\bspf=(\w+)').Groups[1].Value
  } catch {}
  $corpo = [string]$m.Body
  if ($corpo.Length -gt 4000) { $corpo = $corpo.Substring(0, 4000) }
  $res += [pscustomobject]@{
    id = $m.EntryID; de = $de; nome = [string]$m.SenderName; assunto = [string]$m.Subject
    data = $m.ReceivedTime.ToString("yyyy-MM-ddTHH:mm:ss"); corpo = $corpo; anexos = $anexos; spf = $spf
  }
}
ConvertTo-Json -InputObject @($res) -Depth 4 | Out-File -Encoding utf8 $saida
Write-Output ("emails: " + $res.Count)
