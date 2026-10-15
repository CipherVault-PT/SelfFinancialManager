import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, importJSON, exportJSON, wipe, readUndo, restoreUndo, snapshotForUndo } from '../js/store.js';
import { backupDue, snoozeBackup, daysSinceBackup, sealBackup, sealedInfo, openBackup } from '../js/backup.js';
import { deriveKeys, randomSalt } from '../js/sync/crypto.js';
import { reset, lot, stockPos, memoryStorage } from './helpers.js';

const DAY = 86_400_000;

test('lembrete de backup: só com dados, após 3 dias sem backup ou 30 dias desde o último', () => {
  reset();
  const now = Date.now();
  state.settings.createdAt = now - 10 * DAY;
  assert.equal(backupDue(now), false, 'sem dados não lembra');

  state.positions = [stockPos()];
  state.settings.createdAt = now - DAY;
  assert.equal(backupDue(now), false, 'utilizador novo: espera 3 dias');
  state.settings.createdAt = now - 4 * DAY;
  assert.equal(backupDue(now), true);
  assert.equal(daysSinceBackup(now), null);

  state.settings.lastBackup = now - 10 * DAY;
  assert.equal(backupDue(now), false);
  assert.equal(daysSinceBackup(now), 10);
  state.settings.lastBackup = now - 31 * DAY;
  assert.equal(backupDue(now), true);

  snoozeBackup(now);
  assert.equal(backupDue(now + 6 * DAY), false, 'mais tarde = 7 dias');
  assert.equal(backupDue(now + 8 * DAY), true);
});

test('importar e apagar guardam uma cópia que se pode repor', () => {
  memoryStorage();
  reset();
  state.positions = [stockPos({ id: 'orig', lots: [lot(3, 30)] })];
  const backup = exportJSON();

  state.positions = [stockPos({ id: 'other' })];
  importJSON(backup);
  assert.equal(state.positions[0].id, 'orig');
  assert.equal(readUndo().reason, 'import');
  assert.equal(readUndo().data.positions[0].id, 'other');

  wipe();
  assert.equal(state.positions.length, 0);
  snapshotForUndo('wipe');
  assert.equal(readUndo().reason, 'wipe', 'estado vazio não substitui a cópia');
  assert.equal(readUndo().data.positions[0].id, 'orig');

  assert.equal(restoreUndo(), true);
  assert.equal(state.positions[0].id, 'orig');
  assert.equal(readUndo(), null);
  delete globalThis.localStorage;
});

test('backup cifrado com palavra-passe: ilegível no ficheiro, abre só com a palavra certa', async () => {
  reset();
  state.positions = [stockPos({ id: 'p1', name: 'Empresa Inventada', lots: [lot(7, 42.5)] })];
  const plain = exportJSON();
  const sealed = await sealBackup(plain, { password: 'cavalo azul mesa' });
  assert.ok(!sealed.includes('Empresa Inventada') && !sealed.includes('42.5'), 'nada em claro');
  const info = sealedInfo(sealed);
  assert.equal(info.format, 'aurora-backup');
  assert.equal(info.sync, false);
  assert.equal(await openBackup(sealed), null, 'sem palavra-passe pede-a');
  await assert.rejects(openBackup(sealed, { password: 'errada!!' }), /Palavra-passe errada/);
  assert.equal(await openBackup(sealed, { password: 'cavalo azul mesa' }), plain);
  assert.notEqual(await sealBackup(plain, { password: 'cavalo azul mesa' }), sealed, 'sal e IV novos de cada vez');
});

test('backup cifrado com a chave da sincronização abre sozinho no mesmo cofre, ou com a frase-passe', async () => {
  const salt = randomSalt();
  const { key } = await deriveKeys('quatro palavras secretas', salt, 100_000);
  const keyring = { key, salt, iter: 100_000 };
  const sealed = await sealBackup('{"positions":[]}', { keyring });
  assert.equal(sealedInfo(sealed).sync, true);
  assert.equal(await openBackup(sealed, { keyring }), '{"positions":[]}');
  const other = { key, salt: randomSalt(), iter: 100_000 };
  assert.equal(await openBackup(sealed, { keyring: other }), null, 'outro cofre: pede a frase-passe');
  assert.equal(await openBackup(sealed, { password: 'quatro palavras secretas' }), '{"positions":[]}');
});

test('backup em claro passa direto; ficheiros cifrados adulterados são recusados', async () => {
  assert.equal(sealedInfo('{"positions":[]}'), null);
  assert.equal(sealedInfo('não é json'), null);
  assert.equal(await openBackup('{"positions":[]}'), '{"positions":[]}');
  assert.equal(await sealBackup('{"a":1}'), '{"a":1}', 'sem palavra-passe nem chave fica como está');
  const sealed = JSON.parse(await sealBackup('{"positions":[]}', { password: 'palavra-passe' }));
  await assert.rejects(openBackup(JSON.stringify({ ...sealed, iter: 1e12 }), { password: 'palavra-passe' }), /inválido/);
  const ct = sealed.ct.slice(0, -4) + (sealed.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(openBackup(JSON.stringify({ ...sealed, ct }), { password: 'palavra-passe' }), /errada/);
});
