/* @flow */

'use strict';

import Chunk from './chunk.js';
import MemoryStore from './memory_store.js';
import Ref from './ref.js';
import Struct from './struct.js';
import test from './async_test.js';
import type {TypeDesc} from './type.js';
import {assert} from 'chai';
import {decodeNomsValue, JsonArrayReader, readValue} from './decode.js';
import {Field, makeCompoundType, makePrimitiveType, makeStructType, makeType, Type} from './type.js';
import {invariant} from './assert.js';
import {Kind} from './noms_kind.js';
import {registerPackage, Package} from './package.js';
import {suite} from 'mocha';

suite('Decode', () => {
  test('read', async () => {
    let ms = new MemoryStore();
    let a = [1, 'hi', true];
    let r = new JsonArrayReader(a, ms);

    assert.strictEqual(1, r.read());
    assert.isFalse(r.atEnd());

    assert.strictEqual('hi', r.readString());
    assert.isFalse(r.atEnd());

    assert.strictEqual(true, r.readBool());
    assert.isTrue(r.atEnd());
  });

  test('read type as tag', async () => {
    let ms = new MemoryStore();

    function doTest(expected: Type, a: Array<any>) {
      let r = new JsonArrayReader(a, ms);
      let tr = r.readTypeAsTag();
      assert.isTrue(expected.equals(tr));
    }

    doTest(makePrimitiveType(Kind.Bool), [Kind.Bool, true]);
    doTest(makePrimitiveType(Kind.Type), [Kind.Type, Kind.Bool]);
    doTest(makeCompoundType(Kind.List, makePrimitiveType(Kind.Bool)), [Kind.List, Kind.Bool, true, false]);

    let pkgRef = Ref.parse('sha1-a9993e364706816aba3e25717850c26c9cd0d89d');
    doTest(makeType(pkgRef, 42), [Kind.Unresolved, pkgRef.toString(), 42]);

    doTest(makePrimitiveType(Kind.Type), [Kind.Type, Kind.Type, pkgRef.toString()]);
  });

  test('read primitives', async () => {
    let ms = new MemoryStore();

    async function doTest(expected: any, a: Array<any>): Promise<void> {
      let r = new JsonArrayReader(a, ms);
      let v = await r.readTopLevelValue();
      assert.strictEqual(expected, v);
    }

    doTest(true, [Kind.Bool, true]);
    doTest(false, [Kind.Bool, false]);
    doTest(0, [Kind.UInt8, 0]);
    doTest(0, [Kind.UInt16, 0]);
    doTest(0, [Kind.UInt32, 0]);
    doTest(0, [Kind.UInt64, 0]);
    doTest(0, [Kind.Int8, 0]);
    doTest(0, [Kind.Int16, 0]);
    doTest(0, [Kind.Int32, 0]);
    doTest(0, [Kind.Int64, 0]);
    doTest(0, [Kind.Float32, 0]);
    doTest(0, [Kind.Float64, 0]);

    doTest('hi', [Kind.String, 'hi']);

    // TODO: Blob
  });

  test('read list of int 32', async () => {
    let ms = new MemoryStore();
    let a = [Kind.List, Kind.Int32, [0, 1, 2, 3]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();
    assert.deepEqual([0, 1, 2, 3], v);
  });

  test('read list of value', async () => {
    let ms = new MemoryStore();
    let a = [Kind.List, Kind.Value, [Kind.Int32, 1, Kind.String, 'hi', Kind.Bool, true]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();
    assert.deepEqual([1, 'hi', true], v);
  });

  test('read value list of int8', async () => {
    let ms = new MemoryStore();
    let a = [Kind.Value, Kind.List, Kind.Int8, [0, 1, 2]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();
    assert.deepEqual([0, 1, 2], v);
  });

  function assertMapsEqual(expected: Map, actual: Map): void {
    assert.strictEqual(expected.size, actual.size);
    expected.forEach((v, k) => {
      assert.isTrue(actual.has(k));
      assert.deepEqual(v, actual.get(k));
    });
  }

  test('read map of int64 to float64', async () => {
    let ms = new MemoryStore();
    let a = [Kind.Map, Kind.Int64, Kind.Float64, [0, 1, 2, 3]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();

    let m = new Map();
    m.set(0, 1);
    m.set(2, 3);

    assertMapsEqual(m, v);
  });

  test('read value map of uint64 to uint32', async () => {
    let ms = new MemoryStore();
    let a = [Kind.Value, Kind.Map, Kind.UInt64, Kind.UInt32, [0, 1, 2, 3]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();

    let m = new Map();
    m.set(0, 1);
    m.set(2, 3);

    assertMapsEqual(m, v);
  });

  function assertSetsEqual(expected: Set, actual: Set): void {
    assert.strictEqual(expected.size, actual.size);
    expected.forEach((v) => {
      assert.isTrue(actual.has(v));
    });
  }

  test('read set of uint8', async () => {
    let ms = new MemoryStore();
    let a = [Kind.Set, Kind.UInt8, [0, 1, 2, 3]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();

    let s = new Set();
    s.add(0);
    s.add(1);
    s.add(2);
    s.add(3);

    assertSetsEqual(s, v);
  });

  test('read value set of uint16', async () => {
    let ms = new MemoryStore();
    let a = [Kind.Value, Kind.Set, Kind.UInt16, [0, 1, 2, 3]];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();

    let s = new Set([0, 1, 2, 3]);
    assertSetsEqual(s, v);
  });

  function assertStruct(s: Struct, desc: TypeDesc, data: {[key: string]: any}) {
    invariant(s instanceof Struct);
    assert.deepEqual(desc, s.desc);

    for (let key in data) {
      assert.strictEqual(data[key], s.get(key));
    }
  }

  test('test read struct', async () => {
    let ms = new MemoryStore();
    let tr = makeStructType('A1', [
      new Field('x', makePrimitiveType(Kind.Int16), false),
      new Field('s', makePrimitiveType(Kind.String), false),
      new Field('b', makePrimitiveType(Kind.Bool), false)
    ], []);

    let pkg = new Package([tr], []);
    registerPackage(pkg);

    let a = [Kind.Unresolved, pkg.ref.toString(), 0, 42, 'hi', true];
    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();

    assertStruct(v, tr.desc, {
      x: 42,
      s: 'hi',
      b: true
    });
  });

  test('test read map of string to struct', async () => {
    let ms = new MemoryStore();
    let tr = makeStructType('s', [
      new Field('b', makePrimitiveType(Kind.Bool), false),
      new Field('i', makePrimitiveType(Kind.Int32), false)
    ], []);

    let pkg = new Package([tr], []);
    registerPackage(pkg);

    let a = [Kind.Value, Kind.Map, Kind.String, Kind.Unresolved, pkg.ref.toString(), 0, ['foo', true, 3, 'bar', false, 2, 'baz', false, 1]];

    let r = new JsonArrayReader(a, ms);
    let v = await r.readTopLevelValue();

    invariant(v instanceof Map);
    assert.strictEqual(3, v.size);

    assertStruct(v.get('foo'), tr.desc, {b: true, i: 3});
    assertStruct(v.get('bar'), tr.desc, {b: false, i: 2});
    assertStruct(v.get('baz'), tr.desc, {b: false, i: 1});
  });

  test('decodeNomsValue', async () => {
    let chunk = Chunk.fromString(`t [${Kind.Value}, ${Kind.Set}, ${Kind.UInt16}, [0, 1, 2, 3]]`);
    let v = await decodeNomsValue(chunk, new MemoryStore());
    let s = new Set([0, 1, 2, 3]);
    assertSetsEqual(s, v);
  });

  test('decodeNomsValue: counter with one commit', async () => {
    let ms = new MemoryStore();
    let root = Ref.parse('sha1-a53578b3f9f39646df642f010fc9924aec0b4b2f');
    ms.put(Chunk.fromString('t [15,11,16,21,"sha1-7546d804d845125bc42669c7a4c3f3fb909eca29",0,["counter","sha1-d796f8295b4ffa0a0711bfb844f07827012923d3"]]')); // root
    ms.put(Chunk.fromString('t [22,[19,"Commit",["value",13,false,"parents",17,[16,[21,"sha1-0000000000000000000000000000000000000000",0]],false],[]],[]]')); // datas package
    ms.put(Chunk.fromString('t [21,"sha1-7546d804d845125bc42669c7a4c3f3fb909eca29",0,4,1,[]]')); // commit

    let rootMap = await readValue(root, ms);
    let counterRef = rootMap.get('counter');
    let commit = await readValue(counterRef, ms);
    assert.strictEqual(1, commit.get('value'));
  });
});