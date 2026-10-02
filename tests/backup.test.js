import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, importJSON, exportJSON, wipe, readUndo, restoreUndo, snapshotForUndo } from '../js/store.js';
import { backupDue, snoozeBackup, daysSinceBackup } from '../js/backup.js';
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
