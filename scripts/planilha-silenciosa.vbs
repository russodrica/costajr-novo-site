' Roda a ponte da PLANILHA FINANCEIRA sem abrir janela preta na tela.
' Chamado pela tarefa agendada do Windows "CJR - Planilha Financeira" a cada minuto.
' Sem pedido no portal/Telegram, a passada termina em menos de 1 segundo e nao escreve nada.
Set fso = CreateObject("Scripting.FileSystemObject")
raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = raiz
sh.Run "cmd /c node scripts\planilha-ponte.mjs >> ""_ponte-planilha.log"" 2>&1", 0, False
