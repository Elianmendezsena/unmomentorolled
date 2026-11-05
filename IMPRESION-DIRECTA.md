# Imprimir el ticket directo, sin ventana de impresión

Solo funciona en el computador (Windows) con Google Chrome y la impresora térmica conectada.
(Las tablets no permiten saltarse la ventana de impresión.)

1. En Windows: Configuración → Impresoras → elige la térmica → **Establecer como predeterminada**.
2. Copia `ABRIR-CAJA-WINDOWS.bat` al escritorio y úsalo siempre para abrir la caja.
   Abre la caja como aplicación y con la opción `--kiosk-printing`, que manda el ticket a la impresora sin preguntar.
3. Cobra una venta y marca **"Imprimir el ticket solo al cobrar (en este equipo)"**. Desde ese momento el ticket sale solo.
4. Si cierras Chrome por otro lado y lo abres con el icono normal, vuelve a salir la ventana de impresión: abre siempre con el `.bat`.
5. Papel de 80 mm: en la ventana de impresión (la primera vez, abriendo con el icono normal) elige tamaño de papel de la térmica, márgenes "Ninguno" y quita "Encabezados y pies de página".
