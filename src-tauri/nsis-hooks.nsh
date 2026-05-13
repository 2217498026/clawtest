; ========================================
; ClawPanel NSIS Installer Hooks
; ========================================

!macro NSIS_HOOK_PREINSTALL
    DetailPrint "=== ClawPanel 安装程序 ==="
!macroend

!macro NSIS_HOOK_POSTINSTALL
    DetailPrint "=== ClawPanel 安装完成 ==="
    DetailPrint "首次启动应用时会自动检测并安装 Node.js 和 OpenClaw CLI"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
    DetailPrint "=== ClawPanel 卸载 ==="
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
    DetailPrint "=== ClawPanel 卸载完成 ==="
    DetailPrint "感谢使用 ClawPanel！"
!macroend
