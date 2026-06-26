!macro customInstall
  ; Refrescar caché de iconos de Windows tras instalar/actualizar
  System::Call 'Shell32::SHChangeNotify(l, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
