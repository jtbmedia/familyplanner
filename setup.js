/**
 * Modul: Setup-Script
 * Zweck: Erstmalige Einrichtung - ersten Admin-User anlegen.
 *        Wird einmalig nach dem ersten Start ausgeführt: `node setup.js`
 * Abhängigkeiten: server/db.js, bcrypt, dotenv
 */

import readline from 'node:readline';
import bcrypt from 'bcrypt';
import * as db from './server/db.js';
import os from 'node:os';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let password = '';
    process.stdin.on('data', function handler(char) {
      char = char.toString();
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n=== Oikos Setup ===\n');

  // Prüfen ob bereits Admin vorhanden
  const existingAdmin = db.get()
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();

  if (existingAdmin) {
    console.log('ℹ  Es existiert bereits ein Admin-Account.\n');
    const proceed = await prompt('Trotzdem einen weiteren Admin anlegen? (j/N): ');
    if (proceed.toLowerCase() !== 'j') {
      console.log('Setup abgebrochen.');
      rl.close();
      process.exit(0);
    }
  }

  console.log('Admin-Account anlegen:\n');

  const username = (await prompt('Benutzername: ')).trim();
  if (!username || username.length < 3) {
    console.error('Fehler: Benutzername muss mindestens 3 Zeichen lang sein.');
    process.exit(1);
  }

  const displayName = (await prompt('Anzeigename (z.B. "Max Mustermann"): ')).trim();
  if (!displayName) {
    console.error('Fehler: Anzeigename darf nicht leer sein.');
    process.exit(1);
  }

  const password = await promptPassword('Passwort: ');
  if (password.length < 8) {
    console.error('Fehler: Passwort muss mindestens 8 Zeichen lang sein.');
    process.exit(1);
  }

  const passwordConfirm = await promptPassword('Passwort bestätigen: ');
  if (password !== passwordConfirm) {
    console.error('Fehler: Passwörter stimmen nicht überein.');
    process.exit(1);
  }

  const avatarColors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FF2D55'];
  const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

  console.log('\nAccount wird erstellt …');

  const hash = await bcrypt.hash(password, 12);

  try {
    const result = db.get()
      .prepare(`
        INSERT INTO users (username, display_name, password_hash, avatar_color, role)
        VALUES (?, ?, ?, ?, 'admin')
      `)
      .run(username, displayName, hash, avatarColor);

    const port = process.env.PORT || 3000;
    const host = getLocalIP();

    console.log(`\n✅ Admin-Account erfolgreich erstellt!`);
    console.log(`${'─'.repeat(40)}`);
    console.log(`  Benutzername: ${username}`);
    console.log(`  Anzeigename:  ${displayName}`);
    console.log(`  Rolle:        Admin`);
    console.log(`${'─'.repeat(40)}`);
    console.log(`\n🌐 Oikos ist erreichbar unter:\n`);
    console.log(`   Lokal:     http://localhost:${port}`);
    if (host) {
      console.log(`   Netzwerk:  http://${host}:${port}`);
    }
    console.log(`\n   Melde dich mit deinem neuen Account an. Viel Spaß!\n`);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      console.error(`\nFehler: Benutzername "${username}" ist bereits vergeben.`);
    } else {
      console.error('\nFehler beim Erstellen:', err.message);
    }
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unerwarteter Fehler:', err.message);
  process.exit(1);
});
