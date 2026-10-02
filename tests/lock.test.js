import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCK_KEY, lockConfig, lockEnabled, validPin, setPin, checkPin, waitMs, failsLeft, disableLock, setAfter } from '../js/lock.js';
import { memoryStorage } from './helpers.js';

test('PIN: só algarismos, 4 a 8', () => {
  assert.ok(validPin('1234'));
  assert.ok(validPin('12345678'));
  assert.ok(!validPin('123'));
  assert.ok(!validPin('123456789'));
  assert.ok(!validPin('12a4'));
  assert.ok(!validPin(''));
});

test('PIN: guarda só o hash com sal e confirma o PIN certo', async () => {
  const store = memoryStorage();
  assert.equal(lockEnabled(), false);
  assert.equal(await checkPin('0000'), true, 'sem bloqueio, entra sempre');
  await setPin('2580');
  const raw = store.get(LOCK_KEY);
  assert.ok(!raw.includes('2580'), 'o PIN não fica guardado em claro');
  const c = lockConfig();
  assert.equal(c.len, 4);
  assert.equal(c.after, 1);
  assert.ok(c.iter >= 100_000);
  assert.equal(await checkPin('2580'), true);
  assert.equal(await checkPin('2581'), false);
  assert.equal(failsLeft(), 4);
  await setPin('99887766');
  assert.notEqual(lockConfig().salt, c.salt, 'sal novo a cada PIN');
  assert.equal(await checkPin('2580'), false);
  assert.equal(await checkPin('99887766'), true);
  assert.equal(failsLeft(), 5, 'acertar repõe as tentativas');
  await assert.rejects(setPin('12'), /4 a 8/);
});

test('PIN: 5 erros obrigam a esperar, mesmo com o PIN certo', async () => {
  memoryStorage();
  await setPin('1357');
  for (let i = 0; i < 5; i++) assert.equal(await checkPin('0000'), false);
  assert.ok(waitMs() > 25_000 && waitMs() <= 30_000);
  assert.equal(await checkPin('1357'), false);
  const c = lockConfig();
  localStorage.setItem(LOCK_KEY, JSON.stringify({ ...c, until: Date.now() - 1 }));
  assert.equal(waitMs(), 0);
  assert.equal(await checkPin('1357'), true);
  assert.equal(lockConfig().fails, 0);
});

test('bloqueio: tempo para bloquear e desligar', async () => {
  memoryStorage();
  setAfter(5);
  assert.equal(lockConfig(), null, 'sem PIN não há definições');
  await setPin('4826');
  setAfter(0);
  assert.equal(lockConfig().after, 0);
  setAfter(15);
  await setPin('4827');
  assert.equal(lockConfig().after, 15, 'mudar o PIN mantém o tempo');
  disableLock();
  assert.equal(lockEnabled(), false);
  localStorage.setItem(LOCK_KEY, '{lixo');
  assert.equal(lockEnabled(), false);
});
