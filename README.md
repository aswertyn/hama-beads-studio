# Hama Beads Studio v0.2.0

Prototipo React + TypeScript + Vite para convertir imágenes en patrones de 20 × 20, 30 × 30 o 40 × 40 cuentas.

## Requisitos
Node.js 20.19+ o 22.12+ y npm.

## Ejecutar
```bash
npm install
npm run dev
```
Abrir la dirección local que muestre Vite.

## Compilar
```bash
npm run build
npm run preview
```

## Funciones
- Carga de PNG, JPG y WebP, incluso arrastrando archivos.
- Conversión automática a paleta genérica de 26 colores.
- Modo equilibrado y contornos negros activados inicialmente.
- Edición manual: seleccionar color y pintar; usar × para borrar.
- Vista de cuentas circulares o píxeles, cuadrícula opcional.
- Conteo por color y exportación CSV.
- Descarga del patrón en PNG.

## Limitaciones
- La paleta es genérica, no reproduce todavía los códigos Babeefly.
- Los bordes se detectan con una heurística sencilla y pueden requerir correcciones manuales.
- La base debe tener suficientes clavijas para el tamaño de cuadrícula seleccionado.
- La imagen se procesa localmente; no se envía a un servidor.
