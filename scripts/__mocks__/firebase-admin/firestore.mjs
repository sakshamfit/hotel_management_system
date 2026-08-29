// In-memory mock of the subset of firebase-admin/firestore the migration CLI
// uses: collection/doc/add/set/update/get, db.batch().set/commit,
// FieldValue.serverTimestamp/delete. Data shape mirrors Firestore:
//   store[collectionPath][docId] = data
// with collectionPath like 'hotels' or 'hotels/{id}/rooms'.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SERVER_TS = { __mockField: 'serverTimestamp' };
const DELETE = { __mockField: 'delete' };

export const FieldValue = {
  serverTimestamp: () => SERVER_TS,
  delete: () => DELETE,
};

// ---- seeding / dumping ------------------------------------------------------

let store = new Map(); // collectionPath -> Map(docId -> data)

const seedPath = process.env.MOCK_FIRESTORE_SEED;
if (seedPath && existsSync(seedPath)) {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  for (const [coll, docs] of Object.entries(seed)) {
    const m = new Map();
    for (const [id, data] of Object.entries(docs)) m.set(id, structuredClone(data));
    store.set(coll, m);
  }
}

function dumpStore() {
  const dumpPath = process.env.MOCK_FIRESTORE_DUMP;
  if (!dumpPath) return;
  const out = {};
  for (const [coll, docs] of store) {
    out[coll] = {};
    for (const [id, data] of docs) out[coll][id] = data;
  }
  writeFileSync(dumpPath, JSON.stringify(out, null, 2));
}
process.on('exit', dumpStore);

// ---- path helpers -----------------------------------------------------------

function parentSegments(collPath) {
  return collPath.split('/'); // ['hotels', id, 'rooms']
}

function collMap(collPath) {
  if (!store.has(collPath)) store.set(collPath, new Map());
  return store.get(collPath);
}

// ---- snapshots --------------------------------------------------------------

class DocSnap {
  constructor(id, ref, exists) {
    this.id = id;
    this.ref = ref;
    this._exists = exists;
  }
  get exists() {
    return this._exists;
  }
  data() {
    return this._exists ? structuredClone(collMap(this.ref._coll).get(this.id)) : undefined;
  }
  get(field) {
    const d = this.data();
    return d ? d[field] : undefined;
  }
}

class QuerySnap {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
}

// ---- refs -------------------------------------------------------------------

let autoCounter = 0;
function autoId() {
  autoCounter += 1;
  return `mockdoc${String(autoCounter).padStart(6, '0')}`;
}

class DocRef {
  constructor(coll, id) {
    this._coll = coll;
    this.id = id;
    this.path = `${coll}/${id}`;
  }
  collection(name) {
    return new ColRef(`${this._coll}/${this.id}/${name}`);
  }
  async get() {
    const m = collMap(this._coll);
    return new DocSnap(this.id, this, m.has(this.id));
  }
  async set(data) {
    collMap(this._coll).set(this.id, structuredClone(data));
  }
  async update(updates) {
    const m = collMap(this._coll);
    const existing = m.get(this.id);
    if (!existing) throw new Error(`MOCK: update on missing doc ${this.path}`);
    const next = { ...existing };
    for (const [k, v] of Object.entries(updates)) {
      if (v === DELETE) delete next[k];
      else next[k] = v;
    }
    m.set(this.id, next);
  }
}

class ColRef {
  constructor(path) {
    this.path = path;
    this._segments = parentSegments(path);
  }
  doc(id) {
    return new DocRef(this.path, id ?? autoId());
  }
  async add(data) {
    const id = autoId();
    await this.doc(id).set(data);
    return new DocRef(this.path, id);
  }
  async get() {
    const m = store.get(this.path);
    const docs = m ? [...m.entries()].map(([id]) => new DocSnap(id, new DocRef(this.path, id), true)) : [];
    return new QuerySnap(docs);
  }
}

class Batch {
  constructor() {
    this._ops = [];
  }
  set(ref, data) {
    this._ops.push({ kind: 'set', ref, data });
    return this;
  }
  update(ref, data) {
    this._ops.push({ kind: 'update', ref, data });
    return this;
  }
  delete(ref) {
    this._ops.push({ kind: 'delete', ref });
    return this;
  }
  async commit() {
    for (const op of this._ops) {
      if (op.kind === 'set') await op.ref.set(op.data);
      else if (op.kind === 'update') await op.ref.update(op.data);
      else collMap(op.ref._coll).delete(op.ref.id);
    }
    this._ops = [];
  }
}

export function getFirestore() {
  return {
    collection(path) {
      return new ColRef(path);
    },
    batch() {
      return new Batch();
    },
  };
}
