/**
 * Modul: Upload Middleware
 * Zweck: Multer configuratie voor recept-foto uploads
 * Afhankelijkheden: multer, node:fs, node:path
 */

import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads/recipes';

// Zorg dat de map bestaat (ook als Docker volume leeg is).
// Geen crash bij EACCES — foto-upload werkt dan niet, maar de server start wel op.
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  if (err.code !== 'EEXIST') {
    console.warn(`[upload] Kon uploadmap niet aanmaken: ${UPLOAD_DIR} — ${err.message}`);
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, _file, cb) => {
    const ext = path.extname(_file.originalname).toLowerCase() || '.jpg';
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Alleen JPEG, PNG of WebP toegestaan.'));
  }
}

export const uploadRecipePhoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('photo');
