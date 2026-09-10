// server.js - Ruteros Ñuble

const express = require('express');
const path = require('path');
const { createClient } = require('@libsql/client');

const PORT = process.env.PORT || 3000;

// Contraseña para poder borrar rutas desde el botón de engranaje (⚙) de unirse.html
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ruteros2024';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Base de datos ---------
// ---------- Base de datos ---------
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:ruteros.db',
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Inicialización de la base de datos
async function initDb() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rutas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_piloto TEXT NOT NULL,
        nombre_ruta TEXT NOT NULL,
        inicio TEXT NOT NULL,
        paradas TEXT NOT NULL DEFAULT '[]',
        destino TEXT NOT NULL,
        comentarios TEXT,
        fecha TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS asistentes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        moto TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);
    console.log('[BD] Tablas verificadas correctamente en Turso.');
    
    // Ejecutar la primera limpieza RECIÉN DESPUÉS de asegurar la existencia de las tablas
    await limpiarRutasVencidas();
  } catch (err) {
    console.error('[BD] Error inicializando tablas:', err);
  }
}

// ---------- Limpieza automática de rutas vencidas ----------
async function limpiarRutasVencidas() {
  try {
    const info = await db.execute(`DELETE FROM rutas WHERE date(fecha) < date('now','localtime')`);
    if (info.rowsAffected > 0) {
      console.log(`[limpieza] ${info.rowsAffected} ruta(s) vencida(s) eliminada(s).`);
    }
  } catch (err) {
    console.error('[limpieza] Error al limpiar rutas:', err);
  }
}

// Iniciar base de datos
initDb();
setInterval(limpiarRutasVencidas, 60 * 60 * 1000); // cada 1 hora

// ---------- Limpieza automática de rutas vencidas ----------
async function limpiarRutasVencidas() {
  try {
    const info = await db.execute(`DELETE FROM rutas WHERE date(fecha) < date('now','localtime')`);
    if (info.rowsAffected > 0) {
      console.log(`[limpieza] ${info.rowsAffected} ruta(s) vencida(s) eliminada(s).`);
    }
  } catch (err) {
    console.error('[limpieza] Error al limpiar rutas:', err);
  }
}

limpiarRutasVencidas();
setInterval(limpiarRutasVencidas, 60 * 60 * 1000); // cada 1 hora

// ---------- Helpers ----------
async function serializarRuta(row) {
  const astResult = await db.execute({
    sql: 'SELECT id, nombre, moto FROM asistentes WHERE ruta_id = ? ORDER BY id',
    args: [row.id]
  });

  return {
    id: Number(row.id),
    nombre_piloto: row.nombre_piloto,
    nombre_ruta: row.nombre_ruta,
    inicio: row.inicio,
    paradas: JSON.parse(row.paradas || '[]'),
    destino: row.destino,
    comentarios: row.comentarios,
    fecha: row.fecha,
    created_at: row.created_at,
    asistentes: astResult.rows.map(a => ({
      id: Number(a.id),
      nombre: a.nombre,
      moto: a.moto
    }))
  };
}

function requiereAdmin(req, res, next) {
  const pass = req.get('x-admin-password');
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  next();
}

// ---------- API ----------

// Listar rutas vigentes (fecha hoy o futura)
app.get('/api/rutas', async (req, res) => {
  try {
    await limpiarRutasVencidas();
    const result = await db.execute(`
      SELECT * FROM rutas
      WHERE date(fecha) >= date('now','localtime')
      ORDER BY date(fecha) ASC, created_at ASC
    `);

    const rutasFormateadas = await Promise.all(result.rows.map(row => serializarRuta(row)));
    res.json(rutasFormateadas);
  } catch (err) {
    console.error('Error al obtener rutas:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Crear ruta
app.post('/api/rutas', async (req, res) => {
  try {
    const { nombre_piloto, nombre_ruta, inicio, paradas, destino, comentarios, fecha } = req.body || {};

    if (!nombre_piloto || !nombre_ruta || !inicio || !destino || !fecha) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (nombre, ruta, inicio, destino, fecha).' });
    }

    const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!fechaRegex.test(fecha)) {
      return res.status(400).json({ error: 'Fecha inválida.' });
    }

    const paradasArray = Array.isArray(paradas) ? paradas.filter(p => typeof p === 'string' && p.trim() !== '') : [];

    const info = await db.execute({
      sql: `INSERT INTO rutas (nombre_piloto, nombre_ruta, inicio, paradas, destino, comentarios, fecha)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        String(nombre_piloto).trim(),
        String(nombre_ruta).trim(),
        String(inicio).trim(),
        JSON.stringify(paradasArray),
        String(destino).trim(),
        comentarios ? String(comentarios).trim() : '',
        fecha
      ]
    });

    const newRowResult = await db.execute({
      sql: 'SELECT * FROM rutas WHERE id = ?',
      args: [info.lastInsertRowid]
    });

    const rutaCreada = await serializarRuta(newRowResult.rows[0]);
    res.status(201).json(rutaCreada);
  } catch (err) {
    console.error('Error al crear ruta:', err);
    res.status(500).json({ error: 'Error al guardar la ruta.' });
  }
});

// Eliminar ruta (requiere contraseña de administrador)
app.delete('/api/rutas/:id', requiereAdmin, async (req, res) => {
  try {
    const info = await db.execute({
      sql: 'DELETE FROM rutas WHERE id = ?',
      args: [req.params.id]
    });

    if (info.rowsAffected === 0) {
      return res.status(404).json({ error: 'Ruta no encontrada.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar ruta:', err);
    res.status(500).json({ error: 'Error al eliminar la ruta.' });
  }
});

// Unirse a una ruta
app.post('/api/rutas/:id/asistentes', async (req, res) => {
  try {
    const rutaResult = await db.execute({
      sql: 'SELECT id FROM rutas WHERE id = ?',
      args: [req.params.id]
    });

    if (rutaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ruta no encontrada.' });
    }

    const { nombre, moto } = req.body || {};
    if (!nombre || !moto) {
      return res.status(400).json({ error: 'Faltan nombre y/o modelo de moto.' });
    }

    const info = await db.execute({
      sql: 'INSERT INTO asistentes (ruta_id, nombre, moto) VALUES (?, ?, ?)',
      args: [req.params.id, String(nombre).trim(), String(moto).trim()]
    });

    res.status(201).json({ id: Number(info.lastInsertRowid), nombre, moto });
  } catch (err) {
    console.error('Error al agregar asistente:', err);
    res.status(500).json({ error: 'Error al registrar la asistencia.' });
  }
});

app.listen(PORT, () => {
  console.log(`Ruteros Ñuble escuchando en http://localhost:${PORT}`);
});