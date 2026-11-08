'use strict';

const express = require('express');
const { Pool } = require('pg');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL. Configura la conexion a PostgreSQL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SELECT_FIELDS = 'id, titulo, director, genero, anio, estado, created_at';
const ESTADOS = new Set(['Pendiente', 'Vista', 'Favorita']);
const MAX_YEAR = new Date().getFullYear() + 5;

function validarPelicula(data) {
  const errores = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errores: ['Envía un objeto JSON válido.'] };
  }
  const campos = {};
  for (const campo of ['titulo', 'director', 'genero']) {
    if (typeof data[campo] !== 'string') {
      errores.push(`${campo}: debe ser texto.`);
      continue;
    }
    const valor = data[campo].trim();
    if (!valor || valor.length > 120) {
      errores.push(`${campo}: entre 1 y 120 caracteres.`);
    } else {
      campos[campo] = valor;
    }
  }
  const anio = Number(data.anio);
  if (!Number.isInteger(anio) || anio < 1888 || anio > MAX_YEAR) {
    errores.push(`anio: indica un año entre 1888 y ${MAX_YEAR}.`);
  } else {
    campos.anio = anio;
  }
  if (!ESTADOS.has(data.estado)) {
    errores.push('estado: debe ser Pendiente, Vista o Favorita.');
  } else {
    campos.estado = data.estado;
  }
  return { errores, campos };
}

function validarId(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID de película inválido.' });
  }
  req.peliculaId = id;
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, database: 'connected' });
}));

// 1. Consultar TODOS los registros.
app.get('/api/peliculas', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${SELECT_FIELDS} FROM peliculas ORDER BY id DESC`);
  res.json(rows);
}));

// 2. Consultar UN registro por su ID.
app.get('/api/peliculas/:id', validarId, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${SELECT_FIELDS} FROM peliculas WHERE id = $1`, [req.peliculaId]);
  if (!rows.length) return res.status(404).json({ error: 'Película no encontrada.' });
  res.json(rows[0]);
}));

// 3. Agregar un registro.
app.post('/api/peliculas', asyncRoute(async (req, res) => {
  const { errores, campos } = validarPelicula(req.body);
  if (errores.length) return res.status(400).json({ error: errores.join(' ') });
  const { rows } = await pool.query(
    `INSERT INTO peliculas (titulo, director, genero, anio, estado)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${SELECT_FIELDS}`,
    [campos.titulo, campos.director, campos.genero, campos.anio, campos.estado]
  );
  res.status(201).json(rows[0]);
}));

// 4. Editar un registro.
app.put('/api/peliculas/:id', validarId, asyncRoute(async (req, res) => {
  const { errores, campos } = validarPelicula(req.body);
  if (errores.length) return res.status(400).json({ error: errores.join(' ') });
  const { rows } = await pool.query(
    `UPDATE peliculas
     SET titulo = $1, director = $2, genero = $3, anio = $4, estado = $5
     WHERE id = $6 RETURNING ${SELECT_FIELDS}`,
    [campos.titulo, campos.director, campos.genero, campos.anio, campos.estado, req.peliculaId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Película no encontrada.' });
  res.json(rows[0]);
}));

// 5. Eliminar un registro.
app.delete('/api/peliculas/:id', validarId, asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM peliculas WHERE id = $1', [req.peliculaId]);
  if (!rowCount) return res.status(404).json({ error: 'Película no encontrada.' });
  res.status(204).end();
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((err, req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: 'Ocurrió un error con el servidor o la base de datos.' });
});

async function iniciarBD() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS peliculas (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(120) NOT NULL,
        director VARCHAR(120) NOT NULL,
        genero VARCHAR(120) NOT NULL,
        anio INTEGER NOT NULL CHECK (anio BETWEEN 1888 AND 2100),
        estado VARCHAR(12) NOT NULL DEFAULT 'Pendiente'
          CHECK (estado IN ('Pendiente', 'Vista', 'Favorita')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracion (
        clave VARCHAR(50) PRIMARY KEY,
        valor TEXT NOT NULL
      )
    `);
    // Carga inicial UNA sola vez, aunque después se eliminen todas las películas.
    const { rows } = await client.query("SELECT valor FROM configuracion WHERE clave = 'datos_iniciales'");
    if (rows.length === 0) {
      await client.query(`
        INSERT INTO peliculas (titulo, director, genero, anio, estado) VALUES
        ('Interstellar', 'Christopher Nolan', 'Ciencia ficción', 2014, 'Favorita'),
        ('Coco', 'Lee Unkrich', 'Animación', 2017, 'Vista'),
        ('Jurassic Park', 'Steven Spielberg', 'Aventura', 1993, 'Vista'),
        ('El viaje de Chihiro', 'Hayao Miyazaki', 'Fantasía', 2001, 'Pendiente')
      `);
      await client.query("INSERT INTO configuracion (clave, valor) VALUES ('datos_iniciales', 'si')");
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await iniciarBD();
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Catálogo disponible en http://localhost:${PORT}`);
    });
    process.on('SIGTERM', () => {
      server.close(() => pool.end().then(() => process.exit(0)));
    });
  } catch (error) {
    console.error('No se pudo iniciar la aplicación:', error.message);
    await pool.end();
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { app, validarPelicula, iniciarBD };
