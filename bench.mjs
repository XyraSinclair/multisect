import { performance } from 'node:perf_hooks'

import * as esToolkitCore from 'es-toolkit'
import * as esToolkit from 'es-toolkit/compat'
import lodash from 'lodash'
import * as ramda from 'ramda'

import {
    difference,
    intersection,
    symmetricDifference,
    union,
} from './dist/index.js'

let sink = 0

const sameValueZero = (a, b) => a === b || (a !== a && b !== b)
const identity = (value) => value

function uniqueNaive(values, by = identity) {
    const out = []
    const keys = []
    for (const value of values) {
        const key = by(value)
        if (!keys.includes(key)) {
            keys.push(key)
            out.push(value)
        }
    }
    return out
}

function differenceNaive(a, b, by = identity) {
    const bKeys = b.map(by)
    return uniqueNaive(a, by).filter((value) => !bKeys.includes(by(value)))
}

const naive = {
    intersection(a, b, by = identity) {
        const bKeys = b.map(by)
        return uniqueNaive(a, by).filter((value) => bKeys.includes(by(value)))
    },
    difference: differenceNaive,
    symmetricDifference(a, b, by = identity) {
        return differenceNaive(a, b, by).concat(differenceNaive(b, a, by))
    },
    union(a, b, by = identity) {
        return uniqueNaive(a.concat(b), by)
    },
}

function measure(fn) {
    for (let i = 0; i < 20; i++) sink += fn().length
    let iterations = 1
    let elapsed = 0
    do {
        const start = performance.now()
        for (let i = 0; i < iterations; i++) sink += fn().length
        elapsed = performance.now() - start
        if (elapsed < 35) iterations *= 2
    } while (elapsed < 35 && iterations < 1_048_576)
    return (elapsed * 1_000) / iterations
}

function formatMicros(value) {
    if (value === null) return '—'
    if (value < 1) return value.toFixed(3)
    if (value < 10) return value.toFixed(2)
    if (value < 100) return value.toFixed(1)
    return Math.round(value).toLocaleString('en-US')
}

function resultKeys(values, by) {
    return values.map(by ?? identity)
}

function assertComparable(actual, expected, by) {
    const a = resultKeys(actual, by)
    const b = resultKeys(expected, by)
    if (a.length !== b.length) throw new Error(`benchmark implementations disagree on length`)
    for (let i = 0; i < a.length; i++) {
        if (!sameValueZero(a[i], b[i])) throw new Error(`benchmark implementations disagree at ${i}`)
    }
}

const ours = { intersection, difference, symmetricDifference, union }
const lodashOps = {
    intersection: lodash.intersection,
    difference: lodash.difference,
    symmetricDifference: lodash.xor,
    union: lodash.union,
}
const lodashByOps = {
    intersection: lodash.intersectionBy,
    difference: lodash.differenceBy,
    symmetricDifference: lodash.xorBy,
    union: lodash.unionBy,
}
const toolkitOps = {
    intersection: esToolkit.intersection,
    difference: esToolkit.difference,
    symmetricDifference: esToolkit.xor,
    union: esToolkit.union,
}
const toolkitByOps = {
    intersection: esToolkit.intersectionBy,
    difference: esToolkit.differenceBy,
    symmetricDifference: esToolkit.xorBy,
    union: esToolkit.unionBy,
}

function makeSmi(size) {
    return {
        a: Array.from({ length: size }, (_, i) => i),
        b: Array.from({ length: size }, (_, i) => i + (size >> 1)),
    }
}

function makeStrings(size) {
    return {
        a: Array.from({ length: size }, (_, i) => `value-${i}`),
        b: Array.from({ length: size }, (_, i) => `value-${i + (size >> 1)}`),
    }
}

function makeObjects(size) {
    return {
        a: Array.from({ length: size }, (_, i) => ({ key: i, side: 'a' })),
        b: Array.from({ length: size }, (_, i) => ({ key: i + (size >> 1), side: 'b' })),
        by: (value) => value.key,
    }
}

function makeDuplicates(size) {
    return {
        a: Array.from({ length: size }, (_, i) => (i * 17) & 63),
        b: Array.from({ length: size }, (_, i) => (i * 29 + 16) & 63),
    }
}

