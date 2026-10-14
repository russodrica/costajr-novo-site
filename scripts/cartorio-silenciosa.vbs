' Roda o robo de BOLETOS DE CARTORIO sem abrir janela preta na tela.
' Chamado pela tarefa agendada do Windows "CJR - Boletos de Cartorio" a cada 15 minutos.
' Sem e-mail novo de cartorio, a passada so le a Caixa de Entrada e termina.
Set fso = CreateObject("Scripting.FileSystemObject")
raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = raiz
sh.Run "cmd /c node scripts\cartorio-boletos.mjs >> ""_cartorio-boletos.log"" 2>&1", 0, False
