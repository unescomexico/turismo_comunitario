# Guía Nacional de Experiencias Turísticas Comunitarias

Plataforma web interactiva para consultar experiencias turísticas comunitarias en México.

## Estructura de despliegue

- `index.html`: interfaz en español.
- `index_en.html`: interfaz en inglés.
- `main.js` / `main_en.js`: lógica de la aplicación.
- `styles.css`: estilos.
- `data/data.csv` / `data/data_en.csv`: experiencias.
- `data/servicios_contexto.geojson`: servicios DENUE seleccionados para el mapa.
- `data/servicios_contexto_por_experiencia.json`: servicios cercanos por experiencia.
- `data/infraestructura_transporte.geojson`: infraestructura de conectividad.
- `data/infraestructura_por_experiencia.json`: relación de infraestructura por experiencia.
- `imagenes/`: fotografías de experiencias disponibles.
- `img/`: recursos de interfaz y logotipos.

Las antiguas rutas regionales se conservan únicamente como dato histórico en el CSV cuando existe, pero **no se utilizan como filtro ni se muestran en la interfaz nacional**.
