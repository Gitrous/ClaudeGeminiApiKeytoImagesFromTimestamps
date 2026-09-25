# Timestamps → Imágenes (Gemini)

Web estática que genera **una imagen por cada timestamp** de tu guion usando **tu propia API key de Gemini**, manteniendo siempre los **personajes fijos de tu canal**.

## Cómo usarla

1. Abre `index.html` en el navegador (o publícala con GitHub Pages; no necesita servidor).
2. Pega tu API key de Gemini ([Google AI Studio](https://aistudio.google.com/apikey)).
3. Define el estilo visual del canal y sus personajes:
   - **Nombre** y **alias**: se usan para detectar en qué escenas aparece cada personaje.
   - **Siempre en escena**: el protagonista aparece en todas las imágenes.
   - **Descripción visual**: se inyecta en cada prompt para mantener la consistencia.
   - **Imágenes de referencia** (hasta 3 por personaje): se envían al modelo `gemini-*-image` para que el personaje salga igual en todas las imágenes.
4. Pega el guion y pulsa **Generar imágenes**. Luego descarga cada imagen o todas en un `.zip` (con un `manifest.json` que tiene timestamp, texto y prompt de cada escena).

Con **Exportar/Importar configuración** guardas el canal (estilo + personajes + referencias) en un JSON reutilizable.

## Formatos de timestamp soportados

```
00:05 texto
1:02:03 texto
[00:05] texto
0:00 - 0:05 texto
00:00:01,000 --> 00:00:04,000   (subtítulos SRT)
...y timestamps en medio de un párrafo
```

Las líneas sin timestamp se añaden a la escena anterior.

## Modelos

- Imagen: por defecto `gemini-2.5-flash-image` (admite referencias). También `imagen-4.0-*` (solo texto).
- Texto (opcional, convierte cada escena en un prompt visual detallado): `gemini-2.5-flash`.
- El botón **Cargar modelos disponibles** lista los modelos a los que tiene acceso tu key.

## Privacidad

Todo corre en tu navegador. La key solo se envía a `generativelanguage.googleapis.com` y solo se guarda en `localStorage` si marcas "Recordar".
