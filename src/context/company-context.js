import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function runWithCompanyContext(context, callback) {
  return storage.run(context || {}, callback);
}

export function getCompanyContext() {
  return storage.getStore() || {};
}