const workloads = [
    ...[10, 100, 1_000, 100_000].map((size) => ({
        name: `SMIs, ${size.toLocaleString('en-US')}`,
        ...makeSmi(size),
    })),
    { name: 'strings, 1,000', ...makeStrings(1_000) },
    { name: 'objects + by, 1,000', ...makeObjects(1_000) },
    { name: 'duplicate-heavy, 1,000', ...makeDuplicates(1_000) },
    { name: 'pre-sorted, 100,000', ...makeSmi(100_000), sorted: true },
]

console.log(`multisect benchmark — ${process.version}, ${process.arch}, ${process.platform}`)
console.log('times are microseconds per call; lower is better')
console.log()
console.log('Behavior receipt: counted intersection')
console.log(`multisect  ${JSON.stringify(intersection([1, 1, 2], [1, 1, 3], { multiset: true }))}`)
console.log(`lodash    ${JSON.stringify(lodash.intersection([1, 1, 2], [1, 1, 3]))}`)
console.log(`es-toolkit/compat ${JSON.stringify(esToolkit.intersection([1, 1, 2], [1, 1, 3]))}`)
console.log(`es-toolkit core   ${JSON.stringify(esToolkitCore.intersection([1, 1, 1], [1]))} (not counted)`)
console.log(`Ramda     ${JSON.stringify(ramda.intersection([1, 1, 2], [1, 1, 3]))}`)
console.log()

const rows = []
for (const workload of workloads) {
    for (const operation of ['intersection', 'difference', 'symmetricDifference', 'union']) {
        const opts = { sorted: workload.sorted === true, by: workload.by }
        const expected = ours[operation](workload.a, workload.b, opts)
        const lodashFn = workload.by
            ? () => lodashByOps[operation](workload.a, workload.b, workload.by)
            : () => lodashOps[operation](workload.a, workload.b)
        const toolkitFn = workload.by
            ? () => toolkitByOps[operation](workload.a, workload.b, workload.by)
            : () => toolkitOps[operation](workload.a, workload.b)
        const naiveFn = () => naive[operation](workload.a, workload.b, workload.by)
        assertComparable(lodashFn(), expected, workload.by)
        assertComparable(toolkitFn(), expected, workload.by)
        if (workload.a.length <= 10_000) assertComparable(naiveFn(), expected, workload.by)
        rows.push({
            operation,
            workload: workload.name,
            multisect: measure(() => ours[operation](workload.a, workload.b, opts)),
            lodash: measure(lodashFn),
            toolkit: measure(toolkitFn),
            naive: workload.a.length <= 10_000 ? measure(naiveFn) : null,
        })
    }
}

console.log('| operation | workload | multisect | lodash | es-toolkit/compat | naive |')
console.log('|---|---|---:|---:|---:|---:|')
for (const row of rows) {
    console.log(
        `| ${row.operation} | ${row.workload} | ${formatMicros(row.multisect)} | ${formatMicros(row.lodash)} | ${formatMicros(row.toolkit)} | ${formatMicros(row.naive)} |`
    )
}

console.log()
console.log('Adaptive crossover receipt (unique, disjoint SMI intersection):')
console.log('| n × n | pair work | nested scan | Set path | faster |')
console.log('|---:|---:|---:|---:|---|')

function nestedIntersection(a, b) {
    const out = []
    for (let i = 0; i < a.length; i++) {
        let seen = false
        for (let j = 0; j < i; j++) {
            if (sameValueZero(a[j], a[i])) {
                seen = true
                break
            }
        }
        if (seen) continue
        for (let j = 0; j < b.length; j++) {
            if (sameValueZero(a[i], b[j])) {
                out.push(a[i])
                break
            }
        }
    }
    return out
}

function setIntersection(a, b) {
    const remaining = new Set(b)
    const out = []
    for (const value of a) if (remaining.delete(value)) out.push(value)
    return out
}

for (const size of [8, 12, 14, 16, 20, 24]) {
    const a = Array.from({ length: size }, (_, i) => i)
    const b = Array.from({ length: size }, (_, i) => i + size)
    const nested = measure(() => nestedIntersection(a, b))
    const set = measure(() => setIntersection(a, b))
    console.log(
        `| ${size} × ${size} | ${size * size} | ${formatMicros(nested)} | ${formatMicros(set)} | ${nested < set ? 'nested' : 'Set'} |`
    )
}

console.log()
console.log(`counted duplicate-heavy intersection, n=1,000: ${formatMicros(measure(() => intersection(workloads[6].a, workloads[6].b, { multiset: true })))} µs (incumbents have no equivalent operation)`)
// Make it difficult for an optimizing runtime to erase benchmark calls.
if (sink === Number.MIN_VALUE) console.log(sink)
