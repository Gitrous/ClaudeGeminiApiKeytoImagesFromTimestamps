# Timestamps → Imágenes

Web estática que genera **una imagen por cada timestamp** de tu guion, manteniendo siempre los **personajes fijos de tu canal**.

- **Gemini como director (gratis):** lee el guion completo de una vez y escribe un prompt coherente para cada timestamp (mismos personajes, mismos lugares, continuidad entre escenas).
- **Motor de imágenes a elegir:** Pollinations (gratis), Hugging Face FLUX (gratis con token) o Gemini Nano Banana (requiere facturación).

## Publicarla en GitHub Pages

1. **Settings → Pages → Build and deployment → Source: Deploy from a branch.**
2. Rama `claude/jolly-pasteur-e8bk03` (o la rama donde esté la web), carpeta `/ (root)` → **Save**.
3. En 1-2 minutos estará en `https://gitrous.github.io/ClaudeGeminiApiKeytoImagesFromTimestamps/`.

GitHub Pages solo funciona en repos **públicos** con el plan gratuito (en privados requiere GitHub Pro).
La web no contiene ninguna API key: cada usuario pone la suya en su navegador.

## Cómo usarla

1. Abre `index.html` en el navegador (o publícala con GitHub Pages; no necesita servidor).
2. Elige el **motor de imágenes**:
   - **Pollinations**: gratis. Sin key, una imagen cada ~15 s; con key gratuita de [enter.pollinations.ai](https://enter.pollinations.ai), más rápido.
   - **Hugging Face**: gratis con un [token](https://huggingface.co/settings/tokens) (créditos mensuales limitados). Modelo por defecto `black-forest-labs/FLUX.1-schnell`.
   - **Gemini Nano Banana**: mejor calidad y admite imágenes de referencia, pero Google exige facturación activada (el plan gratuito tiene límite 0 para imágenes).
3. Pega tu API key de Gemini ([Google AI Studio](https://aistudio.google.com/apikey)) para que Gemini escriba los prompts leyendo todo el guion. El modelo de texto tiene cuota gratuita. Sin key, se usa el texto de cada escena tal cual.
4. Elige una **plantilla de estilo** (Cartoon, Anime, Realista, Microsoft Paint, Figuras de palitos, Animación 3D, Voxel, Pixel art, Cómic, Acuarela, Plastilina, Boceto a lápiz, Dibujo infantil, Low poly, Terror oscuro) o **Personalizado** para escribir el tuyo. Con una plantilla puedes añadir detalles extra de estilo.
   Las plantillas están en `presets.js`; añadir una nueva es añadir un objeto a la lista.
5. Define los personajes del canal:
   - **Nombre** y **alias**: se usan para detectar en qué escenas aparece cada personaje.
   - **Siempre en escena**: el protagonista aparece en todas las imágenes.
   - **Descripción visual**: se inyecta en cada prompt para mantener la consistencia.
   - **Imágenes de referencia** (hasta 3 por personaje): solo con Nano Banana: se envían al modelo `gemini-*-image` para que el personaje salga igual en todas las imágenes.
6. Pega el guion y pulsa **Generar imágenes**. Cada tarjeta muestra su prompt, que puedes **editar** y pulsar **Regenerar**. Luego descarga cada imagen o todas en un `.zip` (con un `manifest.json` que tiene timestamp, texto y prompt de cada escena).

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

- Imagen: por defecto `gemini-3.1-flash-image` (Nano Banana 2, admite referencias). También `gemini-2.5-flash-image` (Nano Banana) e `imagen-4.0-*` (solo texto).
- Generar imágenes por API requiere tener la facturación activada en la key (el plan gratuito tiene límite 0 para modelos de imagen).
- Texto (opcional, convierte cada escena en un prompt visual detallado): `gemini-2.5-flash`.
- El botón **Cargar modelos disponibles** lista los modelos a los que tiene acceso tu key.

## Privacidad

Todo corre en tu navegador. La key solo se envía a `generativelanguage.googleapis.com` y solo se guarda en `localStorage` si marcas "Recordar".
