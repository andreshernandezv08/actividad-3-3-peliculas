'use strict';

const $ = (id) => document.getElementById(id);
let peliculas = [];
let idEditando = null;
let idDetalle = null;
let mensajeTimer = null;

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function api(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      ...opciones,
      headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) }
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión.');
  }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.error || `Error del servidor (${respuesta.status}).`);
  }
  if (respuesta.status === 204) return null;
  return respuesta.json();
}

function mensaje(texto, esError = false) {
  const elemento = $('message');
  elemento.textContent = texto;
  elemento.className = esError ? 'message error' : 'message';
  clearTimeout(mensajeTimer);
  mensajeTimer = setTimeout(() => { elemento.textContent = ''; }, 5500);
}

function etiquetaEstado(estado) {
  const clase = ['Pendiente', 'Vista', 'Favorita'].includes(estado) ? estado : 'Pendiente';
  return `<span class="status status-${clase}">${escapar(estado)}</span>`;
}

function renderizar() {
  const texto = $('searchInput').value.trim().toLocaleLowerCase('es');
  const estado = $('stateFilter').value;
  const filtradas = peliculas.filter((p) =>
    (!estado || p.estado === estado) &&
    (!texto || `${p.titulo} ${p.director} ${p.genero}`.toLocaleLowerCase('es').includes(texto))
  );
  $('totalCount').textContent = peliculas.length;
  $('seenCount').textContent = peliculas.filter((p) => p.estado === 'Vista' || p.estado === 'Favorita').length;
  $('favoriteCount').textContent = peliculas.filter((p) => p.estado === 'Favorita').length;
  $('collectionCount').textContent = filtradas.length;
  $('recordSummary').textContent = `${filtradas.length} de ${peliculas.length} registros mostrados`;

  if (filtradas.length === 0) {
    $('movieRows').innerHTML = '<tr><td colspan="5" class="empty-cell">No hay películas que coincidan. Usa «Agregar película» para crear una.</td></tr>';
    return;
  }
  $('movieRows').innerHTML = filtradas.map((p) => `
    <tr>
      <td class="title-cell"><div class="movie-entry"><span class="movie-poster" aria-hidden="true">${escapar(p.titulo.charAt(0).toUpperCase())}</span><div><strong>${escapar(p.titulo)}</strong><small>${escapar(p.director)}</small></div></div></td>
      <td><span class="genre">${escapar(p.genero)}</span></td>
      <td>${escapar(p.anio)}</td>
      <td>${etiquetaEstado(p.estado)}</td>
      <td><div class="actions"><button type="button" class="action-button" data-action="ver" data-id="${p.id}" aria-label="Ver ${escapar(p.titulo)}">Ver</button><button type="button" class="action-button" data-action="editar" data-id="${p.id}" aria-label="Editar ${escapar(p.titulo)}">Editar</button><button type="button" class="action-button delete" data-action="eliminar" data-id="${p.id}" aria-label="Eliminar ${escapar(p.titulo)}">Eliminar</button></div></td>
    </tr>`).join('');
}

async function cargarPeliculas() {
  peliculas = await api('/api/peliculas');
  renderizar();
}

function abrirNuevo() {
  idEditando = null;
  $('movieForm').reset();
  $('formError').textContent = '';
  $('modalTitle').textContent = 'Nueva película';
  $('saveMovieButton').textContent = 'Guardar película';
  $('movieDialog').showModal();
  $('fieldTitulo').focus();
}

function abrirEdicion(p) {
  idEditando = p.id;
  $('formError').textContent = '';
  $('modalTitle').textContent = 'Editar película';
  $('saveMovieButton').textContent = 'Guardar cambios';
  for (const nombre of ['titulo', 'director', 'genero', 'anio', 'estado']) {
    $('movieForm').elements.namedItem(nombre).value = p[nombre];
  }
  $('movieDialog').showModal();
  $('fieldTitulo').focus();
}

async function verDetalle(id) {
  const pelicula = await api(`/api/peliculas/${id}`); // Consulta INDIVIDUAL a PostgreSQL.
  idDetalle = pelicula.id;
  $('detailTitle').textContent = pelicula.titulo;
  const campos = [
    ['ID del registro', pelicula.id],
    ['Título', pelicula.titulo],
    ['Director', pelicula.director],
    ['Género', pelicula.genero],
    ['Año de estreno', pelicula.anio],
    ['Estado', pelicula.estado],
  ];
  $('detailsList').innerHTML = campos.map(([nombre, valor]) => `<div><dt>${escapar(nombre)}</dt><dd>${escapar(valor)}</dd></div>`).join('');
  $('detailDialog').showModal();
}

async function guardarPelicula(evento) {
  evento.preventDefault();
  const formulario = $('movieForm');
  if (!formulario.reportValidity()) return;
  const datos = Object.fromEntries(new FormData(formulario).entries());
  datos.anio = Number(datos.anio);
  const boton = $('saveMovieButton');
  boton.disabled = true;
  $('formError').textContent = '';
  try {
    const editando = idEditando !== null;
    await api(editando ? `/api/peliculas/${idEditando}` : '/api/peliculas', {
      method: editando ? 'PUT' : 'POST', body: JSON.stringify(datos)
    });
    $('movieDialog').close();
    await cargarPeliculas();
    mensaje(editando ? 'Película actualizada correctamente.' : 'Película agregada correctamente.');
  } catch (error) {
    $('formError').textContent = error.message;
  } finally {
    boton.disabled = false;
  }
}

async function eliminarPelicula(p) {
  if (!confirm(`¿Seguro que quieres eliminar «${p.titulo}»? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/peliculas/${p.id}`, { method: 'DELETE' });
    await cargarPeliculas();
    mensaje('Película eliminada correctamente.');
  } catch (error) {
    mensaje(error.message, true);
  }
}

$('addButton').addEventListener('click', abrirNuevo);
$('closeFormButton').addEventListener('click', () => $('movieDialog').close());
$('cancelFormButton').addEventListener('click', () => $('movieDialog').close());
$('movieForm').addEventListener('submit', guardarPelicula);
$('searchInput').addEventListener('input', renderizar);
$('stateFilter').addEventListener('change', renderizar);
$('movieRows').addEventListener('click', async (evento) => {
  const boton = evento.target.closest('button[data-action]');
  if (!boton) return;
  const p = peliculas.find((item) => item.id === Number(boton.dataset.id));
  if (!p) return;
  try {
    if (boton.dataset.action === 'ver') await verDetalle(p.id);
    if (boton.dataset.action === 'editar') abrirEdicion(p);
    if (boton.dataset.action === 'eliminar') await eliminarPelicula(p);
  } catch (error) { mensaje(error.message, true); }
});
$('closeDetailButton').addEventListener('click', () => $('detailDialog').close());
$('detailCloseButton').addEventListener('click', () => $('detailDialog').close());
$('detailEditButton').addEventListener('click', async () => {
  const pelicula = await api(`/api/peliculas/${idDetalle}`).catch((err) => { mensaje(err.message, true); return null; });
  if (!pelicula) return;
  $('detailDialog').close();
  abrirEdicion(pelicula);
});

cargarPeliculas().catch((error) => {
  $('movieRows').innerHTML = '<tr><td colspan="5" class="empty-cell">No se pudo cargar la colección. Comprueba la conexión a la base de datos.</td></tr>';
  mensaje(error.message, true);
});
